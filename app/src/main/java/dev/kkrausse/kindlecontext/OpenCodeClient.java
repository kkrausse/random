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
import java.util.List;

final class OpenCodeClient {
    static final class Session {
        final String id;
        final String title;
        final long updated;
        final long inputTokens;
        final long outputTokens;
        final long reasoningTokens;
        final long cacheReadTokens;
        final long cacheWriteTokens;
        final double cost;

        Session(String id, String title, long updated, JSONObject value) {
            this.id = id;
            this.title = title;
            this.updated = updated;
            JSONObject tokens = value.optJSONObject("tokens");
            JSONObject cache = tokens == null ? null : tokens.optJSONObject("cache");
            inputTokens = tokens == null ? 0 : tokens.optLong("input");
            outputTokens = tokens == null ? 0 : tokens.optLong("output");
            reasoningTokens = tokens == null ? 0 : tokens.optLong("reasoning");
            cacheReadTokens = cache == null ? 0 : cache.optLong("read");
            cacheWriteTokens = cache == null ? 0 : cache.optLong("write");
            cost = value.optDouble("cost", 0);
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
        final String role;
        final String text;
        final boolean complete;

        Message(String role, String text, boolean complete) {
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
        request("GET", "/api/health", null);
    }

    Model defaultModel() throws IOException, JSONException {
        String path = "/api/model/default?location%5Bdirectory%5D="
                + java.net.URLEncoder.encode(directory, "UTF-8");
        JSONObject data = request("GET", path, null).optJSONObject("data");
        if (data == null) {
            return null;
        }
        return modelFromJson(data);
    }

    List<Model> listModels() throws IOException, JSONException {
        String path = "/api/model?location%5Bdirectory%5D="
                + java.net.URLEncoder.encode(directory, "UTF-8");
        JSONArray values = request("GET", path, null).getJSONArray("data");
        List<Model> models = new ArrayList<>();
        for (int i = 0; i < values.length(); i++) {
            JSONObject value = values.getJSONObject(i);
            if (value.optBoolean("enabled") && "active".equals(value.optString("status"))) {
                models.add(modelFromJson(value));
            }
        }
        return models;
    }

    String createSession(String providerId, String modelId, String variant)
            throws IOException, JSONException {
        JSONObject body = new JSONObject();
        body.put("location", new JSONObject().put("directory", directory));
        JSONObject model = new JSONObject()
                .put("providerID", providerId)
                .put("id", modelId);
        if (!variant.isEmpty()) {
            model.put("variant", variant);
        }
        body.put("model", model);
        JSONObject data = request("POST", "/api/session", body).getJSONObject("data");
        return data.getString("id");
    }

    void sendMessage(String sessionId, String text) throws IOException, JSONException {
        JSONObject body = new JSONObject().put("text", text);
        request("POST", "/api/session/" + encodePath(sessionId) + "/prompt", body);
    }

    List<Session> listSessions() throws IOException, JSONException {
        String path = "/api/session?limit=50&order=desc&directory="
                + java.net.URLEncoder.encode(directory, "UTF-8");
        JSONArray values = request("GET", path, null).getJSONArray("data");
        List<Session> sessions = new ArrayList<>();
        for (int i = 0; i < values.length(); i++) {
            JSONObject value = values.getJSONObject(i);
            JSONObject time = value.optJSONObject("time");
            sessions.add(new Session(value.getString("id"),
                    value.optString("title", "Untitled reading chat"),
                    time == null ? 0 : time.optLong("updated"), value));
        }
        return sessions;
    }

    List<Message> listMessages(String sessionId) throws IOException, JSONException {
        String path = "/api/session/" + encodePath(sessionId) + "/message?limit=100&order=asc";
        JSONArray values = request("GET", path, null).getJSONArray("data");
        List<Message> messages = new ArrayList<>();
        for (int i = 0; i < values.length(); i++) {
            JSONObject value = values.getJSONObject(i);
            String type = value.optString("type");
            if ("user".equals(type)) {
                messages.add(new Message("YOU", value.optString("text"), true));
            } else if ("assistant".equals(type)) {
                JSONArray content = value.optJSONArray("content");
                StringBuilder text = new StringBuilder();
                if (content != null) {
                    for (int j = 0; j < content.length(); j++) {
                        JSONObject part = content.optJSONObject(j);
                        if (part != null && "text".equals(part.optString("type"))) {
                            text.append(part.optString("text"));
                        }
                    }
                }
                JSONObject time = value.optJSONObject("time");
                boolean complete = time != null && time.has("completed");
                if (text.length() > 0 || !complete) {
                    messages.add(new Message("OPENCODE", text.toString(), complete));
                }
            }
        }
        return messages;
    }

    private JSONObject request(String method, String path, JSONObject body)
            throws IOException, JSONException {
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
        return new JSONObject(response);
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

    private static String encodePath(String value) throws IOException {
        return java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20");
    }

    private static Model modelFromJson(JSONObject value) {
        List<String> variants = new ArrayList<>();
        JSONArray values = value.optJSONArray("variants");
        if (values != null) {
            for (int i = 0; i < values.length(); i++) {
                JSONObject variant = values.optJSONObject(i);
                if (variant != null && !variant.optString("id").isEmpty()) {
                    variants.add(variant.optString("id"));
                }
            }
        }
        return new Model(value.optString("name", value.optString("modelID")),
                value.optString("providerID"), value.optString("modelID"), variants);
    }
}
