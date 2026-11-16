package cc.ginpika.minis.ai.core.tool.work;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

@Component
public class SaveWorkProjectDocumentTool extends WorkProjectTool {
    public static final String NAME = "save_work_project_document";
    @Override public String name() { return NAME; }
    @Override public boolean writes() { return true; }
    @Override public String description() {
        return "按当前用户的明确要求新建、修订、退役或恢复项目共享文档，每次保存新增版本。"
                + "新建 expected_version=0 且须提供 kind、title、content；修订前读最新版，按版本更新所需字段，保留其余字段。";
    }

    @Override public String validate(JsonNode args) {
        if (args == null || !args.path("project_id").isTextual() || args.path("project_id").asText().isBlank())
            return "请填写项目 ID project_id";
        if (!args.path("key").isTextual() || !args.path("key").asText().matches("[A-Za-z0-9._-]{1,120}"))
            return "请提供合法的项目文档 key";
        var version = args.path("expected_version");
        if (!version.isIntegralNumber() || !version.canConvertToInt() || version.intValue() < 0)
            return "请提供非负整数 expected_version";
        if (version.intValue() == 0 && !(args.hasNonNull("kind") && args.hasNonNull("title") && args.hasNonNull("content")))
            return "新建文档须提供 kind、title、content";
        if (version.intValue() > 0 && !(args.hasNonNull("kind") || args.hasNonNull("title")
                || args.hasNonNull("content") || args.hasNonNull("retired"))) return "请提供要修改的字段";
        return null;
    }

    @Override public ObjectNode parameters(ObjectMapper mapper) {
        var schema = objectParameters(mapper);
        var props = schema.putObject("properties");
        text(props, "project_id", "由 list_work_projects 返回的项目 ID");
        props.putObject("key").put("type", "string").put("pattern", "^[A-Za-z0-9._-]{1,120}$");
        props.putObject("kind").put("type", "string").putArray("enum").add("overview").add("decision").add("reference").add("delivery");
        props.putObject("title").put("type", "string").put("maxLength", 160);
        props.putObject("content").put("type", "string").put("maxLength", 40000).put("description", "Markdown 正文；传入时替换正文");
        props.putObject("expected_version").put("type", "integer").put("minimum", 0);
        props.putObject("retired").put("type", "boolean").put("description", "true 退役，false 恢复；历史仍可读");
        basis(props);
        schema.putArray("required").add("project_id").add("key").add("expected_version").add("basis");
        return schema;
    }
}
