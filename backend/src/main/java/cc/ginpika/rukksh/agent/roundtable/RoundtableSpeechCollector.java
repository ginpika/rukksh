package cc.ginpika.rukksh.agent.roundtable;

import cc.ginpika.rukksh.agent.chat.ChatStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 一次圆桌发言的流式出口与分段账本：按出现顺序收集 {@code speak} 工具发言与正文信封兜底文本，
 * 并在整轮结束或换轮时收拢每轮正文及下一轮发言欲望（{@code desire}）。
 */
final class RoundtableSpeechCollector implements ChatStream {

    private final ChatStream down;
    private SpeechEnvelope cur = new SpeechEnvelope();
    private final List<String> utterances = new ArrayList<>();
    private Integer lastDesire;

    RoundtableSpeechCollector(ChatStream down) {
        this.down = down;
    }

    @Override
    public void meta(String sessionId, long messageId) {
        down.meta(sessionId, messageId);
    }

    @Override
    public void round(int round) {
        flush();
        down.round(round);
    }

    @Override
    public void delta(String reasoning, String content) {
        if (reasoning != null) {
            down.delta(reasoning, null);
        }
        if (content == null) {
            return;
        }
        String text = cur.append(content);
        if (!text.isEmpty()) {
            down.delta(null, text);
        }
    }

    @Override
    public void tool(String name, String args) {
        down.tool(name, args);
    }

    /** {@code speak} 工具说了一段：先收敛此前正文，再按发生顺序记入分段账本（生成期只入账、不立即推送）。 */
    void say(String text) {
        flush();
        utterances.add(text);
    }

    /** 本次发言收集到的全部分段（把最后一轮尚未收敛的正文一并收下）。 */
    List<String> utterances() {
        flush();
        return List.copyOf(utterances);
    }

    /** 本次发言拼合后的完整正文（段落之间空一行）。 */
    String speech() {
        return String.join("\n\n", utterances());
    }

    /** 本次发言收尾信封里附带的下一轮发言欲望（0~10；未提供则为 null）。 */
    Integer desire() {
        flush();
        return lastDesire;
    }

    private void flush() {
        String text = current();
        if (!text.isBlank()) {
            utterances.add(text);
        }
        Integer desire = cur.desire();
        if (desire != null) {
            lastDesire = desire;
        }
        cur = new SpeechEnvelope();
    }

    private String current() {
        return cur.seen() ? cur.speech() : cur.fallback();
    }
}
