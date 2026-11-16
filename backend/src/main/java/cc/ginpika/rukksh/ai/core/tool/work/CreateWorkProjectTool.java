package cc.ginpika.rukksh.ai.core.tool.work;

import cc.ginpika.rukksh.ai.core.tool.ToolRisk;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

@Component
public class CreateWorkProjectTool extends WorkProjectTool {
    public static final String NAME = "create_work_project";
    @Override public String name() { return NAME; }
    @Override public ToolRisk risk() { return ToolRisk.WRITE; }
    @Override public String description() {
        return "按当前用户的明确要求创建全局项目。兼容同名项目时返回已有项目。此操作只管理项目目录，"
                + "当前会话的绑定与续接由 manage_project 管理。";
    }

    @Override public String validate(JsonNode args) {
        return args != null && args.path("name").isTextual() && !args.path("name").asText().isBlank()
                ? null : "请填写项目名称 name";
    }

    @Override public ObjectNode parameters(ObjectMapper mapper) {
        var schema = objectParameters(mapper);
        var props = schema.putObject("properties");
        projectFields(props);
        basis(props);
        schema.putArray("required").add("name").add("basis");
        return schema;
    }
}
