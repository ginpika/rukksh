package cc.ginpika.rukksh.config;

public enum ModelApiFormat {
    OPENAI_CHAT_COMPLETIONS("openai-chat-completions"),
    ANTHROPIC_MESSAGES("anthropic-messages");

    private final String wireValue;

    ModelApiFormat(String wireValue) {
        this.wireValue = wireValue;
    }

    public String wireValue() {
        return wireValue;
    }

    public static ModelApiFormat fromWireValue(String value) {
        if (value == null) {
            return OPENAI_CHAT_COMPLETIONS;
        }
        return switch (value.strip()) {
            case "openai-chat-completions" -> OPENAI_CHAT_COMPLETIONS;
            case "anthropic-messages" -> ANTHROPIC_MESSAGES;
            default -> throw new IllegalArgumentException(
                    "API 格式须为 openai-chat-completions 或 anthropic-messages");
        };
    }
}
