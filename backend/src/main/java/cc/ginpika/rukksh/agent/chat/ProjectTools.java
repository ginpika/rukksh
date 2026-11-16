package cc.ginpika.rukksh.agent.chat;

import cc.ginpika.rukksh.agent.member.AgentDirectory;
import cc.ginpika.rukksh.agent.roundtable.CollaborationPlan;
import cc.ginpika.rukksh.agent.roundtable.CollaborationService;
import cc.ginpika.rukksh.agent.roundtable.CollaborationStore;
import cc.ginpika.rukksh.agent.roundtable.CollaborationTaskLifecycle;
import cc.ginpika.rukksh.agent.roundtable.CollaborationWorkspaceBinding;
import cc.ginpika.rukksh.agent.roundtable.RoundtableSessionStore;
import cc.ginpika.rukksh.agent.roundtable.RoundtableTodoStore;
import cc.ginpika.rukksh.ai.core.UserScope;
import cc.ginpika.rukksh.ai.core.tool.work.BindWorkProjectWorkspaceTool;
import cc.ginpika.rukksh.ai.core.tool.work.CreateWorkProjectTool;
import cc.ginpika.rukksh.ai.core.tool.work.ListWorkProjectsTool;
import cc.ginpika.rukksh.ai.core.tool.work.ManageWorkCollaborationTool;
import cc.ginpika.rukksh.ai.core.tool.work.ReadWorkProjectTool;
import cc.ginpika.rukksh.ai.core.tool.work.SaveWorkProjectDocumentTool;
import cc.ginpika.rukksh.ai.core.tool.work.SetWorkProjectMembersTool;
import cc.ginpika.rukksh.ai.core.tool.work.UpdateWorkProjectTool;
import cc.ginpika.rukksh.coding.api.CodingDtos.OpenProject;
import cc.ginpika.rukksh.project.ProjectKnowledgeStore;
import cc.ginpika.rukksh.project.ProjectStore;
import cc.ginpika.rukksh.project.ProjectStore.ProjectRow;
import cc.ginpika.rukksh.todo.TodoService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Project catalog and shared project data exposed to authenticated user conversations. */
@Service
public class ProjectTools {
    private static final Set<String> NAMES = Set.of(ListWorkProjectsTool.NAME, ReadWorkProjectTool.NAME,
            CreateWorkProjectTool.NAME, UpdateWorkProjectTool.NAME, SaveWorkProjectDocumentTool.NAME,
            SetWorkProjectMembersTool.NAME, ManageWorkCollaborationTool.NAME, BindWorkProjectWorkspaceTool.NAME);
    private static final Set<String> STATUSES = Set.of("active", "paused", "archived");

    private final ObjectMapper json;
    private final ProjectStore projects;
    private final ProjectWorkflowService workflows;
    private final ProjectKnowledgeStore knowledge;
    private final CollaborationWorkspaceBinding workspaces;
    private final TodoService personalTodos;
    private final CollaborationService collaboration;
    private final CollaborationTaskLifecycle taskLifecycle;
    private final CollaborationStore collaborationData;
    private final RoundtableSessionStore sessions;
    private final RoundtableTodoStore board;
    private final CollaborationPlan plans;
    private final AgentDirectory agents;

    public ProjectTools(ObjectMapper json, ProjectStore projects, ProjectWorkflowService workflows,
                        ProjectKnowledgeStore knowledge, CollaborationWorkspaceBinding workspaces, TodoService personalTodos,
                        @Lazy CollaborationService collaboration, @Lazy CollaborationTaskLifecycle taskLifecycle,
                        CollaborationStore collaborationData,
                        RoundtableSessionStore sessions, RoundtableTodoStore board, CollaborationPlan plans,
                        AgentDirectory agents) {
        this.json = json;
        this.projects = projects;
        this.workflows = workflows;
        this.knowledge = knowledge;
        this.workspaces = workspaces;
        this.personalTodos = personalTodos;
        this.collaboration = collaboration;
        this.taskLifecycle = taskLifecycle;
        this.collaborationData = collaborationData;
        this.sessions = sessions;
        this.board = board;
        this.plans = plans;
        this.agents = agents;
    }

    public static boolean handles(String name) { return name != null && NAMES.contains(name); }

    public String run(String name, JsonNode args) {
        String user = UserScope.get();
        if (user == null || user.isBlank()) return error(HttpStatus.UNAUTHORIZED.value(), "需要已认证的用户身份");
        if (args == null || !args.isObject()) return error(400, "工具参数必须是 JSON 对象");
        try {
            if (ListWorkProjectsTool.NAME.equals(name)) return json.valueToTree(catalog(user, args)).toString();
            if (CreateWorkProjectTool.NAME.equals(name)) {
                var created = workflows.createVisibleProject(user, required(args, "name", 120), kind(args),
                        optionalBoolean(args, "narrative"), text(args, "note", 4000));
                return projectJson(created).toString();
            }
            ProjectRow project = projects.findVisible(required(args, "project_id", 200), user)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "项目不存在或不可访问"));
            Object result = switch (name) {
                case ReadWorkProjectTool.NAME -> read(user, project, args);
                case UpdateWorkProjectTool.NAME -> update(project, args);
                case SaveWorkProjectDocumentTool.NAME -> saveDocument(user, project.id(), args);
                case SetWorkProjectMembersTool.NAME -> setMembers(project.id(), args);
                case ManageWorkCollaborationTool.NAME -> manageCollaboration(project.id(), args);
                case BindWorkProjectWorkspaceTool.NAME -> bindWorkspace(project.id(), args);
                default -> throw new IllegalArgumentException("未知的项目工具");
            };
            return json.valueToTree(result).toString();
        } catch (ResponseStatusException error) {
            return error(error.getStatusCode().value(), error.getReason());
        } catch (IllegalArgumentException error) {
            return error(400, error.getMessage());
        }
    }

    private ObjectNode catalog(String user, JsonNode args) {
        int offset = offset(args);
        int limit = limit(args);
        String query = text(args, "query", 300);
        var page = projects.catalog(user, query == null ? "" : query.strip(), text(args, "status", 80), kind(args), offset, limit);
        return countedPage(page.items(), page.total(), offset, limit);
    }

    private Object read(String user, ProjectRow project, JsonNode args) {
        String id = project.id();
        String action = text(args, "action", 32);
        int offset = offset(args);
        int limit = limit(args);
        return switch (action == null ? "detail" : action) {
            case "detail" -> detail(user, project);
            case "workspaces" -> {
                var list = collaboration.workspaces();
                int start = Math.min(offset, list.size());
                int end = start + Math.min(limit, list.size() - start);
                var items = list.subList(start, end).stream().map(workspace -> json.createObjectNode()
                        .put("id", workspace.id()).put("name", workspace.name()).put("kind", workspace.kind())
                        .put("enabled", workspace.enabled())).toList();
                yield countedPage(items, list.size(), offset, limit);
            }
            case "tasks" -> page(sessions.projectTasks(id, offset, limit + 1), offset, limit);
            case "board" -> readBoard(id, args, offset, limit);
            case "board_item" -> {
                var session = projectSession(id, required(args, "session_id", 200));
                yield board.todo(required(args, "todo_id", 200)).filter(item -> session.id().equals(item.sessionId()))
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "任务板条目不存在"));
            }
            case "issue" -> projectIssue(id, required(args, "issue_id", 200));
            case "progress" -> {
                var progress = knowledge.progress(id, offset, limit);
                ObjectNode result = json.valueToTree(progress);
                result.set("work", countedPage(progress.work().items(), progress.work().total(), offset, limit));
                yield result;
            }
            case "documents" -> {
                var documents = knowledge.list(id, text(args, "query", 300),
                        Boolean.TRUE.equals(optionalBoolean(args, "include_retired")), offset, limit);
                yield countedPage(documents.items(), documents.total(), offset, limit);
            }
            case "document" -> readDocument(id, args);
            case "document_history" -> page(knowledge.history(id, required(args, "key", 120), offset, limit + 1), offset, limit);
            default -> throw new IllegalArgumentException("未知的项目读取 action");
        };
    }

    private ObjectNode detail(String user, ProjectRow project) {
        var result = projectJson(project);
        var members = result.putArray("members");
        for (String id : collaborationData.projectMembers(project.id())) {
            members.addObject().put("id", id).put("name", agents.nameOf(id));
        }
        personalTodos.projectSummaries(user).stream().filter(summary -> project.id().equals(summary.id())).findFirst()
                .ifPresent(summary -> result.set("personalTodoSummary", json.valueToTree(summary)));
        workspaces.find(project.id()).ifPresent(workspace -> result.set("workspace", workspaceJson(workspace)));
        return result;
    }

    private ObjectNode workspaceJson(CollaborationWorkspaceBinding.Location workspace) {
        var binding = json.createObjectNode().put("projectId", workspace.projectId()).put("enabled", workspace.enabled());
        if (workspace.workspaceId() != null) {
            binding.put("repositoryId", workspace.repositoryId()).put("workspaceId", workspace.workspaceId())
                    .put("workspaceName", workspace.workspaceName()).put("directory", workspace.directory());
        }
        return binding;
    }

    private ObjectNode bindWorkspace(String project, JsonNode args) {
        String directory = text(args, "directory", 4096);
        if (directory == null || directory.isBlank()) throw new IllegalArgumentException("请提供现有目录 directory");
        var request = new OpenProject(required(args, "workspace_id", 200), directory, null, false, null);
        return workspaceJson(collaboration.bindWorkspace(project, request));
    }

    private ObjectNode readBoard(String project, JsonNode args, int offset, int limit) {
        var session = projectSession(project, required(args, "session_id", 200));
        String id = session.id();
        var result = json.createObjectNode().put("sessionId", id).put("title", session.title()).put("archived", sessions.archived(id));
        plans.find(id).ifPresent(plan -> result.set("plan", json.valueToTree(plan)));
        var items = page(board.page(id, offset, limit + 1), offset, limit);
        for (JsonNode node : items.path("items")) {
            ObjectNode item = (ObjectNode) node;
            excerpt(item, "detail", 500);
            excerpt(item, "result", 500);
            excerpt(item, "blockReason", 500);
        }
        result.set("todos", items);
        var issues = page(collaborationData.issuesForTask(id, offset, limit + 1), offset, limit);
        for (JsonNode issue : issues.path("items")) excerpt((ObjectNode) issue, "conclusion", 500);
        result.set("issues", issues);
        return result;
    }

    private RoundtableSessionStore.SessionRow projectSession(String project, String sessionId) {
        return sessions.findById(sessionId).filter(session -> project.equals(session.projectId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "协作会话不属于当前项目"));
    }

    private CollaborationStore.Issue projectIssue(String project, String id) {
        var issue = collaborationData.issue(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "议题不存在"));
        projectSession(project, issue.parentSessionId());
        projectSession(project, issue.sessionId());
        return issue;
    }

    private ObjectNode readDocument(String project, JsonNode args) {
        int start = number(args, "char_offset", 0, 0, Integer.MAX_VALUE);
        int size = number(args, "char_limit", 6000, 1, 8000);
        Integer version = args.has("version") ? number(args, "version", 0, 1, Integer.MAX_VALUE) : null;
        return documentPage(knowledge.read(project, required(args, "key", 120), version), start, size);
    }

    private ObjectNode update(ProjectRow project, JsonNode args) {
        String status = text(args, "status", 80);
        if (status != null && !STATUSES.contains(status)) throw new IllegalArgumentException("未知的项目状态");
        String name = args.has("name") ? required(args, "name", 120) : null;
        return projectJson(workflows.updateProject(project.id(), name, kind(args), optionalBoolean(args, "narrative"),
                status, text(args, "note", 4000)));
    }

    private ObjectNode saveDocument(String user, String project, JsonNode args) {
        String key = required(args, "key", 120);
        if (!args.has("expected_version")) throw new IllegalArgumentException("请提供 expected_version");
        int expected = number(args, "expected_version", 0, 0, Integer.MAX_VALUE);
        var previous = expected == 0 ? null : knowledge.read(project, key, null);
        if (previous != null && previous.version() != expected) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "文档已有新版本，请重新读取后合并");
        }
        String kind = text(args, "kind", 24);
        String title = text(args, "title", 160);
        String content = text(args, "content", 40000);
        Boolean retired = optionalBoolean(args, "retired");
        var write = new ProjectKnowledgeStore.Write(kind == null && previous != null ? previous.kind() : kind,
                title == null && previous != null ? previous.title() : title,
                content == null && previous != null ? previous.content() : content, expected,
                retired == null && previous != null ? Boolean.valueOf(previous.retired()) : retired);
        var saved = knowledge.save(project, key, write, null, "user:" + user);
        ObjectNode result = json.valueToTree(saved);
        result.remove("content");
        return result;
    }

    private ObjectNode setMembers(String project, JsonNode args) {
        ObjectNode result = json.createObjectNode().put("projectId", project);
        result.set("memberIds", json.valueToTree(collaboration.members(project, memberIds(args))));
        return result;
    }

    private Object manageCollaboration(String project, JsonNode args) {
        String action = required(args, "action", 32);
        return switch (action) {
            case "create_task" -> collaboration.task(project, required(args, "title", 160), memberIds(args),
                    text(args, "coordinator_id", 200));
            case "archive_task", "restore_task" -> {
                var session = projectSession(project, required(args, "session_id", 200));
                boolean archived = "archive_task".equals(action);
                taskLifecycle.archive(session.id(), archived);
                yield json.createObjectNode().put("sessionId", session.id()).put("archived", archived);
            }
            case "create_issue" -> {
                var session = projectSession(project, required(args, "session_id", 200));
                yield collaboration.createIssue(session.id(), required(args, "title", 160), memberIds(args));
            }
            case "resolve_issue" -> {
                var issue = projectIssue(project, required(args, "issue_id", 200));
                yield collaboration.resolve(issue.id(), required(args, "conclusion", 8000));
            }
            default -> throw new IllegalArgumentException("未知的项目协作 action");
        };
    }

    private static List<String> memberIds(JsonNode args) {
        var members = args.path("member_ids");
        if (!members.isArray() || members.isEmpty()) throw new IllegalArgumentException("请提供完整的 member_ids 清单");
        var ids = new ArrayList<String>();
        for (JsonNode value : members) {
            if (!value.isTextual() || value.textValue().isBlank()) throw new IllegalArgumentException("成员 ID 必须是非空字符串");
            ids.add(value.textValue());
        }
        return ids;
    }

    private ObjectNode projectJson(ProjectRow project) {
        ObjectNode result = json.valueToTree(project);
        result.remove("userId");
        return result;
    }

    private ObjectNode documentPage(ProjectKnowledgeStore.Document document, int start, int size) {
        String content = document.content();
        int from = Math.min(start, content.length());
        int to = from + Math.min(size, content.length() - from);
        if (from > 0 && from < content.length() && Character.isLowSurrogate(content.charAt(from))
                && Character.isHighSurrogate(content.charAt(from - 1))) {
            throw new IllegalArgumentException("char_offset 落在同一个字符中间，请使用上一页的 next_offset");
        }
        if (to < content.length() && to > from && Character.isHighSurrogate(content.charAt(to - 1))
                && Character.isLowSurrogate(content.charAt(to))) {
            to = to - from == 1 ? to + 1 : to - 1;
        }
        var result = (ObjectNode) json.valueToTree(document);
        result.put("content", content.substring(from, to)).put("total_chars", content.length());
        if (to < content.length()) result.put("next_offset", to);
        return result;
    }

    private ObjectNode page(List<?> items, int offset, int limit) {
        boolean more = items.size() > limit;
        ObjectNode result = json.createObjectNode().put("offset", offset).put("has_more", more);
        result.set("items", json.valueToTree(items.subList(0, Math.min(items.size(), limit))));
        if (more) result.put("next_offset", offset + limit);
        return result;
    }

    private ObjectNode countedPage(List<?> items, long total, int offset, int limit) {
        boolean more = !items.isEmpty() && (long) offset + items.size() < total;
        ObjectNode result = json.createObjectNode().put("offset", offset).put("limit", limit)
                .put("total", total).put("has_more", more);
        result.set("items", json.valueToTree(items));
        if (more) result.put("next_offset", offset + items.size());
        return result;
    }

    private static void excerpt(ObjectNode item, String field, int size) {
        String value = item.path(field).textValue();
        if (value != null && value.length() > size) item.put(field, value.substring(0, size) + "…");
    }

    private static int offset(JsonNode args) { return number(args, "offset", 0, 0, Integer.MAX_VALUE - 50); }
    private static int limit(JsonNode args) { return number(args, "limit", 10, 1, 50); }

    private static int number(JsonNode args, String key, int fallback, int min, int max) {
        if (!args.has(key)) return fallback;
        JsonNode value = args.path(key);
        if (!value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() < min || value.intValue() > max) {
            throw new IllegalArgumentException(key + " 超出支持范围");
        }
        return value.intValue();
    }

    private static String kind(JsonNode args) {
        return args.has("kind") ? required(args, "kind", 80).toLowerCase(Locale.ROOT) : null;
    }

    private static String required(JsonNode args, String key, int max) {
        String value = text(args, key, max);
        if (value == null || value.isBlank()) throw new IllegalArgumentException(key + " 必须是非空字符串");
        return value.strip();
    }

    private static String text(JsonNode args, String key, int max) {
        if (!args.has(key)) return null;
        JsonNode value = args.path(key);
        if (!value.isTextual() || value.textValue().length() > max) {
            throw new IllegalArgumentException(key + " 必须是字符串，且最多 " + max + " 字");
        }
        return value.textValue();
    }

    private static Boolean optionalBoolean(JsonNode args, String key) {
        if (!args.has(key)) return null;
        JsonNode value = args.path(key);
        if (!value.isBoolean()) throw new IllegalArgumentException(key + " 必须是布尔值");
        return value.booleanValue();
    }

    private String error(int status, String reason) {
        return json.createObjectNode().put("status", status).put("error", reason == null ? "项目操作未完成" : reason).toString();
    }
}
