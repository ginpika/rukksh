package cc.ginpika.rukksh.ai.memory.dto;

import cc.ginpika.rukksh.ai.memory.MemoryTime;
import cc.ginpika.rukksh.ai.memory.MemoryVocabulary;
import cc.ginpika.rukksh.ai.memory.recall.MemoryItemRecall;
import cc.ginpika.rukksh.ai.memory.store.MemoryItemStore;
import cc.ginpika.rukksh.ai.memory.store.MemoryWorkStore;

/** 记忆条目与工作集跨控制器/服务共享的只读视图 DTO。 */
public final class MemoryViews {

    private MemoryViews() {
    }

    /** 一条记忆条目（读侧视图） */
    public record ItemView(long id, String agentId, String owner, String domain, String layer,
                           String projectId, String sessionId, Long taskId, String scope,
                           String scopeLabel, String title, String body, double confidence,
                           String source, String sourceKind, String evidenceLevel, String status,
                           String retention, String identity, Long version, boolean pinned,
                           boolean active, Long validUntil, Long supersededBy, long createdAt,
                           long updatedAt, String producerAgent, String sourceRefs, Long expiresSoft,
                           Long promotedFrom, Long learnedAt, Long invalidAt, String temporalJson) {
        public static ItemView of(MemoryItemStore.ItemRow r) {
            return new ItemView(r.id(), r.agentId(), r.owner(), r.domain(), r.layer(), r.projectId(),
                    r.sessionId(), r.taskId(), r.scope(), MemoryItemRecall.scopeLabel(r.scope()),
                    r.title(), r.body(), r.confidence(), r.source(), r.sourceKind(), r.evidenceLevel(),
                    r.status(), r.retention(), r.identity(), r.version(), r.pinned(), isActive(r),
                    r.validUntil(), r.supersededBy(), r.createdAt(), r.updatedAt(), r.producerAgent(),
                    r.sourceRefs(), r.expiresSoft(), r.promotedFrom(), r.learnedAt(), r.invalidAt(),
                    r.temporalJson());
        }
    }

    /** 一条工作状态（memory_work · L3）：与长期记忆物理分离，注入时一并呈现 */
    public record WorkingView(long id, String sessionId, Long taskId, String agentId, String projectId,
                              String kind, String title, String body, String status, Long expiresAt,
                              long createdAt, long updatedAt) {
        public static WorkingView of(MemoryWorkStore.WorkRow w) {
            return new WorkingView(w.id(), w.sessionId(), w.taskId(), w.agentId(), w.projectId(),
                    w.kind(), w.title(), w.body(), w.status(), w.expiresAt(), w.createdAt(),
                    w.updatedAt());
        }
    }

    public static boolean isActive(MemoryItemStore.ItemRow r) {
        var temporal = MemoryTime.decode(r.temporalJson());
        boolean state = temporal != null && "state".equals(temporal.kind());
        long now = System.currentTimeMillis();
        return MemoryVocabulary.STATUS_ACTIVE.equals(r.status())
                && r.supersededBy() == null
                && (r.validUntil() == null || r.validUntil() > now)
                && (r.expiresSoft() == null || r.expiresSoft() > now)
                && (!state || (temporal.start() == null || temporal.start() <= now)
                && (r.invalidAt() == null || r.invalidAt() > now));
    }
}
