package cc.ginpika.rukksh.agent.runtime;

import cc.ginpika.rukksh.ai.comfyui.integration.GenerateImageTool;
import cc.ginpika.rukksh.ai.core.tool.NowTool;
import cc.ginpika.rukksh.ai.core.tool.RollDiceTool;
import cc.ginpika.rukksh.ai.core.tool.ToolRegistry;
import cc.ginpika.rukksh.ai.core.tool.ToolResult;
import cc.ginpika.rukksh.ai.core.util.LlmJson;
import cc.ginpika.rukksh.ai.knowledge.ingest.KnowledgeToolExecutor;
import cc.ginpika.rukksh.ai.knowledge.recall.RagRecallRecorder;
import cc.ginpika.rukksh.ai.memory.MemoryToolExecutor;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import org.springframework.stereotype.Component;

/**
 * 编排层公共工具路由器：协调知识库/文档/网页工具、记忆域工具、生图工具以及时间/骰子等内置通用工具，
 * 避免知识库执行器承担跨域粘合职责。
 */
@Component
public class AgentToolRouter {

    private static final DateTimeFormatter NOW_STAMP =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final KnowledgeToolExecutor knowledgeTools;
    private final MemoryToolExecutor memoryTools;
    private final GenerateImageTool imageTool;
    private final RagRecallRecorder ragRecalls;
    private final ToolRegistry tools;

    public AgentToolRouter(KnowledgeToolExecutor knowledgeTools,
                           MemoryToolExecutor memoryTools,
                           GenerateImageTool imageTool,
                           RagRecallRecorder ragRecalls,
                           ToolRegistry tools) {
        this.knowledgeTools = knowledgeTools;
        this.memoryTools = memoryTools;
        this.imageTool = imageTool;
        this.ragRecalls = ragRecalls;
        this.tools = tools;
    }

    /** 执行一次 OpenAI 风格的工具调用节点；source 标明来自哪条流（chat / multiagent / heartbeat / plan / agent） */
    public ToolResult run(JsonNode call, String source) {
        String name = call.path("function").path("name").asText("");
        String args = call.path("function").path("arguments").asText("");
        return run(name, args, source);
    }

    /** 按工具名分发执行，并由各能力边界记录召回留痕与写库属性。 */
    public ToolResult run(String name, String argsJson, String source) {
        JsonNode args = LlmJson.readTree(argsJson);
        if (GenerateImageTool.NAME.equals(name)) {
            return new ToolResult(name, argsJson, imageTool.execute(args), false);
        }
        if (MemoryToolExecutor.handles(name)) {
            String content = memoryTools.run(name, args);
            ragRecalls.record(name, argsJson, content, source);
            return new ToolResult(name, argsJson, content, tools.isWriteTool(name));
        }
        if (NowTool.NAME.equals(name)) {
            return new ToolResult(name, argsJson, LocalDateTime.now().format(NOW_STAMP), false);
        }
        if (RollDiceTool.NAME.equals(name)) {
            return new ToolResult(name, argsJson, RollDiceTool.roll(args), false);
        }
        return knowledgeTools.run(name, argsJson, source);
    }
}
