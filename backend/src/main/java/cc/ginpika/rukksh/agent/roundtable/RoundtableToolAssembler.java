package cc.ginpika.rukksh.agent.roundtable;

import cc.ginpika.rukksh.agent.chat.ChatStream;
import cc.ginpika.rukksh.agent.chat.ChatTurnRunner;
import cc.ginpika.rukksh.agent.member.AgentAnchorService;
import cc.ginpika.rukksh.agent.member.AgentDirectory;
import cc.ginpika.rukksh.agent.member.AgentStore.AgentRow;
import cc.ginpika.rukksh.ai.computer.terminal.TerminalService;
import cc.ginpika.rukksh.ai.core.UserScope;
import cc.ginpika.rukksh.ai.core.tool.ToolDomain;
import cc.ginpika.rukksh.ai.core.tool.ToolRegistry;
import cc.ginpika.rukksh.ai.core.tool.ToolSurface;
import cc.ginpika.rukksh.ai.core.tool.agentmessage.ListAgentsTool;
import cc.ginpika.rukksh.ai.core.tool.agentmessage.ReadAgentMessageTool;
import cc.ginpika.rukksh.ai.core.tool.agentmessage.SendAgentMessageTool;
import cc.ginpika.rukksh.ai.core.tool.graph.ReadMyAnchorTool;
import cc.ginpika.rukksh.ai.core.tool.multiagent.AddTodoTool;
import cc.ginpika.rukksh.ai.core.tool.multiagent.AskUserTool;
import cc.ginpika.rukksh.ai.core.tool.multiagent.CompleteTodoTool;
import cc.ginpika.rukksh.ai.core.tool.multiagent.ControlCollaborationTool;
import cc.ginpika.rukksh.ai.core.tool.multiagent.GoSilentTool;
import cc.ginpika.rukksh.ai.core.tool.multiagent.InterjectTool;
import cc.ginpika.rukksh.ai.core.tool.multiagent.ManagePlanTool;
import cc.ginpika.rukksh.ai.core.tool.multiagent.ProposeEndTool;
import cc.ginpika.rukksh.ai.core.tool.multiagent.RequestDiscussionTool;
import cc.ginpika.rukksh.ai.core.tool.multiagent.ResolveIssueTool;
import cc.ginpika.rukksh.ai.core.tool.multiagent.ReviewTodoTool;
import cc.ginpika.rukksh.ai.core.tool.multiagent.SpeakTool;
import cc.ginpika.rukksh.ai.core.tool.multiagent.StartWorkTool;
import cc.ginpika.rukksh.ai.core.tool.multiagent.UpdateTodoTool;
import cc.ginpika.rukksh.ai.core.tool.plan.WriteTodosTool;
import cc.ginpika.rukksh.ai.core.tool.subagent.DelegateSubagentTool;
import cc.ginpika.rukksh.ai.core.tool.subagent.ReadSubagentRunTool;
import cc.ginpika.rukksh.ai.core.tool.terminal.ListTerminalsTool;
import cc.ginpika.rukksh.ai.core.tool.terminal.RunCommandTool;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * 圆桌每次发言/执行的工具面装配与入口路由：按当前 turn 的模式（讨论 / 私聊 / 问答 / 执行）裁剪可用工具，
 * 并在执行时强制校验权限边界，避免幻觉越权调用或绕过版本检查。
 */
@Component
public class RoundtableToolAssembler {

    private static final List<String> STATE_TOOLS = List.of(
            ProposeEndTool.NAME, GoSilentTool.NAME, InterjectTool.NAME, AskUserTool.NAME);
    private static final List<String> SPEAK_TOOLS = List.of(SpeakTool.NAME);
    private static final List<String> WORK_TOOLS = List.of(
            AddTodoTool.NAME, UpdateTodoTool.NAME, CompleteTodoTool.NAME,
            StartWorkTool.NAME, RequestDiscussionTool.NAME,
            ReviewTodoTool.NAME, ResolveIssueTool.NAME, ManagePlanTool.NAME,
            "read_project_knowledge", "write_project_knowledge");
    private static final List<String> SUBAGENT_TOOLS =
            List.of(DelegateSubagentTool.NAME, ReadSubagentRunTool.NAME);
    private static final List<String> TERMINAL_TOOLS =
            List.of(RunCommandTool.NAME, ListTerminalsTool.NAME);

    private final ObjectMapper om;
    private final ToolRegistry tools;
    private final TerminalService terminal;
    private final AgentDirectory directory;
    private final AgentAnchorService peerAnchors;
    private final TopicStateMachine machine;
    private final RoundtableProgress progress;
    private final RoundtableRevision revisions;
    private final CollaborationPlan plans;
    private final CollaborationWorkspaceBinding workspaceBinding;
    private final RoundtableTaskTools taskTools;

    public RoundtableToolAssembler(ObjectMapper om, ToolRegistry tools, TerminalService terminal,
                                   AgentDirectory directory, AgentAnchorService peerAnchors,
                                   TopicStateMachine machine, RoundtableProgress progress,
                                   RoundtableRevision revisions, CollaborationPlan plans,
                                   CollaborationWorkspaceBinding workspaceBinding, RoundtableTaskTools taskTools) {
        this.om = om;
        this.tools = tools;
        this.terminal = terminal;
        this.directory = directory;
        this.peerAnchors = peerAnchors;
        this.machine = machine;
        this.progress = progress;
        this.revisions = revisions;
        this.plans = plans;
        this.workspaceBinding = workspaceBinding;
        this.taskTools = taskTools;
    }

    ArrayNode toolSchemas(RoundtableTurnExecution turn) {
        ArrayNode out = om.createArrayNode();
        boolean core = AgentDirectory.isBuiltin(turn.peerId());
        boolean answeringUser = turn.isConversation();
        var plan = plans.find(turn.sessionId()).orElse(null);
        boolean canSendAgentMessage = !answeringUser && plan == null;
        Set<String> seen = new HashSet<>();
        ArrayNode chatTools = tools.agentToolsOf(ToolSurface.CHAT);
        if (core && !canSendAgentMessage) {
            for (int i = 0; i < chatTools.size(); i++) {
                if (SendAgentMessageTool.NAME.equals(chatTools.get(i).path("function").path("name").asText())) {
                    chatTools.remove(i);
                    break;
                }
            }
        }
        append(out, seen, chatTools);
        String user = UserScope.get();
        if (turn.solo() && turn.soloUserInput() != null && user != null && !user.isBlank()) {
            append(out, seen, tools.toolsOfDomains(Set.of(ToolDomain.WORK), ToolSurface.CHAT));
        }
        append(out, seen, tools.grantedToolsOf(canSendAgentMessage
                ? List.of(ListAgentsTool.NAME, ReadAgentMessageTool.NAME, SendAgentMessageTool.NAME)
                : List.of(ListAgentsTool.NAME, ReadAgentMessageTool.NAME), ToolSurface.CHAT));
        append(out, seen, tools.toolsOf(List.of("read_project_knowledge"), ToolSurface.PEER));
        if (answeringUser) {
            append(out, seen, tools.grantedToolsOf(List.of(ReadMyAnchorTool.NAME), ToolSurface.CHAT));
            if (plan != null) {
                append(out, seen, tools.grantedToolsOf(List.of(ControlCollaborationTool.NAME), ToolSurface.PEER));
            }
            return out;
        }
        boolean discussing = !turn.solo() && turn.workTodo() == null;
        if (discussing) {
            append(out, seen, tools.toolsOf(SPEAK_TOOLS, ToolSurface.PEER));
            append(out, seen, tools.toolsOf(STATE_TOOLS, ToolSurface.PEER));
        }
        if (turn.workTodo() != null && plan == null) {
            append(out, seen, tools.grantedToolsOf(List.of(WriteTodosTool.NAME), ToolSurface.CHAT));
        }
        if (plan != null) {
            append(out, seen, tools.grantedToolsOf(List.of("coding_task"), ToolSurface.CHAT));
        }
        if (!turn.solo() || turn.workTodo() != null) {
            append(out, seen, tools.toolsOf(WORK_TOOLS, ToolSurface.PEER));
            append(out, seen, tools.grantedToolsOf(SUBAGENT_TOOLS, ToolSurface.CHAT));
        }
        AgentRow peer = speakingPeer(turn);
        append(out, seen, tools.grantedToolsOf(List.of(ReadMyAnchorTool.NAME), ToolSurface.CHAT));
        if (core || !directory.declaredTerminals(peer).isEmpty()) {
            append(out, seen, tools.grantedToolsOf(TERMINAL_TOOLS, ToolSurface.CHAT));
        }
        if (plan != null) {
            var todo = turn.workTodo();
            Set<String> allowed = todo != null ? ("checking".equals(todo.status())
                    ? Set.of("review_todo") : Set.of("complete_todo", "update_todo", "request_discussion"))
                    : plan.coordinatorId().equals(turn.peerId())
                    ? Set.of("manage_plan", "add_todo", "update_todo", "start_work", "request_discussion")
                    : Set.of("request_discussion");
            ArrayNode filtered = om.createArrayNode();
            for (JsonNode tool : out) {
                String name = tool.path("function").path("name").asText();
                if (!core && TERMINAL_TOOLS.contains(name) && directory.declaredTerminals(peer).isEmpty()) {
                    continue;
                }
                if (!WORK_TOOLS.contains(name) || allowed.contains(name) || "read_project_knowledge".equals(name)
                        || ("write_project_knowledge".equals(name) && todo == null && plans.coordinator(turn.sessionId(), turn.peerId()))) {
                    filtered.add(tool);
                }
            }
            return filtered;
        }
        return out;
    }

    Set<String> allowedToolNames(RoundtableTurnExecution turn) {
        Set<String> names = new HashSet<>();
        if (turn.peerId() == null) {
            return names;
        }
        for (JsonNode node : toolSchemas(turn)) {
            String name = node.path("function").path("name").asText("");
            if (!name.isEmpty()) {
                names.add(name);
            }
        }
        return names;
    }

    String runTool(RoundtableTurnExecution turn, ChatTurnRunner runner, JsonNode call, String batchRunId, String hubId) {
        checkCurrentTurn(turn);
        String name = call.path("function").path("name").asText("");
        if (!allowedToolNames(turn).contains(name)) {
            if (turn.isConversation()) {
                return "本条是普通问答，不改变当前工作；该操作未执行。需要调整工作请使用明确的任务调整入口。";
            }
            if (SendAgentMessageTool.NAME.equals(name)) {
                return "当前协作项目通过共享任务板派工。请在任务板上指派成员。";
            }
            if (TERMINAL_TOOLS.contains(name)) {
                return "你没有可用的工作空间授权；请用户在成员能力页绑定工作空间后重试。";
            }
            if (SUBAGENT_TOOLS.contains(name) && plans.find(turn.sessionId()).isPresent()) {
                return "协作项目的修改与执行统一通过当前派工的 coding_task 副本；此操作未执行，不能绕过独立检查后的应用。";
            }
            return "「" + name + "」不在本次发言可用的工具范围内，未执行。"
                    + "若确需，请说明理由，由用户授权后再执行。";
        }
        if (ControlCollaborationTool.NAME.equals(name)) {
            return handleControlTool(turn, call);
        }
        if (SpeakTool.NAME.equals(name)) {
            return speakTool(turn.speechSink(), call);
        }
        if (STATE_TOOLS.contains(name)) {
            return stateTool(turn, runner, name, call);
        }
        if (WORK_TOOLS.contains(name)) {
            return taskTools.runTool(name, call, turn.sessionId(), turn.peerId(), turn.topicId(), turn.workTodo());
        }
        if (ReadMyAnchorTool.NAME.equals(name)) {
            return readMyAnchorTool(turn);
        }
        if (TerminalService.handles(name)) {
            return terminalTool(turn, call);
        }
        String result = turn.solo() && turn.soloUserInput() != null
                && tools.find(name).filter(tool -> tool.domain() == ToolDomain.WORK).isPresent()
                ? runner.runDirectWorkTool(call, turn.soloUserInput())
                : runner.runTool(call, batchRunId, hubId);
        checkCurrentTurn(turn);
        if (turn.workTodo() != null && "coding_task".equals(name)) {
            try {
                JsonNode diagnostic = om.readTree(result);
                if (diagnostic != null && Set.of("NEEDS_DIAGNOSIS", "APPLICATION_CONFLICT")
                        .contains(diagnostic.path("code").asText())) {
                    taskTools.diagnose(turn.sessionId(), turn.peerId(), turn.workTodo(),
                            diagnostic.path("code").asText(), diagnostic.path("reason").asText(),
                            diagnostic.path("runId").asText(), diagnostic.path("artifactHash").asText());
                    throw new ChatStream.ChatCancelledException();
                }
            } catch (JsonProcessingException ignored) {
                /* Legacy tool errors can be plain text. */
            }
        }
        return result;
    }

    String speakTool(RoundtableSpeechCollector out, JsonNode call) {
        String text = readTree(call.path("function").path("arguments").asText(""))
                .path("text").asText("").strip();
        if (text.isEmpty()) {
            return "text 是空的，这句话没说出去。";
        }
        if (out == null) {
            return "此刻不在圆桌发言中，说不出口。";
        }
        out.say(text);
        return "已经说出口了，桌上的人都听到了。可以接着说，也可以先查资料、想清楚再开口。";
    }

    String stateTool(RoundtableTurnExecution turn, ChatTurnRunner runner, String name, JsonNode call) {
        String topicId = turn.topicId();
        String peerId = turn.peerId();
        if (topicId == null || peerId == null) {
            return "此刻没有进行中的话题，这个动作没有落点。";
        }
        String reason = readTree(call.path("function").path("arguments").asText(""))
                .path("reason").asText("").trim();
        return switch (name) {
            case ProposeEndTool.NAME -> {
                machine.proposeEnd(topicId, peerId, reason);
                yield "已记下你的结束提议。若有人重新发言，你会被重新叫到，可以改主意。";
            }
            case GoSilentTool.NAME -> {
                machine.silent(topicId, peerId, reason);
                yield "已转入沉默：这一轮不再安排你发言。想再开口时直接说即可。";
            }
            case InterjectTool.NAME -> {
                machine.interject(topicId, peerId, reason);
                yield "已记下你的发言请求（抢答）：接下来会优先把话头交给你。";
            }
            case AskUserTool.NAME -> {
                progress.pause(turn.sessionId(), reason == null ? "等待用户决定" : reason);
                runner.requestStopOthers(turn.sessionId());
                machine.askUser(topicId, peerId, reason);
                yield "已请用户表态：全桌就此暂停，等用户发言后再继续（这一轮不必再补充说明）。";
            }
            default -> "未知工具: " + name;
        };
    }

    private String handleControlTool(RoundtableTurnExecution turn, JsonNode call) {
        var args = readTree(call.path("function").path("arguments").asText(""));
        String error = new ControlCollaborationTool().validate(args);
        if (error != null) {
            return error;
        }
        String input = turn.conversationInput();
        String basis = args.path("basis").asText();
        if (input == null || !input.contains(basis)
                || directory.peers(turn.sessionId()).stream().noneMatch(p -> p.id().equals(turn.peerId()))) {
            return "控制请求必须来自当前会话成员对本条用户指令的理解，未提交。";
        }
        var control = new RoundtableChatService.WorkControl(args.path("action").asText(), basis);
        if (turn.conversationControl() != null && !turn.conversationControl().equals(control)) {
            return "本条消息已有控制请求，请勿提交冲突请求。";
        }
        turn.recordConversationControl(control);
        return "控制请求已记录，答复结束并通过状态校验后由运行时处理；尚未执行。";
    }

    private void checkCurrentTurn(RoundtableTurnExecution turn) {
        if (turn.sessionId() != null && ((!turn.isConversation() && !progress.allowed(turn.sessionId()))
                || !Objects.equals(turn.baseRevision(), revisions.current(turn.sessionId())))) {
            throw new ChatStream.ChatCancelledException();
        }
    }

    private AgentRow speakingPeer(RoundtableTurnExecution turn) {
        return turn.peerId() == null ? null : directory.peer(turn.peerId()).orElse(null);
    }

    private String readMyAnchorTool(RoundtableTurnExecution turn) {
        return turn.peerId() == null
                ? "（此刻不在成员发言中，读不到人格锚点）"
                : peerAnchors.text(turn.peerId());
    }

    private String terminalTool(RoundtableTurnExecution turn, JsonNode call) {
        if (AgentDirectory.isBuiltin(turn.peerId())) {
            return workspaceBinding.terminal(call, turn.sessionId(), null, terminal);
        }
        List<String> bound = directory.declaredTerminals(speakingPeer(turn));
        if (bound.isEmpty()) {
            return "你没有可用的工作空间（未绑定），无法执行命令。";
        }
        return workspaceBinding.terminal(call, turn.sessionId(), new LinkedHashSet<>(bound), terminal);
    }

    private static void append(ArrayNode out, Set<String> seen, ArrayNode more) {
        for (JsonNode node : more) {
            String name = node.path("function").path("name").asText("");
            if (name.isEmpty() || seen.add(name)) {
                out.add(node);
            }
        }
    }

    private JsonNode readTree(String json) {
        try {
            return om.readTree(json == null || json.isBlank() ? "{}" : json);
        } catch (Exception e) {
            return om.createObjectNode();
        }
    }
}
