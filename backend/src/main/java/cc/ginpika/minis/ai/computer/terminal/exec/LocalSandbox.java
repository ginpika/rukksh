package cc.ginpika.minis.ai.computer.terminal.exec;

import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/** Local directory validation and the macOS kernel policy. */
public final class LocalSandbox {
    private static final String SEATBELT = "/usr/bin/sandbox-exec";
    private static final String PERL = "/usr/bin/perl";
    private static final int MAX_ROOTS = 32;
    private static final int MAX_CHECKED_ENTRIES = 200_000;

    // Keep the trusted supervisor outside the command sandbox so it can kill the whole
    // process group. The sandbox forbids changing groups once the shell starts.
    private static final String SUPERVISE = """
            use strict;
            use warnings;
            use IO::Select;
            use POSIX qw(setpgid WNOHANG WIFEXITED WEXITSTATUS WTERMSIG);
            use Time::HiRes qw(clock_gettime CLOCK_MONOTONIC);
            my $limit = shift(@ARGV) / 1000;
            my $owner = getppid();
            exit 125 if $owner == 1;
            my $cancelled = 0;
            $SIG{TERM} = $SIG{INT} = $SIG{HUP} = sub { $cancelled = 1 };
            my $child = fork();
            die "fork: $!" unless defined $child;
            if ($child == 0) {
                defined setpgid(0, 0) or die "setpgid: $!";
                open STDIN, '<', '/dev/null' or die "stdin: $!";
                exec { $ARGV[0] } @ARGV or die "sandbox-exec: $!";
            }
            setpgid($child, $child);
            my $lifetime = IO::Select->new(\\*STDIN);
            my $deadline = clock_gettime(CLOCK_MONOTONIC) + $limit;
            my $status;
            my $timed_out = 0;
            while (!$cancelled && getppid() == $owner) {
                if (waitpid($child, WNOHANG) == $child) {
                    $status = $?;
                    last;
                }
                my $remaining = $deadline - clock_gettime(CLOCK_MONOTONIC);
                if ($remaining <= 0) { $timed_out = 1; last; }
                last if $lifetime->can_read($remaining < 0.05 ? $remaining : 0.05);
            }
            kill 'KILL', -$child;
            if (!defined $status) {
                kill 'KILL', $child;
                waitpid($child, 0);
                exit($timed_out ? 124 : 125);
            }
            exit(WIFEXITED($status) ? WEXITSTATUS($status) : 128 + WTERMSIG($status));
            """;

    private LocalSandbox() {}

    static boolean hasExecutables() {
        return Files.isExecutable(Path.of(SEATBELT)) && Files.isExecutable(Path.of(PERL));
    }

    public static Path resolveDirectory(String value) {
        if (value == null || value.isBlank() || value.length() > 1024
                || value.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("请填写有效的本机绝对目录");
        }
        Path path = Path.of(value);
        if (!path.isAbsolute()) {
            throw new IllegalArgumentException("本机路径必须是绝对目录：" + value);
        }
        try {
            Path real = path.toRealPath();
            if (!Files.isDirectory(real)) {
                throw new IllegalArgumentException("本机路径必须是目录：" + value);
            }
            return real;
        } catch (IOException error) {
            throw new IllegalArgumentException("本机目录不存在或不可访问：" + value, error);
        }
    }

    public static List<String> validateWritePaths(List<String> paths) {
        if (paths == null || paths.isEmpty()) {
            return List.of();
        }
        if (paths.size() > MAX_ROOTS) {
            throw new IllegalArgumentException("本机写入白名单最多支持 " + MAX_ROOTS + " 个目录");
        }
        var roots = new LinkedHashSet<String>();
        for (String value : paths) {
            Path path = resolveDirectory(value);
            if (path.getParent() == null) {
                throw new IllegalArgumentException("不能将文件系统根目录加入写入白名单");
            }
            roots.add(path.toString());
        }
        return List.copyOf(roots);
    }

    static Path storedDirectory(String value) {
        Path real = resolveDirectory(value);
        if (!real.toString().equals(value)) {
            throw new IllegalArgumentException("本机目录位置已变化，请重新保存工作空间：" + value);
        }
        return real;
    }

    static void inspectWriteRoots(List<Path> roots) {
        // Seatbelt denies creating hard links. Existing aliases also need checking because
        // writing a multiply-linked inode changes every name for that file.
        var visitor = new SimpleFileVisitor<Path>() {
            private int entries;

            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attributes) {
                countEntry();
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attributes) throws IOException {
                countEntry();
                if (attributes.isSymbolicLink()) {
                    return FileVisitResult.CONTINUE;
                }
                if (!attributes.isRegularFile()) {
                    throw new IllegalArgumentException("本机写入目录中包含特殊文件：" + file);
                }
                int links = ((Number) Files.getAttribute(file, "unix:nlink", LinkOption.NOFOLLOW_LINKS)).intValue();
                if (links > 1) {
                    throw new IllegalArgumentException("本机写入目录中包含硬链接：" + file);
                }
                return FileVisitResult.CONTINUE;
            }

            private void countEntry() {
                if (++entries > MAX_CHECKED_ENTRIES) {
                    throw new IllegalArgumentException("本机写入目录过大，请选择更小的子目录");
                }
            }
        };
        try {
            for (Path root : roots) {
                Files.walkFileTree(root, visitor);
            }
        } catch (IOException error) {
            throw new IllegalArgumentException("无法验证本机写入目录：" + error.getMessage(), error);
        }
    }

    static ProcessBuilder command(Path workdir, List<Path> writes, List<Path> privatePaths,
                                  long timeoutMs, String command) {
        var args = new ArrayList<>(List.of(PERL, "-e", SUPERVISE, "--", Long.toString(timeoutMs), SEATBELT));
        var policy = new StringBuilder("""
                (version 1)
                (deny default)
                (allow process-exec* process-fork file-read* file-map-executable)
                (allow file-test-existence)
                (allow signal (target same-sandbox))
                (allow syscall-unix)
                (deny syscall-unix (syscall-number SYS_setsid SYS_setpgid SYS_sysctl))
                (allow sysctl-read (sysctl-name-prefix "hw.") (sysctl-name "kern.osrelease" "kern.osversion" "kern.ostype"))
                """);
        for (int i = 0; i < writes.size(); i++) {
            String name = "WRITE_" + i;
            args.addAll(List.of("-D", name + "=" + writes.get(i)));
            policy.append("(allow file-write* (subpath (param \"").append(name).append("\")))\n");
        }
        for (int i = 0; i < privatePaths.size(); i++) {
            String name = "PRIVATE_" + i;
            args.addAll(List.of("-D", name + "=" + privatePaths.get(i)));
            policy.append("(deny file-read* file-write* file-map-executable process-exec* (subpath (param \"")
                    .append(name).append("\")))\n");
        }
        policy.append("""
                (deny file-link file-write-setugid)
                (deny file-write* (vnode-type BLOCK-DEVICE CHARACTER-DEVICE SOCKET))
                (allow file-write-data (require-all (literal "/dev/null") (vnode-type CHARACTER-DEVICE)))
                """);
        args.addAll(List.of("-p", policy.toString(), "/bin/sh", "-c", command));
        var builder = new ProcessBuilder(args).directory(workdir.toFile());
        configureEnvironment(builder, workdir, writes, "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin",
                "en_US.UTF-8");
        return builder;
    }

    static void configureEnvironment(ProcessBuilder builder, Path workdir, List<Path> writes, String path,
                                     String locale) {
        var env = builder.environment();
        env.clear();
        env.put("PATH", path);
        env.put("HOME", workdir.toString());
        if (!writes.isEmpty()) {
            env.put("TMPDIR", writes.getFirst().toString());
        }
        env.put("LC_ALL", locale);
        env.put("GIT_CONFIG_NOSYSTEM", "1");
        env.put("GIT_CONFIG_GLOBAL", "/dev/null");
        env.put("GIT_TERMINAL_PROMPT", "0");
        env.put("GIT_PAGER", "cat");
    }
}
