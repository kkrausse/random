package dev.example.kindlecontext;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.ArrayAdapter;
import android.widget.AdapterView;
import android.widget.Spinner;
import android.widget.TextView;

import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import io.noties.markwon.Markwon;

public class MainActivity extends Activity {
    private static final String SETTINGS = "opencode_connection";
    private static final String SERVER_KEY = "server_url";
    private static final String TOKEN_KEY = "server_token";
    private static final String DIRECTORY_KEY = "workspace_directory";
    private static final String MODEL_PROVIDER_KEY = "model_provider";
    private static final String MODEL_ID_KEY = "model_id";
    private static final String MODEL_VARIANT_KEY = "model_variant";
    private static final String DEFAULT_SERVER = "http://raspberrypi.example.ts.net:41137";
    private static final String DEFAULT_DIRECTORY = "/home/pi/deploys/palma2-opencode/workdir";
    private static final String DEFAULT_MODEL_PROVIDER = "opencode";
    private static final String DEFAULT_MODEL_ID = "laguna-s-2.1-free";
    private static final String DEFAULT_MODEL_VARIANT = "medium";

    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String sessionId;
    private boolean readClipboardOnResume;
    private boolean polling;
    private LinearLayout root;
    private LinearLayout toolbar;
    private LinearLayout transcript;
    private ScrollView scrollView;
    private TextView statusView;
    private TextView accessibilityStatusView;
    private boolean followChatBottom;
    private boolean userScrolling;
    private Markwon markwon;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        markwon = Markwon.create(this);
        acceptSharedText(getIntent());
        acceptCaptureIntent(getIntent());
        showCapture();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        acceptSharedText(intent);
        acceptCaptureIntent(intent);
        showCapture();
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateAccessibilityStatus();
        if (readClipboardOnResume) {
            readClipboardOnResume = false;
            handler.postDelayed(() -> {
                captureClipboardText();
                showCapture();
            }, 250);
        }
    }

    private void showCapture() {
        polling = false;
        beginScreen();
        addTopBar("NEW QUESTION");
        addTitle("READING CONTEXT");

        String enabled = Settings.Secure.getString(
                getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null || !enabled.contains(getPackageName())) {
            status("Capture service is disabled.");
            Button enable = button("ENABLE CAPTURE SERVICE");
            enable.setOnClickListener(v -> startActivity(
                    new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
            root.addView(enable);
        }

        String selected = captured(KindleAccessibilityService.SELECTED_TEXT_KEY);
        String current = captured(KindleAccessibilityService.CURRENT_TEXT_KEY);
        String previous = captured(KindleAccessibilityService.PREVIOUS_TEXT_KEY);
        addContext("HIGHLIGHT", selected, "No highlight captured");
        addContext("VISIBLE PAGE", current, "No page context captured");
        if (!previous.isEmpty()) {
            addContext("PREVIOUS PAGE", previous, "");
        }

        addSection("ASK");
        addPromptButton("EXPLAIN TERMS", "Identify up to five terms, names, allusions, or references "
                + "in the highlighted passage that a reader may not recognize. Give a brief explanation "
                + "of each in this context. Do not list ordinary words merely to fill space.");
        addPromptButton("WHY IT MATTERS", "Explain what role the highlighted passage plays in the "
                + "author's broader point or the surrounding discussion. Base the answer only on the "
                + "supplied text and distinguish inference from explicit evidence.");
        addPromptButton("HISTORICAL CONTEXT", "Give the minimum historical, cultural, scientific, or "
                + "philosophical context needed to understand the highlighted passage. Research external "
                + "facts when useful and distinguish them from the book's claims.");

        EditText custom = input("Ask your own question...");
        custom.setMinLines(2);
        root.addView(custom);
        Button send = button("START CHAT");
        send.setOnClickListener(v -> {
            String question = custom.getText().toString().trim();
            if (!question.isEmpty()) {
                startChat(question);
            }
        });
        root.addView(send);
        statusView = status("");
    }

    private void showChat() {
        beginScreen();
        addTopBar("CHAT");
        followChatBottom = true;
        transcript = new LinearLayout(this);
        transcript.setOrientation(LinearLayout.VERTICAL);
        root.addView(transcript);
        statusView = status("Loading conversation...");

        EditText reply = input("Reply...");
        reply.setSingleLine(false);
        reply.setImeOptions(EditorInfo.IME_ACTION_SEND);
        root.addView(reply);
        Button send = button("SEND");
        send.setOnClickListener(v -> {
            String text = reply.getText().toString().trim();
            if (!text.isEmpty()) {
                reply.setText("");
                sendFollowUp(text);
            }
        });
        root.addView(send);
        polling = true;
        loadMessages();
    }

    private void showSessions() {
        polling = false;
        beginScreen();
        addTopBar("PAST CHATS");
        addTitle("READING CHATS");
        statusView = status("Loading...");
        network.execute(() -> {
            try {
                List<OpenCodeClient.Session> sessions = client().listSessions();
                runOnUiThread(() -> {
                    statusView.setText(sessions.isEmpty() ? "No chats yet." : "");
                    DateFormat format = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT);
                    for (OpenCodeClient.Session session : sessions) {
                        Button item = button(session.title + "\n" + format.format(new Date(session.updated)));
                        item.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
                        item.setOnClickListener(v -> {
                            sessionId = session.id;
                            showChat();
                        });
                        root.addView(item);
                    }
                });
            } catch (Exception error) {
                showError(error);
            }
        });
    }

    private void showSettings() {
        polling = false;
        beginScreen();
        addTopBar("CONNECTION");
        SharedPreferences preferences = getSharedPreferences(SETTINGS, MODE_PRIVATE);
        EditText server = settingInput("SERVER URL",
                preferences.getString(SERVER_KEY, DEFAULT_SERVER));
        EditText directory = settingInput("WORKSPACE DIRECTORY",
                preferences.getString(DIRECTORY_KEY, DEFAULT_DIRECTORY));
        EditText token = settingInput("SERVER PASSWORD",
                preferences.getString(TOKEN_KEY, ""));
        token.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        addSection("NEW CHAT MODEL");
        Spinner modelSpinner = new Spinner(this);
        root.addView(modelSpinner, new LinearLayout.LayoutParams(-1, dp(52)));
        Spinner variantSpinner = new Spinner(this);
        root.addView(variantSpinner, new LinearLayout.LayoutParams(-1, dp(52)));
        List<OpenCodeClient.Model> availableModels = new ArrayList<>();
        List<String> availableVariants = new ArrayList<>();
        ArrayAdapter<String> loadingModels = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, List.of("Loading models..."));
        loadingModels.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        modelSpinner.setAdapter(loadingModels);
        setVariantChoices(variantSpinner, availableVariants, null, "");
        modelSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (position >= availableModels.size()) {
                    return;
                }
                OpenCodeClient.Model selected = availableModels.get(position);
                String preferred = selected.providerId.equals(preferences.getString(
                        MODEL_PROVIDER_KEY, DEFAULT_MODEL_PROVIDER))
                        && selected.modelId.equals(preferences.getString(
                        MODEL_ID_KEY, DEFAULT_MODEL_ID))
                        ? preferences.getString(MODEL_VARIANT_KEY, DEFAULT_MODEL_VARIANT) : "";
                setVariantChoices(variantSpinner, availableVariants, selected, preferred);
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });
        Button save = button("SAVE AND TEST");
        save.setOnClickListener(v -> {
            SharedPreferences.Editor editor = preferences.edit()
                    .putString(SERVER_KEY, server.getText().toString().trim())
                    .putString(DIRECTORY_KEY, directory.getText().toString().trim())
                    .putString(TOKEN_KEY, token.getText().toString().trim());
            int modelPosition = modelSpinner.getSelectedItemPosition();
            if (modelPosition >= 0 && modelPosition < availableModels.size()) {
                OpenCodeClient.Model selected = availableModels.get(modelPosition);
                int variantPosition = variantSpinner.getSelectedItemPosition();
                String variant = variantPosition >= 0 && variantPosition < availableVariants.size()
                        ? availableVariants.get(variantPosition) : "";
                editor.putString(MODEL_PROVIDER_KEY, selected.providerId)
                        .putString(MODEL_ID_KEY, selected.modelId)
                        .putString(MODEL_VARIANT_KEY, variant);
            }
            editor.apply();
            statusView.setText("Testing connection...");
            network.execute(() -> {
                try {
                    client().health();
                    runOnUiThread(() -> statusView.setText("Connected. New chats will use "
                            + selectedModelDescription(preferences) + "."));
                } catch (Exception error) {
                    showError(error);
                }
            });
        });
        root.addView(save);
        statusView = status("");
        addSection("CAPTURE SETUP");
        accessibilityStatusView = label("", 16, false);
        accessibilityStatusView.setPadding(dp(12), dp(10), dp(12), dp(10));
        accessibilityStatusView.setBackgroundColor(0xffeeeeee);
        root.addView(accessibilityStatusView);
        updateAccessibilityStatus();
        Button accessibility = button("ENABLE / UPDATE CAPTURE SETUP");
        accessibility.setOnClickListener(v -> openAccessibilitySetup());
        root.addView(accessibility);
        addSection("OPENCODE");
        TextView usage = label("READING CHAT USAGE\nLoading...", 16, false);
        usage.setPadding(dp(12), dp(10), dp(12), dp(10));
        usage.setBackgroundColor(0xffeeeeee);
        root.addView(usage);
        network.execute(() -> {
            try {
                OpenCodeClient client = client();
                List<OpenCodeClient.Model> models = client.listModels();
                List<OpenCodeClient.Session> sessions = client.listSessions();
                long input = 0;
                long output = 0;
                long reasoning = 0;
                long cacheRead = 0;
                long cacheWrite = 0;
                double cost = 0;
                for (OpenCodeClient.Session session : sessions) {
                    input += session.inputTokens;
                    output += session.outputTokens;
                    reasoning += session.reasoningTokens;
                    cacheRead += session.cacheReadTokens;
                    cacheWrite += session.cacheWriteTokens;
                    cost += session.cost;
                }
                String usageText = "READING CHAT USAGE (LATEST " + sessions.size() + ")"
                        + "\nTokens in: " + formatNumber(input)
                        + "\nTokens out: " + formatNumber(output)
                        + "\nReasoning: " + formatNumber(reasoning)
                        + "\nCache read: " + formatNumber(cacheRead)
                        + "\nCache write: " + formatNumber(cacheWrite)
                        + String.format(java.util.Locale.US, "\nCost: $%.4f", cost);
                runOnUiThread(() -> {
                    availableModels.clear();
                    availableModels.addAll(models);
                    List<String> labels = new ArrayList<>();
                    for (OpenCodeClient.Model model : models) {
                        labels.add(model.name + " (" + model.providerId + "/" + model.modelId + ")");
                    }
                    ArrayAdapter<String> modelAdapter = new ArrayAdapter<>(this,
                            android.R.layout.simple_spinner_item, labels);
                    modelAdapter.setDropDownViewResource(
                            android.R.layout.simple_spinner_dropdown_item);
                    modelSpinner.setAdapter(modelAdapter);
                    int selected = findSelectedModel(models, preferences);
                    if (selected >= 0) {
                        modelSpinner.setSelection(selected);
                    }
                    usage.setText(usageText);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    ArrayAdapter<String> unavailable = new ArrayAdapter<>(this,
                            android.R.layout.simple_spinner_item,
                            List.of("Models unavailable"));
                    modelSpinner.setAdapter(unavailable);
                    usage.setText("READING CHAT USAGE\nUnavailable: "
                            + (error.getMessage() == null ? error.toString() : error.getMessage()));
                });
            }
        });
    }

    private void startChat(String question) {
        statusView.setText("Starting chat...");
        setButtonsEnabled(false);
        String prompt = readingPrompt(question);
        network.execute(() -> {
            try {
                OpenCodeClient client = client();
                SharedPreferences preferences = getSharedPreferences(SETTINGS, MODE_PRIVATE);
                sessionId = client.createSession(
                        preferences.getString(MODEL_PROVIDER_KEY, DEFAULT_MODEL_PROVIDER),
                        preferences.getString(MODEL_ID_KEY, DEFAULT_MODEL_ID),
                        preferences.getString(MODEL_VARIANT_KEY, DEFAULT_MODEL_VARIANT));
                client.sendMessage(sessionId, prompt);
                runOnUiThread(this::showChat);
            } catch (Exception error) {
                runOnUiThread(() -> setButtonsEnabled(true));
                showError(error);
            }
        });
    }

    private void sendFollowUp(String text) {
        statusView.setText("Sending...");
        network.execute(() -> {
            try {
                client().sendMessage(sessionId, text);
                runOnUiThread(() -> {
                    polling = true;
                    loadMessages();
                });
            } catch (Exception error) {
                showError(error);
            }
        });
    }

    private void loadMessages() {
        if (!polling || sessionId == null) {
            return;
        }
        network.execute(() -> {
            try {
                List<OpenCodeClient.Message> messages = client().listMessages(sessionId);
                runOnUiThread(() -> renderMessages(messages));
            } catch (Exception error) {
                showError(error);
            }
        });
    }

    private void renderMessages(List<OpenCodeClient.Message> messages) {
        if (transcript == null) {
            return;
        }
        boolean scrollToBottom = followChatBottom || isNearBottom();
        transcript.removeAllViews();
        boolean waiting = messages.isEmpty();
        for (OpenCodeClient.Message message : messages) {
            addMessage(message.role, message.text.isEmpty() ? "Thinking..." : message.text);
            waiting = "YOU".equals(message.role) || !message.complete;
        }
        if (waiting) {
            addLoadingIndicator();
        }
        statusView.setText("");
        if (scrollToBottom) {
            followChatBottom = true;
            scrollView.post(() -> scrollView.fullScroll(View.FOCUS_DOWN));
        }
        if (polling) {
            handler.removeCallbacksAndMessages(null);
            handler.postDelayed(this::loadMessages, waiting ? 2_000 : 5_000);
        }
    }

    private String readingPrompt(String question) {
        return "HIGHLIGHTED PASSAGE\n"
                + valueOrNone(captured(KindleAccessibilityService.SELECTED_TEXT_KEY))
                + "\n\nSURROUNDING CONTEXT\n\nPREVIOUS PAGE\n"
                + valueOrNone(captured(KindleAccessibilityService.PREVIOUS_TEXT_KEY))
                + "\n\nCURRENT PAGE\n"
                + valueOrNone(captured(KindleAccessibilityService.CURRENT_TEXT_KEY))
                + "\n\nREADER'S QUESTION\n" + question;
    }

    private void beginScreen() {
        handler.removeCallbacksAndMessages(null);
        accessibilityStatusView = null;
        LinearLayout screen = new LinearLayout(this);
        screen.setOrientation(LinearLayout.VERTICAL);
        screen.setBackgroundColor(Color.WHITE);
        toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.VERTICAL);
        screen.addView(toolbar, new LinearLayout.LayoutParams(-1, -2));
        scrollView = new ScrollView(this);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(14), dp(18), dp(28));
        root.setBackgroundColor(Color.WHITE);
        scrollView.addView(root);
        scrollView.setOnTouchListener((view, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                userScrolling = true;
            } else if (event.getActionMasked() == MotionEvent.ACTION_UP
                    || event.getActionMasked() == MotionEvent.ACTION_CANCEL) {
                followChatBottom = isNearBottom();
                userScrolling = false;
            }
            return false;
        });
        scrollView.setOnScrollChangeListener((view, x, y, oldX, oldY) -> {
            if (userScrolling) {
                followChatBottom = isNearBottom();
            }
        });
        screen.addView(scrollView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(screen);
    }

    private void addTopBar(String heading) {
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        Button capture = smallButton("NEW");
        capture.setOnClickListener(v -> showCapture());
        bar.addView(capture, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button sessions = smallButton("CHATS");
        sessions.setOnClickListener(v -> showSessions());
        bar.addView(sessions, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button kindle = smallButton("KINDLE");
        kindle.setOnClickListener(v -> openKindle());
        bar.addView(kindle, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button settings = smallButton("SETTINGS");
        settings.setOnClickListener(v -> showSettings());
        bar.addView(settings, new LinearLayout.LayoutParams(0, dp(48), 1));
        toolbar.addView(bar);
        TextView title = label(heading, 15, true);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(5), 0, dp(7));
        title.setBackgroundColor(0xffeeeeee);
        toolbar.addView(title, new LinearLayout.LayoutParams(-1, -2));
    }

    private void addTitle(String text) {
        TextView title = label(text, 26, true);
        title.setPadding(0, dp(22), 0, dp(12));
        root.addView(title);
    }

    private void addSection(String text) {
        TextView section = label(text, 14, true);
        section.setPadding(0, dp(18), 0, dp(8));
        root.addView(section);
    }

    private void addContext(String heading, String value, String empty) {
        addSection(heading);
        TextView text = label(value.isEmpty() ? empty : value, 16, false);
        text.setMaxLines(6);
        text.setTextColor(value.isEmpty() ? Color.DKGRAY : Color.BLACK);
        text.setBackgroundColor(0xffeeeeee);
        text.setPadding(dp(12), dp(10), dp(12), dp(10));
        root.addView(text);
    }

    private void addPromptButton(String label, String prompt) {
        Button button = button(label);
        button.setOnClickListener(v -> startChat(prompt));
        root.addView(button);
    }

    private void addMessage(String role, String text) {
        TextView roleView = label(role, 13, true);
        roleView.setPadding(0, dp(16), 0, dp(4));
        transcript.addView(roleView);
        TextView message = label(text, 17, false);
        if ("OPENCODE".equals(role)) {
            markwon.setMarkdown(message, text);
        }
        message.setTextIsSelectable(true);
        message.setLineSpacing(0, 1.15f);
        transcript.addView(message);
    }

    private void addLoadingIndicator() {
        LinearLayout loading = new LinearLayout(this);
        loading.setGravity(Gravity.CENTER_VERTICAL);
        loading.setPadding(0, dp(16), 0, dp(10));
        ProgressBar progress = new ProgressBar(this);
        progress.setIndeterminate(true);
        loading.addView(progress, new LinearLayout.LayoutParams(dp(30), dp(30)));
        TextView text = label("  OPENCODE IS WORKING...", 15, true);
        loading.addView(text);
        transcript.addView(loading);
    }

    private boolean isNearBottom() {
        if (scrollView == null || scrollView.getChildCount() == 0) {
            return true;
        }
        View content = scrollView.getChildAt(0);
        return content.getBottom() - (scrollView.getHeight() + scrollView.getScrollY()) <= dp(48);
    }

    private String formatNumber(long value) {
        return java.text.NumberFormat.getIntegerInstance().format(value);
    }

    private void setVariantChoices(Spinner spinner, List<String> choices,
            OpenCodeClient.Model model, String preferred) {
        choices.clear();
        choices.add("");
        if (model != null) {
            choices.addAll(model.variants);
        }
        List<String> labels = new ArrayList<>();
        labels.add("Default variant");
        if (model != null) {
            labels.addAll(model.variants);
        }
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item, labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
        int selected = choices.indexOf(preferred);
        spinner.setSelection(Math.max(selected, 0));
    }

    private int findSelectedModel(List<OpenCodeClient.Model> models,
            SharedPreferences preferences) {
        String provider = preferences.getString(MODEL_PROVIDER_KEY, DEFAULT_MODEL_PROVIDER);
        String modelId = preferences.getString(MODEL_ID_KEY, DEFAULT_MODEL_ID);
        for (int i = 0; i < models.size(); i++) {
            OpenCodeClient.Model model = models.get(i);
            if (provider.equals(model.providerId) && modelId.equals(model.modelId)) {
                return i;
            }
        }
        return models.isEmpty() ? -1 : 0;
    }

    private String selectedModelDescription(SharedPreferences preferences) {
        String model = preferences.getString(MODEL_ID_KEY, DEFAULT_MODEL_ID);
        String variant = preferences.getString(MODEL_VARIANT_KEY, DEFAULT_MODEL_VARIANT);
        return model + (variant.isEmpty() ? "" : " / " + variant);
    }

    private EditText settingInput(String heading, String value) {
        addSection(heading);
        EditText input = input("");
        input.setText(value);
        root.addView(input);
        return input;
    }

    private TextView status(String text) {
        TextView view = label(text, 15, false);
        view.setPadding(0, dp(12), 0, dp(8));
        root.addView(view);
        return view;
    }

    private TextView label(String text, int size, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.BLACK);
        view.setTextSize(size);
        if (bold) {
            view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        }
        return view;
    }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(15);
        button.setTextColor(Color.BLACK);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.setMargins(0, dp(4), 0, dp(4));
        button.setLayoutParams(params);
        return button;
    }

    private Button smallButton(String text) {
        Button button = button(text);
        button.setTextSize(12);
        button.setMinWidth(dp(78));
        button.setLayoutParams(new LinearLayout.LayoutParams(-2, dp(48)));
        return button;
    }

    private EditText input(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setTextSize(17);
        input.setTextColor(Color.BLACK);
        input.setHintTextColor(Color.DKGRAY);
        input.setPadding(dp(10), dp(10), dp(10), dp(10));
        return input;
    }

    private void openKindle() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(
                KindleAccessibilityService.KINDLE_PACKAGE);
        if (launch != null) {
            startActivity(launch);
        } else if (statusView != null) {
            statusView.setText("Kindle is not installed.");
        }
    }

    private void openAccessibilitySetup() {
        startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
    }

    private void updateAccessibilityStatus() {
        if (accessibilityStatusView == null) {
            return;
        }
        ComponentName service = new ComponentName(this, KindleAccessibilityService.class);
        String component = service.flattenToString();
        String enabledServices = Settings.Secure.getString(
                getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        String buttonTargets = Settings.Secure.getString(
                getContentResolver(), "accessibility_button_targets");
        boolean accessibilityEnabled = Settings.Secure.getInt(
                getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED, 0) == 1;
        boolean serviceEnabled = enabledServices != null && enabledServices.contains(component);
        boolean buttonAssigned = buttonTargets != null && buttonTargets.contains(component);
        accessibilityStatusView.setText("ANDROID ACCESSIBILITY: "
                + (accessibilityEnabled ? "ON" : "OFF")
                + "\nCAPTURE SERVICE: " + (serviceEnabled ? "ENABLED" : "DISABLED")
                + "\nFLOATING BUTTON: " + (buttonAssigned ? "ASSIGNED" : "NOT ASSIGNED")
                + "\nBOOX APP FREEZE: Check manually in BOOX app settings");
    }

    private OpenCodeClient client() {
        SharedPreferences preferences = getSharedPreferences(SETTINGS, MODE_PRIVATE);
        return new OpenCodeClient(
                preferences.getString(SERVER_KEY, DEFAULT_SERVER),
                preferences.getString(TOKEN_KEY, ""),
                preferences.getString(DIRECTORY_KEY, DEFAULT_DIRECTORY));
    }

    private void setButtonsEnabled(boolean enabled) {
        setButtonsEnabled(root, enabled);
    }

    private void setButtonsEnabled(View view, boolean enabled) {
        if (view instanceof Button) {
            view.setEnabled(enabled);
        } else if (view instanceof LinearLayout) {
            LinearLayout layout = (LinearLayout) view;
            for (int i = 0; i < layout.getChildCount(); i++) {
                setButtonsEnabled(layout.getChildAt(i), enabled);
            }
        }
    }

    private void showError(Exception error) {
        runOnUiThread(() -> {
            if (statusView != null) {
                statusView.setText(error.getMessage() == null ? error.toString() : error.getMessage());
            }
        });
    }

    private String captured(String key) {
        return getSharedPreferences(KindleAccessibilityService.PREFS, MODE_PRIVATE)
                .getString(key, "").trim();
    }

    private String valueOrNone(String value) {
        return value.isEmpty() ? "(none captured)" : value;
    }

    private void acceptSharedText(Intent intent) {
        CharSequence selected;
        if (Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())) {
            selected = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        } else if (Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            selected = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        } else {
            return;
        }
        if (!TextUtils.isEmpty(selected)) {
            getSharedPreferences(KindleAccessibilityService.PREFS, MODE_PRIVATE)
                    .edit().putString(KindleAccessibilityService.SELECTED_TEXT_KEY, selected.toString()).apply();
        }
    }

    private void acceptCaptureIntent(Intent intent) {
        readClipboardOnResume = intent.getBooleanExtra(
                KindleAccessibilityService.READ_CLIPBOARD_EXTRA, false);
    }

    private void captureClipboardText() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData clip = clipboard.getPrimaryClip();
        CharSequence value = clip != null && clip.getItemCount() > 0
                ? clip.getItemAt(0).coerceToText(this) : null;
        if (value != null && !value.toString().trim().isEmpty()) {
            getSharedPreferences(KindleAccessibilityService.PREFS, MODE_PRIVATE)
                    .edit().putString(KindleAccessibilityService.SELECTED_TEXT_KEY,
                            value.toString().trim()).apply();
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        polling = false;
        handler.removeCallbacksAndMessages(null);
        network.shutdownNow();
        super.onDestroy();
    }
}
