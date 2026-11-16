package cc.ginpika.rukksh.ai.llm;

import cc.ginpika.rukksh.ai.core.util.LlmJson;
import cc.ginpika.rukksh.config.ModelTarget;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import okhttp3.HttpUrl;
import okhttp3.Request;

import java.util.Set;
import java.util.regex.Pattern;

/** Converts the shared conversation representation to the Anthropic Messages wire format. */
final class AnthropicMessagesRequest {
    static final String NATIVE_CONTENT = "_anthropic_content";
    private static final Pattern BEDROCK_HOST = Pattern.compile(
            "bedrock-(mantle|runtime)(-fips)?\\.[a-z0-9-]+\\.(api\\.aws|amazonaws\\.com(\\.cn)?)");
    private static final Set<String> IMAGE_MEDIA = Set.of("image/jpeg", "image/png", "image/gif", "image/webp");

    private AnthropicMessagesRequest() {}

    static Request.Builder request(ModelTarget target) {
        HttpUrl base = HttpUrl.get(target.baseUrl());
        String path = base.encodedPath().replaceFirst("/+$", "");
        if (BEDROCK_HOST.matcher(base.host()).matches()
                && (path.isEmpty() || path.equals("/v1") || path.equals("/v1/messages"))) {
            path = "/anthropic" + path;
        }
        if (!path.endsWith("/v1/messages")) {
            path += path.endsWith("/v1") ? "/messages" : "/v1/messages";
        }
        return new Request.Builder()
                .url(base.newBuilder().encodedPath(path).fragment(null).build())
                .header("x-api-key", target.apiKey())
                .header("anthropic-version", "2023-06-01");
    }

    static ObjectNode body(ObjectNode source, ModelTarget target) {
        ObjectNode body = source.objectNode().put("model", target.model())
                .put("max_tokens", maxTokens(source, target.maxOutputTokens())).put("stream", true);
        ArrayNode system = source.arrayNode();
        ArrayNode messages = body.putArray("messages");
        JsonNode history = source.path("messages");
        int activeToolTurn = activeToolTurn(history);
        for (int i = 0; i < history.size(); i++) {
            JsonNode message = history.get(i);
            String role = message.path("role").asText();
            switch (role) {
                case "system", "developer" -> addContent(system, message.path("content"), true);
                case "user", "assistant" -> {
                    ArrayNode blocks = body.arrayNode();
                    JsonNode nativeMessage = message.path(NATIVE_CONTENT);
                    if ("assistant".equals(role) && i >= activeToolTurn
                            && target.model().equals(nativeMessage.path("model").asText())
                            && nativeMessage.path("content") instanceof ArrayNode nativeContent) {
                        blocks.addAll(nativeContent.deepCopy());
                    } else {
                        addContent(blocks, message.path("content"), false);
                        if ("assistant".equals(role)) {
                            for (JsonNode call : message.path("tool_calls")) addToolUse(blocks, call);
                        }
                    }
                    appendMessage(messages, role, blocks, false);
                }
                case "tool" -> {
                    ArrayNode blocks = body.arrayNode();
                    addToolResult(blocks, message);
                    appendMessage(messages, "user", blocks, true);
                }
                default -> throw new IllegalArgumentException("Anthropic Messages 不支持消息角色 " + role);
            }
        }
        if (messages.isEmpty()) {
            throw new IllegalArgumentException("Anthropic Messages 至少需要一条对话消息");
        }
        // Steering can end the transcript with an interim reply. Claude would interpret it as prefill.
        if ("assistant".equals(messages.get(messages.size() - 1).path("role").asText())) {
            addText(messages.addObject().put("role", "user").putArray("content"), "请根据当前对话继续。");
        }
        if (!system.isEmpty()) body.set("system", system);
        addTools(body, source);
        for (String field : Set.of("temperature", "top_p")) {
            if (source.path(field).isNumber()) body.set(field, source.get(field));
        }
        JsonNode stop = source.path("stop");
        if (stop.isTextual() && !stop.asText().isEmpty()) body.putArray("stop_sequences").add(stop.asText());
        if (stop.isArray() && !stop.isEmpty()) body.set("stop_sequences", stop.deepCopy());
        return body;
    }

    private static int maxTokens(ObjectNode source, Integer configured) {
        int requested = source.path("max_completion_tokens").asInt();
        if (requested <= 0) requested = source.path("max_tokens").asInt();
        if (configured != null && configured > 0) {
            return requested > 0 ? Math.min(requested, configured) : configured;
        }
        return requested > 0 ? requested : ModelTarget.DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS;
    }

    /** Signed blocks are required for the ongoing tool turn. Historical exchanges can use the shared fields. */
    private static int activeToolTurn(JsonNode history) {
        int first = history.size();
        boolean results = false;
        for (int i = first - 1; i >= 0; i--) {
            JsonNode message = history.get(i);
            switch (message.path("role").asText()) {
                case "tool" -> results = true;
                case "assistant" -> {
                    if (!results || message.path("tool_calls").isEmpty()) return first;
                    first = i;
                    results = false;
                }
                default -> { }
            }
        }
        return first;
    }

    private static void appendMessage(ArrayNode messages, String role, ArrayNode blocks, boolean toolResult) {
        if (blocks.isEmpty()) return;
        JsonNode previous = messages.get(messages.size() - 1);
        if (previous == null || !role.equals(previous.path("role").asText())) {
            messages.addObject().put("role", role).set("content", blocks);
            return;
        }
        ArrayNode content = (ArrayNode) previous.path("content");
        if (toolResult) {
            // Claude expects all parallel results before any text or images in the user message.
            int index = 0;
            while (index < content.size() && "tool_result".equals(content.get(index).path("type").asText())) index++;
            content.insert(index, blocks.get(0));
        } else {
            content.addAll(blocks);
        }
    }

    private static void addContent(ArrayNode blocks, JsonNode content, boolean textOnly) {
        if (content.isTextual()) {
            addText(blocks, content.asText());
            return;
        }
        for (JsonNode part : content) {
            String type = part.path("type").asText();
            if ("text".equals(type)) {
                addText(blocks, part.path("text").asText());
            } else if (!textOnly && "image_url".equals(type)) {
                addImage(blocks, part.path("image_url").path("url").asText());
            } else {
                throw new IllegalArgumentException("Anthropic Messages 不支持此内容类型 " + type);
            }
        }
    }

    private static void addText(ArrayNode blocks, String text) {
        if (!text.isBlank()) blocks.addObject().put("type", "text").put("text", text);
    }

    private static void addImage(ArrayNode blocks, String url) {
        if (url.startsWith("data:")) {
            int delimiter = url.indexOf(";base64,");
            if (delimiter > 5 && IMAGE_MEDIA.contains(url.substring(5, delimiter))) {
                blocks.addObject().put("type", "image").putObject("source").put("type", "base64")
                        .put("media_type", url.substring(5, delimiter)).put("data", url.substring(delimiter + 8));
                return;
            }
            throw new IllegalArgumentException("Anthropic Messages 图片需使用 PNG、JPEG、GIF 或 WebP Base64 数据");
        }
        if (HttpUrl.parse(url) == null) throw new IllegalArgumentException("Anthropic Messages 图片 URL 无效");
        blocks.addObject().put("type", "image").putObject("source").put("type", "url").put("url", url);
    }

    private static void addToolUse(ArrayNode blocks, JsonNode call) {
        JsonNode function = call.path("function");
        JsonNode input = function.path("arguments");
        if (input.isTextual()) input = LlmJson.readTree(input.asText());
        // Older transcripts may contain clipped or invalid argument strings. Keep their tool/result pairing.
        blocks.addObject().put("type", "tool_use").put("id", call.path("id").asText())
                .put("name", function.path("name").asText())
                .set("input", input.isObject() ? input.deepCopy() : blocks.objectNode());
    }

    private static void addToolResult(ArrayNode blocks, JsonNode message) {
        ObjectNode result = blocks.addObject().put("type", "tool_result")
                .put("tool_use_id", message.path("tool_call_id").asText());
        JsonNode content = message.path("content");
        if (content.isTextual()) {
            if (!content.asText().isEmpty()) result.put("content", content.asText());
        } else {
            ArrayNode converted = blocks.arrayNode();
            addContent(converted, content, false);
            if (!converted.isEmpty()) result.set("content", converted);
        }
        if (message.path("is_error").isBoolean()) result.set("is_error", message.get("is_error"));
    }

    private static void addTools(ObjectNode body, ObjectNode source) {
        JsonNode tools = source.path("tools");
        if (!tools.isArray() || tools.isEmpty()) return;
        ArrayNode converted = body.putArray("tools");
        for (JsonNode tool : tools) {
            JsonNode function = tool.path("function");
            if (!"function".equals(tool.path("type").asText()) || function.path("name").asText().isBlank()) {
                throw new IllegalArgumentException("Anthropic Messages 工具需要有效的函数定义");
            }
            ObjectNode definition = converted.addObject().put("name", function.path("name").asText());
            if (function.path("description").isTextual()) definition.set("description", function.get("description"));
            JsonNode schema = function.path("parameters");
            definition.set("input_schema", schema.isObject() ? schema.deepCopy() : body.objectNode().put("type", "object"));
        }
        JsonNode choice = source.path("tool_choice");
        boolean serial = source.path("parallel_tool_calls").isBoolean() && !source.path("parallel_tool_calls").asBoolean();
        if (choice.isMissingNode() && !serial) return;
        ObjectNode selected = body.putObject("tool_choice");
        if (choice.isObject() && "function".equals(choice.path("type").asText())) {
            selected.put("type", "tool").put("name", choice.path("function").path("name").asText());
        } else {
            String type = switch (choice.asText("auto")) {
                case "required" -> "any";
                case "none" -> "none";
                default -> "auto";
            };
            selected.put("type", type);
        }
        if (serial && !"none".equals(selected.path("type").asText())) selected.put("disable_parallel_tool_use", true);
    }
}
