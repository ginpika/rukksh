package cc.ginpika.rukksh.coding.runner;

import cc.ginpika.rukksh.shared.error.DomainException;

import cc.ginpika.rukksh.ai.computer.terminal.ExecTarget;
import cc.ginpika.rukksh.ai.computer.terminal.InteractiveTerminals;
import cc.ginpika.rukksh.coding.workspace.WorkspaceProjects;
import java.io.IOException;
import org.springframework.stereotype.Service;

/** Human project terminals never share an Agent's execution checkout. */
@Service
public class CodingTerminals extends InteractiveTerminals {
    private final WorkspaceProjects projects;
    public CodingTerminals(WorkspaceProjects projects){this.projects=projects;}
    @Override protected Object scope(String owner,String id,boolean enabled){
        var project=projects.project(owner,id);
        if(enabled && !project.enabled()){throw new DomainException(DomainException.ErrorKind.CONFLICT,"工作空间已禁用或连接配置发生变化");}
        return project.id();
    }
    @Override protected ExecTarget.Shell openShell(String owner,String id,int cols,int rows) throws IOException {return projects.openShell(owner,id,cols,rows);}
}
