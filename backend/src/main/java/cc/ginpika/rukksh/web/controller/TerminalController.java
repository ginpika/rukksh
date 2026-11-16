package cc.ginpika.rukksh.web.controller;

import cc.ginpika.rukksh.ai.computer.terminal.TerminalService;
import cc.ginpika.rukksh.ai.computer.terminal.dto.TerminalDtos;
import cc.ginpika.rukksh.ai.computer.terminal.exec.LocalExecTarget;
import cc.ginpika.rukksh.config.SsoProps;
import cc.ginpika.rukksh.web.sso.SsoInterceptor;
import cc.ginpika.rukksh.web.sso.SsoUser;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * 命令行终端接口（工作空间页）：目标维护 + 连通性测试 + 试跑 + 执行审计。
 *
 * <p>与潜意识那套的取舍一致：<b>能力面由人配置，使用时机由模型决定</b>。
 * 这里管的是「模型能碰哪些环境、能碰多久、能输出多少」（{@code term_target}），
 * 而「什么时候去执行什么」发生在对话里，页面不做这个决定——所以这里没有「让模型执行」这类接口，
 * 只有人工试跑（{@code /targets/{id}/run}），它走的是与模型完全相同的那条执行路径。
 *
 * <p>工作空间逐目标启用。本机工作空间需要可用的系统沙箱和管理员配置。
 */
@RestController
@RequestMapping("/api/terminal")
public class TerminalController {

    /** 审计列表默认返回条数 */
    private static final int DEFAULT_COMMANDS = 50;

    private final TerminalService terminal;
    private final SsoProps sso;

    public TerminalController(TerminalService terminal, SsoProps sso) {
        this.terminal = terminal;
        this.sso = sso;
    }

    /** 整页视图：全部目标 */
    @GetMapping
    public TerminalDtos.TerminalView get(HttpServletRequest request) {
        return view(request);
    }

    @PostMapping("/targets")
    public TerminalDtos.TerminalView createTarget(@RequestBody TerminalDtos.TargetRequest req, HttpServletRequest request) {
        requireLocalAdmin(request, localRequest(req));
        terminal.create(req);
        return view(request);
    }

    @PutMapping("/targets/{id}")
    public TerminalDtos.TerminalView updateTarget(@PathVariable String id,
                                                  @RequestBody TerminalDtos.TargetRequest req,
                                                  HttpServletRequest request) {
        requireLocalAdmin(request, localRequest(req) || terminal.isLocalTarget(id));
        terminal.update(id, req);
        return view(request);
    }

    @DeleteMapping("/targets/{id}")
    public TerminalDtos.TerminalView deleteTarget(@PathVariable String id, HttpServletRequest request) {
        requireLocalAdmin(request, terminal.isLocalTarget(id));
        terminal.delete(id);
        return view(request);
    }

    /** 连通性测试：连得上、能执行即通过（不打洞、不起容器） */
    @PostMapping("/targets/{id}/probe")
    public TerminalDtos.ProbeView probe(@PathVariable String id, HttpServletRequest request) {
        requireLocalAdmin(request, terminal.isLocalTarget(id));
        return terminal.probe(id);
    }

    /** 人工试跑一条命令：与模型走同一条执行路径（同样上护栏、同样记审计） */
    @PostMapping("/targets/{id}/run")
    public TerminalDtos.CommandView run(@PathVariable String id,
                                        @RequestBody TerminalDtos.RunRequest req,
                                        HttpServletRequest request) {
        requireLocalAdmin(request, terminal.isLocalTarget(id));
        return terminal.runManual(id, req == null ? null : req.command());
    }

    /** 最近执行过的命令（倒序）：模型到底在环境里做了些什么 */
    @GetMapping("/commands")
    public List<TerminalDtos.CommandView> commands(
            @RequestParam(defaultValue = "" + DEFAULT_COMMANDS) int limit) {
        return terminal.commands(limit);
    }

    private TerminalDtos.TerminalView view(HttpServletRequest request) {
        return terminal.view(isAdministrator(request));
    }

    private boolean isAdministrator(HttpServletRequest request) {
        return request.getAttribute(SsoInterceptor.ATTR) instanceof SsoUser user
                && ("admin".equalsIgnoreCase(user.getRole()) || sso.getAdminUsernames().contains(user.getUsername()));
    }

    private static boolean localRequest(TerminalDtos.TargetRequest request) {
        return request != null && request.kind() != null && LocalExecTarget.KIND.equals(request.kind().trim());
    }

    private void requireLocalAdmin(HttpServletRequest request, boolean local) {
        if (local && !isAdministrator(request)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "管理本机工作空间需要管理员身份");
        }
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, String>> error(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode())
                .body(Map.of("message", error.getReason() == null ? "请求失败" : error.getReason()));
    }
}
