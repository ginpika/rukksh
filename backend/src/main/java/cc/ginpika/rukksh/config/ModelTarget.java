package cc.ginpika.rukksh.config;

/**
 * 一次模型调用的运行时端点和聊天协议。
 * 由 SettingsService 解析：既可能来自设置页持久化的配置，也可能来自 .env（内置 "env" 项）。
 */
public record ModelTarget(String baseUrl, String apiKey, String model,
                          ModelApiFormat apiFormat, Integer maxOutputTokens) {

    public static final int DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS = 8192;

    public ModelTarget(String baseUrl, String apiKey, String model) {
        this(baseUrl, apiKey, model, ModelApiFormat.OPENAI_CHAT_COMPLETIONS);
    }

    public ModelTarget(String baseUrl, String apiKey, String model, ModelApiFormat apiFormat) {
        this(baseUrl, apiKey, model, apiFormat, null);
    }

    public boolean configured() {
        return !isBlank(baseUrl) && !isBlank(apiKey) && !isBlank(model);
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
