package cc.ginpika.rukksh.ai.core.tool.work;

import cc.ginpika.rukksh.ai.core.tool.ToolRisk;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

@Component
public class BindWorkProjectWorkspaceTool extends WorkProjectTool {
    public static final String NAME = "bind_work_project_workspace";

    @Override public String name() { return NAME; }
    @Override public ToolRisk risk() { return ToolRisk.WRITE; }

    @Override public String description() {
        return "按当前用户明确给出的项目和目录，绑定或更换 AI IDE 与协作共用的项目工作目录。"
                + "先用 read_work_project 的 detail 和 workspaces 确认现有绑定与工作空间；目录须已存在。"
                + "用户没有明确指定目录时先询问。项目仍在讨论或执行时，沿用协作工作目录的调整规则。";
    }

    @Override public ObjectNode parameters(ObjectMapper mapper) {
        var schema = objectParameters(mapper);
        var props = schema.putObject("properties");
        text(props, "project_id", "全局项目 ID");
        text(props, "workspace_id", "由 read_work_project 的 workspaces 返回的工作空间 ID");
        text(props, "directory", "用户指定的现有工作空间相对路径；根目录用 .");
        basis(props);
        schema.putArray("required").add("project_id").add("workspace_id").add("directory").add("basis");
        return schema;
    }
}
