package cc.ginpika.rukksh.agent.heartbeat;

import cc.ginpika.rukksh.agent.chat.dto.ChatDtos;
import cc.ginpika.rukksh.agent.heartbeat.dto.HeartbeatDtos;
import cc.ginpika.rukksh.agent.heartbeat.store.PlanStore;
import cc.ginpika.rukksh.agent.member.AgentDirectory;
import cc.ginpika.rukksh.agent.runtime.ExecStore;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * 观测台脉冲快照与执行视图聚合服务，统一全局与单 Agent 观测台口径，消除控制器间横向耦合与映射重复。
 */
@Service
public class HeartbeatDashboardService {

    /** 快照里带回的批次数 */
    private static final int PULSE_RUNS = 8;

    /** 快照里每批带回的执行条数 */
    private static final int PULSE_EXECS = 30;

    private final HeartbeatService heartbeat;
    private final PlanStore plans;
    private final ExecStore execs;
    private final AgentDirectory directory;
    private final ObjectMapper om;

    public HeartbeatDashboardService(HeartbeatService heartbeat, PlanStore plans, ExecStore execs,
                                     AgentDirectory directory, ObjectMapper om) {
        this.heartbeat = heartbeat;
        this.plans = plans;
        this.execs = execs;
        this.directory = directory;
        this.om = om;
    }

    /** 全局观测台快照：全部已启用的心跳与最近若干批执行。 */
    public HeartbeatDtos.PulseView globalPulse() {
        List<HeartbeatDtos.HeartbeatState> states = plans.enabledHeartbeats().stream()
                .map(this::toState)
                .toList();
        List<HeartbeatDtos.RunBundle> recent = execs.runs(null, PULSE_RUNS).stream()
                .map(r -> new HeartbeatDtos.RunBundle(toRun(r), execsOfRun(r.id())))
                .toList();
        return new HeartbeatDtos.PulseView(states, recent);
    }

    /** 指定 Agent 后台观测台快照。 */
    public HeartbeatDtos.PulseView agentPulse(String agentId) {
        PlanStore.HeartbeatRow hb = heartbeat.heartbeat(agentId);
        HeartbeatDtos.HeartbeatState state = new HeartbeatDtos.HeartbeatState(agentId,
                directory.nameOf(agentId), hb.enabled(), hb.tickMs(), hb.lastBeatAt(),
                heartbeat.running(agentId));
        List<HeartbeatDtos.RunBundle> recent = execs.runs(agentId, PULSE_RUNS).stream()
                .map(r -> new HeartbeatDtos.RunBundle(toRun(r), execsOfRun(r.id())))
                .toList();
        return new HeartbeatDtos.PulseView(List.of(state), recent);
    }

    /** 某批的执行列表（超过 PULSE_EXECS 时只保留最近若干条）。 */
    public List<HeartbeatDtos.ExecView> execsOfRun(String runId) {
        List<ExecStore.ExecRow> rows = execs.execsByRun(runId);
        if (rows.size() > PULSE_EXECS) {
            rows = rows.subList(rows.size() - PULSE_EXECS, rows.size());
        }
        return rows.stream().map(r -> toExec(r, false, null)).toList();
    }

    /** 执行详情（含写库清单与完整上下文）。 */
    public HeartbeatDtos.ExecView toExecWithEdits(ExecStore.ExecRow r) {
        List<HeartbeatDtos.EditView> edits = execs.editsByExec(r.id()).stream()
                .map(e -> new HeartbeatDtos.EditView(e.id(), e.tool(), e.args(), e.summary(), e.createdAt()))
                .toList();
        return new HeartbeatDtos.ExecView(r.id(), r.runId(), r.kind(), r.planId(), r.title(),
                r.status(), r.context(), r.output(), r.reasoning(), traces(r.trace()), edits,
                r.error(), r.startedAt(), r.finishedAt(), null);
    }

    public HeartbeatDtos.ExecView toExec(ExecStore.ExecRow r, boolean withContext, Long taskId) {
        return new HeartbeatDtos.ExecView(r.id(), r.runId(), r.kind(), r.planId(), r.title(),
                r.status(), withContext ? r.context() : null, r.output(), r.reasoning(),
                traces(r.trace()), List.of(), r.error(), r.startedAt(), r.finishedAt(), taskId);
    }

    public static HeartbeatDtos.RunView toRun(ExecStore.RunRow r) {
        return new HeartbeatDtos.RunView(r.id(), r.agentId(), r.beat(), r.trigger(), r.status(),
                r.agentCount(), r.note(), r.startedAt(), r.finishedAt());
    }

    /** 快照指纹：仅当核心运行态变化时触发 SSE 推送。 */
    public static String pulseKey(HeartbeatDtos.PulseView pulse) {
        StringBuilder sb = new StringBuilder();
        for (HeartbeatDtos.HeartbeatState s : pulse.heartbeats()) {
            sb.append(s.agentId()).append(s.enabled()).append(s.running()).append(':');
        }
        sb.append('|');
        for (HeartbeatDtos.RunBundle bundle : pulse.recentRuns()) {
            HeartbeatDtos.RunView run = bundle.run();
            sb.append(run.id()).append(run.status()).append(run.agentCount()).append(':');
            for (HeartbeatDtos.ExecView e : bundle.execs()) {
                sb.append(e.id()).append(':').append(e.status()).append(',');
            }
            sb.append('|');
        }
        return sb.toString();
    }

    private HeartbeatDtos.HeartbeatState toState(PlanStore.HeartbeatRow hb) {
        return new HeartbeatDtos.HeartbeatState(hb.agentId(), directory.nameOf(hb.agentId()),
                hb.enabled(), hb.tickMs(), hb.lastBeatAt(), heartbeat.running(hb.agentId()));
    }

    private List<ChatDtos.TraceSegment> traces(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return om.readValue(json, new TypeReference<List<ChatDtos.TraceSegment>>() {
            });
        } catch (Exception e) {
            return List.of();
        }
    }
}
