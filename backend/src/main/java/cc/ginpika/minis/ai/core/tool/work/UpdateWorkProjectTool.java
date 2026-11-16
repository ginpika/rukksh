package cc.ginpika.minis.ai.core.tool.work;

import cc.ginpika.minis.ai.core.tool.ToolRisk;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

@Component
public class UpdateWorkProjectTool extends WorkProjectTool {
    public static final String NAME = "update_work_project";
    @Override public String name() { return NAME; }
    @Override public ToolRisk risk() { return ToolRisk.WRITE; }
    @Override public String description() {
        return "按当前用户的明确要求修改项目名称、分类、创作标记、说明或状态（暂停、归档、恢复）。"
                + "只提供要修改的字段；归档状态保留项目和历史记录。";
    }

    @Override public String validate(JsonNode args) {
        if (args == null || !args.path("project_id").isTextual() || args.path("project_id").asText().isBlank())
            return "请填写项目 ID project_id";
        if (!(args.hasNonNull("name") || args.hasNonNull("kind") || args.hasNonNull("narrative")
                || args.hasNonNull("status") || args.hasNonNull("note"))) return "请提供要修改的字段";
        return null;
    }

    @Override public ObjectNode parameters(ObjectMapper mapper) {
        var schema = objectParameters(mapper);
        var props = schema.putObject("properties");
        text(props, "project_id", "由 list_work_projects 返回的项目 ID");
        projectFields(props);
        props.putObject("status").put("type", "string").putArray("enum").add("active").add("paused").add("archived");
        basis(props);
        schema.putArray("required").add("project_id").add("basis");
        return schema;
    }
}
