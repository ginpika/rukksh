package cc.ginpika.rukksh.agent.roundtable;

import cc.ginpika.rukksh.agent.chat.ChatExecution;
import cc.ginpika.rukksh.agent.chat.ChatTurnRunner;
import cc.ginpika.rukksh.agent.chat.store.ChatMessageStore;
import cc.ginpika.rukksh.agent.chat.store.HubSessionStore.HubRow;
import cc.ginpika.rukksh.agent.roundtable.store.RoundtableTodoStore;
import cc.ginpika.rukksh.config.ModelTarget;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/**
 * 每次圆桌发言/私聊/工作执行对应的单轮执行上下文（{@link ChatExecution}）：
 * 将原先分散在单例服务上的 14 个 {@link ThreadLocal} 收敛为本次 Turn 的私有实例状态，确保并发隔离且无需手动清理。
 */
final class RoundtableTurnExecution implements ChatExecution {

    private final RoundtableChatService chat;
    private final RoundtableSessionService sessions;
    private final RoundtableToolAssembler toolAssembler;
    private final ChatTurnRunner runner;

    private final String sessionId;
    private final String peerId;
    private final String topicId;
    private final RoundtableTodoStore.TodoRow workTodo;
    private final Long workRunId;
    private final boolean solo;
    private final String soloUserInput;
    private final String conversationInput;
    private final int baseRevision;
    private final RoundtableSpeechCollector speechSink;

    private long replyId = -1L;
    private boolean stale;
    private String requestContext;
    private RoundtableChatService.WorkControl conversationControl;

    private RoundtableTurnExecution(RoundtableChatService chat, RoundtableSessionService sessions,
                                    RoundtableToolAssembler toolAssembler, ChatTurnRunner runner,
                                    String sessionId, String peerId, String topicId,
                                    RoundtableTodoStore.TodoRow workTodo, Long workRunId,
                                    boolean solo, String soloUserInput, String conversationInput,
                                    int baseRevision, RoundtableSpeechCollector speechSink) {
        this.chat = chat;
        this.sessions = sessions;
        this.toolAssembler = toolAssembler;
        this.runner = runner;
        this.sessionId = sessionId;
        this.peerId = peerId;
        this.topicId = topicId;
        this.workTodo = workTodo;
        this.workRunId = workRunId;
        this.solo = solo;
        this.soloUserInput = soloUserInput;
        this.conversationInput = conversationInput;
        this.baseRevision = baseRevision;
        this.speechSink = speechSink;
    }

    static RoundtableTurnExecution discussion(RoundtableChatService chat, RoundtableSessionService sessions,
                                            RoundtableToolAssembler toolAssembler, ChatTurnRunner runner,
                                            String sessionId, String topicId, String peerId,
                                            String conversationInput, int baseRevision,
                                            RoundtableSpeechCollector speechSink) {
        return new RoundtableTurnExecution(chat, sessions, toolAssembler, runner,
                sessionId, peerId, topicId, null, null, false, null, conversationInput, baseRevision, speechSink);
    }

    static RoundtableTurnExecution solo(RoundtableChatService chat, RoundtableSessionService sessions,
                                      RoundtableToolAssembler toolAssembler, ChatTurnRunner runner,
                                      String sessionId, String peerId, String soloUserInput, int baseRevision) {
        return new RoundtableTurnExecution(chat, sessions, toolAssembler, runner,
                sessionId, peerId, null, null, null, true, soloUserInput, null, baseRevision, null);
    }

    static RoundtableTurnExecution work(RoundtableChatService chat, RoundtableSessionService sessions,
                                      RoundtableToolAssembler toolAssembler, ChatTurnRunner runner,
                                      String sessionId, String peerId, RoundtableTodoStore.TodoRow workTodo,
                                      Long workRunId, int baseRevision) {
        return new RoundtableTurnExecution(chat, sessions, toolAssembler, runner,
                sessionId, peerId, null, workTodo, workRunId, false, null, null, baseRevision, null);
    }

    String sessionId() { return sessionId; }
    String peerId() { return peerId; }
    String topicId() { return topicId; }
    RoundtableTodoStore.TodoRow workTodo() { return workTodo; }
    Long workRunId() { return workRunId; }
    boolean solo() { return solo; }
    String soloUserInput() { return soloUserInput; }
    String conversationInput() { return conversationInput; }
    boolean isConversation() { return conversationInput != null; }
    int baseRevision() { return baseRevision; }
    RoundtableSpeechCollector speechSink() { return speechSink; }

    long replyId() { return replyId; }
    void recordReplyId(long id) { this.replyId = id; }
    boolean stale() { return stale; }
    void markStale() { this.stale = true; }
    String requestContext() { return requestContext; }
    void recordRequestContext(String ctx) { this.requestContext = ctx; }
    RoundtableChatService.WorkControl conversationControl() { return conversationControl; }
    void recordConversationControl(RoundtableChatService.WorkControl control) { this.conversationControl = control; }

    @Override
    public HubRow resolveOrCreate(String hubId) {
        return sessions.resolveOrCreate(hubId);
    }

    @Override
    public HubRow insertNew() {
        return sessions.insertNew();
    }

    @Override
    public List<ChatMessageStore.MessageRow> history(HubRow row) {
        return chat.history(row, solo);
    }

    @Override
    public long recordUserInput(HubRow row, String input) {
        return chat.recordUserInput(row, input, solo);
    }

    @Override
    public long recordReply(HubRow row, String content, String reasoning, String trace, String rounds) {
        return chat.recordReply(this, row, content, reasoning, trace, rounds);
    }

    @Override
    public void touchSession(HubRow row, String title) {
        sessions.touch(row.id(), conversationInput == null ? title : null);
    }

    @Override
    public void rememberConfig(HubRow row, String modelId, String promptId) {
        sessions.updateModel(row.id(), modelId);
    }

    @Override
    public ObjectNode requestBody(HubRow row, ModelTarget target, String promptId, int contextWindow) {
        return chat.requestBody(this, row, target, contextWindow);
    }

    @Override
    public boolean parallelToolCalls() {
        return false;
    }

    @Override
    public String runTool(JsonNode call, String batchRunId, String hubId) {
        return toolAssembler.runTool(this, runner, call, batchRunId, hubId);
    }

    @Override
    public String toolSource() {
        return "multiagent";
    }

    @Override
    public boolean taskTracked() {
        return true;
    }

    @Override
    public boolean turnTracked() {
        return false;
    }

    @Override
    public boolean singleFlight() {
        return false;
    }

    @Override
    public boolean settleTodosOnFinish() {
        return conversationInput == null;
    }

    @Override
    public boolean keepPartialReplyOnCancel() {
        return workTodo == null;
    }

    @Override
    public String replyOnCancel(String partialContent) {
        return workTodo == null && speechSink != null && !speechSink.speech().isBlank()
                ? speechSink.speech() : partialContent;
    }
}
