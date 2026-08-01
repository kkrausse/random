package dev.example.kindlecontext;

import android.accessibilityservice.AccessibilityButtonController;
import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.text.Spanned;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;

public class KindleAccessibilityService extends AccessibilityService {
    public static final String KINDLE_PACKAGE = "com.amazon.kindle";
    public static final String PREFS = "capture";
    public static final String CURRENT_TEXT_KEY = "current_text_v2";
    public static final String PREVIOUS_TEXT_KEY = "previous_text_v2";
    public static final String SELECTED_TEXT_KEY = "selected_text_v1";
    public static final String EVENT_KEY = "latest_event";

    private static final String TAG = "KindleContext";
    private static final String LEGACY_TEXT_KEY = "latest_text";
    private static final String TREE_DUMP_FILE = "kindle-accessibility-tree.txt";
    private static final String EVENT_DUMP_FILE = "kindle-accessibility-events.txt";
    private static final long TEXT_POLL_MS = 1500;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable textPoll = new Runnable() {
        @Override
        public void run() {
            if (isKindleActive()) {
                captureCurrentTree();
            }
            mainHandler.postDelayed(this, TEXT_POLL_MS);
        }
    };

    private AccessibilityButtonController accessibilityButtonController;
    private AccessibilityButtonController.AccessibilityButtonCallback accessibilityButtonCallback;

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
                Intent intent = new Intent(KindleAccessibilityService.this, MainActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                startActivity(intent);
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
        if (packageName == null || !KINDLE_PACKAGE.contentEquals(packageName)) {
            return;
        }

        String eventDescription = AccessibilityEvent.eventTypeToString(event.getEventType())
                + " class=" + event.getClassName()
                + " text=" + event.getText()
                + " description=" + event.getContentDescription();
        Log.i(TAG, eventDescription);
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

    private int collectText(AccessibilityNodeInfo node, Set<String> pieces) {
        int count = 1;
        CharSequence text = node.getText();
        if (text != null && !text.toString().trim().isEmpty()) {
            pieces.add(text.toString().trim());
        }

        CharSequence description = node.getContentDescription();
        if (description != null && !description.toString().trim().isEmpty()) {
            pieces.add(description.toString().trim());
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                count += collectText(child, pieces);
            }
        }
        return count;
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
        if (root == null || root.getPackageName() == null
                || !KINDLE_PACKAGE.contentEquals(root.getPackageName())) {
            return;
        }

        Set<String> pieces = new LinkedHashSet<>();
        collectSelectedText(root, pieces);
        String selected = String.join("\n\n", pieces).trim();
        getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putString(SELECTED_TEXT_KEY, selected)
                .apply();
        Log.i(TAG, selected.isEmpty()
                ? "Kindle exposed no text selection offsets"
                : "Captured " + selected.length() + " selected characters");
    }

    private void dumpCurrentTree() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || root.getPackageName() == null
                || !KINDLE_PACKAGE.contentEquals(root.getPackageName())) {
            return;
        }

        StringBuilder dump = new StringBuilder();
        appendNodeDump(root, 0, dump);
        writeDiagnostic(TREE_DUMP_FILE, dump.toString(), MODE_PRIVATE);
        Log.i(TAG, "Wrote accessibility tree diagnostics for "
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
        if (root == null || root.getPackageName() == null
                || !KINDLE_PACKAGE.contentEquals(root.getPackageName())) {
            return;
        }

        Set<String> pieces = new LinkedHashSet<>();
        int nodeCount = collectText(root, pieces);
        String text = String.join("\n\n", pieces).trim();
        if (!looksLikeProse(text)) {
            Log.i(TAG, "No Kindle prose; inspected " + text.length()
                    + " characters from " + nodeCount + " nodes");
            return;
        }

        String current = getSharedPreferences(PREFS, MODE_PRIVATE)
                .getString(CURRENT_TEXT_KEY, "");
        if (text.equals(current)) {
            return;
        }

        getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putString(PREVIOUS_TEXT_KEY, current)
                .putString(CURRENT_TEXT_KEY, text)
                .apply();
        Log.i(TAG, "Captured " + text.length() + " characters from " + nodeCount + " nodes");
    }

    private boolean looksLikeProse(String text) {
        if (text.length() < 800) {
            return false;
        }
        int spaces = 0;
        for (int i = 0; i < text.length(); i++) {
            if (Character.isWhitespace(text.charAt(i))) {
                spaces++;
            }
        }
        return spaces >= 100;
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

    private boolean isKindleActive() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        return root != null
                && root.getPackageName() != null
                && KINDLE_PACKAGE.contentEquals(root.getPackageName());
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        if (accessibilityButtonController != null && accessibilityButtonCallback != null) {
            accessibilityButtonController.unregisterAccessibilityButtonCallback(accessibilityButtonCallback);
        }
        super.onDestroy();
    }
}
