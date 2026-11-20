package cc.ginpika.rukksh.ai.computer.terminal;

import cc.ginpika.rukksh.shared.error.DomainException;

import cc.ginpika.rukksh.ai.computer.terminal.exec.LocalExecTarget;
import cc.ginpika.rukksh.ai.computer.terminal.store.TerminalStore;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/** Human shells start at the workspace's configured directory and need no coding project. */
@Service
public class WorkspaceTerminals extends InteractiveTerminals {
    private final TerminalStore store;
    private final Map<String,ExecTarget> targets;

    public WorkspaceTerminals(TerminalStore store,List<ExecTarget> targets){
        this.store=store;
        this.targets=targets.stream().collect(Collectors.toUnmodifiableMap(ExecTarget::kind,Function.identity()));
    }

    @Override protected Object scope(String owner,String id,boolean enabled){
        var target=store.targetById(id).orElse(null);
        // Listing/cleanup remain possible after a workspace is disabled or deleted.
        if(!enabled){return target;}
        if(target==null){throw new DomainException(DomainException.ErrorKind.NOT_FOUND,"工作空间已删除");}
        if(!target.enabled()){throw new DomainException(DomainException.ErrorKind.CONFLICT,"工作空间未启用，请先启用后打开 Shell");}
        if(LocalExecTarget.KIND.equals(target.kind()) || !targets.containsKey(target.kind())){
            throw new DomainException(DomainException.ErrorKind.BAD_REQUEST,"工作空间类型不支持交互终端");
        }
        return target;
    }

    @Override protected ExecTarget.Shell openShell(String owner,String id,int cols,int rows) throws IOException {
        var target=(TerminalStore.TargetRow)scope(owner,id,true);
        String prefix=target.workdir()==null || target.workdir().isBlank()?"":"cd -- "+ExecTarget.quote(target.workdir())+" || exit 72; ";
        // Keep the IDE's bash when available; minimal workspace images can use sh.
        return targets.get(target.kind()).openShell(target,prefix+"if command -v bash >/dev/null 2>&1; then exec bash -i; else exec sh -i; fi",cols,rows);
    }
}
