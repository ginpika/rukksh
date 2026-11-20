package cc.ginpika.rukksh.config;

import cc.ginpika.rukksh.config.dto.SettingsDtos;
import cc.ginpika.rukksh.config.store.SettingsStore;
import cc.ginpika.rukksh.config.store.SettingsStore.EmbeddingRow;
import cc.ginpika.rukksh.config.store.SettingsStore.ModelRow;
import cc.ginpika.rukksh.config.store.SettingsStore.RerankRow;
import cc.ginpika.rukksh.config.store.SettingsStore.SettingRow;
import cc.ginpika.rukksh.shared.error.DomainException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.stereotype.Service;

/**
 * 设置页与运行时配置中枢（模型 / Embedding / Rerank）。
 *
 * <p>持久化在 SQLite（SettingsStore）；.env 传入的 LLM/Embedding 作为内置项（id="env"）在运行时合成，
 * 不入库、不可编辑删除，并在用户未指定默认项时兜底。连通性测试与知识库重置见对应专门服务。
 */
@Service
public class SettingsService {

    /** 内置项 id（.env 传入），不可编辑/删除 */
    public static final String ENV_ID = "env";

    public static final String MODE_LLM = "llm";
    public static final String MODE_CUSTOM = "custom";
    public static final String MODE_OFF = "off";

    private final LlmProps props;
    private final SettingsStore store;

    public SettingsService(LlmProps props, SettingsStore store) {
        this.props = props;
        this.store = store;
    }

    // ---------- 视图 ----------

    /** 设置页全量视图：内置 env 模型项（.env 已配置大模型时）+ 用户模型 + 默认选择 + Embedding + Rerank */
    public SettingsDtos.SettingsView view() {
        List<SettingsDtos.ModelView> models = new ArrayList<>();
        if (envChatConfigured()) {
            models.add(envModel());
        }
        store.models().forEach(m -> models.add(toModelView(m)));

        SettingRow setting = store.setting().orElse(null);
        String defaultModelId = pickDefault(setting == null ? null : setting.defaultModelId(),
                models.stream().map(SettingsDtos.ModelView::id).toList());
        if (ENV_ID.equals(defaultModelId) && !envTarget().configured()) {
            defaultModelId = models.stream()
                    .filter(m -> !ENV_ID.equals(m.id()))
                    .filter(SettingsService::usable)
                    .map(SettingsDtos.ModelView::id)
                    .findFirst().orElse(defaultModelId);
        }

        return new SettingsDtos.SettingsView(models, embeddingView(), rerankView(), defaultModelId);
    }

    // ---------- 模型 CRUD ----------

    public SettingsDtos.SettingsView createModel(SettingsDtos.ModelRequest req) {
        return createModel(req, t -> null);
    }

    public SettingsDtos.SettingsView createModel(SettingsDtos.ModelRequest req,
                                                 Function<ModelTarget, Integer> contextWindowProbe) {
        requireModelFields(req);
        ModelApiFormat format = requireApiFormat(req.apiFormat());
        boolean needsDefault = !chatConfigured();
        String id = UUID.randomUUID().toString();
        store.insertModel(modelRow(id, req, format, contextWindowProbe));
        if (needsDefault) {
            store.saveSetting(id);
        }
        return view();
    }

    public SettingsDtos.SettingsView updateModel(String id, SettingsDtos.ModelRequest req) {
        return updateModel(id, req, t -> null);
    }

    public SettingsDtos.SettingsView updateModel(String id, SettingsDtos.ModelRequest req,
                                                 Function<ModelTarget, Integer> contextWindowProbe) {
        requireNotBuiltin(id, "模型");
        requireModelFields(req);
        ModelRow existing = requireModelRow(id);
        ModelApiFormat format = req.apiFormat() == null ? existing.apiFormat() : requireApiFormat(req.apiFormat());
        store.updateModel(modelRow(id, req, format, contextWindowProbe));
        return view();
    }

    private ModelRow modelRow(String id, SettingsDtos.ModelRequest req, ModelApiFormat format,
                              Function<ModelTarget, Integer> contextWindowProbe) {
        String baseUrl = req.baseUrl().strip();
        String apiKey = req.apiKey().strip();
        String model = req.model().strip();
        Integer contextWindow = resolveContextWindow(format, baseUrl, apiKey, model,
                req.contextWindow(), contextWindowProbe);
        return new ModelRow(id, req.name().strip(), baseUrl, apiKey, model, contextWindow,
                req.maxOutputTokens(), format);
    }

    public SettingsDtos.SettingsView deleteModel(String id) {
        requireNotBuiltin(id, "模型");
        requireModelRow(id);
        store.deleteModel(id);
        SettingRow setting = store.setting().orElse(null);
        if (setting != null && id.equals(setting.defaultModelId())) {
            store.saveSetting(null);
        }
        return view();
    }

    /** 按设置页表单草稿解析端点：custom 用表单里的独立端点，其余复用所选模型端点 */
    public ModelTarget resolveDraftTarget(String mode, String llmModelId, String baseUrl,
                                          String apiKey, String model) {
        String m = normalize(model);
        if (MODE_CUSTOM.equals(normalize(mode))) {
            return new ModelTarget(normalize(baseUrl), normalize(apiKey), m);
        }
        ModelTarget llm = resolveModelById(normalize(llmModelId));
        return new ModelTarget(llm.baseUrl(), llm.apiKey(), m);
    }

    /** 设置页按列表 id 精确解析端点（测试/账户查询）：非内置 id 不存在时 404，不回退 env。 */
    public ModelTarget requireModelTarget(String id) {
        if (id == null || id.isBlank() || ENV_ID.equals(id)) {
            return resolveModelById(null);
        }
        return toModelTarget(requireModelRow(id));
    }

    // ---------- 默认选择与 Embedding ----------

    public SettingsDtos.SettingsView saveDefaults(SettingsDtos.DefaultsRequest req) {
        String modelId = normalize(req == null ? null : req.modelId());
        if (modelId != null && !ENV_ID.equals(modelId) && store.model(modelId).isEmpty()) {
            throw new DomainException(DomainException.ErrorKind.BAD_REQUEST, "模型不存在: " + modelId);
        }
        store.saveSetting(modelId);
        return view();
    }

    public SettingsDtos.SettingsView saveEmbedding(SettingsDtos.EmbeddingRequest req) {
        if (req == null) {
            throw new DomainException(DomainException.ErrorKind.BAD_REQUEST, "Embedding 配置不能为空");
        }
        String mode = normalize(req.mode());
        if (mode == null) {
            mode = MODE_LLM;
        }
        if (!MODE_LLM.equals(mode) && !MODE_CUSTOM.equals(mode)) {
            throw new DomainException(DomainException.ErrorKind.BAD_REQUEST, "mode 仅支持 llm | custom");
        }
        if (isBlank(req.model())) {
            throw new DomainException(DomainException.ErrorKind.BAD_REQUEST, "Embedding 模型名不能为空");
        }
        String llmModelId = normalize(req.llmModelId());
        if (MODE_CUSTOM.equals(mode)) {
            if (isBlank(req.baseUrl()) || isBlank(req.apiKey())) {
                throw new DomainException(DomainException.ErrorKind.BAD_REQUEST,
                        "自定义 Embedding 需填写 base-url 与 api-key");
            }
        } else if (llmModelId != null && !ENV_ID.equals(llmModelId)
                && store.model(llmModelId).isEmpty()) {
            throw new DomainException(DomainException.ErrorKind.BAD_REQUEST, "复用的模型不存在: " + llmModelId);
        }
        store.saveEmbedding(new EmbeddingRow(mode,
                MODE_CUSTOM.equals(mode) ? null : llmModelId,
                MODE_CUSTOM.equals(mode) ? req.baseUrl().strip() : null,
                MODE_CUSTOM.equals(mode) ? req.apiKey().strip() : null,
                req.model().strip()));
        return view();
    }

    /**
     * 保存 Rerank 配置：off 关闭精排（保留其余字段，便于再次打开时沿用）；
     * llm 复用某模型端点；custom 用独立端点。
     */
    public SettingsDtos.SettingsView saveRerank(SettingsDtos.RerankRequest req) {
        if (req == null) {
            throw new DomainException(DomainException.ErrorKind.BAD_REQUEST, "Rerank 配置不能为空");
        }
        String mode = normalize(req.mode());
        if (mode == null) {
            mode = MODE_LLM;
        }
        if (!MODE_LLM.equals(mode) && !MODE_CUSTOM.equals(mode) && !MODE_OFF.equals(mode)) {
            throw new DomainException(DomainException.ErrorKind.BAD_REQUEST,
                    "mode 仅支持 llm | custom | off");
        }
        if (MODE_OFF.equals(mode)) {
            store.saveRerank(new RerankRow(MODE_OFF, normalize(req.llmModelId()),
                    normalize(req.baseUrl()), normalize(req.apiKey()), normalize(req.model())));
            return view();
        }
        if (isBlank(req.model())) {
            throw new DomainException(DomainException.ErrorKind.BAD_REQUEST, "Rerank 模型名不能为空");
        }
        String llmModelId = normalize(req.llmModelId());
        if (MODE_CUSTOM.equals(mode)) {
            if (isBlank(req.baseUrl()) || isBlank(req.apiKey())) {
                throw new DomainException(DomainException.ErrorKind.BAD_REQUEST,
                        "自定义 Rerank 需填写 base-url 与 api-key");
            }
        } else if (llmModelId != null && !ENV_ID.equals(llmModelId)
                && store.model(llmModelId).isEmpty()) {
            throw new DomainException(DomainException.ErrorKind.BAD_REQUEST, "复用的模型不存在: " + llmModelId);
        }
        store.saveRerank(new RerankRow(mode,
                MODE_CUSTOM.equals(mode) ? null : llmModelId,
                MODE_CUSTOM.equals(mode) ? req.baseUrl().strip() : null,
                MODE_CUSTOM.equals(mode) ? req.apiKey().strip() : null,
                req.model().strip()));
        return view();
    }

    // ---------- 运行时解析 ----------

    /** 默认聊天模型（无请求级指定时使用） */
    public ModelTarget chatModel() {
        return resolveChatModel(null);
    }

    /** 解析聊天模型：modelId 缺省 → 已保存默认 → 内置 env 项；不可用时回退首个可用模型 */
    public ModelTarget resolveChatModel(String modelId) {
        ModelTarget target = resolveModelById(chatModelId(modelId));
        if (target.configured()) {
            return target;
        }
        return store.models().stream()
                .map(SettingsService::toModelTarget)
                .filter(ModelTarget::configured)
                .findFirst().orElse(target);
    }

    /** Resolve the selected identifier so long-running tasks can persist their model choice. */
    public String chatModelId(String modelId) {
        String id = normalize(modelId);
        if (id == null) {
            SettingRow setting = store.setting().orElse(null);
            id = normalize(setting == null ? null : setting.defaultModelId());
        }
        return id == null ? ENV_ID : id;
    }

    /** Output capability cannot be inferred from the context window. Null uses provider defaults. */
    public Integer chatOutputTokens(String modelId) {
        String id = chatModelId(modelId);
        return ENV_ID.equals(id) ? null : store.model(id).map(ModelRow::maxOutputTokens).filter(value -> value > 0).orElse(null);
    }

    /** 解析 Embedding 端点：mode=llm 复用某模型端点的 base-url/api-key，mode=custom 用独立端点 */
    public ModelTarget resolveEmbedding() {
        EmbeddingRow e = store.embedding().orElse(null);
        String mode = e == null ? MODE_LLM : normalize(e.mode());
        String model = e == null ? null : normalize(e.model());
        if (model == null) {
            model = props.getEmbeddingModel();
        }
        if (MODE_CUSTOM.equals(mode)) {
            return new ModelTarget(e.baseUrl(), e.apiKey(), model);
        }
        ModelTarget llm = resolveModelById(e == null ? null : e.llmModelId());
        return new ModelTarget(llm.baseUrl(), llm.apiKey(), model);
    }

    /** 本次聊天所用模型的上下文窗口（token 数） */
    public int chatContextWindow(String modelId) {
        String id = normalize(modelId);
        if (id == null) {
            SettingRow setting = store.setting().orElse(null);
            id = normalize(setting == null ? null : setting.defaultModelId());
        }
        if (id != null && !ENV_ID.equals(id)) {
            ModelRow row = store.model(id).orElse(null);
            Integer configured = positiveOrNull(row == null ? null : row.contextWindow());
            if (configured != null) {
                return configured;
            }
        }
        Integer fallback = positiveOrNull(props.getContextWindow());
        return fallback != null ? fallback : LlmProps.DEFAULT_CONTEXT_WINDOW;
    }

    /** 聊天可用性（内置或已配置任一模型） */
    public boolean chatConfigured() {
        return chatModel().configured();
    }

    /** 解析 Rerank 端点 */
    public ModelTarget resolveRerank() {
        RerankRow r = store.rerank().orElse(null);
        if (r != null) {
            String mode = normalize(r.mode());
            String model = normalize(r.model());
            if (MODE_OFF.equals(mode) || model == null) {
                return new ModelTarget(null, null, null);
            }
            if (MODE_CUSTOM.equals(mode)) {
                return new ModelTarget(r.baseUrl(), r.apiKey(), model);
            }
            ModelTarget llm = resolveModelById(r.llmModelId());
            return new ModelTarget(llm.baseUrl(), llm.apiKey(), model);
        }
        ModelTarget llm = resolveModelById(null);
        return new ModelTarget(llm.baseUrl(), llm.apiKey(), props.getRerankModel());
    }

    /** Embedding 可用性 */
    public boolean embeddingConfigured() {
        return resolveEmbedding().configured();
    }

    public static ModelApiFormat requireApiFormat(String value) {
        try {
            return ModelApiFormat.fromWireValue(value);
        } catch (IllegalArgumentException e) {
            throw new DomainException(DomainException.ErrorKind.BAD_REQUEST, e.getMessage(), e);
        }
    }

    // ---------- 私有 ----------

    private ModelTarget resolveModelById(String id) {
        if (id != null && !ENV_ID.equals(id)) {
            ModelRow row = store.model(id).orElse(null);
            if (row != null) {
                return toModelTarget(row);
            }
        }
        return envTarget();
    }

    private ModelTarget envTarget() {
        return new ModelTarget(props.getBaseUrl(), props.getApiKey(), props.getChatModel(),
                ModelApiFormat.fromWireValue(props.getApiFormat()));
    }

    private static ModelTarget toModelTarget(ModelRow row) {
        return new ModelTarget(row.baseUrl(), row.apiKey(), row.model(), row.apiFormat(), row.maxOutputTokens());
    }

    private static boolean usable(SettingsDtos.ModelView m) {
        return !isBlank(m.baseUrl()) && !isBlank(m.apiKey()) && !isBlank(m.model());
    }

    private boolean envChatConfigured() {
        return envTarget().configured();
    }

    private SettingsDtos.ModelView envModel() {
        ModelTarget target = envTarget();
        String name = normalize(target.model());
        if (name == null) {
            name = ".env";
        }
        return new SettingsDtos.ModelView(ENV_ID, name, target.baseUrl(), target.apiKey(), target.model(),
                props.getContextWindow(), true, null, ModelReasoning.efforts(target.model(), target.apiFormat()),
                target.apiFormat().wireValue());
    }

    private SettingsDtos.EmbeddingView embeddingView() {
        EmbeddingRow e = store.embedding().orElse(null);
        if (e == null) {
            return new SettingsDtos.EmbeddingView(MODE_LLM, ENV_ID, null, null,
                    props.getEmbeddingModel());
        }
        String mode = normalize(e.mode());
        if (mode == null) {
            mode = MODE_LLM;
        }
        return new SettingsDtos.EmbeddingView(mode,
                MODE_CUSTOM.equals(mode) ? null : pickDefault(e.llmModelId(), List.of()),
                e.baseUrl(), e.apiKey(), e.model());
    }

    private SettingsDtos.RerankView rerankView() {
        RerankRow r = store.rerank().orElse(null);
        if (r == null) {
            String model = normalize(props.getRerankModel());
            return new SettingsDtos.RerankView(model == null ? MODE_OFF : MODE_LLM, ENV_ID, null,
                    null, model);
        }
        String mode = normalize(r.mode());
        if (mode == null) {
            mode = MODE_LLM;
        }
        return new SettingsDtos.RerankView(mode,
                MODE_CUSTOM.equals(mode) ? null : pickDefault(r.llmModelId(), List.of()),
                r.baseUrl(), r.apiKey(), r.model());
    }

    private static SettingsDtos.ModelView toModelView(ModelRow m) {
        return new SettingsDtos.ModelView(m.id(), m.name(), m.baseUrl(), m.apiKey(), m.model(),
                m.contextWindow(), false, m.maxOutputTokens(), ModelReasoning.efforts(m.model(), m.apiFormat()),
                m.apiFormat().wireValue());
    }

    private static String pickDefault(String id, List<String> candidates) {
        String norm = normalize(id);
        if (norm == null) {
            return ENV_ID;
        }
        if (candidates.isEmpty() || candidates.contains(norm)) {
            return norm;
        }
        return ENV_ID;
    }

    private void requireModelFields(SettingsDtos.ModelRequest req) {
        if (req == null || isBlank(req.name()) || isBlank(req.baseUrl()) || isBlank(req.apiKey())
                || isBlank(req.model())) {
            throw new DomainException(DomainException.ErrorKind.BAD_REQUEST,
                    "模型配置需填写 名称/base-url/api-key/model");
        }
        if (req.maxOutputTokens() != null && (req.maxOutputTokens() < 1 || req.maxOutputTokens() > 1_000_000)) {
            throw new DomainException(DomainException.ErrorKind.BAD_REQUEST,
                    "单次输出上限须为 1 至 1000000 的 token 数，或留空跟随模型服务");
        }
    }

    private void requireNotBuiltin(String id, String what) {
        if (ENV_ID.equals(id)) {
            throw new DomainException(DomainException.ErrorKind.BAD_REQUEST, "内置" + what + "不可编辑或删除");
        }
    }

    private ModelRow requireModelRow(String id) {
        ModelRow row = id == null ? null : store.model(id).orElse(null);
        if (row != null) {
            return row;
        }
        throw new DomainException(DomainException.ErrorKind.NOT_FOUND, "模型不存在: " + id);
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String normalize(String s) {
        return isBlank(s) ? null : s.strip();
    }

    private Integer resolveContextWindow(ModelApiFormat format, String baseUrl, String apiKey, String model,
                                         Integer manual, Function<ModelTarget, Integer> contextWindowProbe) {
        Integer m = positiveOrNull(manual);
        if (m != null) {
            return m;
        }
        Integer fetched = contextWindowProbe == null
                ? null
                : contextWindowProbe.apply(new ModelTarget(baseUrl, apiKey, model, format));
        return positiveOrNull(fetched) != null ? fetched : LlmProps.DEFAULT_CONTEXT_WINDOW;
    }

    private static Integer positiveOrNull(Integer n) {
        return n == null || n <= 0 ? null : n;
    }
}
