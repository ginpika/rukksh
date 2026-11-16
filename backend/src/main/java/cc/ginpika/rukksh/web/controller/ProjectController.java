package cc.ginpika.rukksh.web.controller;

import cc.ginpika.rukksh.project.ProjectStore;
import cc.ginpika.rukksh.project.ProjectStore.ProjectRow;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

/**
 * 项目 API（memory-v5 §10）：项目的增删改查。项目是记忆归属的作用域锚点——会话绑项目后，
 * 其记忆按项目隔离；创作类项目（narrative=1）的域内记忆永不升级为用户画像。
 */
@RestController
@RequestMapping("/api/projects")
public class ProjectController {

    private final ProjectStore projects;
    private final cc.ginpika.rukksh.agent.chat.ProjectWorkflowService workflows;

    public ProjectController(ProjectStore projects, cc.ginpika.rukksh.agent.chat.ProjectWorkflowService workflows) {
        this.projects = projects;
        this.workflows=workflows;
    }

    @GetMapping
    public List<ProjectRow> list() {
        return projects.list();
    }

    @GetMapping("/{id}")
    public ProjectRow get(@PathVariable String id) {
        return projects.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "项目不存在: " + id));
    }

    @PostMapping
    public ProjectRow create(@RequestBody ProjectRequest req) {
        String name = req == null || req.name() == null ? "" : req.name().trim();
        if (name.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "项目名不能为空");
        }
        return workflows.createProject(name,req.kind(),req.narrative(),req.note());
    }

    @PutMapping("/{id}")
    public ProjectRow update(@PathVariable String id, @RequestBody ProjectRequest req) {
        return workflows.updateProject(id, req == null ? null : req.name(), req == null ? null : req.kind(),
                req == null ? null : req.narrative(), req == null ? null : req.status(), req == null ? null : req.note());
    }

    @DeleteMapping("/{id}")
    public CountResult delete(@PathVariable String id) {
        return new CountResult(projects.delete(id));
    }

    /** 新建 / 编辑请求体 */
    public record ProjectRequest(String name, String kind, Boolean narrative, String status, String note) {
    }

    /** 变更条数结果 */
    public record CountResult(int changed) {
    }

    /** 由 kind 推断是否创作 / 虚构类 */
    static final class ProjectKinds {
        private ProjectKinds() {
        }

        static boolean narrative(String kind) {
            if (kind == null) {
                return false;
            }
            return switch (kind.toLowerCase()) {
                case "novel", "fiction", "rpg", "story" -> true;
                default -> false;
            };
        }
    }
}
