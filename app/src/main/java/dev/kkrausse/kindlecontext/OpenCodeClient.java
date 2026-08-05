package dev.example.kindlecontext;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

final class OpenCodeClient {
    interface EventListener {
        void onSessionEvent(StreamEvent event);
    }

    static final class StreamEvent {
        final String type;
        final String messageId;
        final String text;

        StreamEvent(String type, String messageId, String text) {
            this.type = type;
            this.messageId = messageId;
            this.text = text;
        }
    }

    final class EventStream implements AutoCloseable {
        private final String sessionId;
        private final EventListener listener;
        private final CountDownLatch connected = new CountDownLatch(1);
        private volatile HttpURLConnection connection;
        private volatile boolean closed;

        EventStream(String sessionId, EventListener listener) {
            this.sessionId = sessionId;
            this.listener = listener;
        }

        void run() throws IOException, JSONException {
            HttpURLConnection active = openConnection("GET", "/event?directory=" + encode(directory));
            connection = active;
            active.setReadTimeout(0);
            active.setRequestProperty("Accept", "text/event-stream");
            int status = active.getResponseCode();
            if (status < 200 || status >= 300) {
                String response = readAll(active.getErrorStream());
                active.disconnect();
                throw new IOException("OpenCode returned HTTP " + status + ": " + response);
            }
            connected.countDown();

            try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    active.getInputStream(), StandardCharsets.UTF_8))) {
                StringBuilder data = new StringBuilder();
                String line;
                while (!closed && (line = reader.readLine()) != null) {
                    if (line.isEmpty()) {
                        dispatch(data);
                        data.setLength(0);
                    } else if (line.startsWith("data:")) {
                        if (data.length() > 0) {
                            data.append('\n');
                        }
                        data.append(line.substring(5).stripLeading());
                    }
                }
                dispatch(data);
            } finally {
                active.disconnect();
                connection = null;
            }
        }

        private void dispatch(StringBuilder data) throws JSONException {
            if (data.length() == 0) {
                return;
            }
            JSONObject event = new JSONObject(data.toString());
            JSONObject properties = event.optJSONObject("properties");
            if (properties == null) {
                return;
            }
            JSONObject info = properties.optJSONObject("info");
            JSONObject part = properties.optJSONObject("part");
            String eventSessionId = properties.optString("sessionID");
            if (eventSessionId.isEmpty() && info != null) {
                eventSessionId = info.optString("sessionID");
            }
            if (eventSessionId.isEmpty() && part != null) {
                eventSessionId = part.optString("sessionID");
            }
            if (!sessionId.equals(eventSessionId)) {
                return;
            }

            String type = event.optString("type");
            String messageId = properties.optString("messageID");
            if (messageId.isEmpty() && info != null) {
                messageId = info.optString("id");
            }
            if (messageId.isEmpty() && part != null) {
                messageId = part.optString("messageID");
            }
            if ("message.updated".equals(type)) {
                if (info != null && "assistant".equals(info.optString("role"))) {
                    listener.onSessionEvent(new StreamEvent(type, messageId, ""));
                }
            } else if ("message.part.updated".equals(type) && part != null) {
                String partType = part.optString("type");
                if ("text".equals(partType)) {
                    listener.onSessionEvent(new StreamEvent(type, messageId, part.optString("text")));
                } else if ("reasoning".equals(partType)) {
                    listener.onSessionEvent(new StreamEvent("message.reasoning", messageId, ""));
                } else if ("tool".equals(partType)) {
                    listener.onSessionEvent(new StreamEvent("message.tool", messageId,
                            part.optString("tool")));
                }
            } else if ("message.part.delta".equals(type)
                    && "text".equals(properties.optString("field"))) {
                listener.onSessionEvent(new StreamEvent(type, messageId,
                        properties.optString("delta")));
            } else if ("session.status".equals(type)) {
                JSONObject status = properties.optJSONObject("status");
                listener.onSessionEvent(new StreamEvent(type, "",
                        status == null ? "" : status.optString("type")));
            } else if ("session.idle".equals(type) || "session.error".equals(type)) {
                listener.onSessionEvent(new StreamEvent(type, "", ""));
            }
        }

        boolean awaitConnected(long timeoutMillis) throws InterruptedException {
            return connected.await(timeoutMillis, TimeUnit.MILLISECONDS);
        }

        @Override
        public void close() {
            closed = true;
            HttpURLConnection active = connection;
            if (active != null) {
                active.disconnect();
            }
        }
    }

    static final class Session {
        final String id;
        final String title;
        final long updated;
        long inputTokens;
        long outputTokens;
        long reasoningTokens;
        long cacheReadTokens;
        long cacheWriteTokens;
        double cost;

        Session(String id, String title, long updated) {
            this.id = id;
            this.title = title;
            this.updated = updated;
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

        Message(String id, String role, String text, boolean complete) {
            this.id = id;
            this.role = role;
            this.text = text;
            this.complete = complete;
        }
    }

    private final String baseUrl;
    private final String token;
    private final String directory;

    OpenCodeClient(String baseUrl, String token, String directory) {
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.token = token.trim();
        this.directory = directory.trim();
    }

    void health() throws IOException, JSONException {
        requestObject("GET", "/global/health", null);
    }

    List<Model> listModels() throws IOException, JSONException {
        JSONObject response = requestObject("GET", "/config/providers?directory=" + encode(directory), null);
        JSONArray providers = response.optJSONArray("providers");
        List<Model> models = new ArrayList<>();
        if (providers == null) {
            return models;
        }
        for (int i = 0; i < providers.length(); i++) {
            JSONObject values = providers.getJSONObject(i).optJSONObject("models");
            if (values == null) {
                continue;
            }
            Iterator<String> keys = values.keys();
            while (keys.hasNext()) {
                JSONObject value = values.optJSONObject(keys.next());
                if (value != null && "active".equals(value.optString("status"))) {
                    models.add(modelFromJson(value));
                }
            }
        }
        return models;
    }

    String createSession() throws IOException, JSONException {
        JSONObject data = requestObject("POST", "/session?directory=" + encode(directory),
                new JSONObject());
        return data.getString("id");
    }

    void sendMessage(String sessionId, String text, String providerId, String modelId,
            String variant) throws IOException, JSONException {
        JSONObject body = new JSONObject()
                .put("model", new JSONObject()
                        .put("providerID", providerId)
                        .put("modelID", modelId))
                .put("parts", new JSONArray().put(new JSONObject()
                        .put("type", "text")
                        .put("text", text)));
        if (!variant.isEmpty()) {
            body.put("variant", variant);
        }
        request("POST", "/session/" + encode(sessionId) + "/prompt_async?directory="
                + encode(directory), body);
    }

    EventStream eventStream(String sessionId, EventListener listener) {
        return new EventStream(sessionId, listener);
    }

    List<Session> listSessions() throws IOException, JSONException {
        JSONArray values = requestArray("GET", "/session?directory=" + encode(directory), null);
        List<Session> sessions = new ArrayList<>();
        for (int i = 0; i < Math.min(values.length(), 50); i++) {
            JSONObject value = values.getJSONObject(i);
            JSONObject time = value.optJSONObject("time");
            sessions.add(new Session(value.getString("id"),
                    value.optString("title", "Untitled reading chat"),
                    time == null ? 0 : time.optLong("updated")));
        }
        return sessions;
    }

    void loadUsage(List<Session> sessions) throws IOException, JSONException {
        for (Session session : sessions) {
            JSONArray messages = messageValues(session.id);
            for (int i = 0; i < messages.length(); i++) {
                JSONObject info = messages.getJSONObject(i).optJSONObject("info");
                if (info == null || !"assistant".equals(info.optString("role"))) {
                    continue;
                }
                JSONObject tokens = info.optJSONObject("tokens");
                JSONObject cache = tokens == null ? null : tokens.optJSONObject("cache");
                session.inputTokens += tokens == null ? 0 : tokens.optLong("input");
                session.outputTokens += tokens == null ? 0 : tokens.optLong("output");
                session.reasoningTokens += tokens == null ? 0 : tokens.optLong("reasoning");
                session.cacheReadTokens += cache == null ? 0 : cache.optLong("read");
                session.cacheWriteTokens += cache == null ? 0 : cache.optLong("write");
                session.cost += info.optDouble("cost", 0);
            }
        }
    }

    List<Message> listMessages(String sessionId) throws IOException, JSONException {
        JSONArray values = messageValues(sessionId);
        List<Message> messages = new ArrayList<>();
        for (int i = 0; i < values.length(); i++) {
            JSONObject value = values.getJSONObject(i);
            JSONObject info = value.optJSONObject("info");
            if (info == null) {
                continue;
            }
            String role = info.optString("role");
            JSONArray parts = value.optJSONArray("parts");
            StringBuilder text = new StringBuilder();
            if (parts != null) {
                for (int j = 0; j < parts.length(); j++) {
                    JSONObject part = parts.optJSONObject(j);
                    if (part != null && "text".equals(part.optString("type"))) {
                        text.append(part.optString("text"));
                    }
                }
            }
            if ("user".equals(role)) {
                messages.add(new Message(info.optString("id"), "YOU", text.toString(), true));
            } else if ("assistant".equals(role)) {
                JSONObject time = info.optJSONObject("time");
                boolean complete = time != null && time.has("completed");
                if (text.length() > 0 || !complete) {
                    messages.add(new Message(info.optString("id"), "OPENCODE",
                            text.toString(), complete));
                }
            }
        }
        return messages;
    }

    private JSONArray messageValues(String sessionId) throws IOException, JSONException {
        return requestArray("GET", "/session/" + encode(sessionId)
                + "/message?directory=" + encode(directory) + "&limit=200", null);
    }

    private JSONObject requestObject(String method, String path, JSONObject body)
            throws IOException, JSONException {
        String response = request(method, path, body);
        return response.isEmpty() ? new JSONObject() : new JSONObject(response);
    }

    private JSONArray requestArray(String method, String path, JSONObject body)
            throws IOException, JSONException {
        String response = request(method, path, body);
        return response.isEmpty() ? new JSONArray() : new JSONArray(response);
    }

    private String request(String method, String path, JSONObject body) throws IOException {
        HttpURLConnection connection = openConnection(method, path);
        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
        }

        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300
                ? connection.getInputStream() : connection.getErrorStream();
        String response = readAll(stream);
        connection.disconnect();
        if (status < 200 || status >= 300) {
            throw new IOException("OpenCode returned HTTP " + status + ": " + response);
        }
        return response;
    }

    private HttpURLConnection openConnection(String method, String path) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) URI.create(baseUrl + path)
                .toURL().openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(120_000);
        connection.setRequestProperty("Accept", "application/json");
        if (!token.isEmpty()) {
            String credentials = Base64.getEncoder().encodeToString(
                    ("opencode:" + token).getBytes(StandardCharsets.UTF_8));
            connection.setRequestProperty("Authorization", "Basic " + credentials);
        }
        return connection;
    }

    private static String readAll(InputStream stream) throws IOException {
        if (stream == null) {
            return "";
        }
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                result.append(line);
            }
        }
        return result.toString();
    }

    private static String encode(String value) throws IOException {
        return java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20");
    }

    private static Model modelFromJson(JSONObject value) {
        List<String> variants = new ArrayList<>();
        JSONObject values = value.optJSONObject("variants");
        if (values != null) {
            Iterator<String> keys = values.keys();
            while (keys.hasNext()) {
                variants.add(keys.next());
            }
        }
        return new Model(value.optString("name", value.optString("id")),
                value.optString("providerID"), value.optString("id"), variants);
    }
}
