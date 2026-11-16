package cc.ginpika.rukksh.ai.core.tool.work;

import cc.ginpika.rukksh.ai.core.tool.ToolRisk;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

@Component
public class SetWorkProjectMembersTool extends WorkProjectTool {
    public static final String NAME = "set_work_project_members";
    @Override public String name() { return NAME; }
    @Override public ToolRisk risk() { return ToolRisk.WRITE; }
    @Override public String description() {
        return "按当前用户的明确要求设置项目协作成员。先用 read_work_project 查看当前成员，用 list_agents 确认 Agent ID，"
                + "提交修改后的完整 member_ids 清单（至少一位），已有协作任务的参与成员保留原配置。";
    }

    @Override public String validate(JsonNode args) {
        if (args == null || !args.path("project_id").isTextual() || args.path("project_id").asText().isBlank())
            return "请填写项目 ID project_id";
        JsonNode members = args.path("member_ids");
        if (!members.isArray() || members.isEmpty()) return "请提供至少一位成员的完整 member_ids 清单";
        for (JsonNode member : members) {
            if (!member.isTextual() || member.asText().isBlank()) return "member_ids 必须是有效的 Agent ID";
        }
        return null;
    }

    @Override public ObjectNode parameters(ObjectMapper mapper) {
        var schema = objectParameters(mapper);
        var props = schema.putObject("properties");
        text(props, "project_id", "由 list_work_projects 返回的项目 ID");
        props.putObject("member_ids").put("type", "array").put("minItems", 1)
                .put("description", "最终成员列表，顺序与协作页面一致").putObject("items").put("type", "string");
        basis(props);
        schema.putArray("required").add("project_id").add("member_ids").add("basis");
        return schema;
    }
}
