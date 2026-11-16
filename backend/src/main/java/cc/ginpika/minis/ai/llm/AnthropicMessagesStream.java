package cc.ginpika.minis.ai.llm;

import cc.ginpika.minis.stats.TokenUsageService.Usage;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.BufferedReader;
import java.io.IOException;
import java.util.TreeMap;

/** Decode Messages SSE while retaining signed content needed by a subsequent tool round. */
final class AnthropicMessagesStream {
    private final ObjectMapper json;
    private final OpenAiChatClient.DeltaListener listener;
    private final Runnable onChunk;
    private final TreeMap<Integer, ContentBlock> blocks = new TreeMap<>();
    private final StringBuilder text = new StringBuilder();
    private final StringBuilder reasoning = new StringBuilder();
    private final ObjectNode counts;
    private String finishReason;
    private boolean received;
    private boolean stopped;

    AnthropicMessagesStream(ObjectMapper json, OpenAiChatClient.DeltaListener listener, Runnable onChunk) {
        this.json = json;
        this.listener = listener;
        this.onChunk = onChunk;
        counts = json.createObjectNode();
    }

    void read(BufferedReader reader) throws IOException {
        StringBuilder data = new StringBuilder();
        String line;
        while (!stopped && (line = reader.readLine()) != null) {
            if (line.isEmpty() && !data.isEmpty()) {
                JsonNode event = json.readTree(data.toString());
                if (event != null && event.isObject()) accept(event);
                data.setLength(0);
            } else if (line.startsWith("data:")) {
                if (!data.isEmpty()) data.append('\n');
                data.append(line, 5, line.length());
            }
        }
        if (!stopped || finishReason == null || blocks.values().stream().anyMatch(block -> !block.closed)) {
            throw new IOException("流式响应在完成前断开；未接收完整模型结果");
        }
    }

    private void accept(JsonNode event) throws IOException {
        switch (event.path("type").asText()) {
            case "message_start" -> {
                received = true;
                mergeUsage(event.path("message").path("usage"));
            }
            case "content_block_start" -> startBlock(event);
            case "content_block_delta" -> updateBlock(event);
            case "content_block_stop" -> {
                ContentBlock block = blockOf(event);
                if (block != null) block.closed = true;
            }
            case "message_delta" -> {
                mergeUsage(event.path("usage"));
                String reason = event.path("delta").path("stop_reason").asText(null);
                if (reason != null) finishReason = normalizeStop(reason);
            }
            case "message_stop" -> stopped = true;
            case "error" -> throw streamError(event.path("error"));
            default -> { /* Ping and extensions. */ }
        }
    }

    private void startBlock(JsonNode event) throws IOException {
        if (!(event.path("content_block") instanceof ObjectNode start)) return;
        String type = start.path("type").asText();
        if (!"text".equals(type) && !"thinking".equals(type)
                && !"redacted_thinking".equals(type) && !"tool_use".equals(type)) return;
        int index = event.path("index").asInt(-1);
        var block = new ContentBlock(start.deepCopy());
        if (index < 0 || blocks.putIfAbsent(index, block) != null) {
            throw new IOException("无效的 Anthropic 内容块序号");
        }
        received = true;
        switch (type) {
            case "text" -> publish(start.path("text").asText(), false);
            case "thinking" -> publish(start.path("thinking").asText(), true);
            case "tool_use" -> onChunk.run();
            default -> { }
        }
    }

    private void updateBlock(JsonNode event) {
        ContentBlock block = blockOf(event);
        if (block == null || block.closed) return;
        JsonNode delta = event.path("delta");
        switch (delta.path("type").asText()) {
            case "text_delta" -> {
                String part = delta.path("text").asText();
                block.payload.append(part);
                publish(part, false);
            }
            case "thinking_delta" -> {
                String part = delta.path("thinking").asText();
                block.payload.append(part);
                publish(part, true);
            }
            case "signature_delta" -> block.signature.append(delta.path("signature").asText());
            case "input_json_delta" -> {
                String part = delta.path("partial_json").asText();
                block.payload.append(part);
                if (!part.isEmpty()) onChunk.run();
            }
            default -> { }
        }
    }

    private ContentBlock blockOf(JsonNode event) {
        return blocks.get(event.path("index").asInt(-1));
    }

    private void publish(String part, boolean thinking) {
        if (part.isEmpty()) return;
        (thinking ? reasoning : text).append(part);
        onChunk.run();
        if (listener != null) {
            if (thinking) listener.onDelta(part, null);
            else listener.onDelta(null, part);
        }
    }

    ObjectNode message(String model) throws IOException {
        ObjectNode message = json.createObjectNode().put("role", "assistant");
        if (text.isEmpty()) message.putNull("content");
        else message.put("content", text.toString());
        if (!reasoning.isEmpty()) message.put("reasoning_content", reasoning.toString());
        // A length-limited response can end with an incomplete tool use. Only tool_use authorizes a tool round.
        if (!"tool_calls".equals(finishReason)) return message;
        ArrayNode calls = message.putArray("tool_calls");
        ArrayNode nativeContent = json.createArrayNode();
        boolean signed = false;
        for (ContentBlock block : blocks.values()) {
            ObjectNode nativeBlock = block.value;
            switch (nativeBlock.path("type").asText()) {
                case "text" -> nativeBlock.put("text", nativeBlock.path("text").asText() + block.payload);
                case "thinking" -> {
                    nativeBlock.put("thinking", nativeBlock.path("thinking").asText() + block.payload);
                    String signature = nativeBlock.path("signature").asText() + block.signature;
                    if (signature.isEmpty()) throw new IOException("Anthropic 工具调用缺少思考签名");
                    nativeBlock.put("signature", signature);
                    signed = true;
                }
                case "redacted_thinking" -> signed = true;
                case "tool_use" -> appendCall(calls, block);
                default -> { }
            }
            nativeContent.add(nativeBlock);
        }
        if (calls.isEmpty()) throw new IOException("Anthropic 流式响应缺少 tool_use 内容块");
        if (signed) message.putObject(AnthropicMessagesRequest.NATIVE_CONTENT).put("model", model)
                .set("content", nativeContent);
        return message;
    }

    private void appendCall(ArrayNode calls, ContentBlock block) throws IOException {
        ObjectNode value = block.value;
        String id = value.path("id").asText();
        String name = value.path("name").asText();
        JsonNode arguments = block.payload.isEmpty() ? value.path("input") : json.reader()
                .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(block.payload.toString());
        if (!arguments.isObject() || id.isBlank() || name.isBlank()) {
            throw new IOException("Anthropic 流式响应包含无效的工具调用");
        }
        value.set("input", arguments);
        calls.addObject().put("id", id).put("type", "function").putObject("function")
                .put("name", name).put("arguments", arguments.toString());
    }

    private void mergeUsage(JsonNode usage) {
        usage.fields().forEachRemaining(field -> {
            if (field.getValue().isIntegralNumber() && field.getValue().canConvertToLong()) {
                counts.set(field.getKey(), field.getValue());
            }
        });
    }

    Usage usage() {
        long reads = counts.path("cache_read_input_tokens").asLong();
        long writes = counts.path("cache_creation_input_tokens").asLong();
        Long input = count("input_tokens");
        if (input != null) input += reads + writes;
        Usage usage = Usage.reported(input, count("output_tokens"), null, false, reads, 0);
        return usage != null && writes != 0 ? usage.partial() : usage;
    }

    private Long count(String name) {
        return counts.has(name) ? counts.path(name).longValue() : null;
    }

    boolean received() { return received; }
    String finishReason() { return finishReason; }

    void appendObservedText(StringBuilder target) {
        target.append(text).append(reasoning);
        for (ContentBlock block : blocks.values()) {
            if ("tool_use".equals(block.value.path("type").asText())) {
                target.append(block.value.path("name").asText()).append(block.payload);
            }
        }
    }

    private static String normalizeStop(String reason) {
        return switch (reason) {
            case "end_turn", "stop_sequence" -> "stop";
            case "max_tokens", "model_context_window_exceeded" -> "length";
            case "tool_use" -> "tool_calls";
            case "refusal" -> "content_filter";
            default -> reason;
        };
    }

    private static OpenAiChatClient.ChatFailure streamError(JsonNode error) {
        String type = error.path("type").asText();
        int status = switch (type) {
            case "invalid_request_error" -> 400;
            case "authentication_error" -> 401;
            case "permission_error" -> 403;
            case "not_found_error" -> 404;
            case "request_too_large" -> 413;
            case "rate_limit_error" -> 429;
            case "api_error" -> 500;
            case "overloaded_error" -> 529;
            default -> 0;
        };
        String detail = error.path("message").asText(type);
        return new OpenAiChatClient.ChatFailure(status, "Anthropic SSE: " + detail, null);
    }

    private static final class ContentBlock {
        final ObjectNode value;
        final StringBuilder payload = new StringBuilder();
        final StringBuilder signature = new StringBuilder();
        boolean closed;

        ContentBlock(ObjectNode value) { this.value = value; }
    }
}
