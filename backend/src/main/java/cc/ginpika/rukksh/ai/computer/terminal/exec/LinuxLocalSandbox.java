package cc.ginpika.rukksh.ai.computer.terminal.exec;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** Prepares the path grants consumed by the Linux Landlock and seccomp helper. */
final class LinuxLocalSandbox {
    private static final Path HELPER = Path.of("/usr/local/bin/rukksh-local-sandbox");
    private static final List<Path> KERNEL_AND_SERVICE_PATHS = List.of(
            Path.of("/dev"), Path.of("/proc"), Path.of("/sys"), Path.of("/run"));
    private static final List<Path> TOOL_PATHS = List.of(
            Path.of("/usr/bin"), Path.of("/usr/sbin"), Path.of("/usr/lib"),
            Path.of("/lib"), Path.of("/lib64"), Path.of("/bin"), Path.of("/sbin"),
            Path.of("/usr/local/bin"), Path.of("/usr/local/lib"), Path.of("/usr/share"),
            Path.of("/etc/ld.so.cache"), Path.of("/etc/localtime"), Path.of("/etc/passwd"),
            Path.of("/etc/group"), Path.of("/dev/urandom"), Path.of(System.getProperty("java.home")));

    private LinuxLocalSandbox() {}

    static String unavailableReason() {
        if (!Files.isExecutable(HELPER)) {
            return "Linux 后端缺少 rukksh-local-sandbox。请安装沙箱程序或更新后端镜像。";
        }
        Process process = null;
        try {
            var builder = new ProcessBuilder(HELPER.toString(), "--check").redirectErrorStream(true);
            builder.environment().clear();
            process = builder.start();
            if (!process.waitFor(3, TimeUnit.SECONDS)) {
                return "Linux 沙箱初始化超时。";
            }
            if (process.exitValue() == 0) {
                return null;
            }
            String detail = new String(process.getInputStream().readNBytes(1024), StandardCharsets.UTF_8).strip();
            return "Linux 沙箱不可用，请检查 Landlock、seccomp 和后端运行用户。"
                    + (detail.isEmpty() ? "" : " " + detail);
        } catch (IOException error) {
            return "无法启动 Linux 沙箱：" + error.getMessage();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return "Linux 沙箱初始化已中断。";
        } finally {
            if (process != null && process.isAlive()) {
                process.destroyForcibly();
            }
        }
    }

    static ProcessBuilder command(Path base, Path workdir, List<Path> writes, List<Path> privatePaths,
                                  long timeoutMs, String command) {
        var args = new ArrayList<>(List.of(HELPER.toString(), Long.toString(timeoutMs)));
        var readable = new LinkedHashSet<Path>();
        for (Path path : TOOL_PATHS) {
            if (Files.exists(path)) {
                try {
                    Path resolved = path.toRealPath();
                    if (!overlapsPrivate(resolved, privatePaths)) {
                        readable.add(resolved);
                    }
                } catch (IOException error) {
                    throw new IllegalStateException("无法检查 Linux 沙箱工具目录：" + path, error);
                }
            }
        }
        readable.add(base);
        for (Path path : readable) {
            if (!writes.contains(path)) {
                args.addAll(List.of("--read", path.toString()));
            }
        }
        for (Path path : writes) {
            args.addAll(List.of("--write", path.toString()));
        }
        args.addAll(List.of("--", command));
        var builder = new ProcessBuilder(args).directory(workdir.toFile());
        LocalSandbox.configureEnvironment(builder, workdir, writes,
                "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin", "C.UTF-8");
        return builder;
    }

    private static boolean overlapsPrivate(Path directory, List<Path> privatePaths) {
        return privatePaths.stream().anyMatch(path -> directory.startsWith(path) || path.startsWith(directory));
    }

    static void validateWorkdir(Path directory, List<Path> privatePaths) {
        if (overlapsPrivate(directory, privatePaths)) {
            throw new IllegalArgumentException("Linux 沙箱目录不能包含应用运行时或数据文件：" + directory);
        }
        if (KERNEL_AND_SERVICE_PATHS.stream().anyMatch(directory::startsWith)) {
            throw new IllegalArgumentException("Linux 本机工作目录不能位于设备、内核或服务目录：" + directory);
        }
    }

    static void validateWritePaths(List<Path> writes) {
        // These directories contain dynamically loaded tools used by the server and the launcher.
        for (Path path : TOOL_PATHS) {
            if (Files.isDirectory(path)) {
                try {
                    rejectPrivateWrites(path.toRealPath(), writes);
                } catch (IOException error) {
                    throw new IllegalStateException("无法检查 Linux 系统目录：" + path, error);
                }
            }
        }
        for (Path systemPath : KERNEL_AND_SERVICE_PATHS) {
            rejectPrivateWrites(systemPath, writes);
        }
        rejectPrivateWrites(Path.of("/etc"), writes);
        rejectPrivateWrites(Path.of("/boot"), writes);
    }

    private static void rejectPrivateWrites(Path systemPath, List<Path> writes) {
        for (Path write : writes) {
            if (write.startsWith(systemPath) || systemPath.startsWith(write)) {
                throw new IllegalArgumentException("写入白名单不能包含 Linux 系统目录：" + write);
            }
        }
    }
}
