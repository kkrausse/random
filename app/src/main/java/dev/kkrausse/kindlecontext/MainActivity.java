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
import android.text.Editable;
import android.text.InputType;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
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

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import io.noties.markwon.Markwon;

public class MainActivity extends Activity {
    private static final String SETTINGS = "opencode_connection";
    private static final String SERVER_KEY = "server_url";
    private static final String TOKEN_KEY = "server_token";
    private static final String DIRECTORY_KEY = "workspace_directory";
    private static final String MODEL_PROVIDER_KEY = "model_provider";
    private static final String MODEL_ID_KEY = "model_id";
    private static final String MODEL_VARIANT_KEY = "model_variant";
    private static final String MESSAGE_TEMPLATE_KEY = "message_template";
    private static final String PROMPT_PRESETS_KEY = "prompt_presets";
    private static final String CONTEXT_WORD_LIMIT_KEY = "context_word_limit";
    private static final String DEFAULT_SERVER = "http://raspberrypi.example.ts.net:41137";
    private static final String DEFAULT_DIRECTORY = "/home/pi/deploys/palma2-opencode/workdir";
    private static final String DEFAULT_MODEL_PROVIDER = "opencode";
    private static final String DEFAULT_MODEL_ID = "laguna-s-2.1-free";
    private static final String DEFAULT_MODEL_VARIANT = "medium";
    private static final int DEFAULT_CONTEXT_WORD_LIMIT = 2_000;
    private static final String LEGACY_DEFAULT_MESSAGE_TEMPLATE = "SURROUNDING CONTEXT\n\nPREVIOUS PAGE\n"
            + "{{previous_page}}\n\nCURRENT PAGE\n{{current_page}}"
            + "\n\nHIGHLIGHTED PASSAGE\n{{highlight}}"
            + "\n\nREADER'S QUESTION\n{{question}}";
    private static final String PLAIN_CONTEXT_MESSAGE_TEMPLATE = "SURROUNDING CONTEXT\n\n"
            + "{{surrounding_context}}\n\nHIGHLIGHTED PASSAGE\n{{highlight}}"
            + "\n\nREADER'S QUESTION\n{{question}}";
    private static final String DEFAULT_MESSAGE_TEMPLATE = "<reading_request>\n"
            + "  <source_material>\n"
            + "    <surrounding_context>\n{{surrounding_context}}\n"
            + "    </surrounding_context>\n"
            + "    <highlighted_passage>\n{{highlight}}\n"
            + "    </highlighted_passage>\n"
            + "  </source_material>\n"
            + "  <instructions>\n"
            + "    <reader_question>\n{{question}}\n"
            + "    </reader_question>\n"
            + "  </instructions>\n"
            + "</reading_request>";
    private static final Pattern TEMPLATE_PLACEHOLDER = Pattern.compile(
            "\\{\\{(highlight|surrounding_context|previous_page|current_page|question)\\}\\}");
    private static final Pattern SURROUNDING_CONTEXT_XML = xmlElement("surrounding_context");
    private static final Pattern HIGHLIGHT_XML = xmlElement("highlighted_passage");
    private static final Pattern QUESTION_XML = xmlElement("reader_question");
    private static final Pattern PLAIN_READING_MESSAGE = Pattern.compile(
            "^SURROUNDING CONTEXT\\n\\n(.*?)\\n\\nHIGHLIGHTED PASSAGE\\n(.*?)"
                    + "\\n\\nREADER'S QUESTION\\n(.*)$", Pattern.DOTALL);
    private static final String CONTEXT_OMISSION_MARKER = "[Earlier captured context omitted.]";
    private static final String LATER_CONTEXT_OMISSION_MARKER = "[Later captured context omitted.]";
    private static final Pattern WORD_PATTERN = Pattern.compile("\\S+");

    private static final class PromptPreset {
        String label;
        String prompt;

        PromptPreset(String label, String prompt) {
            this.label = label;
            this.prompt = prompt;
        }
    }

    private final class TrackingScrollView extends ScrollView {
        TrackingScrollView(Context context) {
            super(context);
        }

        @Override
        public boolean dispatchTouchEvent(MotionEvent event) {
            trackScrollTouch(event);
            return super.dispatchTouchEvent(event);
        }
    }

    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final ExecutorService eventNetwork = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable streamTextRefresh = () -> {
        streamTextRefreshScheduled = false;
        renderStreamingText();
    };
    private String sessionId;
    private boolean readClipboardOnResume;
    private boolean polling;
    private LinearLayout root;
    private LinearLayout toolbar;
    private LinearLayout transcript;
    private ScrollView scrollView;
    private TextView statusView;
    private TextView accessibilityStatusView;
    private TextView sessionUsageView;
    private boolean followChatBottom;
    private boolean userScrolling;
    private float scrollTouchDownY;
    private int scrollTouchSlop;
    private Markwon markwon;
    private OpenCodeClient.EventStream eventStream;
    private int eventStreamGeneration;
    private boolean streamTextRefreshScheduled;
    private String streamingMessageId;
    private boolean streamingStartedAtBoundary;
    private final StringBuilder streamingText = new StringBuilder();
    private TextView streamingMessageView;
    private View streamingLoadingView;
    private boolean messagesLoading;
    private boolean messagesDirty;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        markwon = Markwon.create(this);
        scrollTouchSlop = ViewConfiguration.get(this).getScaledTouchSlop();
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
        String surroundingContext = capturedSurroundingContext();
        addContext("HIGHLIGHT", selected, "No highlight captured");
        addContext("SURROUNDING CONTEXT", surroundingContext, "No surrounding context captured");

        addSection("ASK");
        for (PromptPreset preset : loadPromptPresets(
                getSharedPreferences(SETTINGS, MODE_PRIVATE))) {
            addPromptButton(preset.label, preset.prompt);
        }

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
        streamingMessageId = null;
        streamingStartedAtBoundary = false;
        streamingText.setLength(0);
        streamingMessageView = null;
        streamingLoadingView = null;
        transcript = new LinearLayout(this);
        transcript.setOrientation(LinearLayout.VERTICAL);
        root.addView(transcript);
        statusView = status("Loading conversation...");

        EditText reply = input("Reply...");
        reply.setSingleLine(false);
        reply.setImeOptions(EditorInfo.IME_ACTION_SEND);
        root.addView(reply);
        Button send = button("RETURN TO " + sourceLabel().toUpperCase(java.util.Locale.US));
        reply.addTextChangedListener(textWatcher(value ->
                send.setText(value.trim().isEmpty()
                        ? "RETURN TO " + sourceLabel().toUpperCase(java.util.Locale.US) : "SEND")));
        send.setOnClickListener(v -> {
            String text = reply.getText().toString().trim();
            if (text.isEmpty()) {
                openReadingSource();
                return;
            }
            reply.setText("");
            sendFollowUp(text);
        });
        root.addView(send);
        sessionUsageView = label("SESSION USAGE\nLoading...", 13, false);
        sessionUsageView.setPadding(dp(4), dp(8), dp(4), dp(12));
        root.addView(sessionUsageView);
        polling = true;
        startEventStream();
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
        addTopBar("SETTINGS");
        SharedPreferences preferences = getSharedPreferences(SETTINGS, MODE_PRIVATE);
        EditText server = settingInput("SERVER URL",
                preferences.getString(SERVER_KEY, DEFAULT_SERVER));
        EditText directory = settingInput("WORKSPACE DIRECTORY",
                preferences.getString(DIRECTORY_KEY, DEFAULT_DIRECTORY));
        EditText token = settingInput("SERVER PASSWORD",
                preferences.getString(TOKEN_KEY, ""));
        token.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        EditText contextWordLimit = settingInput("SURROUNDING CONTEXT WORD LIMIT",
                String.valueOf(preferences.getInt(
                        CONTEXT_WORD_LIMIT_KEY, DEFAULT_CONTEXT_WORD_LIMIT)));
        contextWordLimit.setInputType(InputType.TYPE_CLASS_NUMBER);
        TextView contextHelp = label("Maximum total words sent from the captured text. "
                + "When possible, the highlighted passage is centered in this window.", 14, false);
        contextHelp.setPadding(0, 0, 0, dp(6));
        root.addView(contextHelp);
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
        addSection("MESSAGE TEMPLATE");
        TextView templateHelp = label("Available placeholders: {{highlight}}, "
                + "{{surrounding_context}}, {{question}}", 14, false);
        templateHelp.setPadding(0, 0, 0, dp(6));
        root.addView(templateHelp);
        EditText messageTemplate = input("");
        messageTemplate.setMinLines(8);
        messageTemplate.setGravity(Gravity.TOP | Gravity.START);
        messageTemplate.setText(messageTemplate(preferences));
        root.addView(messageTemplate);

        addSection("PRE-FILLED PROMPTS");
        List<PromptPreset> promptPresets = loadPromptPresets(preferences);
        LinearLayout promptEditors = new LinearLayout(this);
        promptEditors.setOrientation(LinearLayout.VERTICAL);
        root.addView(promptEditors);
        renderPromptEditors(promptEditors, promptPresets);
        Button addPrompt = button("ADD PROMPT");
        addPrompt.setOnClickListener(v -> {
            promptPresets.add(new PromptPreset("NEW PROMPT", ""));
            renderPromptEditors(promptEditors, promptPresets);
        });
        root.addView(addPrompt);

        Button save = button("SAVE AND TEST");
        save.setOnClickListener(v -> {
            String template = messageTemplate.getText().toString();
            if (template.trim().isEmpty()) {
                statusView.setText("Message template cannot be empty.");
                return;
            }
            for (PromptPreset preset : promptPresets) {
                if (preset.label.trim().isEmpty() || preset.prompt.trim().isEmpty()) {
                    statusView.setText("Each pre-filled prompt needs a label and prompt text.");
                    return;
                }
            }
            int wordLimit;
            try {
                wordLimit = Integer.parseInt(contextWordLimit.getText().toString());
            } catch (NumberFormatException error) {
                statusView.setText("Context word limit must be a positive whole number.");
                return;
            }
            if (wordLimit <= 0) {
                statusView.setText("Context word limit must be a positive whole number.");
                return;
            }
            SharedPreferences.Editor editor = preferences.edit()
                    .putString(SERVER_KEY, server.getText().toString().trim())
                    .putString(DIRECTORY_KEY, directory.getText().toString().trim())
                    .putString(TOKEN_KEY, token.getText().toString().trim())
                    .putInt(CONTEXT_WORD_LIMIT_KEY, wordLimit)
                    .putString(MESSAGE_TEMPLATE_KEY, template)
                    .putString(PROMPT_PRESETS_KEY, serializePromptPresets(promptPresets));
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
                client.loadUsage(sessions);
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
                sessionId = client.createSession();
                runOnUiThread(() -> {
                    showChat();
                    network.execute(() -> {
                        try {
                            OpenCodeClient.EventStream stream = eventStream;
                            if (stream != null) {
                                stream.awaitConnected(5_000);
                            }
                            sendMessage(client, prompt);
                            runOnUiThread(this::loadMessages);
                        } catch (Exception error) {
                            showError(error);
                        }
                    });
                });
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
                sendMessage(client(), text);
                runOnUiThread(() -> {
                    polling = true;
                    loadMessages();
                });
            } catch (Exception error) {
                showError(error);
            }
        });
    }

    private void sendMessage(OpenCodeClient client, String text) throws Exception {
        SharedPreferences preferences = getSharedPreferences(SETTINGS, MODE_PRIVATE);
        client.sendMessage(sessionId, text,
                preferences.getString(MODEL_PROVIDER_KEY, DEFAULT_MODEL_PROVIDER),
                preferences.getString(MODEL_ID_KEY, DEFAULT_MODEL_ID),
                preferences.getString(MODEL_VARIANT_KEY, DEFAULT_MODEL_VARIANT));
    }

    private void loadMessages() {
        if (!polling || sessionId == null) {
            return;
        }
        if (messagesLoading) {
            messagesDirty = true;
            return;
        }
        messagesLoading = true;
        messagesDirty = false;
        String requestedSession = sessionId;
        int requestedGeneration = eventStreamGeneration;
        network.execute(() -> {
            try {
                List<OpenCodeClient.Message> messages = client().listMessages(requestedSession);
                runOnUiThread(() -> {
                    messagesLoading = false;
                    if (polling && requestedSession.equals(sessionId)
                            && requestedGeneration == eventStreamGeneration) {
                        renderMessages(messages);
                    }
                    if (messagesDirty) {
                        loadMessages();
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    messagesLoading = false;
                    if (polling && requestedSession.equals(sessionId)
                            && requestedGeneration == eventStreamGeneration) {
                        showError(error);
                    }
                    if (messagesDirty) {
                        loadMessages();
                    }
                });
            }
        });
    }

    private void renderMessages(List<OpenCodeClient.Message> messages) {
        if (transcript == null) {
            return;
        }
        boolean scrollToBottom = followChatBottom;
        transcript.removeAllViews();
        streamingMessageView = null;
        streamingLoadingView = null;
        boolean waiting = messages.isEmpty();
        long input = 0;
        long output = 0;
        long reasoning = 0;
        long cacheRead = 0;
        long cacheWrite = 0;
        double cost = 0;
        for (OpenCodeClient.Message message : messages) {
            input += message.inputTokens;
            output += message.outputTokens;
            reasoning += message.reasoningTokens;
            cacheRead += message.cacheReadTokens;
            cacheWrite += message.cacheWriteTokens;
            cost += message.cost;
            String text = message.text;
            if (message.id.equals(streamingMessageId)) {
                String streamed = streamingText.toString();
                if (!streamingStartedAtBoundary) {
                    text = message.text.endsWith(streamed) ? message.text : message.text + streamed;
                    streamingText.setLength(0);
                    streamingText.append(text);
                    streamingStartedAtBoundary = true;
                } else {
                    text = streamed;
                }
            }
            waiting = "YOU".equals(message.role) || !message.complete;
            if (text.isEmpty() && message.complete) {
                continue;
            }
            TextView view = addMessage(message.role, text.isEmpty() ? "Thinking..." : text);
            if (message.id.equals(streamingMessageId)) {
                streamingMessageView = view;
            }
        }
        if (waiting) {
            streamingLoadingView = addLoadingIndicator();
        }
        statusView.setText("");
        if (sessionUsageView != null) {
            sessionUsageView.setText("SESSION USAGE"
                    + "\nInput: " + formatNumber(input)
                    + "  Output: " + formatNumber(output)
                    + "  Reasoning: " + formatNumber(reasoning)
                    + "\nCache read: " + formatNumber(cacheRead)
                    + "  Cache write: " + formatNumber(cacheWrite)
                    + String.format(java.util.Locale.US, "  Cost: $%.4f", cost));
        }
        if (scrollToBottom) {
            scrollChatToBottom();
        }
    }

    private String readingPrompt(String question) {
        String template = messageTemplate(getSharedPreferences(SETTINGS, MODE_PRIVATE));
        boolean xmlTemplate = template.contains("<reading_request>");
        Matcher matcher = TEMPLATE_PLACEHOLDER.matcher(template);
        StringBuffer result = new StringBuffer();
        while (matcher.find()) {
            String value;
            switch (matcher.group(1)) {
                case "highlight":
                    value = valueOrNone(captured(KindleAccessibilityService.SELECTED_TEXT_KEY));
                    break;
                case "surrounding_context":
                    value = valueOrNone(capturedSurroundingContext());
                    break;
                case "previous_page":
                    value = valueOrNone(capturedHistory());
                    break;
                case "current_page":
                    value = valueOrNone(captured(KindleAccessibilityService.CURRENT_TEXT_KEY));
                    break;
                default:
                    value = question;
                    break;
            }
            if (xmlTemplate) {
                value = xmlEscape(value);
            }
            matcher.appendReplacement(result, Matcher.quoteReplacement(value));
        }
        matcher.appendTail(result);
        return result.toString();
    }

    private String messageTemplate(SharedPreferences preferences) {
        String template = preferences.getString(MESSAGE_TEMPLATE_KEY, DEFAULT_MESSAGE_TEMPLATE);
        return LEGACY_DEFAULT_MESSAGE_TEMPLATE.equals(template)
                || PLAIN_CONTEXT_MESSAGE_TEMPLATE.equals(template)
                ? DEFAULT_MESSAGE_TEMPLATE : template;
    }

    private static Pattern xmlElement(String name) {
        return Pattern.compile("<" + name + ">\\s*(.*?)\\s*</" + name + ">",
                Pattern.DOTALL);
    }

    private String xmlValue(Pattern pattern, String text) {
        Matcher matcher = pattern.matcher(text);
        return matcher.find() ? xmlUnescape(matcher.group(1).trim()) : null;
    }

    private String xmlEscape(String value) {
        return value.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;");
    }

    private String xmlUnescape(String value) {
        return value.replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&amp;", "&");
    }

    private int countWords(String value) {
        String text = value.trim();
        return text.isEmpty() ? 0 : text.split("\\s+").length;
    }

    private List<PromptPreset> loadPromptPresets(SharedPreferences preferences) {
        if (!preferences.contains(PROMPT_PRESETS_KEY)) {
            return defaultPromptPresets();
        }
        List<PromptPreset> presets = new ArrayList<>();
        try {
            JSONArray values = new JSONArray(preferences.getString(PROMPT_PRESETS_KEY, "[]"));
            for (int i = 0; i < values.length(); i++) {
                JSONObject value = values.getJSONObject(i);
                presets.add(new PromptPreset(value.getString("label"), value.getString("prompt")));
            }
            return presets;
        } catch (JSONException error) {
            return defaultPromptPresets();
        }
    }

    private List<PromptPreset> defaultPromptPresets() {
        List<PromptPreset> presets = new ArrayList<>();
        presets.add(new PromptPreset("EXPLAIN TERMS", "Identify up to five terms, names, allusions, "
                + "or references in the highlighted passage that a reader may not recognize. Give a "
                + "brief explanation of each in this context. Do not list ordinary words merely to fill space."));
        presets.add(new PromptPreset("WHY IT MATTERS", "Explain what role the highlighted passage "
                + "plays in the author's broader point or the surrounding discussion. Base the answer "
                + "only on the supplied text and distinguish inference from explicit evidence."));
        presets.add(new PromptPreset("HISTORICAL CONTEXT", "Give the minimum historical, cultural, "
                + "scientific, or philosophical context needed to understand the highlighted passage. "
                + "Research external facts when useful and distinguish them from the book's claims."));
        return presets;
    }

    private String serializePromptPresets(List<PromptPreset> presets) {
        JSONArray values = new JSONArray();
        for (PromptPreset preset : presets) {
            JSONObject value = new JSONObject();
            try {
                value.put("label", preset.label.trim());
                value.put("prompt", preset.prompt.trim());
            } catch (JSONException error) {
                throw new IllegalStateException(error);
            }
            values.put(value);
        }
        return values.toString();
    }

    private void renderPromptEditors(LinearLayout container, List<PromptPreset> presets) {
        container.removeAllViews();
        for (int i = 0; i < presets.size(); i++) {
            int position = i;
            PromptPreset preset = presets.get(i);
            TextView heading = label("PROMPT " + (i + 1), 13, true);
            heading.setPadding(0, dp(10), 0, dp(4));
            container.addView(heading);

            EditText labelInput = input("Button label");
            labelInput.setSingleLine(true);
            labelInput.setText(preset.label);
            labelInput.addTextChangedListener(textWatcher(value -> preset.label = value));
            container.addView(labelInput);

            EditText promptInput = input("Prompt text");
            promptInput.setMinLines(3);
            promptInput.setGravity(Gravity.TOP | Gravity.START);
            promptInput.setText(preset.prompt);
            promptInput.addTextChangedListener(textWatcher(value -> preset.prompt = value));
            container.addView(promptInput);

            LinearLayout controls = new LinearLayout(this);
            Button up = smallButton("UP");
            up.setEnabled(i > 0);
            up.setOnClickListener(v -> {
                PromptPreset moved = presets.remove(position);
                presets.add(position - 1, moved);
                renderPromptEditors(container, presets);
            });
            controls.addView(up, new LinearLayout.LayoutParams(0, dp(48), 1));
            Button down = smallButton("DOWN");
            down.setEnabled(i < presets.size() - 1);
            down.setOnClickListener(v -> {
                PromptPreset moved = presets.remove(position);
                presets.add(position + 1, moved);
                renderPromptEditors(container, presets);
            });
            controls.addView(down, new LinearLayout.LayoutParams(0, dp(48), 1));
            Button remove = smallButton("REMOVE");
            remove.setOnClickListener(v -> {
                presets.remove(position);
                renderPromptEditors(container, presets);
            });
            controls.addView(remove, new LinearLayout.LayoutParams(0, dp(48), 1));
            container.addView(controls);
        }
    }

    private TextWatcher textWatcher(java.util.function.Consumer<String> onChange) {
        return new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence text, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence text, int start, int before, int count) {
                onChange.accept(text.toString());
            }

            @Override
            public void afterTextChanged(Editable editable) {
            }
        };
    }

    private void beginScreen() {
        stopEventStream();
        handler.removeCallbacksAndMessages(null);
        accessibilityStatusView = null;
        LinearLayout screen = new LinearLayout(this);
        screen.setOrientation(LinearLayout.VERTICAL);
        screen.setBackgroundColor(Color.WHITE);
        toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.VERTICAL);
        screen.addView(toolbar, new LinearLayout.LayoutParams(-1, -2));
        scrollView = new TrackingScrollView(this);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(14), dp(18), dp(28));
        root.setBackgroundColor(Color.WHITE);
        scrollView.addView(root);
        scrollView.setOnScrollChangeListener((view, x, y, oldX, oldY) -> {
            if (userScrolling && y < oldY) {
                followChatBottom = false;
            } else if (isNearBottom()) {
                followChatBottom = true;
            }
        });
        screen.addView(scrollView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(screen);
    }

    private void trackScrollTouch(MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                scrollTouchDownY = event.getY();
                userScrolling = true;
                break;
            case MotionEvent.ACTION_MOVE:
                if (event.getY() - scrollTouchDownY > scrollTouchSlop) {
                    followChatBottom = false;
                }
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                userScrolling = false;
                if (isNearBottom()) {
                    followChatBottom = true;
                }
                break;
            default:
                break;
        }
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
        Button reader = smallButton(sourceLabel().toUpperCase(java.util.Locale.US));
        reader.setOnClickListener(v -> openReadingSource());
        bar.addView(reader, new LinearLayout.LayoutParams(0, dp(48), 1));
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

    private TextView addMessage(String role, String text) {
        TextView roleView = label(role, 13, true);
        roleView.setPadding(0, dp(16), 0, dp(4));
        transcript.addView(roleView);
        if ("YOU".equals(role) && addStructuredUserMessage(text)) {
            return null;
        }
        TextView message = label(text, 17, false);
        if ("OPENCODE".equals(role)) {
            markwon.setMarkdown(message, text);
        }
        message.setTextIsSelectable(true);
        message.setLineSpacing(0, 1.15f);
        transcript.addView(message);
        return message;
    }

    private boolean addStructuredUserMessage(String text) {
        String question = xmlValue(QUESTION_XML, text);
        String highlight = xmlValue(HIGHLIGHT_XML, text);
        String context = xmlValue(SURROUNDING_CONTEXT_XML, text);
        if (question == null || highlight == null || context == null) {
            Matcher plain = PLAIN_READING_MESSAGE.matcher(text);
            if (plain.matches()) {
                context = plain.group(1).trim();
                highlight = plain.group(2).trim();
                question = plain.group(3).trim();
            }
        }
        if (question == null || highlight == null || context == null) {
            return false;
        }

        addUserMessageSection("QUESTION", question);
        addUserMessageSection("HIGHLIGHT", highlight);
        int contextWords = countWords(context);
        Button toggle = smallButton("SHOW CONTEXT (" + contextWords + " WORDS)");
        TextView contextView = label(context, 16, false);
        contextView.setTextIsSelectable(true);
        contextView.setVisibility(View.GONE);
        toggle.setOnClickListener(view -> {
            boolean show = contextView.getVisibility() != View.VISIBLE;
            contextView.setVisibility(show ? View.VISIBLE : View.GONE);
            toggle.setText(show ? "HIDE CONTEXT"
                    : "SHOW CONTEXT (" + contextWords + " WORDS)");
        });
        transcript.addView(toggle);
        transcript.addView(contextView);
        return true;
    }

    private void addUserMessageSection(String heading, String text) {
        TextView headingView = label(heading, 12, true);
        headingView.setPadding(0, dp(6), 0, dp(2));
        transcript.addView(headingView);
        TextView value = label(text, 17, false);
        value.setTextIsSelectable(true);
        transcript.addView(value);
    }

    private View addLoadingIndicator() {
        LinearLayout loading = new LinearLayout(this);
        loading.setGravity(Gravity.CENTER_VERTICAL);
        loading.setPadding(0, dp(16), 0, dp(10));
        ProgressBar progress = new ProgressBar(this);
        progress.setIndeterminate(true);
        loading.addView(progress, new LinearLayout.LayoutParams(dp(30), dp(30)));
        TextView text = label("  OPENCODE IS WORKING...", 15, true);
        loading.addView(text);
        transcript.addView(loading);
        return loading;
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

    private void openReadingSource() {
        String sourcePackage = captured(KindleAccessibilityService.SOURCE_PACKAGE_KEY);
        if (sourcePackage.isEmpty()) {
            sourcePackage = KindleAccessibilityService.KINDLE_PACKAGE;
        }
        Intent launch = getPackageManager().getLaunchIntentForPackage(sourcePackage);
        if (launch != null) {
            startActivity(launch);
        } else if (statusView != null) {
            statusView.setText(sourceLabel() + " is not installed.");
        }
    }

    private String sourceLabel() {
        String label = captured(KindleAccessibilityService.SOURCE_LABEL_KEY);
        return label.isEmpty() ? "Kindle" : label;
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

    private String capturedHistory() {
        SharedPreferences preferences = getSharedPreferences(
                KindleAccessibilityService.PREFS, MODE_PRIVATE);
        try {
            JSONArray pages = new JSONArray(preferences.getString(
                    KindleAccessibilityService.HISTORY_TEXT_KEY, "[]"));
            StringBuilder history = new StringBuilder();
            for (int i = 0; i < pages.length(); i++) {
                String page = pages.optString(i).trim();
                if (!page.isEmpty()) {
                    if (history.length() > 0) {
                        history.append("\n\n");
                    }
                    history.append("EARLIER PAGE ").append(i + 1).append('\n').append(page);
                }
            }
            if (history.length() > 0) {
                return history.toString();
            }
        } catch (JSONException ignored) {
        }
        return captured(KindleAccessibilityService.PREVIOUS_TEXT_KEY);
    }

    private String capturedSurroundingContext() {
        SharedPreferences preferences = getSharedPreferences(
                KindleAccessibilityService.PREFS, MODE_PRIVATE);
        List<String> snapshots = new ArrayList<>();
        try {
            JSONArray history = new JSONArray(preferences.getString(
                    KindleAccessibilityService.HISTORY_TEXT_KEY, "[]"));
            for (int i = 0; i < history.length(); i++) {
                addSnapshot(snapshots, history.optString(i));
            }
            if (snapshots.isEmpty()) {
                addSnapshot(snapshots, preferences.getString(
                        KindleAccessibilityService.PREVIOUS_TEXT_KEY, ""));
            }
        } catch (JSONException ignored) {
            addSnapshot(snapshots, preferences.getString(
                    KindleAccessibilityService.PREVIOUS_TEXT_KEY, ""));
        }
        addSnapshot(snapshots, preferences.getString(
                KindleAccessibilityService.CURRENT_TEXT_KEY, ""));
        SharedPreferences settings = getSharedPreferences(SETTINGS, MODE_PRIVATE);
        return contextAroundHighlight(String.join("\n\n", snapshots),
                captured(KindleAccessibilityService.SELECTED_TEXT_KEY),
                settings.getInt(CONTEXT_WORD_LIMIT_KEY, DEFAULT_CONTEXT_WORD_LIMIT));
    }

    private void addSnapshot(List<String> snapshots, String value) {
        String text = value.trim();
        if (text.isEmpty()) {
            return;
        }
        if (!snapshots.isEmpty()) {
            int lastIndex = snapshots.size() - 1;
            String previous = snapshots.get(lastIndex);
            if (text.contains(previous)) {
                snapshots.set(lastIndex, text);
                return;
            }
            if (previous.contains(text)) {
                return;
            }
        }
        snapshots.add(text);
    }

    private String contextAroundHighlight(String text, String highlight, int maxWords) {
        List<Integer> wordStarts = new ArrayList<>();
        List<Integer> wordEnds = new ArrayList<>();
        List<String> words = new ArrayList<>();
        Matcher matcher = WORD_PATTERN.matcher(text);
        while (matcher.find()) {
            wordStarts.add(matcher.start());
            wordEnds.add(matcher.end());
            words.add(matcher.group());
        }
        if (words.size() <= maxWords) {
            return text;
        }

        List<String> highlightWords = new ArrayList<>();
        Matcher highlightMatcher = WORD_PATTERN.matcher(highlight);
        while (highlightMatcher.find()) {
            highlightWords.add(highlightMatcher.group());
        }
        int highlightStart = findLastWordSequence(words, highlightWords);
        int start;
        if (highlightStart < 0) {
            start = words.size() - maxWords;
        } else if (highlightWords.size() >= maxWords) {
            start = highlightStart + (highlightWords.size() - maxWords) / 2;
        } else {
            int wordsBefore = (maxWords - highlightWords.size()) / 2;
            start = Math.max(0, highlightStart - wordsBefore);
            start = Math.min(start, words.size() - maxWords);
        }
        int end = start + maxWords;
        String result = text.substring(wordStarts.get(start), wordEnds.get(end - 1));
        if (start > 0) {
            result = CONTEXT_OMISSION_MARKER + "\n\n" + result;
        }
        if (end < words.size()) {
            result += "\n\n" + LATER_CONTEXT_OMISSION_MARKER;
        }
        return result;
    }

    private int findLastWordSequence(List<String> words, List<String> sequence) {
        if (sequence.isEmpty() || sequence.size() > words.size()) {
            return -1;
        }
        for (int start = words.size() - sequence.size(); start >= 0; start--) {
            boolean matches = true;
            for (int i = 0; i < sequence.size(); i++) {
                if (!words.get(start + i).equals(sequence.get(i))) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                return start;
            }
        }
        return -1;
    }

    private void handleStreamEvent(OpenCodeClient.StreamEvent event) {
        switch (event.type) {
            case "message.updated":
                beginStreamingMessage(event.messageId, true);
                statusView.setText("OpenCode is working...");
                break;
            case "message.part.updated":
                beginStreamingMessage(event.messageId, true);
                streamingText.setLength(0);
                streamingText.append(event.text);
                renderStreamingText();
                break;
            case "message.part.delta":
                if (!event.messageId.equals(streamingMessageId)) {
                    beginStreamingMessage(event.messageId, false);
                    loadMessages();
                }
                streamingText.append(event.text);
                if (!streamTextRefreshScheduled) {
                    streamTextRefreshScheduled = true;
                    handler.postDelayed(streamTextRefresh, 40);
                }
                break;
            case "message.reasoning":
                statusView.setText("Thinking...");
                break;
            case "message.tool":
                statusView.setText(event.text.isEmpty() ? "Using a tool..." : "Using " + event.text + "...");
                break;
            case "session.status":
                statusView.setText("retry".equals(event.text) ? "Retrying..." : "OpenCode is working...");
                break;
            case "session.idle":
            case "session.error":
                renderStreamingText();
                streamingMessageId = null;
                streamingText.setLength(0);
                loadMessages();
                break;
            default:
                break;
        }
    }

    private void beginStreamingMessage(String messageId, boolean startedAtBoundary) {
        if (messageId.isEmpty() || messageId.equals(streamingMessageId)) {
            return;
        }
        streamingMessageId = messageId;
        streamingStartedAtBoundary = startedAtBoundary;
        streamingText.setLength(0);
        if (transcript == null) {
            return;
        }
        if (streamingLoadingView != null) {
            transcript.removeView(streamingLoadingView);
        }
        streamingMessageView = addMessage("OPENCODE", "Thinking...");
        streamingLoadingView = addLoadingIndicator();
        scrollChatToBottom();
    }

    private void renderStreamingText() {
        if (streamingMessageView == null) {
            return;
        }
        String text = streamingText.toString();
        markwon.setMarkdown(streamingMessageView, text.isEmpty() ? "Thinking..." : text);
        statusView.setText(text.isEmpty() ? "Thinking..." : "Responding...");
        scrollChatToBottom();
    }

    private void scrollChatToBottom() {
        if (followChatBottom && scrollView != null) {
            scrollView.post(() -> {
                if (followChatBottom && !userScrolling) {
                    scrollView.fullScroll(View.FOCUS_DOWN);
                }
            });
        }
    }

    private void startEventStream() {
        stopEventStream();
        if (!polling || sessionId == null) {
            return;
        }
        int generation = ++eventStreamGeneration;
        OpenCodeClient.EventStream stream = client().eventStream(sessionId, event ->
                handler.post(() -> {
                    if (polling && generation == eventStreamGeneration) {
                        handleStreamEvent(event);
                    }
                }));
        eventStream = stream;
        eventNetwork.execute(() -> {
            try {
                stream.run();
            } catch (Exception error) {
                if (polling && generation == eventStreamGeneration) {
                    handler.postDelayed(() -> {
                        if (polling && generation == eventStreamGeneration) {
                            startEventStream();
                            loadMessages();
                        }
                    }, 1_000);
                }
            }
        });
    }

    private void stopEventStream() {
        eventStreamGeneration++;
        streamTextRefreshScheduled = false;
        handler.removeCallbacks(streamTextRefresh);
        OpenCodeClient.EventStream stream = eventStream;
        eventStream = null;
        if (stream != null) {
            stream.close();
        }
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
        stopEventStream();
        handler.removeCallbacksAndMessages(null);
        network.shutdownNow();
        eventNetwork.shutdownNow();
        super.onDestroy();
    }
}
