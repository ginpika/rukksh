#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/landlock.h>
#include <linux/openat2.h>
#include <poll.h>
#include <sched.h>
#include <seccomp.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

/* Landlock ABI 3 adds truncation checks. The first eight bytes of the
 * ruleset attribute describe filesystem permissions on every supported ABI. */
static const uint64_t read_access = LANDLOCK_ACCESS_FS_READ_DIR
    | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_EXECUTE;
static const uint64_t write_access = LANDLOCK_ACCESS_FS_WRITE_FILE
    | LANDLOCK_ACCESS_FS_TRUNCATE | LANDLOCK_ACCESS_FS_REMOVE_FILE
    | LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG
    | LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_SYM
    | LANDLOCK_ACCESS_FS_REFER;
static const uint64_t file_access = LANDLOCK_ACCESS_FS_READ_FILE
    | LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_WRITE_FILE
    | LANDLOCK_ACCESS_FS_TRUNCATE;

static void fail(const char *where)
{
    perror(where);
    _exit(125);
}

static void allow_path(int rules, const char *path, uint64_t access)
{
    struct open_how how = { .flags = O_PATH | O_CLOEXEC, .resolve = RESOLVE_NO_SYMLINKS };
    int fd = syscall(SYS_openat2, AT_FDCWD, path, &how, sizeof(how));
    if (fd < 0) {
        fail(path);
    }
    struct stat entry;
    if (fstat(fd, &entry) < 0) {
        fail(path);
    }
    struct landlock_path_beneath_attr rule = {
        .parent_fd = fd,
        .allowed_access = access & (S_ISDIR(entry.st_mode) ? UINT64_MAX : file_access)
    };
    if (syscall(SYS_landlock_add_rule, rules, LANDLOCK_RULE_PATH_BENEATH, &rule, 0) < 0) {
        fail(path);
    }
    close(fd);
}

static void restrict_syscalls(void)
{
    // Landlock mediates these file operations. Metadata mutation, host IPC,
    // namespace changes and syscalls added by newer kernels stay blocked.
    static const char *const allowed[] = {
        "read", "write", "readv", "writev", "pread64", "pwrite64", "preadv", "pwritev",
        "preadv2", "pwritev2", "sendfile", "copy_file_range", "lseek",
        "open", "openat", "openat2", "creat", "close", "close_range", "dup", "dup2", "dup3",
        "pipe", "pipe2", "poll", "ppoll", "select", "pselect6",
        "stat", "lstat", "fstat", "newfstatat", "statx", "statfs", "fstatfs", "getdents", "getdents64",
        "access", "faccessat", "faccessat2", "getcwd", "chdir", "fchdir", "readlink", "readlinkat",
        "mkdir", "mkdirat", "rmdir", "unlink", "unlinkat", "rename", "renameat", "renameat2",
        "symlink", "symlinkat", "truncate", "ftruncate", "fallocate", "fsync", "fdatasync", "umask",
        "execve", "fork", "vfork", "wait4", "waitid", "exit", "exit_group",
        "getpid", "getppid", "gettid", "getuid", "geteuid", "getgid", "getegid", "getgroups",
        "getpgid", "getpgrp", "getsid", "getrlimit", "getrusage", "times", "uname",
        "brk", "mmap", "munmap", "mprotect", "pkey_mprotect", "mremap", "madvise", "msync", "mincore",
        "arch_prctl", "set_tid_address", "set_robust_list", "rseq", "futex", "futex_waitv", "membarrier",
        "rt_sigaction", "rt_sigprocmask", "rt_sigpending", "rt_sigreturn", "rt_sigsuspend",
        "rt_sigtimedwait", "sigaltstack",
        "clock_gettime", "clock_getres", "nanosleep", "clock_nanosleep", "gettimeofday", "time",
        "restart_syscall", "sched_yield", "sched_getaffinity", "getcpu", "getrandom",
        "epoll_create", "epoll_create1", "epoll_ctl", "epoll_wait", "epoll_pwait", "epoll_pwait2",
        "eventfd", "eventfd2", "timerfd_create", "timerfd_gettime", "timerfd_settime"
    };
    scmp_filter_ctx filter = seccomp_init(SCMP_ACT_ERRNO(ENOSYS));
    if (filter == NULL) {
        fail("seccomp_init");
    }
    for (size_t i = 0; i < sizeof(allowed) / sizeof(allowed[0]); i++) {
        int call = seccomp_syscall_resolve_name(allowed[i]);
        if (call < 0) {
            continue;
        }
        int result = seccomp_rule_add(filter, SCMP_ACT_ALLOW, call, 0);
        if (result < 0) {
            errno = -result;
            fail(allowed[i]);
        }
    }
    static const int fd_commands[] = { F_GETFD, F_SETFD, F_GETFL, F_SETFL, F_DUPFD, F_DUPFD_CLOEXEC };
    for (size_t i = 0; i < sizeof(fd_commands) / sizeof(fd_commands[0]); i++) {
        int result = seccomp_rule_add(filter, SCMP_ACT_ALLOW, SCMP_SYS(fcntl), 1,
                                     SCMP_A1(SCMP_CMP_EQ, fd_commands[i]));
        if (result < 0) {
            errno = -result;
            fail("seccomp fcntl filter");
        }
    }
    const uint64_t clone_flags = CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND | CLONE_THREAD
        | CLONE_SYSVSEM | CLONE_SETTLS | CLONE_PARENT_SETTID | CLONE_CHILD_SETTID
        | CLONE_CHILD_CLEARTID | CLONE_VFORK | 0xffU;
#if defined(__s390__) || defined(__s390x__) || defined(__cris__)
    const unsigned int clone_argument = 1;
#else
    const unsigned int clone_argument = 0;
#endif
    int result = seccomp_rule_add(filter, SCMP_ACT_ALLOW, SCMP_SYS(clone), 1,
                                 SCMP_CMP(clone_argument, SCMP_CMP_MASKED_EQ, ~clone_flags, 0));
    if (result < 0) {
        errno = -result;
        fail("seccomp clone filter");
    }
    result = seccomp_rule_add(filter, SCMP_ACT_ALLOW, SCMP_SYS(prlimit64), 2,
                              SCMP_A0(SCMP_CMP_EQ, 0), SCMP_A2(SCMP_CMP_EQ, 0));
    if (result < 0) {
        errno = -result;
        fail("seccomp prlimit filter");
    }
    // Language runtimes use socketpair internally. No named socket can be opened or connected.
    result = seccomp_rule_add(filter, SCMP_ACT_ALLOW, SCMP_SYS(socketpair), 1,
                              SCMP_A0(SCMP_CMP_EQ, AF_UNIX));
    if (result < 0) {
        errno = -result;
        fail("seccomp socketpair filter");
    }
    result = seccomp_load(filter);
    if (result < 0) {
        errno = -result;
        fail("seccomp_load");
    }
    seccomp_release(filter);
}

static void isolate(char **paths)
{
    if (geteuid() == 0 || getuid() == 0) {
        fputs("Local workspace requires an unprivileged service account.\n", stderr);
        _exit(125);
    }
    if (syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION) < 3) {
        fputs("Local workspace requires Linux Landlock ABI 3 or later.\n", stderr);
        _exit(125);
    }
    uint64_t attributes = read_access | write_access | LANDLOCK_ACCESS_FS_MAKE_FIFO
        | LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_BLOCK;
    int rules = syscall(SYS_landlock_create_ruleset, &attributes, sizeof(attributes), 0);
    if (rules < 0) {
        fail("landlock_create_ruleset");
    }
    allow_path(rules, "/dev/null", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_WRITE_FILE);
    while (*paths != NULL && strcmp(*paths, "--") != 0) {
        uint64_t access = read_access;
        if (strcmp(*paths, "--write") == 0) {
            access |= write_access;
        } else if (strcmp(*paths, "--read") != 0) {
            fputs("Invalid sandbox path mode.\n", stderr);
            _exit(125);
        }
        paths++;
        if (*paths == NULL || **paths != '/') {
            fputs("Expected an absolute sandbox path.\n", stderr);
            _exit(125);
        }
        allow_path(rules, *paths++, access);
    }
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0
        || syscall(SYS_landlock_restrict_self, rules, 0) < 0) {
        fail("landlock_restrict_self");
    }
    close(rules);
    restrict_syscalls();
}

static int64_t now_ms(void)
{
    struct timespec time;
    if (clock_gettime(CLOCK_MONOTONIC, &time) < 0) {
        fail("clock_gettime");
    }
    return (int64_t)time.tv_sec * 1000 + time.tv_nsec / 1000000;
}

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "--check") == 0) {
        char *empty[] = { NULL };
        isolate(empty);
        return 0;
    }
    if (argc < 4) {
        return 125;
    }
    char *end;
    long timeout = strtol(argv[1], &end, 10);
    if (*end != '\0' || timeout < 1 || timeout > INT_MAX) {
        return 125;
    }
    char **delimiter = argv + 2;
    while (*delimiter != NULL && strcmp(*delimiter, "--") != 0) {
        delimiter++;
    }
    if (*delimiter == NULL || delimiter[1] == NULL || delimiter[2] != NULL) {
        return 125;
    }
    int64_t deadline = now_ms() + timeout;
    pid_t parent = getpid();
    pid_t child = fork();
    if (child < 0) {
        fail("fork");
    }
    if (child == 0) {
        if (prctl(PR_SET_PDEATHSIG, SIGKILL) < 0 || getppid() != parent || setpgid(0, 0) < 0) {
            fail("sandbox process group");
        }
        int input = open("/dev/null", O_RDONLY);
        if (input < 0 || dup2(input, STDIN_FILENO) < 0
            || syscall(SYS_close_range, 3U, UINT_MAX, 0U) < 0) {
            fail("sandbox file descriptors");
        }
        isolate(argv + 2);
        execl("/bin/sh", "sh", "-c", delimiter[1], (char *)NULL);
        fail("/bin/sh");
    }
    setpgid(child, child);
    int result = 125;
    struct pollfd lifetime = { .fd = STDIN_FILENO, .events = POLLIN };
    for (;;) {
        siginfo_t status = { 0 };
        int waited = waitid(P_PID, child, &status, WEXITED | WNOHANG | WNOWAIT);
        if (waited < 0 && errno != EINTR) {
            break;
        }
        if (waited == 0 && status.si_pid == child) {
            result = status.si_code == CLD_EXITED ? status.si_status : 128 + status.si_status;
            break;
        }
        int64_t remaining = deadline - now_ms();
        if (remaining <= 0) {
            result = 124;
            break;
        }
        int ready = poll(&lifetime, 1, remaining < 50 ? (int)remaining : 50);
        if (ready > 0 || (ready < 0 && errno != EINTR)) {
            break;
        }
    }
    // Keep the leader unreaped until the whole group has been signalled.
    kill(-child, SIGKILL);
    kill(child, SIGKILL);
    while (waitpid(child, NULL, 0) < 0 && errno == EINTR) {}
    return result;
}
