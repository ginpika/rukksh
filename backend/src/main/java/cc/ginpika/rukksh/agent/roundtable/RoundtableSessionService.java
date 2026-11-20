package cc.ginpika.rukksh.agent.roundtable;

import cc.ginpika.rukksh.agent.chat.ProjectWorkflowService;
import cc.ginpika.rukksh.agent.chat.dto.ChatDtos;
import cc.ginpika.rukksh.agent.chat.store.ChatMessageStore;
import cc.ginpika.rukksh.agent.chat.store.HubSessionStore.HubRow;
import cc.ginpika.rukksh.agent.member.AgentDirectory;
import cc.ginpika.rukksh.agent.member.AgentDtos;
import cc.ginpika.rukksh.agent.member.AgentStore.AgentRow;
import cc.ginpika.rukksh.agent.roundtable.store.RoundtableMessageStore;
import cc.ginpika.rukksh.agent.roundtable.store.RoundtableSessionStore;
import cc.ginpika.rukksh.agent.roundtable.store.RoundtableTopicEventStore;
import cc.ginpika.rukksh.agent.roundtable.store.RoundtableTopicStore;
import cc.ginpika.rukksh.agent.roundtable.store.RoundtableTopicStore.TopicRow;
import cc.ginpika.rukksh.shared.error.DomainException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 圆桌会话管理、状态校验、消息查询与 {@link HubRow} 视图适配服务。
 */
@Service
public class RoundtableSessionService {

    /** 会话模式标记（{@link HubRow#mode()}）：标明为多智能体圆桌会话 */
    public static final String MODE = "multi-agent";

    private final RoundtableSessionStore sessions;
    private final RoundtableMessageStore messages;
    private final RoundtableTopicStore topics;
    private final RoundtableTopicEventStore topicEvents;
    private final AgentDirectory directory;
    private final ProjectWorkflowService projectWorkflows;
    private final ObjectMapper om;

    public RoundtableSessionService(RoundtableSessionStore sessions,
                                    RoundtableMessageStore messages,
                                    RoundtableTopicStore topics,
                                    RoundtableTopicEventStore topicEvents,
                                    AgentDirectory directory,
                                    ProjectWorkflowService projectWorkflows,
                                    ObjectMapper om) {
        this.sessions = sessions;
        this.messages = messages;
        this.topics = topics;
        this.topicEvents = topicEvents;
        this.directory = directory;
        this.projectWorkflows = projectWorkflows;
        this.om = om;
    }

    public List<AgentDtos.SessionView> sessions() {
        return sessions.listAll().stream().map(this::toSessionView).toList();
    }

    /** 新建会话：memberIds 为勾选成员（null / 空表示全体名册） */
    public AgentDtos.NewSession createSession(List<String> memberIds) {
        return new AgentDtos.NewSession(sessions.insert(directory.membersJson(memberIds)));
    }

    /** 项目绑定与会话创建在同一事务中完成，无效项目不会留下空会话。 */
    @Transactional
    public AgentDtos.NewSession createSession(List<String> memberIds, String projectId) {
        String id = sessions.insert(directory.membersJson(memberIds));
        if (projectId != null && !projectId.isBlank()) {
            projectWorkflows.bind(id, projectId);
        }
        return new AgentDtos.NewSession(id);
    }

    public AgentDtos.SessionView session(String sessionId) {
        return sessions.findById(sessionId).map(this::toSessionView)
                .orElseThrow(() -> new DomainException(DomainException.ErrorKind.NOT_FOUND,
                        "多智能体会话不存在: " + sessionId));
    }

    /** 删除会话：连同它的消息、话题与状态机事件一并清掉（不存在的会话返回 404） */
    @Transactional
    public void deleteSession(String sessionId) {
        sessions.findById(sessionId)
                .orElseThrow(() -> new DomainException(DomainException.ErrorKind.NOT_FOUND,
                        "多智能体会话不存在: " + sessionId));
        if (sessions.hasIssueRelations(sessionId)) {
            throw new DomainException(DomainException.ErrorKind.CONFLICT,
                    "这项任务包含议题记录，请保留任务与议题的完整关联");
        }
        messages.deleteBySession(sessionId);
        /* 顺序不能反：roundtable_topic_event.topic_id 的外键指着 roundtable_topic */
        topicEvents.deleteBySession(sessionId);
        topics.deleteBySession(sessionId);
        sessions.delete(sessionId);
    }

    public void requireDiscussable(String sessionId) {
        session(sessionId);
        sessions.requireWritable(sessionId);
        if (sessions.isResolvedIssue(sessionId)) {
            throw new DomainException(DomainException.ErrorKind.CONFLICT,
                    "议题已形成结论，请回到主任务继续，或发起新的议题");
        }
    }

    /** 会话的全部消息（按时间序混排；带 topicId 时仅看该话题） */
    public List<AgentDtos.MessageView> messages(String sessionId, String topicId) {
        List<RoundtableMessageStore.MessageRow> rows = topicId == null || topicId.isBlank()
                ? messages.bySession(sessionId) : messages.byTopic(topicId);
        List<AgentDtos.MessageView> out = new ArrayList<>();
        for (RoundtableMessageStore.MessageRow m : rows) {
            out.add(new AgentDtos.MessageView(m.id(), m.sessionId(), m.topicId(), m.role(),
                    m.peerId(), m.peerName(), m.content(), m.reasoning(), traceOf(m.trace()),
                    iso(m.createdAt()), m.eventKind()));
        }
        return out;
    }

    /** 某条成员发言当时实际发出的原始请求上下文（人的话无此数据，返回空） */
    public Optional<String> contextOf(long messageId) {
        return messages.message(messageId)
                .map(RoundtableMessageStore.MessageRow::context)
                .filter(text -> text != null && !text.isBlank());
    }

    HubRow resolveOrCreate(String hubId) {
        if (hubId == null || hubId.isBlank()) {
            return sessions.latest().map(RoundtableSessionService::asHubRow).orElseGet(this::insertNew);
        }
        return sessions.findById(hubId).map(RoundtableSessionService::asHubRow)
                .orElseThrow(() -> new DomainException(DomainException.ErrorKind.NOT_FOUND,
                        "多智能体会话不存在: " + hubId));
    }

    HubRow insertNew() {
        String id = sessions.insert(null);
        return sessions.findById(id).map(RoundtableSessionService::asHubRow)
                .orElseThrow(() -> new IllegalStateException("圆桌会话落库失败: " + id));
    }

    String resolvePeerModel(String sessionId, AgentRow peer) {
        return peer.modelId() != null ? peer.modelId()
                : sessions.findById(sessionId).map(RoundtableSessionStore.SessionRow::modelId).orElse(null);
    }

    void touch(String sessionId, String title) {
        sessions.touch(sessionId, title);
    }

    void updateModel(String sessionId, String modelId) {
        sessions.updateModel(sessionId, modelId);
    }

    private AgentDtos.SessionView toSessionView(RoundtableSessionStore.SessionRow row) {
        TopicRow topic = topics.openBySession(row.id()).orElse(null);
        List<String> memberIds = directory.peers(row.id()).stream().map(AgentRow::id).toList();
        return new AgentDtos.SessionView(row.id(), row.title(), row.modelId(),
                topic == null ? null : topic.id(),
                topic == null ? RoundtableTopicStore.STATUS_CLOSED : topic.status(),
                topic == null ? null : topic.floorPeer(), memberIds,
                row.createdAt() == null ? 0L : row.createdAt(), row.updatedAt(), row.projectId());
    }

    static HubRow asHubRow(RoundtableSessionStore.SessionRow row) {
        return new HubRow(row.id(), row.title(), MODE, row.modelId(), null, null, row.projectId(),
                true, true, 0, false, false, row.createdAt(), row.updatedAt());
    }

    static ChatMessageStore.MessageRow asChatRow(RoundtableMessageStore.MessageRow m) {
        return new ChatMessageStore.MessageRow(m.id(), m.sessionId(),
                RoundtableMessageStore.ROLE_USER.equals(m.role()) ? "user" : "assistant",
                m.content(), m.reasoning(), m.trace(), m.toolRounds(), null, null, m.createdAt());
    }

    private List<ChatDtos.TraceSegment> traceOf(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return om.readValue(json, new TypeReference<List<ChatDtos.TraceSegment>>() {
            });
        } catch (Exception e) {
            return null;
        }
    }

    private static String iso(Long ms) {
        return ms == null ? null
                : LocalDateTime.ofInstant(Instant.ofEpochMilli(ms), ZoneId.systemDefault())
                        .toString();
    }
}
