package cc.ginpika.minis.ai.computer.terminal.exec;

import cc.ginpika.minis.ai.computer.terminal.ExecTarget;
import cc.ginpika.minis.ai.computer.terminal.store.TerminalStore;
import cc.ginpika.minis.config.DesktopProps;
import cc.ginpika.minis.web.sso.SsoService;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** Non-interactive commands on the machine running the authenticated backend. */
@Component
public final class LocalExecTarget implements ExecTarget {
    public static final String KIND = "local";
    public static final String UNAVAILABLE = "当前后端不支持本机工作空间";
    private static final String SQLITE = "jdbc:sqlite:";

    private final DesktopProps desktop;
    private final SsoService sso;
    private final Environment environment;
    private final ObjectMapper json;
    private final String os = System.getProperty("os.name", "");
    private final Set<Process> active = ConcurrentHashMap.newKeySet();
    private volatile String linuxUnavailable = "Linux 沙箱尚未初始化。";
    private boolean closed;

    public LocalExecTarget(DesktopProps desktop, SsoService sso, Environment environment, ObjectMapper json) {
        this.desktop = desktop;
        this.sso = sso;
        this.environment = environment;
        this.json = json;
    }

    @Override
    public String kind() {
        return KIND;
    }

    public boolean available() {
        return unavailableReason() == null;
    }

    @PostConstruct
    void checkLinuxSandbox() {
        if (isLinux() && authenticationIssue() == null) {
            linuxUnavailable = LinuxLocalSandbox.unavailableReason();
        }
    }

    public String unavailableReason() {
        String authentication = authenticationIssue();
        if (authentication != null) {
            return authentication;
        }
        if (isLinux()) {
            return linuxUnavailable;
        }
        if (!os.startsWith("Mac")) {
            return "本机环境需要 Linux 或 macOS 后端。";
        }
        return LocalSandbox.hasExecutables() ? null : "当前 macOS 缺少可执行的 sandbox-exec 或 Perl，本机沙箱无法启动。";
    }

    private String authenticationIssue() {
        if (!desktop.isEnabled()) {
            return sso.isEnabled() ? null : "请先为服务器配置 SSO（SSO_SERVER_URL），然后以管理员身份添加本机环境。";
        }
        if (desktop.getLocalToken().isBlank()
                || !"127.0.0.1".equals(environment.getProperty("server.address"))
                || !environment.getProperty("server.servlet.context-path", "").isEmpty()
                || !"/".equals(environment.getProperty("spring.mvc.servlet.path", "/"))) {
            return "桌面本机后端的回环监听或本机认证配置不完整。请从桌面应用重新启动本机后端。";
        }
        return null;
    }

    private boolean isLinux() {
        return os.equals("Linux");
    }

    public void validateConfiguration(Path workdir, List<String> writePaths) {
        validate(workdir, writePaths.stream().map(Path::of).toList(), privatePaths());
    }

    @Override
    public ExecOutcome run(TerminalStore.TargetRow target, String command, ExecOptions options) {
        if (!target.enabled()) {
            throw new IllegalArgumentException("本机工作空间未启用");
        }
        if (command == null || command.isBlank() || command.length() > 16_000 || command.indexOf('\0') >= 0) {
            throw new IllegalArgumentException("本机命令为空、包含空字符或过长");
        }
        return execute(target, command, options);
    }

    @Override
    public void probe(TerminalStore.TargetRow target) {
        ExecOutcome outcome = execute(target, "/usr/bin/true", new ExecOptions(target.workdir(), 3_000, 1_000));
        if (!outcome.ok()) {
            throw new IllegalStateException("本机沙箱测试失败：" + outcome.stderr());
        }
    }

    private ExecOutcome execute(TerminalStore.TargetRow target, String command, ExecOptions options) {
        String unavailable = unavailableReason();
        if (unavailable != null) {
            throw new IllegalStateException(unavailable);
        }
        Path base = LocalSandbox.storedDirectory(target.workdir());
        Path workdir = target.workdir().equals(options.workdir()) ? base : LocalSandbox.resolveDirectory(options.workdir());
        if (!inside(workdir, base)) {
            throw new IllegalArgumentException("项目工作目录必须位于本机工作空间内");
        }
        List<Path> writes = options.readOnly() ? List.of() : resolveWritePaths(target.writePaths());
        List<Path> privatePaths = privatePaths();
        validate(base, writes, privatePaths);
        if (!base.equals(workdir)) {
            rejectPrivateWorkdir(workdir, privatePaths);
        }

        long started = System.nanoTime();
        ProcessBuilder builder = isLinux()
                ? LinuxLocalSandbox.command(base, workdir, writes, privatePaths, options.timeoutMs(), command)
                : LocalSandbox.command(workdir, writes, privatePaths, options.timeoutMs(), command);
        try {
            Process process = start(builder);
            try {
                var out = new CappedOutput(process.getInputStream(), options.maxOutputChars());
                var err = new CappedOutput(process.getErrorStream(), options.maxOutputChars());
                Thread stdout = Thread.startVirtualThread(out);
                Thread stderr = Thread.startVirtualThread(err);
                boolean finished = process.waitFor(options.timeoutMs() + 2_000, TimeUnit.MILLISECONDS);
                if (!finished) {
                    cancel(process);
                }
                stdout.join(1_000);
                stderr.join(1_000);
                int exit = finished ? process.exitValue() : NO_EXIT_CODE;
                return new ExecOutcome(exit, out.text(), err.text(),
                        TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started),
                        out.truncated() || err.truncated() || stdout.isAlive() || stderr.isAlive(),
                        !finished || exit == 124);
            } finally {
                cancel(process);
                active.remove(process);
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("本机命令已中断", error);
        } catch (IOException error) {
            throw new IllegalStateException("无法启动本机沙箱：" + error.getMessage(), error);
        }
    }

    private synchronized Process start(ProcessBuilder builder) throws IOException {
        if (closed) {
            throw new IllegalStateException("本机工作空间正在关闭");
        }
        Process process = builder.start();
        active.add(process);
        return process;
    }

    @PreDestroy
    synchronized void close() {
        closed = true;
        active.forEach(LocalExecTarget::cancel);
    }

    private static void cancel(Process process) {
        // Closing this pipe requests group termination even when the worker thread is interrupted.
        try {
            process.getOutputStream().close();
        } catch (IOException ignored) {
            process.destroy();
        }
    }

    private List<Path> resolveWritePaths(String stored) {
        if (stored == null) {
            return List.of();
        }
        try {
            var paths = json.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(stored);
            if (paths == null || !paths.isArray()) {
                throw new IllegalArgumentException("写入白名单必须是目录列表");
            }
            var result = new ArrayList<String>();
            for (var path : paths) {
                if (!path.isTextual()) {
                    throw new IllegalArgumentException("写入白名单必须是目录列表");
                }
                result.add(path.textValue());
            }
            List<String> canonical = LocalSandbox.validateWritePaths(result);
            if (!canonical.equals(result)) {
                throw new IllegalArgumentException("本机写入目录位置已变化，请重新保存工作空间");
            }
            return canonical.stream().map(Path::of).toList();
        } catch (IOException error) {
            throw new IllegalArgumentException("本机写入白名单格式无效", error);
        }
    }

    private void validate(Path workdir, List<Path> writes, List<Path> privatePaths) {
        rejectPrivateWorkdir(workdir, privatePaths);
        for (Path write : writes) {
            if (privatePaths.stream().anyMatch(path -> inside(write, path) || inside(path, write))) {
                throw new IllegalArgumentException("写入白名单不能包含应用运行时或数据目录：" + write);
            }
        }
        if (isLinux()) {
            LinuxLocalSandbox.validateWorkdir(workdir, privatePaths);
            LinuxLocalSandbox.validateWritePaths(writes);
        }
        LocalSandbox.inspectWriteRoots(writes);
    }

    private static void rejectPrivateWorkdir(Path workdir, List<Path> privatePaths) {
        if (privatePaths.stream().anyMatch(path -> inside(workdir, path))) {
            throw new IllegalArgumentException("应用运行时或数据目录不能作为本机工作目录：" + workdir);
        }
    }

    private static boolean inside(Path path, Path root) {
        if (path.startsWith(root)) {
            return true;
        }
        // Case-insensitive filesystems and bind mounts can expose the same inode under another path.
        for (Path current = path; current != null; current = current.getParent()) {
            try {
                if (Files.isSameFile(current, root)) {
                    return true;
                }
            } catch (NoSuchFileException ignored) {
                // A protected path may only be created when the corresponding feature starts.
            } catch (IOException error) {
                throw new IllegalStateException("无法验证本机路径：" + current, error);
            }
        }
        return false;
    }

    private List<Path> privatePaths() {
        var paths = new LinkedHashSet<Path>();
        String url = environment.getProperty("spring.datasource.url", "jdbc:sqlite:../data/minis.db");
        if (!url.startsWith(SQLITE)) {
            throw new IllegalStateException("无法识别本机应用数据目录");
        }
        String file = url.substring(SQLITE.length());
        if (file.isBlank() || file.startsWith(":") || file.startsWith("file:")) {
            throw new IllegalStateException("本机工作空间需要独立的 SQLite 数据文件目录");
        }
        Path database = Path.of(file).toAbsolutePath().normalize();
        Path current = Path.of("").toAbsolutePath();
        if (desktop.isEnabled() && current.getParent() != null) {
            protect(paths, current);
        }
        for (String name : List.of(".env", "config", "application.properties", "application.yml", "application.yaml")) {
            protect(paths, current.resolve(name));
        }
        protect(paths, database.getParent());
        for (String key : List.of("minis.coding.data-dir", "minis.article-dir", "logging.file.name",
                "minis.computer.window-helper", "MINIS_DESKTOP_RUNTIME")) {
            String value = environment.getProperty(key);
            if (value != null && !value.isBlank()) {
                protect(paths, Path.of(value));
            }
        }
        if (!isLinux()) {
            protect(paths, Path.of(System.getProperty("java.home")));
        }
        for (String entry : System.getProperty("java.class.path", "").split(java.io.File.pathSeparator)) {
            if (!entry.isBlank()) {
                protect(paths, Path.of(entry));
            }
        }
        return List.copyOf(paths);
    }

    private static void protect(Set<Path> paths, Path path) {
        Path absolute = path.toAbsolutePath().normalize();
        paths.add(absolute);
        // Some protected files may be created on the next launch. Resolve existing parents so
        // an alternate path through a symbolic link still carries the same protection.
        var missing = new ArrayList<Path>();
        while (true) {
            try {
                Path real = absolute.toRealPath();
                for (Path part : missing.reversed()) {
                    real = real.resolve(part);
                }
                paths.add(real);
                return;
            } catch (NoSuchFileException error) {
                missing.add(absolute.getFileName());
                absolute = absolute.getParent();
            } catch (IOException error) {
                throw new IllegalStateException("无法保护本机应用文件：" + path, error);
            }
        }
    }

    private static final class CappedOutput implements Runnable {
        private final InputStream stream;
        private final int max;
        private final StringBuilder text = new StringBuilder();
        private boolean truncated;

        CappedOutput(InputStream stream, int max) {
            this.stream = stream;
            this.max = max;
        }

        @Override
        public void run() {
            try (var reader = new InputStreamReader(stream, StandardCharsets.UTF_8)) {
                var buffer = new char[4_096];
                int count;
                while ((count = reader.read(buffer)) != -1) {
                    synchronized (this) {
                        int keep = Math.min(count, Math.max(0, max - text.length()));
                        text.append(buffer, 0, keep);
                        truncated |= keep < count;
                    }
                }
            } catch (IOException error) {
                synchronized (this) {
                    truncated = true;
                }
            }
        }

        synchronized String text() {
            return text.toString();
        }

        synchronized boolean truncated() {
            return truncated;
        }
    }
}
