package cc.ginpika.minis.ai.core.tool.work;

import cc.ginpika.minis.ai.core.tool.AiTool;
import cc.ginpika.minis.ai.core.tool.ToolRisk;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

@Component
public class ManageWorkCollaborationTool extends WorkProjectTool {
    public static final String NAME = "manage_work_collaboration";

    @Override public String name() { return NAME; }
    @Override public ToolRisk risk() { return ToolRisk.WRITE; }

    @Override public String description() {
        return "按当前用户明确要求维护项目协作记录。create_task 新建协作会话，archive_task / restore_task 归档或恢复，"
                + "create_issue 发起议题，resolve_issue 保存结论。先用 read_work_project 核对归属和 ID。"
                + "这些操作不启动会话执行，协作任务板仍由会话自己的角色和审核流程管理。";
    }

    @Override public ObjectNode parameters(ObjectMapper mapper) {
        var schema = objectParameters(mapper);
        var props = schema.putObject("properties");
        props.putObject("action").put("type", "string").putArray("enum").add("create_task")
                .add("archive_task").add("restore_task").add("create_issue").add("resolve_issue");
        text(props, "project_id", "全局项目 ID");
        text(props, "session_id", "归档、恢复或发起议题时的主任务会话 ID");
        text(props, "issue_id", "resolve_issue 的议题 ID，由 board 返回");
        text(props, "title", "新建协作任务或议题的标题");
        text(props, "coordinator_id", "create_task 可选，指定参与成员中的主控 Agent");
        AiTool.putStringArraySchema(props, "member_ids", "新建协作任务或议题的参与 Agent ID 列表。新建任务至少两位");
        text(props, "conclusion", "resolve_issue 的结论正文");
        basis(props);
        schema.putArray("required").add("action").add("project_id").add("basis");
        return schema;
    }
}
