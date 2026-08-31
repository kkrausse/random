package dev.example.kindlecontext;

import android.accessibilityservice.AccessibilityButtonController;
import android.accessibilityservice.AccessibilityService;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.text.Spanned;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONException;

import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public class KindleAccessibilityService extends AccessibilityService {
    public static final String KINDLE_PACKAGE = "com.amazon.kindle";
    public static final String SUBSTACK_PACKAGE = "com.substack.app";
    public static final String PREFS = "capture";
    public static final String CURRENT_TEXT_KEY = "current_text_v2";
    public static final String PREVIOUS_TEXT_KEY = "previous_text_v2";
    public static final String HISTORY_TEXT_KEY = "page_history_v1";
    public static final String SELECTED_TEXT_KEY = "selected_text_v1";
    public static final String EVENT_KEY = "latest_event";
    public static final String SOURCE_PACKAGE_KEY = "source_package_v1";
    public static final String SOURCE_LABEL_KEY = "source_label_v1";
    public static final String SOURCE_TITLE_KEY = "source_title_v1";
    public static final String SOURCE_AUTHOR_KEY = "source_author_v1";
    public static final String READ_CLIPBOARD_EXTRA = "read_clipboard";

    private static final String TAG = "KindleContext";
    private static final String LEGACY_TEXT_KEY = "latest_text";
    private static final String TREE_DUMP_FILE = "reading-accessibility-tree.txt";
    private static final String EVENT_DUMP_FILE = "reading-accessibility-events.txt";
    private static final long TEXT_POLL_MS = 1500;
    private static final long COPY_SETTLE_MS = 250;
    public static final int MAX_CONTEXT_WORDS = 5_000;

    private static final class ReadingSource {
        final String packageName;
        final String label;
        final String copyAction;
        final boolean cacheTransientCopy;

        ReadingSource(String packageName, String label, String copyAction,
                boolean cacheTransientCopy) {
            this.packageName = packageName;
            this.label = label;
            this.copyAction = copyAction;
            this.cacheTransientCopy = cacheTransientCopy;
        }
    }

    // Adding another reader should only require a source profile unless its UI needs a new strategy.
    private static final List<ReadingSource> READING_SOURCES = List.of(
            new ReadingSource(KINDLE_PACKAGE, "Kindle", "Copy", false),
            new ReadingSource(SUBSTACK_PACKAGE, "Substack", "Copy", true));

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable textPoll = new Runnable() {
        @Override
        public void run() {
            if (activeSource() != null) {
                captureCurrentTree();
            }
            mainHandler.postDelayed(this, TEXT_POLL_MS);
        }
    };

    private AccessibilityButtonController accessibilityButtonController;
    private AccessibilityButtonController.AccessibilityButtonCallback accessibilityButtonCallback;
    private AccessibilityNodeInfo pendingCopyAction;
    private String pendingCopyPackage;

    private static final class MetadataCandidate {
        String title = "";
        String author = "";
    }

    @Override
    protected void onServiceConnected() {
        migrateCapturedProse();
        accessibilityButtonController = getAccessibilityButtonController();
        accessibilityButtonCallback = new AccessibilityButtonController.AccessibilityButtonCallback() {
            @Override
            public void onClicked(AccessibilityButtonController controller) {
                dumpCurrentTree();
                captureSelectedText();
                captureCurrentTree();
                if (!copySelection()) {
                    openCaptureActivity(false);
                }
            }

            @Override
            public void onAvailabilityChanged(
                    AccessibilityButtonController controller, boolean available) {
                Log.i(TAG, "Accessibility button available=" + available);
            }
        };
        accessibilityButtonController.registerAccessibilityButtonCallback(accessibilityButtonCallback);
        mainHandler.post(textPoll);
        Log.i(TAG, "Text-only service connected; use K to inspect captured prose");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        CharSequence packageName = event.getPackageName();
        ReadingSource source = sourceFor(packageName);
        if (source == null) {
            return;
        }

        String eventDescription = AccessibilityEvent.eventTypeToString(event.getEventType())
                + " class=" + event.getClassName()
                + " text=" + event.getText()
                + " description=" + event.getContentDescription();
        Log.i(TAG, eventDescription);
        cacheCopyAction(event, source);
        cacheSourceMetadata(event, source);
        appendEventDump(event);
        getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putString(EVENT_KEY, eventDescription)
                .apply();
        captureCurrentTree();
    }

    @Override
    public void onInterrupt() {
    }

    private int collectText(AccessibilityNodeInfo node, Set<String> pieces, Rect screenBounds) {
        int count = 1;
        Rect nodeBounds = new Rect();
        node.getBoundsInScreen(nodeBounds);
        if (!nodeBounds.isEmpty() && Rect.intersects(screenBounds, nodeBounds)) {
            addText(node.getText(), pieces, false);
            addText(node.getContentDescription(), pieces, true);
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                count += collectText(child, pieces, screenBounds);
            }
        }
        return count;
    }

    private void addText(CharSequence value, Set<String> pieces, boolean requireProse) {
        if (value == null) {
            return;
        }
        String text = value.toString().trim();
        if (!text.isEmpty() && (!requireProse || looksLikeProseFragment(text))) {
            pieces.add(text);
        }
    }

    private boolean looksLikeProseFragment(String text) {
        int spaces = 0;
        for (int i = 0; i < text.length(); i++) {
            if (Character.isWhitespace(text.charAt(i))) {
                spaces++;
            }
        }
        return text.length() >= 80 && spaces >= 10;
    }

    private void collectSelectedText(AccessibilityNodeInfo node, Set<String> pieces) {
        CharSequence text = node.getText();
        int start = node.getTextSelectionStart();
        int end = node.getTextSelectionEnd();
        if (text != null && start >= 0 && end > start && end <= text.length()) {
            String selected = text.subSequence(start, end).toString().trim();
            if (!selected.isEmpty()) {
                pieces.add(selected);
            }
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectSelectedText(child, pieces);
            }
        }
    }

    private void captureSelectedText() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        ReadingSource source = sourceFor(root == null ? null : root.getPackageName());
        if (source == null) {
            return;
        }

        prepareSource(source);
        Set<String> pieces = new LinkedHashSet<>();
        collectSelectedText(root, pieces);
        String selected = String.join("\n\n", pieces).trim();
        getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putString(SELECTED_TEXT_KEY, selected)
                .apply();
        Log.i(TAG, selected.isEmpty()
                ? source.label + " exposed no text selection offsets"
                : "Captured " + selected.length() + " selected characters");
    }

    private boolean copySelection() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        ReadingSource source = sourceFor(root == null ? null : root.getPackageName());
        if (source == null || source.copyAction == null) {
            return false;
        }

        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        clipboard.clearPrimaryClip();
        if (source.packageName.equals(pendingCopyPackage) && pendingCopyAction != null) {
            boolean copied = pendingCopyAction.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            clearPendingCopyAction();
            if (copied) {
                Log.i(TAG, "Invoked cached " + source.label + " Copy action");
                mainHandler.postDelayed(() -> openCaptureActivity(true), COPY_SETTLE_MS);
                return true;
            }
            Log.i(TAG, source.label + " cached Copy action was no longer valid");
        }
        AccessibilityNodeInfo copy = findAction(root, source.copyAction);
        if (copy == null) {
            Log.i(TAG, source.label + " did not expose a " + source.copyAction + " action");
            return false;
        }
        if (!copy.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            Log.w(TAG, source.label + " exposed " + source.copyAction
                    + " but rejected ACTION_CLICK");
            return false;
        }

        mainHandler.postDelayed(() -> openCaptureActivity(true), COPY_SETTLE_MS);
        return true;
    }

    private void cacheCopyAction(AccessibilityEvent event, ReadingSource source) {
        AccessibilityNodeInfo eventSource = event.getSource();
        if (eventSource == null || !source.cacheTransientCopy || source.copyAction == null) {
            return;
        }
        AccessibilityNodeInfo copy = findAction(eventSource, source.copyAction);
        if (copy != null) {
            clearPendingCopyAction();
            pendingCopyAction = AccessibilityNodeInfo.obtain(copy);
            pendingCopyPackage = source.packageName;
            Log.i(TAG, "Cached " + source.label + " Copy action from accessibility event");
        }
    }

    private void clearPendingCopyAction() {
        if (pendingCopyAction != null) {
            pendingCopyAction.recycle();
            pendingCopyAction = null;
        }
        pendingCopyPackage = null;
    }

    private void cacheSourceMetadata(AccessibilityEvent event, ReadingSource source) {
        if (!KINDLE_PACKAGE.equals(source.packageName)
                || event.getEventType() != AccessibilityEvent.TYPE_VIEW_CLICKED) {
            return;
        }
        AccessibilityNodeInfo node = event.getSource();
        String viewId = node == null ? null : node.getViewIdResourceName();
        if (viewId == null || !(viewId.endsWith("/badgeable_cover")
                || viewId.endsWith("/book_in_bottom_bar"))) {
            return;
        }
        SourceMetadata metadata = SourceMetadata.fromKindleDescription(
                node.getContentDescription() == null ? null : node.getContentDescription().toString());
        if (metadata.title.isEmpty()) {
            return;
        }
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putString("pending_source_title_v1", metadata.title)
                .putString("pending_source_author_v1", metadata.author)
                .apply();
        Log.i(TAG, "Captured Kindle metadata for " + metadata.title);
    }

    private AccessibilityNodeInfo findAction(AccessibilityNodeInfo node, String name) {
        CharSequence description = node.getContentDescription();
        CharSequence text = node.getText();
        boolean matches = description != null && name.equalsIgnoreCase(description.toString())
                || text != null && name.equalsIgnoreCase(text.toString());
        if (matches && node.isClickable()) {
            return node;
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                AccessibilityNodeInfo result = findAction(child, name);
                if (result != null) {
                    return result;
                }
            }
        }
        return null;
    }

    private void openCaptureActivity(boolean readClipboard) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra(READ_CLIPBOARD_EXTRA, readClipboard);
        startActivity(intent);
    }

    private void dumpCurrentTree() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        ReadingSource source = sourceFor(root == null ? null : root.getPackageName());
        if (source == null) {
            return;
        }

        StringBuilder dump = new StringBuilder();
        appendNodeDump(root, 0, dump);
        writeDiagnostic(TREE_DUMP_FILE, dump.toString(), MODE_PRIVATE);
        Log.i(TAG, "Wrote " + source.label + " accessibility tree diagnostics for "
                + dumpNodeCount(root) + " nodes");
    }

    private void appendNodeDump(AccessibilityNodeInfo node, int depth, StringBuilder dump) {
        dump.append("  ".repeat(depth));
        appendNodeDetails(node, dump);
        dump.append('\n');
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                appendNodeDump(child, depth + 1, dump);
            }
        }
    }

    private void appendNodeDetails(AccessibilityNodeInfo node, StringBuilder dump) {
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        CharSequence text = node.getText();
        dump.append("class=").append(node.getClassName())
                .append(" viewId=").append(node.getViewIdResourceName())
                .append(" bounds=").append(bounds)
                .append(" selected=").append(node.isSelected())
                .append(" focused=").append(node.isFocused())
                .append(" accessibilityFocused=").append(node.isAccessibilityFocused())
                .append(" editable=").append(node.isEditable())
                .append(" selection=").append(node.getTextSelectionStart())
                .append("..").append(node.getTextSelectionEnd())
                .append(" actions=").append(node.getActionList())
                .append(" extras=").append(node.getExtras())
                .append(" description=").append(quoted(node.getContentDescription()))
                .append(" text=").append(quoted(text));

        if (text instanceof Spanned) {
            Spanned spanned = (Spanned) text;
            Object[] spans = spanned.getSpans(0, spanned.length(), Object.class);
            dump.append(" spans=[");
            for (int i = 0; i < spans.length; i++) {
                if (i > 0) {
                    dump.append(", ");
                }
                Object span = spans[i];
                dump.append(span.getClass().getName())
                        .append('@').append(spanned.getSpanStart(span))
                        .append("..").append(spanned.getSpanEnd(span))
                        .append(" flags=").append(spanned.getSpanFlags(span));
            }
            dump.append(']');
        }
    }

    private void appendEventDump(AccessibilityEvent event) {
        StringBuilder dump = new StringBuilder()
                .append("\nEVENT time=").append(event.getEventTime())
                .append(" type=").append(AccessibilityEvent.eventTypeToString(event.getEventType()))
                .append(" action=").append(event.getAction())
                .append(" from=").append(event.getFromIndex())
                .append(" to=").append(event.getToIndex())
                .append(" itemCount=").append(event.getItemCount())
                .append(" contentChanges=").append(event.getContentChangeTypes())
                .append(" text=").append(quoted(event.getText()))
                .append(" description=").append(quoted(event.getContentDescription()))
                .append('\n');
        AccessibilityNodeInfo source = event.getSource();
        if (source != null) {
            dump.append("SOURCE ");
            appendNodeDetails(source, dump);
            dump.append('\n');
        }
        writeDiagnostic(EVENT_DUMP_FILE, dump.toString(), MODE_APPEND);
    }

    private int dumpNodeCount(AccessibilityNodeInfo node) {
        int count = 1;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                count += dumpNodeCount(child);
            }
        }
        return count;
    }

    private String quoted(Object value) {
        if (value == null) {
            return "null";
        }
        return '"' + value.toString()
                .replace("\\", "\\\\")
                .replace("\n", "\\n")
                .replace("\r", "\\r") + '"';
    }

    private void writeDiagnostic(String name, String contents, int mode) {
        try (FileOutputStream output = openFileOutput(name, mode)) {
            output.write(contents.getBytes(StandardCharsets.UTF_8));
        } catch (IOException error) {
            Log.e(TAG, "Could not write " + name, error);
        }
    }

    private void captureCurrentTree() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        ReadingSource source = sourceFor(root == null ? null : root.getPackageName());
        if (source == null || KINDLE_PACKAGE.equals(source.packageName)
                && !containsViewId(root, "/reader_view_bookmark_container")) {
            return;
        }

        prepareSource(source);
        Set<String> pieces = new LinkedHashSet<>();
        Rect screenBounds = new Rect(0, 0,
                getResources().getDisplayMetrics().widthPixels,
                getResources().getDisplayMetrics().heightPixels);
        int nodeCount = collectText(root, pieces, screenBounds);
        MetadataCandidate metadata = new MetadataCandidate();
        collectMetadata(root, source, metadata);
        String text = String.join("\n\n", pieces).trim();
        if (!looksLikeProse(text)) {
            Log.i(TAG, "No " + source.label + " prose; inspected " + text.length()
                    + " characters from " + nodeCount + " nodes");
            return;
        }

        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        String current = preferences.getString(CURRENT_TEXT_KEY, "");
        if (text.equals(current)) {
            saveMetadata(preferences, metadata, false);
            return;
        }

        JSONArray history = loadPageHistory(preferences);
        boolean selectedNewSource = !preferences.getString(
                "pending_source_title_v1", "").isEmpty();
        boolean continuous = !looksLikeProse(current)
                || !selectedNewSource && SnapshotContinuity.overlaps(current, text);
        if (!continuous) {
            history = new JSONArray();
            Log.i(TAG, "Started a new " + source.label
                    + " context chain because the prose did not overlap");
        } else if (looksLikeProse(current)
                && (history.length() == 0
                || !current.equals(history.optString(history.length() - 1)))) {
            history.put(current);
        }
        int retainedWords = countWords(text);
        for (int i = 0; i < history.length(); i++) {
            retainedWords += countWords(history.optString(i));
        }
        while (history.length() > 0
                && retainedWords - countWords(history.optString(0)) >= MAX_CONTEXT_WORDS) {
            retainedWords -= countWords(history.optString(0));
            history.remove(0);
        }
        preferences.edit()
                .putString(PREVIOUS_TEXT_KEY, continuous ? current : "")
                .putString(HISTORY_TEXT_KEY, history.toString())
                .putString(CURRENT_TEXT_KEY, text)
                .apply();
        saveMetadata(preferences, metadata, !continuous || !looksLikeProse(current));
        Log.i(TAG, "Captured " + text.length() + " characters from " + nodeCount + " nodes");
    }

    private boolean containsViewId(AccessibilityNodeInfo node, String suffix) {
        String viewId = node.getViewIdResourceName();
        if (viewId != null && viewId.endsWith(suffix)) {
            return true;
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null && containsViewId(child, suffix)) {
                return true;
            }
        }
        return false;
    }

    private void collectMetadata(AccessibilityNodeInfo node, ReadingSource source,
            MetadataCandidate candidate) {
        CharSequence nodeText = node.getText();
        String text = nodeText == null ? "" : nodeText.toString().trim();
        String viewId = node.getViewIdResourceName();
        String id = viewId == null ? "" : viewId.toLowerCase(java.util.Locale.ROOT);
        if (candidate.title.isEmpty() && plausibleMetadata(text)
                && (id.contains("article_title") || id.contains("post_title")
                || id.contains("story_title"))) {
            candidate.title = text;
        }
        if (candidate.author.isEmpty() && plausibleMetadata(text)
                && (id.contains("author") || id.contains("byline"))) {
            candidate.author = text.replaceFirst("(?i)^by\\s+", "");
        }
        if (SUBSTACK_PACKAGE.equals(source.packageName)) {
            if (plausibleMetadata(text) && node.isHeading()
                    && text.length() > candidate.title.length()) {
                candidate.title = text;
            }
            if (candidate.author.isEmpty() && text.matches("(?i)^by\\s+.{2,100}$")) {
                candidate.author = text.substring(3).trim();
            }
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectMetadata(child, source, candidate);
            }
        }
    }

    private boolean plausibleMetadata(String text) {
        return !text.isEmpty() && text.length() <= 300 && countWords(text) <= 40;
    }

    private void saveMetadata(SharedPreferences preferences, MetadataCandidate candidate,
            boolean newChain) {
        String pendingTitle = preferences.getString("pending_source_title_v1", "");
        String pendingAuthor = preferences.getString("pending_source_author_v1", "");
        String title = !pendingTitle.isEmpty() ? pendingTitle : candidate.title;
        String author = !pendingTitle.isEmpty() ? pendingAuthor : candidate.author;
        SharedPreferences.Editor editor = preferences.edit();
        if (newChain) {
            editor.putString(SOURCE_TITLE_KEY, title)
                    .putString(SOURCE_AUTHOR_KEY, author)
                    .remove("pending_source_title_v1")
                    .remove("pending_source_author_v1");
        } else {
            if (!candidate.title.isEmpty()) {
                editor.putString(SOURCE_TITLE_KEY, candidate.title);
            }
            if (!candidate.author.isEmpty()) {
                editor.putString(SOURCE_AUTHOR_KEY, candidate.author);
            }
        }
        editor.apply();
    }

    private JSONArray loadPageHistory(SharedPreferences preferences) {
        try {
            JSONArray history = new JSONArray(preferences.getString(HISTORY_TEXT_KEY, "[]"));
            if (history.length() == 0) {
                String previous = preferences.getString(PREVIOUS_TEXT_KEY, "");
                if (looksLikeProse(previous)) {
                    history.put(previous);
                }
            }
            return history;
        } catch (JSONException error) {
            return new JSONArray();
        }
    }

    private boolean looksLikeProse(String text) {
        if (text.length() < 200) {
            return false;
        }
        int spaces = 0;
        for (int i = 0; i < text.length(); i++) {
            if (Character.isWhitespace(text.charAt(i))) {
                spaces++;
            }
        }
        return spaces >= 30;
    }

    private int countWords(String text) {
        String trimmed = text.trim();
        return trimmed.isEmpty() ? 0 : trimmed.split("\\s+").length;
    }

    private void migrateCapturedProse() {
        String current = getSharedPreferences(PREFS, MODE_PRIVATE)
                .getString(CURRENT_TEXT_KEY, "");
        if (looksLikeProse(current)) {
            return;
        }

        String legacy = getSharedPreferences(PREFS, MODE_PRIVATE)
                .getString(LEGACY_TEXT_KEY, "");
        int separator = legacy.indexOf("\n\n");
        if (separator >= 0) {
            legacy = legacy.substring(separator + 2);
        }
        if (looksLikeProse(legacy)) {
            getSharedPreferences(PREFS, MODE_PRIVATE)
                    .edit()
                    .putString(CURRENT_TEXT_KEY, legacy)
                    .putString(PREVIOUS_TEXT_KEY, "")
                    .apply();
        }
    }

    private ReadingSource activeSource() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        return sourceFor(root == null ? null : root.getPackageName());
    }

    private ReadingSource sourceFor(CharSequence packageName) {
        if (packageName == null) {
            return null;
        }
        for (ReadingSource source : READING_SOURCES) {
            if (source.packageName.contentEquals(packageName)) {
                return source;
            }
        }
        return null;
    }

    private void prepareSource(ReadingSource source) {
        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        String previousSource = preferences.getString(SOURCE_PACKAGE_KEY, "");
        if (source.packageName.equals(previousSource)
                && source.label.equals(preferences.getString(SOURCE_LABEL_KEY, ""))) {
            return;
        }
        SharedPreferences.Editor editor = preferences.edit()
                .putString(SOURCE_PACKAGE_KEY, source.packageName)
                .putString(SOURCE_LABEL_KEY, source.label);
        if (!source.packageName.equals(previousSource)) {
            clearPendingCopyAction();
            editor.putString(CURRENT_TEXT_KEY, "")
                    .putString(PREVIOUS_TEXT_KEY, "")
                    .putString(HISTORY_TEXT_KEY, "[]")
                    .putString(SELECTED_TEXT_KEY, "")
                    .putString(SOURCE_TITLE_KEY, "")
                    .putString(SOURCE_AUTHOR_KEY, "")
                    .remove("pending_source_title_v1")
                    .remove("pending_source_author_v1");
        }
        editor.apply();
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        clearPendingCopyAction();
        if (accessibilityButtonController != null && accessibilityButtonCallback != null) {
            accessibilityButtonController.unregisterAccessibilityButtonCallback(accessibilityButtonCallback);
        }
        super.onDestroy();
    }
}
