package cc.ginpika.rukksh.agent.chat;

import cc.ginpika.rukksh.agent.chat.dto.ChatDtos.AttachmentInfo;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.util.List;

/** Normalized attachments. Transcript APIs expose the names and types only. */
public final class ChatAttachments {
    public static final int MAX_IMAGES = 2;

    private ChatAttachments() {}

    public record Content(String name, String mediaType, String value) {
        public boolean image() {
            return mediaType.startsWith("image/");
        }
    }

    public static List<Content> read(ObjectMapper json, String stored) {
        if (stored == null) return List.of();
        try {
            return json.readValue(stored, new TypeReference<List<Content>>() {});
        } catch (IOException e) {
            throw new IllegalStateException("会话附件记录无法读取", e);
        }
    }

    public static List<AttachmentInfo> info(List<Content> files) {
        return files.stream().map(file -> new AttachmentInfo(file.name(), file.image())).toList();
    }

    public static boolean supportsImages(String model) {
        return !"deepseek-v4-pro".equalsIgnoreCase(model);
    }

    public static ObjectNode userMessage(ObjectMapper json, String text, List<Content> files, int imageBudget) {
        var message = json.createObjectNode().put("role", "user");
        if (files.isEmpty()) return message.put("content", text);
        var parts = message.putArray("content");
        parts.addObject().put("type", "text").put("text", text);
        for (Content file : files) {
            if (file.image()) {
                parts.addObject().put("type", "text").put("text", imageBudget > 0
                        ? "用户附件（图片）：" + file.name()
                        : "用户附件（图片未随此次请求提供）：" + file.name());
                if (imageBudget > 0) {
                    imageBudget--;
                    parts.addObject().put("type", "image_url").putObject("image_url").put("url", file.value());
                }
            } else {
                parts.addObject().put("type", "text").put("text", "【用户附件资料：" + file.name()
                        + "】\n" + file.value() + "\n【附件资料结束】");
            }
        }
        return message;
    }
}
