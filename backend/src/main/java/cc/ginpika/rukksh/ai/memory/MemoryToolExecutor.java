package cc.ginpika.rukksh.ai.memory;

import cc.ginpika.rukksh.ai.core.MemoryExec;
import cc.ginpika.rukksh.ai.core.tool.memory.BackfillMemoryVectorsTool;
import cc.ginpika.rukksh.ai.core.tool.memory.ForgetMemoryTool;
import cc.ginpika.rukksh.ai.core.tool.memory.NoteWorkingTool;
import cc.ginpika.rukksh.ai.core.tool.memory.PublishKnowledgeTool;
import cc.ginpika.rukksh.ai.core.tool.memory.RecallMemoryTool;
import cc.ginpika.rukksh.ai.core.tool.memory.UpdateMemoryTool;
import cc.ginpika.rukksh.ai.core.util.ToolTextPage;
import cc.ginpika.rukksh.ai.llm.EmbeddingClient;
import cc.ginpika.rukksh.ai.memory.graph.MemoryGraphStore;
import cc.ginpika.rukksh.ai.memory.recall.MemoryItemRecall;
import cc.ginpika.rukksh.ai.memory.recall.MemoryRecall;
import cc.ginpika.rukksh.config.MemoryProps;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.DateTimeException;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import org.springframework.stereotype.Component;

/**
 * 记忆域工具执行器：承载记忆召回、发布、交接、工作集记录、改写、遗忘与向量补齐，
 * 与知识库检索工具解耦以保持模块单向边界。
 */
@Component
public class MemoryToolExecutor {

    private static final String MANAGE_HANDOFF_TOOL = "manage_handoff";

    private static final Set<String> HANDLED = Set.of(
            RecallMemoryTool.NAME,
            PublishKnowledgeTool.NAME,
            MANAGE_HANDOFF_TOOL,
            NoteWorkingTool.NAME,
            UpdateMemoryTool.NAME,
            ForgetMemoryTool.NAME,
            BackfillMemoryVectorsTool.NAME);

    private final MemoryRecall memoryRecall;
    private final MemoryItemRecall memoryItems;
    private final MemoryEmbeddingWriter memoryVectors;
    private final MemoryItemEmbeddingWriter memoryItemVectors;
    private final MemoryPublisher memoryPublisher;
    private final WorkingSetService workingSet;
    private final MemoryEditService memoryEdit;
    private final EmbeddingClient embedding;
    private final MemoryProps memoryProps;
    private final ObjectMapper om;

    public MemoryToolExecutor(MemoryRecall memoryRecall,
                              MemoryItemRecall memoryItems,
                              MemoryEmbeddingWriter memoryVectors,
                              MemoryItemEmbeddingWriter memoryItemVectors,
                              MemoryPublisher memoryPublisher,
                              WorkingSetService workingSet,
                              MemoryEditService memoryEdit,
                              EmbeddingClient embedding,
                              MemoryProps memoryProps,
                              ObjectMapper om) {
        this.memoryRecall = memoryRecall;
        this.memoryItems = memoryItems;
        this.memoryVectors = memoryVectors;
        this.memoryItemVectors = memoryItemVectors;
        this.memoryPublisher = memoryPublisher;
        this.workingSet = workingSet;
        this.memoryEdit = memoryEdit;
        this.embedding = embedding;
        this.memoryProps = memoryProps;
        this.om = om;
    }

    public static boolean handles(String name) {
        return HANDLED.contains(name);
    }

    public String run(String name, JsonNode args) {
        return switch (name) {
            case RecallMemoryTool.NAME -> recallMemoryTool(args);
            case PublishKnowledgeTool.NAME -> publishKnowledgeTool(args);
            case MANAGE_HANDOFF_TOOL -> manageHandoff(args);
            case NoteWorkingTool.NAME -> noteWorkingTool(args);
            case UpdateMemoryTool.NAME -> updateMemoryTool(args);
            case ForgetMemoryTool.NAME -> forgetMemoryTool(args);
            case BackfillMemoryVectorsTool.NAME -> backfillMemoryVectorsTool(args);
            default -> "未知记忆工具: " + name;
        };
    }

    private String recallMemoryTool(JsonNode args) {
        if ("evidence".equals(args.path("mode").asText())) {
            if (!args.path("id").canConvertToLong()) {
                return "mode=evidence 需要事实 id";
            }
            String evidence = MemoryGraphStore.encode(memoryItems.evidence(
                    ScopeGuard.resolveRead(null),
                    args.path("id").asLong(),
                    args.path("offset").asInt(),
                    args.path("limit").asInt(8)));
            return ToolTextPage.slice(om, evidence,
                    args.path("text_offset").asInt(),
                    args.path("max_chars").asInt(6000)).toString();
        }
        String query = args.path("query").asText("").trim();
        boolean timed = args.hasNonNull("occurred_from")
                || args.hasNonNull("occurred_to")
                || args.hasNonNull("temporal_kind");
        if (query.isEmpty() && !timed) {
            return "参数缺少 query";
        }
        if ("event".equalsIgnoreCase(args.path("mode").asText("").trim())) {
            return recallMemoryEvents(args, query);
        }
        String scope = blankToNull(args.path("scope").asText(null));
        int limit = clamp(args.path("limit").asInt(8), 1, 30);
        MemoryExec exec = ScopeGuard.resolveRead(null);
        ZoneId zone;
        Long from;
        Long to;
        String temporalKind = blankToNull(args.path("temporal_kind").asText(null));
        if (temporalKind != null && !List.of("event", "state", "timeless", "unknown").contains(temporalKind)) {
            return "temporal_kind 无效";
        }
        try {
            zone = ZoneId.of(args.path("time_zone").asText(memoryProps.getTimeZone()));
            from = MemoryTime.instant(args.path("occurred_from").asText(null), zone);
            to = MemoryTime.instant(args.path("occurred_to").asText(null), zone);
            if (from != null && to != null && from >= to) {
                return "时间区间必须满足 occurred_from < occurred_to";
            }
        } catch (DateTimeException e) {
            return "时间或时区格式无效，请使用 ISO 日期/时间和 IANA 时区";
        }
        String text = MemoryItemRecall.hitsText(memoryItems.recall(exec, query, scope, limit, from, to, temporalKind));
        return text.isEmpty() ? "（没有相关的记忆）" : text;
    }

    private String noteWorkingTool(JsonNode args) {
        String body = args.path("body").asText("").trim();
        if (body.isEmpty()) {
            return "参数缺少 body";
        }
        String kind = args.path("kind").asText("").trim();
        String title = args.path("title").asText("").trim();
        MemoryExec exec = ScopeGuard.resolve(null);
        if (exec == null) {
            return "当前执行没有记忆作用域，无法记录工作状态（memory-v6 I1）";
        }
        String[] out = new String[1];
        boolean deferred = MemoryStage.defer(() -> {
            long id = workingSet.record(exec, kind, title, body, null, null);
            out[0] = id > 0
                    ? "已记入本会话工作集（work=" + id + "）"
                    : "未记录：当前执行没有会话 / 任务绑定（工作状态必须可归属）";
        }, memoryProps);
        if (out[0] != null) {
            return out[0];
        }
        return deferred ? "已记入本会话工作集（本轮末提交，下一轮起可见）" : "已记入本会话工作集";
    }

    private String updateMemoryTool(JsonNode args) {
        String body = args.path("new_content").asText("").trim();
        Long itemId = args.path("item_id").isNumber() ? args.path("item_id").asLong() : null;
        String match = blankToNull(args.path("match").asText(null));
        String title = blankToNull(args.path("title").asText(null));
        MemoryExec exec = ScopeGuard.resolve(null);
        if (exec == null) {
            return "当前执行没有记忆作用域，无法改写（memory-v6 I1）";
        }
        String[] out = new String[1];
        boolean deferred = MemoryStage.defer(
                () -> out[0] = memoryEdit.update(exec, itemId, match, title, body).message(),
                memoryProps);
        return out[0] != null ? out[0] : (deferred ? "已登记改写（本轮末提交，下一轮生效）" : "已处理");
    }

    private String forgetMemoryTool(JsonNode args) {
        Long itemId = args.path("item_id").isNumber() ? args.path("item_id").asLong() : null;
        String match = blankToNull(args.path("match").asText(null));
        String reason = blankToNull(args.path("reason").asText(null));
        MemoryExec exec = ScopeGuard.resolve(null);
        if (exec == null) {
            return "当前执行没有记忆作用域，无法遗忘（memory-v6 I1）";
        }
        String[] out = new String[1];
        boolean deferred = MemoryStage.defer(
                () -> out[0] = memoryEdit.forget(exec, itemId, match, reason).message(),
                memoryProps);
        return out[0] != null ? out[0] : (deferred ? "已登记遗忘（本轮末提交）" : "已处理");
    }

    private String publishKnowledgeTool(JsonNode args) {
        String content = args.path("content").asText("").trim();
        if (content.isEmpty()) {
            return "参数缺少 content";
        }
        String toKind = args.path("to_kind").asText("").trim().toLowerCase();
        switch (toKind) {
            case "agent", "project", "session", "user" -> {
            }
            default -> {
                return "参数 to_kind 非法（agent|project|session|user）：" + toKind;
            }
        }
        MemoryExec exec = ScopeGuard.resolve(null);
        if (exec == null) {
            return "当前执行没有记忆作用域，无法发布（memory-v6 I1）";
        }
        String toRef = publishTarget(toKind, args.path("to_ref").asText("").trim(), exec);
        if (toRef == null && !"user".equals(toKind)) {
            return "缺少接收方：" + toKind + "（当前执行也没有可用的默认目标）";
        }
        String title = args.path("title").asText("").trim();
        String note = args.path("note").asText("");
        boolean handoff = args.path("handoff").asBoolean(false);
        String[] result = new String[1];
        boolean deferred = MemoryStage.defer(() -> {
            long[] ids = memoryPublisher.publishNew(exec, content, title, toKind, toRef, note, handoff);
            result[0] = "已发布到 " + toKind + ":" + toRef + "（share=" + ids[0] + ")";
        }, memoryProps);
        if (result[0] != null) {
            return result[0];
        }
        return deferred ? "已登记发布（本轮末提交；接收方下一轮可见）：" + content
                : "已发布：" + content;
    }

    private static String publishTarget(String toKind, String toRef, MemoryExec exec) {
        if (toRef != null && !toRef.isBlank()) {
            return toRef;
        }
        return switch (toKind) {
            case "agent" -> exec.agentOrBuiltin();
            case "project" -> exec.projectId();
            case "session" -> exec.sessionId();
            default -> null;
        };
    }

    private String manageHandoff(JsonNode args) {
        MemoryExec exec = ScopeGuard.resolve(null);
        if (exec == null) {
            return "无记忆执行作用域";
        }
        String action = args.path("action").asText("list");
        if ("list".equals(action)) {
            return om.valueToTree(Stream.concat(memoryPublisher.inbox(exec, 50).stream(),
                    memoryPublisher.inbox(exec, 50, "accepted").stream()).toList()).toString();
        }
        memoryPublisher.move(exec, args.path("handoff_id").asLong(), action);
        return "交接状态已更新为 " + action;
    }

    private String recallMemoryEvents(JsonNode args, String query) {
        Long since = null;
        if (args.path("days").isNumber()) {
            since = System.currentTimeMillis()
                    - (long) (args.path("days").asDouble() * 86_400_000L);
        }
        List<MemoryRecall.Hit> hits = memoryRecall.recall(ScopeGuard.resolveRead(null), query, since, null,
                blankToNull(args.path("kind").asText(null)),
                blankToNull(args.path("actor").asText(null)),
                clamp(args.path("limit").asInt(8), 1, 30));
        String text = MemoryRecall.hitsText(hits);
        return text.isEmpty() ? "（记忆事件流中没有匹配的记录）" : text;
    }

    private String backfillMemoryVectorsTool(JsonNode args) {
        if (!embedding.configured()) {
            return "embedding 未配置，无法补齐记忆向量（请先在设置页配置 embedding 端点）";
        }
        int done = memoryVectors.backfill(clamp(args.path("limit").asInt(16), 1,
                MemoryEmbeddingWriter.BACKFILL_MAX));
        int itemDone = memoryItemVectors.backfill(clamp(args.path("limit").asInt(16), 1, 64));
        return "已补齐事件向量 " + done + " 条、记忆条目向量 " + itemDone + " 条";
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }
}
