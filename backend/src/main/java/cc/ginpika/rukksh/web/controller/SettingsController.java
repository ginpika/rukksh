package cc.ginpika.rukksh.web.controller;

import cc.ginpika.rukksh.agent.maintenance.KnowledgeResetService;
import cc.ginpika.rukksh.ai.llm.ModelConnectivityService;
import cc.ginpika.rukksh.config.SettingsService;
import cc.ginpika.rukksh.config.dto.SettingsDtos;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 设置页：多模型 / 默认项 / Embedding / Rerank 配置（含连通性测试）；提示词见 PromptController。 */
@RestController
@RequestMapping("/api/settings")
public class SettingsController {

    private final SettingsService settings;
    private final ModelConnectivityService connectivity;
    private final KnowledgeResetService knowledgeReset;

    public SettingsController(SettingsService settings, ModelConnectivityService connectivity,
                              KnowledgeResetService knowledgeReset) {
        this.settings = settings;
        this.connectivity = connectivity;
        this.knowledgeReset = knowledgeReset;
    }

    @GetMapping
    public SettingsDtos.SettingsView get() {
        return settings.view();
    }

    @PostMapping("/models")
    public SettingsDtos.SettingsView createModel(@RequestBody SettingsDtos.ModelRequest req) {
        return settings.createModel(req, connectivity::probeContextWindow);
    }

    @PutMapping("/models/{id}")
    public SettingsDtos.SettingsView updateModel(@PathVariable String id,
                                                 @RequestBody SettingsDtos.ModelRequest req) {
        return settings.updateModel(id, req, connectivity::probeContextWindow);
    }

    @DeleteMapping("/models/{id}")
    public SettingsDtos.SettingsView deleteModel(@PathVariable String id) {
        return settings.deleteModel(id);
    }

    /** 编辑模型时按端点试取上下文窗口（token 数）；取不到返回 null */
    @PostMapping("/models/context-window")
    public SettingsDtos.ContextWindowView fetchContextWindow(
            @RequestBody SettingsDtos.ContextWindowRequest req) {
        return connectivity.fetchContextWindow(req);
    }

    /** 模型连通性测试（设置页模型列表）：基于基准对话验证接口能否正常返回 */
    @PostMapping("/models/{id}/test")
    public SettingsDtos.ChatTestView testModel(@PathVariable String id) {
        return connectivity.testModel(id);
    }

    @PutMapping("/defaults")
    public SettingsDtos.SettingsView saveDefaults(@RequestBody SettingsDtos.DefaultsRequest req) {
        return settings.saveDefaults(req);
    }

    @PutMapping("/embedding")
    public SettingsDtos.SettingsView saveEmbedding(@RequestBody SettingsDtos.EmbeddingRequest req) {
        return settings.saveEmbedding(req);
    }

    @PutMapping("/rerank")
    public SettingsDtos.SettingsView saveRerank(@RequestBody SettingsDtos.RerankRequest req) {
        return settings.saveRerank(req);
    }

    /** Embedding 连通性测试（设置页）：按表单草稿端点向量化一条探针文本，不改动已保存配置 */
    @PostMapping("/embedding/test")
    public SettingsDtos.TestView testEmbedding(@RequestBody SettingsDtos.EmbeddingRequest req) {
        return connectivity.testEmbedding(req);
    }

    /** Rerank 连通性测试（设置页）：按表单草稿端点对探针文档打分，不改动已保存配置 */
    @PostMapping("/rerank/test")
    public SettingsDtos.TestView testRerank(@RequestBody SettingsDtos.RerankRequest req) {
        return connectivity.testRerank(req);
    }

    /** 重置知识库（设置页「危险操作」）：删除全部 chunk、图谱实体与关系，并移除相关 embedding */
    @PostMapping("/knowledge-base/reset")
    public SettingsDtos.ResetResult resetKnowledgeBase(@org.springframework.web.bind.annotation.RequestBody(required=false) ResetRequest request) {
        return knowledgeReset.resetKnowledgeBase(request!=null && Boolean.TRUE.equals(request.deleteProjectKnowledge()));
    }
    public record ResetRequest(Boolean deleteProjectKnowledge) {}
}
