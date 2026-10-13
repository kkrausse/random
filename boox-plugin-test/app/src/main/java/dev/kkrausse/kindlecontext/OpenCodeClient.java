package dev.kkrausse.kindlecontext;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Thin bridge to the shared OpenCode v2 client (client/, bundled as assets/reading-client.js),
 * which runs in a WebView that is never shown. The contract is in client/README.md.
 *
 * Every public call blocks its caller until JavaScript answers, so it must run on a background
 * thread. The WebView itself is only ever touched on the main thread; answers and events arrive
 * on WebView's JavaScript bridge thread.
 */
final class OpenCodeClient {
    private static final String TAG = "ReadingBridge";
    private static final String BUNDLE_ASSET = "reading-client.js";
    private static final long PAGE_TIMEOUT_MS = 20_000;
    // The shared client gives up on a request after 120 seconds.
    private static final long CALL_TIMEOUT_MS = 130_000;
    private static final long SUBSCRIBE_READY_MS = 5_000;

    interface EventListener {
        /** One event object from the table in client/README.md. Called on a WebView thread. */
        void onSessionEvent(JSONObject event);

        /** The WebView went away, taking the subscription with it. Subscribe again. */
        void onSubscriptionLost(String message);
    }

    static final class Usage {
        final long input;
        final long output;
        final long reasoning;
        final long cacheRead;
        final long cacheWrite;
        final double cost;

        Usage(long input, long output, long reasoning, long cacheRead, long cacheWrite,
                double cost) {
            this.input = input;
            this.output = output;
            this.reasoning = reasoning;
            this.cacheRead = cacheRead;
            this.cacheWrite = cacheWrite;
            this.cost = cost;
        }

        Usage plus(Usage other) {
            return new Usage(input + other.input, output + other.output,
                    reasoning + other.reasoning, cacheRead + other.cacheRead,
                    cacheWrite + other.cacheWrite, cost + other.cost);
        }

        static Usage fromJson(JSONObject value) {
            if (value == null) {
                return new Usage(0, 0, 0, 0, 0, 0);
            }
            return new Usage(value.optLong("input"), value.optLong("output"),
                    value.optLong("reasoning"), value.optLong("cacheRead"),
                    value.optLong("cacheWrite"), value.optDouble("cost", 0));
        }
    }

    static final class Session {
        final String id;
        final String title;
        final long updated;
        /** Empty when the session has no model yet. */
        final String providerId;
        final String modelId;
        final String variant;
        /** The server's own running totals for the session. */
        final Usage usage;

        Session(JSONObject value) throws JSONException {
            id = value.getString("id");
            String name = value.optString("title");
            title = name.isEmpty() ? "Untitled reading chat" : name;
            updated = value.optLong("updated");
            JSONObject model = value.optJSONObject("model");
            providerId = model == null ? "" : model.optString("providerId");
            modelId = model == null ? "" : model.optString("modelId");
            variant = model == null ? "" : model.optString("variant");
            usage = Usage.fromJson(value.optJSONObject("usage"));
        }

        boolean usesModel(String providerId, String modelId, String variant) {
            return this.providerId.equals(providerId) && this.modelId.equals(modelId)
                    && this.variant.equals(variant);
        }
    }

    static final class Model {
        final String name;
        final String providerId;
        final String modelId;
        final List<String> variants;

        Model(String name, String providerId, String modelId, List<String> variants) {
            this.name = name;
            this.providerId = providerId;
            this.modelId = modelId;
            this.variants = variants;
        }
    }

    static final class Message {
        final String id;
        final String role;
        final String text;
        final boolean complete;
        /** Why this step failed, or empty. */
        final String error;

        Message(String id, String role, String text, boolean complete, String error) {
            this.id = id;
            this.role = role;
            this.text = text;
            this.complete = complete;
            this.error = error;
        }
    }

    static final class Conversation {
        final Session session;
        final List<Message> messages;
        /** The server is still working on this session. */
        final boolean busy;
        /** Why the most recent run failed, or empty. */
        final String error;

        Conversation(Session session, List<Message> messages, boolean busy, String error) {
            this.session = session;
            this.messages = messages;
            this.busy = busy;
            this.error = error;
        }
    }

    private static final class Config {
        final String baseUrl;
        final String password;
        final String directory;

        Config(String baseUrl, String password, String directory) {
            this.baseUrl = baseUrl;
            this.password = password;
            this.directory = directory;
        }

        boolean sameAs(Config other) {
            return baseUrl.equals(other.baseUrl) && password.equals(other.password)
                    && directory.equals(other.directory);
        }
    }

    /** One loaded document. A change of connection settings gets a new one. */
    private final class Page {
        final Config config;
        final CompletableFuture<Void> ready = new CompletableFuture<>();
        WebView view;
        boolean configureSent;
        volatile String scriptError = "";

        Page(Config config) {
            this.config = config;
        }

        @JavascriptInterface
        public void resolve(String callId, String resultJson) {
            CompletableFuture<String> call = calls.remove(callId);
            if (call != null) {
                call.complete(resultJson);
            }
        }

        @JavascriptInterface
        public void reject(String callId, String errorMessage) {
            CompletableFuture<String> call = calls.remove(callId);
            if (call != null) {
                call.completeExceptionally(new IOException(errorMessage));
            }
        }

        @JavascriptInterface
        public void event(String subscriptionId, String eventJson) {
            EventListener listener = listeners.get(subscriptionId);
            if (listener == null) {
                return;
            }
            try {
                listener.onSessionEvent(new JSONObject(eventJson));
            } catch (JSONException error) {
                Log.w(TAG, "Unreadable event: " + eventJson, error);
            }
        }
    }

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, CompletableFuture<String>> calls = new ConcurrentHashMap<>();
    private final Map<String, EventListener> listeners = new ConcurrentHashMap<>();
    private final AtomicLong nextCallId = new AtomicLong();
    private volatile Config config;
    private String bundle;
    // Main thread only.
    private Page page;
    private boolean destroyed;

    OpenCodeClient(Context context) {
        this.context = context.getApplicationContext();
    }

    /**
     * Sets where the next call goes. Nothing is loaded here; a call made after the settings
     * changed loads a fresh page for them, which also ends every subscription.
     */
    void setConnection(String baseUrl, String password, String directory) {
        config = new Config(baseUrl.trim().replaceAll("/+$", ""), password.trim(),
                directory.trim());
    }

    /** Returns the server version. */
    String checkConnection() throws IOException, JSONException {
        return new JSONObject(call("checkConnection", new JSONObject())).optString("version");
    }

    List<Model> listModels() throws IOException, JSONException {
        JSONArray values = new JSONArray(call("listModels", new JSONObject()));
        List<Model> models = new ArrayList<>();
        for (int i = 0; i < values.length(); i++) {
            JSONObject value = values.getJSONObject(i);
            List<String> variants = new ArrayList<>();
            JSONArray names = value.optJSONArray("variants");
            for (int j = 0; names != null && j < names.length(); j++) {
                variants.add(names.getString(j));
            }
            models.add(new Model(value.optString("name", value.optString("modelId")),
                    value.optString("providerId"), value.optString("modelId"), variants));
        }
        return models;
    }

    /** The latest 50 sessions, most recently updated first, each with its usage totals. */
    List<Session> listSessions() throws IOException, JSONException {
        JSONArray values = new JSONArray(call("listSessions", new JSONObject()));
        List<Session> sessions = new ArrayList<>();
        for (int i = 0; i < values.length(); i++) {
            sessions.add(new Session(values.getJSONObject(i)));
        }
        return sessions;
    }

    /** In v2 the model belongs to the session, so it is chosen here rather than per prompt. */
    Session createSession(String providerId, String modelId, String variant)
            throws IOException, JSONException {
        return new Session(new JSONObject(call("createSession",
                new JSONObject().put("model", modelRef(providerId, modelId, variant)))));
    }

    Session getSession(String sessionId) throws IOException, JSONException {
        return new Session(new JSONObject(call("getSession",
                new JSONObject().put("sessionId", sessionId))));
    }

    void setModel(String sessionId, String providerId, String modelId, String variant)
            throws IOException, JSONException {
        call("setModel", new JSONObject().put("sessionId", sessionId)
                .put("model", modelRef(providerId, modelId, variant)));
    }

    /**
     * Queues the prompt and returns its message id at once; the reply arrives as events. Pass the
     * id to {@link #loadConversation} until the run ends.
     */
    String sendPrompt(String sessionId, String text) throws IOException, JSONException {
        return new JSONObject(call("sendPrompt", new JSONObject()
                .put("sessionId", sessionId).put("text", text))).optString("messageId");
    }

    Conversation loadConversation(String sessionId, String pendingMessageId)
            throws IOException, JSONException {
        JSONObject args = new JSONObject().put("sessionId", sessionId);
        if (pendingMessageId != null && !pendingMessageId.isEmpty()) {
            args.put("pendingMessageId", pendingMessageId);
        }
        JSONObject value = new JSONObject(call("loadConversation", args));
        JSONArray values = value.getJSONArray("messages");
        List<Message> messages = new ArrayList<>();
        for (int i = 0; i < values.length(); i++) {
            JSONObject message = values.getJSONObject(i);
            messages.add(new Message(message.optString("id"),
                    "user".equals(message.optString("role")) ? "YOU" : "OPENCODE",
                    message.optString("text"), message.optBoolean("complete"),
                    message.optString("error")));
        }
        return new Conversation(new Session(value.getJSONObject("session")), messages,
                value.optBoolean("busy"), value.optString("error"));
    }

    /**
     * Starts delivering the session's events to the listener. Returns once the event stream is
     * connected, or after five seconds with false while it keeps connecting, so a prompt sent
     * next cannot outrun the stream.
     */
    boolean subscribe(String subscriptionId, String sessionId, EventListener listener)
            throws IOException, JSONException {
        listeners.put(subscriptionId, listener);
        try {
            return new JSONObject(call("subscribe", new JSONObject()
                    .put("subscriptionId", subscriptionId)
                    .put("sessionId", sessionId)
                    .put("readyTimeoutMs", SUBSCRIBE_READY_MS))).optBoolean("connected");
        } catch (IOException | JSONException error) {
            listeners.remove(subscriptionId);
            throw error;
        }
    }

    /** No further event reaches the listener once this is called. */
    void unsubscribe(String subscriptionId) throws IOException, JSONException {
        if (listeners.remove(subscriptionId) != null) {
            call("unsubscribe", new JSONObject().put("subscriptionId", subscriptionId), false);
        }
    }

    /** Main thread. */
    void destroy() {
        destroyed = true;
        discardPage("Reading Context was closed.");
    }

    private static JSONObject modelRef(String providerId, String modelId, String variant)
            throws JSONException {
        JSONObject model = new JSONObject().put("providerId", providerId).put("modelId", modelId);
        if (!variant.isEmpty()) {
            model.put("variant", variant);
        }
        return model;
    }

    private String call(String method, JSONObject args) throws IOException {
        return call(method, args, true);
    }

    /**
     * @param loadPage false for calls that only make sense against the page already loaded; with
     *                 no such page they answer {@code null} instead of loading one.
     */
    private String call(String method, JSONObject args, boolean loadPage) throws IOException {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            // Waiting here would block the very thread that has to run the WebView.
            throw new IllegalStateException("OpenCode calls must run on a background thread.");
        }
        Config target = config;
        if (target == null || !target.baseUrl.matches("(?i)https?://[^/]+")) {
            throw new IOException("Set the OpenCode server URL in Settings, for example "
                    + "http://host:41137.");
        }
        String callId = "call-" + nextCallId.incrementAndGet();
        String argsJson = args.toString();
        CompletableFuture<String> result = new CompletableFuture<>();
        main.post(() -> {
            try {
                if (!loadPage && (page == null || !page.config.sameAs(target))) {
                    result.complete("null");
                    return;
                }
                Page active = pageFor(target);
                active.ready.whenComplete((nothing, error) -> main.post(() -> {
                    if (error != null) {
                        result.completeExceptionally(error);
                    } else if (page != active) {
                        result.completeExceptionally(new IOException(
                                "The OpenCode connection was restarted. Try again."));
                    } else {
                        calls.put(callId, result);
                        evaluate(active, callId, method, argsJson);
                    }
                }));
            } catch (Throwable error) {
                result.completeExceptionally(error);
            }
        });
        try {
            return result.get(PAGE_TIMEOUT_MS + CALL_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (ExecutionException error) {
            Throwable cause = error.getCause();
            if (cause instanceof IOException) {
                throw (IOException) cause;
            }
            throw new IOException(describe(cause), cause);
        } catch (TimeoutException error) {
            throw new IOException("OpenCode did not answer in time.");
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted while waiting for OpenCode.");
        } finally {
            calls.remove(callId);
        }
    }

    /** Main thread. The page for these settings, loading a new one if they changed. */
    private Page pageFor(Config target) throws IOException {
        if (destroyed) {
            throw new IOException("Reading Context was closed.");
        }
        if (page != null && page.config.sameAs(target)) {
            return page;
        }
        discardPage("The OpenCode connection settings changed.");
        Page created = new Page(target);
        try {
            created.view = createView(created);
            // The document's origin must be the server so the client's fetch calls are
            // same-origin. Navigating to the server instead would load its own web UI.
            created.view.loadDataWithBaseURL(target.baseUrl + "/",
                    "<!doctype html><script>" + bundle() + "</script>",
                    "text/html", "utf-8", null);
        } catch (Throwable error) {
            if (created.view != null) {
                created.view.destroy();
            }
            Log.e(TAG, "WebView unavailable", error);
            throw new IOException("Android System WebView is unavailable, and Reading Context "
                    + "needs it to talk to OpenCode: " + describe(error), error);
        }
        page = created;
        main.postDelayed(() -> {
            if (page == created && !created.ready.isDone()) {
                discardPage("The OpenCode client did not start in Android System WebView."
                        + scriptErrorNote(created));
            }
        }, PAGE_TIMEOUT_MS);
        return created;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView createView(Page owner) {
        WebView view = new WebView(context);
        view.getSettings().setJavaScriptEnabled(true);
        view.addJavascriptInterface(owner, "AndroidHost");
        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    Log.w(TAG, "JavaScript: " + message.message() + " (line "
                            + message.lineNumber() + ")");
                    owner.scriptError = message.message();
                }
                return true;
            }
        });
        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView finished, String url) {
                if (page != owner || owner.configureSent) {
                    return;
                }
                owner.configureSent = true;
                configure(owner);
            }

            @Override
            public boolean onRenderProcessGone(WebView gone, RenderProcessGoneDetail detail) {
                Log.w(TAG, "WebView renderer gone, crashed=" + detail.didCrash());
                // Returning true keeps the app alive; the dead WebView must not be used again.
                main.post(() -> {
                    if (page == owner) {
                        discardPage("Android System WebView stopped. Try again.");
                    } else if (owner.view != null) {
                        owner.view.destroy();
                        owner.view = null;
                    }
                });
                return true;
            }
        });
        return view;
    }

    /** Main thread. `configure` has to be the page's first call. */
    private void configure(Page target) {
        String callId = "configure-" + nextCallId.incrementAndGet();
        CompletableFuture<String> configured = new CompletableFuture<>();
        configured.whenComplete((result, error) -> {
            if (error == null) {
                target.ready.complete(null);
            } else {
                main.post(() -> {
                    if (page == target) {
                        discardPage(describe(error) + scriptErrorNote(target));
                    }
                });
            }
        });
        calls.put(callId, configured);
        try {
            evaluate(target, callId, "configure", new JSONObject()
                    .put("baseUrl", target.config.baseUrl)
                    .put("password", target.config.password)
                    .put("directory", target.config.directory).toString());
        } catch (JSONException error) {
            calls.remove(callId);
            configured.completeExceptionally(error);
        }
    }

    /** Main thread. */
    private void evaluate(Page target, String callId, String method, String argsJson) {
        String id = JSONObject.quote(callId);
        target.view.evaluateJavascript("(function(){if(!window.ReadingBridge){"
                + "AndroidHost.reject(" + id + ",'The OpenCode client script did not load.');"
                + "return;}"
                + "window.ReadingBridge.call(" + id + "," + JSONObject.quote(method) + ","
                + JSONObject.quote(argsJson) + ");})()", null);
    }

    /**
     * Main thread. Drops the page and its WebView; calls in flight fail with the message and
     * every subscription is reported lost. The next call loads a new page.
     */
    private void discardPage(String message) {
        Page old = page;
        page = null;
        if (old == null) {
            return;
        }
        if (old.view != null) {
            old.view.destroy();
            old.view = null;
        }
        IOException failure = new IOException(message);
        old.ready.completeExceptionally(failure);
        List<CompletableFuture<String>> pending = new ArrayList<>(calls.values());
        calls.clear();
        for (CompletableFuture<String> call : pending) {
            call.completeExceptionally(failure);
        }
        List<EventListener> lost = new ArrayList<>(listeners.values());
        listeners.clear();
        for (EventListener listener : lost) {
            listener.onSubscriptionLost(message);
        }
    }

    private static String scriptErrorNote(Page target) {
        return target.scriptError.isEmpty() ? ""
                : " Its script failed (the WebView may be too old): " + target.scriptError;
    }

    private static String describe(Throwable error) {
        return error.getMessage() == null ? error.toString() : error.getMessage();
    }

    /** Main thread. */
    private String bundle() throws IOException {
        if (bundle == null) {
            StringBuilder text = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    context.getAssets().open(BUNDLE_ASSET), StandardCharsets.UTF_8))) {
                char[] buffer = new char[16_384];
                int read;
                while ((read = reader.read(buffer)) > 0) {
                    text.append(buffer, 0, read);
                }
            }
            bundle = text.toString();
        }
        return bundle;
    }
}
