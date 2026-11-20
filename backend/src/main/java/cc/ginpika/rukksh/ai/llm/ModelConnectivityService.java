package cc.ginpika.rukksh.ai.llm;

import cc.ginpika.rukksh.config.ModelApiFormat;
import cc.ginpika.rukksh.config.ModelTarget;
import cc.ginpika.rukksh.config.SettingsService;
import cc.ginpika.rukksh.config.dto.SettingsDtos;
import cc.ginpika.rukksh.shared.error.DomainException;
import cc.ginpika.rukksh.stats.TokenUsageService;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.stereotype.Service;

/** 模型/Embedding/Rerank 端点连通性与元信息探测服务。 */
@Service
public class ModelConnectivityService {

    /** 连通性测试的基准消息：要求极短固定回复，尽量少耗 token 与时间 */
    private static final String TEST_PROMPT = "连通性测试：请只回复两个字「正常」";

    /** 测试请求的响应上限：超过即判定超时，避免设置页按钮长时间挂起 */
    private static final long TEST_TIMEOUT_MS = 5000;

    /** Embedding 测试的探针文本 */
    private static final String TEST_EMBED_TEXT = "连通性测试";

    /** Rerank 测试的探针查询与候选文档 */
    private static final String TEST_RERANK_QUERY = "连通性测试";

    private static final List<String> TEST_RERANK_DOCS =
            List.of("连通性测试文档一", "连通性测试文档二");

    /** 测试回复截断长度（单行展示用） */
    private static final int TEST_REPLY_LIMIT = 120;

    /** 测试调用跑在虚拟线程上，超时后立即返回 */
    private static final ExecutorService TEST_POOL = Executors.newVirtualThreadPerTaskExecutor();

    private final SettingsService settings;
    private final ModelMetaClient meta;
    private final OpenAiChatClient chat;
    private final EmbeddingClient embedding;
    private final RerankClient rerank;

    public ModelConnectivityService(SettingsService settings, ModelMetaClient meta,
                                    OpenAiChatClient chat, EmbeddingClient embedding,
                                    RerankClient rerank) {
        this.settings = settings;
        this.meta = meta;
        this.chat = chat;
        this.embedding = embedding;
        this.rerank = rerank;
    }

    /** 保存模型时按需向远端探测上下文窗口（仅 OpenAI Chat Completions 兼容端点） */
    public Integer probeContextWindow(ModelTarget target) {
        if (target == null || target.apiFormat() != ModelApiFormat.OPENAI_CHAT_COMPLETIONS) {
            return null;
        }
        return meta.fetchContextWindow(target.baseUrl(), target.apiKey(), target.model());
    }

    /** 按给定端点从模型 API 试取上下文窗口（设置页编辑时自动回填）；取不到返回 null */
    public SettingsDtos.ContextWindowView fetchContextWindow(SettingsDtos.ContextWindowRequest req) {
        ModelApiFormat format = SettingsService.requireApiFormat(req.apiFormat());
        Integer value = format == ModelApiFormat.OPENAI_CHAT_COMPLETIONS
                ? meta.fetchContextWindow(req.baseUrl(), req.apiKey(), req.model())
                : null;
        return new SettingsDtos.ContextWindowView(value);
    }

    /** 模型连通性测试（设置页模型列表）：使用模型配置的聊天协议发一条基准对话 */
    public SettingsDtos.ChatTestView testModel(String id) {
        ModelTarget target = settings.requireModelTarget(id);
        long start = System.nanoTime();
        try {
            OpenAiChatClient.Completion completion = withinTestLimit(() -> chat.chat(target,
                    List.of(new OpenAiChatClient.ChatMessage("user", TEST_PROMPT)),
                    TokenUsageService.SOURCE_MODEL_TEST));
            return new SettingsDtos.ChatTestView(true, elapsedMs(start),
                    abbreviate(completion.content()), null);
        } catch (Exception e) {
            return new SettingsDtos.ChatTestView(false, elapsedMs(start), null, reason(e));
        }
    }

    /** Embedding 连通性测试：按设置页表单草稿端点向量化一条探针文本 */
    public SettingsDtos.TestView testEmbedding(SettingsDtos.EmbeddingRequest req) {
        ModelTarget target = settings.resolveDraftTarget(req.mode(), req.llmModelId(),
                req.baseUrl(), req.apiKey(), req.model());
        long start = System.nanoTime();
        try {
            float[] vec = withinTestLimit(() -> embedding.embed(target, TEST_EMBED_TEXT,
                    TokenUsageService.SOURCE_MODEL_TEST))
                    .orElseThrow(() -> new IllegalStateException("未配置 Embedding 端点"));
            return new SettingsDtos.TestView(true, elapsedMs(start), "向量维度 " + vec.length, null);
        } catch (Exception e) {
            return new SettingsDtos.TestView(false, elapsedMs(start), null, reason(e));
        }
    }

    /** Rerank 连通性测试：按设置页表单草稿端点对两条探针文档打分 */
    public SettingsDtos.TestView testRerank(SettingsDtos.RerankRequest req) {
        String mode = req.mode() == null || req.mode().isBlank() ? null : req.mode().strip();
        if (SettingsService.MODE_OFF.equals(mode)) {
            throw new DomainException(DomainException.ErrorKind.BAD_REQUEST, "Rerank 精排已关闭，无需测试");
        }
        ModelTarget target = settings.resolveDraftTarget(req.mode(), req.llmModelId(),
                req.baseUrl(), req.apiKey(), req.model());
        long start = System.nanoTime();
        try {
            double[] scores = withinTestLimit(() -> rerank.score(target, TEST_RERANK_QUERY,
                    TEST_RERANK_DOCS, TokenUsageService.SOURCE_MODEL_TEST))
                    .orElseThrow(() -> new IllegalStateException("响应缺少 results 或 relevance_score"));
            int top = 0;
            for (int i = 1; i < scores.length; i++) {
                if (scores[i] > scores[top]) {
                    top = i;
                }
            }
            return new SettingsDtos.TestView(true, elapsedMs(start),
                    scores.length + " 条候选打分成功，最高分 " + String.format("%.4f", scores[top]),
                    null);
        } catch (Exception e) {
            return new SettingsDtos.TestView(false, elapsedMs(start), null, reason(e));
        }
    }

    private static <T> T withinTestLimit(Callable<T> task) throws Exception {
        Future<T> future = TEST_POOL.submit(task);
        try {
            return future.get(TEST_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            future.cancel(true);
            throw new TimeoutException("超过 " + TEST_TIMEOUT_MS / 1000 + "s 未响应");
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof Exception ex) {
                throw ex;
            }
            throw new IllegalStateException(cause);
        }
    }

    private static String reason(Exception e) {
        return e.getMessage() == null ? e.toString() : e.getMessage();
    }

    private static long elapsedMs(long startNanos) {
        return (System.nanoTime() - startNanos) / 1_000_000;
    }

    private static String abbreviate(String s) {
        String t = s == null ? "" : s.strip().replaceAll("\\s+", " ");
        return t.length() <= TEST_REPLY_LIMIT ? t : t.substring(0, TEST_REPLY_LIMIT) + "…";
    }
}
