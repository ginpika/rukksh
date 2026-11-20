package cc.ginpika.rukksh.web.controller;

import cc.ginpika.rukksh.agent.heartbeat.HeartbeatDashboardService;
import cc.ginpika.rukksh.agent.heartbeat.dto.HeartbeatDtos;
import cc.ginpika.rukksh.ai.core.tool.ToolRegistry;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 系统级接口（全局、跨 Agent）：工具词典 + 全局观测台（所有 Agent 的心跳状态与最近执行）。
 *
 * <p>「后台」已逐 Agent 化：逐 Agent 的读取 / 操作在 {@link AgentController} 的 {@code /api/agents/{agentId}/*}；
 * 这里只放<b>全局</b>两样——工具字典（与 Agent 无关）与全局观测台（跨全部 Agent 聚合）。
 */
@RestController
@RequestMapping("/api/system")
public class SystemController {

    /** SSE 流最长保持：与 nginx 的 proxy_read_timeout（300s）对齐 */
    private static final long STREAM_TIMEOUT_MS = 300_000L;

    /** 全局观测台快照间隔 */
    private static final long PULSE_MS = 2_000L;

    /** 保活注释帧间隔（无变化时） */
    private static final long PING_MS = 15_000L;

    private final HeartbeatDashboardService dashboard;
    private final ToolRegistry tools;
    private final ObjectMapper om;

    /** 每个观测台连接一个虚拟线程：只做「读快照 → 推 SSE」，不占请求线程 */
    private final ExecutorService streamExecutor = Executors.newVirtualThreadPerTaskExecutor();

    public SystemController(HeartbeatDashboardService dashboard, ToolRegistry tools, ObjectMapper om) {
        this.dashboard = dashboard;
        this.tools = tools;
        this.om = om;
    }

    /**
     * 工具词典：全部工具各自是什么、属于哪些工具面、参数怎么给。
     * 只读、不参与调度，故独立成一条接口（全局一份，与 Agent 无关）。
     */
    @GetMapping("/tools")
    public List<HeartbeatDtos.ToolInfoView> tools() {
        return tools.allTools().stream()
                .map(t -> new HeartbeatDtos.ToolInfoView(t.name(), t.description(),
                        t.surfaces().stream().map(Enum::name).sorted().toList(),
                        t.writes(), t.agentsMayCall(), t.parallelizable(), t.parameters(om)))
                .toList();
    }

    /** 全局观测台快照：全部「已启用」心跳的逐 Agent 状态 + 所有 Agent 的最近几批执行 */
    @GetMapping("/dashboard/pulse")
    public HeartbeatDtos.PulseView pulse() {
        return dashboard.globalPulse();
    }

    /** 全局观测台实时流：变化时推 pulse（整份快照），无变化时发注释帧保活 */
    @GetMapping(value = "/dashboard/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream() {
        SseEmitter emitter = new SseEmitter(STREAM_TIMEOUT_MS);
        streamExecutor.execute(() -> {
            String last = null;
            long lastPing = System.currentTimeMillis();
            try {
                for (;;) {
                    HeartbeatDtos.PulseView pulse = dashboard.globalPulse();
                    String key = HeartbeatDashboardService.pulseKey(pulse);
                    long now = System.currentTimeMillis();
                    if (!key.equals(last)) {
                        last = key;
                        lastPing = now;
                        send(emitter, "pulse", pulse);
                    } else if (now - lastPing >= PING_MS) {
                        lastPing = now;
                        emitter.send(SseEmitter.event().comment("ping"));
                    }
                    Thread.sleep(PULSE_MS);
                }
            } catch (ClientGone e) {
                emitter.complete();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                emitter.complete();
            } catch (Exception e) {
                emitter.complete();
            }
        });
        return emitter;
    }

    private void send(SseEmitter emitter, String name, Object payload) {
        try {
            emitter.send(SseEmitter.event().name(name).data(om.writeValueAsString(payload)));
        } catch (Exception e) {
            throw new ClientGone();
        }
    }

    /** 客户端已断开：结束该观测台线程 */
    private static final class ClientGone extends RuntimeException {
    }
}
