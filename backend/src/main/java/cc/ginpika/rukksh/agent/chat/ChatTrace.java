package cc.ginpika.rukksh.agent.chat;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 会话 trace 协议常量：思考/工具分段类型与多段思考的拼接分隔线。
 *
 * <p>分段（trace）随 assistant 消息落库、由前端分阶段折叠回放；同一套常量也被
 * 子代理（AgentRunner / SubagentService）用于拼装自己的思维链与 trace。
 */
public final class ChatTrace {

    /** 分段类型：普通思考 */
    public static final String SEG_REASONING = "reasoning";
    /** 分段类型：工具调用 */
    public static final String SEG_TOOL = "tool";
    /** Place a durable interjection between completed tool exchanges when replaying the turn. */
    public static final String INTERJECTION_MARKER = "_rukksh_interjection";
    /** 多段思考拼成 reasoning 纯文本列时的分隔线（Markdown 水平线）；分段展示走 trace */
    public static final String REASONING_SEPARATOR = "\n\n---\n\n";

    public static boolean isInterjection(JsonNode round) {
        return round.path(INTERJECTION_MARKER).asBoolean() || round.path("_minis_interjection").asBoolean();
    }

    private ChatTrace() {
    }
}
