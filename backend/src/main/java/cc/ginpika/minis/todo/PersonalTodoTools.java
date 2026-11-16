package cc.ginpika.minis.todo;

import static cc.ginpika.minis.todo.TodoDtos.*;

import cc.ginpika.minis.ai.core.UserScope;
import cc.ginpika.minis.ai.core.tool.todo.ManagePersonalTodosTool;
import cc.ginpika.minis.ai.core.tool.todo.ReadPersonalTodosTool;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.DateTimeException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.function.Function;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Adapter for the signed-in user's personal work data. Runtime dispatch authorizes the current turn. */
@Service
public class PersonalTodoTools {
    private final TodoService todos;
    private final ObjectMapper json;

    public PersonalTodoTools(TodoService todos, ObjectMapper json) {
        this.todos = todos;
        this.json = json;
    }

    public static boolean handles(String name) {
        return ReadPersonalTodosTool.NAME.equals(name) || ManagePersonalTodosTool.NAME.equals(name);
    }

    public String execute(String name, JsonNode args) {
        String owner = UserScope.get();
        if (owner == null || owner.isBlank()) return error("需要已认证的用户身份", 401);
        if (args == null || !args.isObject()) return error("工具参数必须是 JSON 对象", 400);
        try {
            String action = requiredText(args, "action");
            Object result = switch (name) {
                case ReadPersonalTodosTool.NAME -> read(owner, action, args);
                case ManagePersonalTodosTool.NAME -> {
                    requiredText(args, "basis");
                    yield write(owner, action, args);
                }
                default -> throw invalid("未知的个人待办工具");
            };
            return json.valueToTree(result).toString();
        } catch (ResponseStatusException error) {
            return error(error.getReason() == null ? "待办操作未完成" : error.getReason(), error.getStatusCode().value());
        } catch (IllegalArgumentException error) {
            return error(error.getMessage(), 400);
        }
    }

    private Object read(String owner, String action, JsonNode args) {
        int offset = integer(args, "offset", 0, 0, Integer.MAX_VALUE - 50);
        int limit = integer(args, "limit", 10, 1, 50);
        String project = text(args, "project_id", false);
        return switch (action) {
            case "overview" -> overview(todos.overview(owner, zone(args), project), offset, limit);
            case "list" -> {
                String query = text(args, "query", false);
                if (query != null && query.length() > 300) throw invalid("query 最多 300 字");
                List<Item> items = todos.list(owner, project, text(args, "state", false), query, limit + 1, offset);
                yield page(items, 0, limit, offset, this::itemSummary);
            }
            case "detail" -> detail(todos.detail(owner, requiredText(args, "todo_id")), offset, limit);
            case "focus" -> todos.focusDetail(owner, requiredText(args, "focus_id"));
            case "day" -> day(todos.day(owner, text(args, "day", false), zone(args), project), offset, limit);
            case "review" -> review(todos.review(owner, requiredText(args, "month"), zone(args), project), offset, limit);
            case "projects" -> page(todos.projectSummaries(owner).stream()
                    .filter(summary -> project == null || project.isBlank() || project.equals(summary.id())).toList(),
                    offset, limit, offset, json::valueToTree);
            case "day_note" -> todos.dayNote(owner, requiredText(args, "day"));
            default -> throw invalid("未知的个人待办查询 action");
        };
    }

    private Object write(String owner, String action, JsonNode args) {
        return switch (action) {
            case "create" -> todos.create(owner, new ItemRequest(requiredText(args, "title"), text(args, "note", false),
                    text(args, "project_id", true), text(args, "planned_on", true), time(args, "due_at", true), null));
            case "update" -> {
                requireAny(args, "title", "note", "project_id", "planned_on", "due_at");
                yield todos.patch(owner, requiredText(args, "todo_id"), new ItemPatch(text(args, "title", false),
                        text(args, "note", false), text(args, "project_id", true), args.has("project_id"),
                        text(args, "planned_on", true), args.has("planned_on"), time(args, "due_at", true),
                        args.has("due_at"), version(args, 0)));
            }
            case "complete", "drop", "reopen" -> todos.transition(owner, requiredText(args, "todo_id"),
                    new TransitionRequest(action, version(args, 0)));
            case "start_timer" -> {
                if (!args.has("expected_active_id")) throw invalid("expected_active_id 必填，无活动计时传 null");
                String active = text(args, "expected_active_id", true);
                if (active != null && active.isBlank()) throw invalid("expected_active_id 必须是计时记录 ID 或 null");
                yield todos.start(owner, requiredText(args, "todo_id"), new StartRequest(active));
            }
            case "stop_timer" -> todos.stop(owner, requiredText(args, "focus_id"));
            case "add_focus" -> todos.addFocus(owner, new FocusRequest(requiredText(args, "todo_id"),
                    requiredTime(args, "started_at"), requiredTime(args, "ended_at"), text(args, "note", false), null));
            case "update_focus" -> {
                requireAny(args, "started_at", "ended_at", "note");
                yield todos.patchFocus(owner, requiredText(args, "focus_id"), new FocusPatch(time(args, "started_at", false),
                        time(args, "ended_at", false), text(args, "note", false), version(args, 0)));
            }
            case "delete_focus" -> todos.deleteFocus(owner, requiredText(args, "focus_id"), version(args, 0));
            case "save_day_note" -> {
                String body = text(args, "body", false);
                if (body == null) throw invalid("body 必填，传空字符串可清空每日记录");
                yield todos.saveNote(owner, requiredText(args, "day"), zone(args), new NoteRequest(body, version(args, -1)));
            }
            default -> throw invalid("未知的个人待办修改 action");
        };
    }

    private ObjectNode overview(Overview data, int offset, int limit) {
        ObjectNode out = json.createObjectNode().put("today", data.today()).put("zone", data.zone())
                .put("now", data.now()).put("dayStart", data.dayStart()).put("dayEnd", data.dayEnd());
        out.set("active", data.active() == null ? json.nullNode() : focusSummary(data.active()));
        out.set("dayNote", json.valueToTree(data.dayNote()));
        out.set("items", page(data.items(), offset, limit, offset, this::itemSummary));
        out.set("todayFocus", page(data.todayFocus(), offset, limit, offset, this::focusSummary));
        out.set("projects", page(data.projects(), offset, limit, offset, json::valueToTree));
        return out;
    }

    private ObjectNode detail(Detail data, int offset, int limit) {
        ObjectNode out = json.createObjectNode();
        out.set("item", json.valueToTree(data.item()));
        out.set("focus", page(data.focus(), offset, limit, offset, this::focusSummary));
        out.set("events", page(data.events(), offset, limit, offset, json::valueToTree));
        return out;
    }

    private ObjectNode day(DayWork data, int offset, int limit) {
        ObjectNode out = json.createObjectNode().put("day", data.day()).put("zone", data.zone())
                .put("now", data.now()).put("rangeStart", data.rangeStart()).put("rangeEnd", data.rangeEnd());
        out.set("hours", json.valueToTree(data.hours()));
        out.set("items", page(data.items(), offset, limit, offset, this::itemSummary));
        out.set("focus", page(data.focus(), offset, limit, offset, this::focusSummary));
        return out;
    }

    private ObjectNode review(Review data, int offset, int limit) {
        ObjectNode out = json.createObjectNode().put("month", data.month()).put("now", data.now())
                .put("rangeStart", data.rangeStart()).put("rangeEnd", data.rangeEnd())
                .put("completedCount", data.completedCount()).put("droppedCount", data.droppedCount())
                .put("spentMillis", data.spentMillis()).put("activeDays", data.activeDays());
        out.set("allocations", page(data.allocations(), offset, limit, offset, json::valueToTree));
        out.set("closed", page(data.closed(), offset, limit, offset, this::itemSummary));
        out.set("footprints", page(data.footprints(), offset, limit, offset, json::valueToTree));
        out.set("notes", page(data.notes(), offset, limit, offset,
                note -> json.createObjectNode().put("day", note.day()).put("version", note.version())));
        return out;
    }

    private ObjectNode itemSummary(Item item) { return withoutNote(item); }
    private ObjectNode focusSummary(Focus focus) { return withoutNote(focus); }

    private ObjectNode withoutNote(Object value) {
        ObjectNode out = json.valueToTree(value);
        out.remove("note");
        return out;
    }

    private <T> ObjectNode page(List<T> values, int start, int limit, int offset, Function<T, JsonNode> map) {
        int from = Math.min(start, values.size());
        int to = Math.min(from + limit, values.size());
        ObjectNode out = json.createObjectNode().put("offset", offset).put("has_more", to < values.size());
        if (to < values.size()) out.put("next_offset", offset + to - from);
        var items = out.putArray("items");
        for (T value : values.subList(from, to)) items.add(map.apply(value));
        return out;
    }

    private String error(String message, int status) {
        return json.createObjectNode().put("error", message).put("status", status).toString();
    }

    private static String zone(JsonNode args) {
        String zone = text(args, "zone", false);
        return zone == null ? "UTC" : zone;
    }

    private static String requiredText(JsonNode args, String key) {
        String value = text(args, key, false);
        if (value == null || value.isBlank()) throw invalid(key + " 必须是非空字符串");
        return value;
    }

    private static String text(JsonNode args, String key, boolean nullable) {
        JsonNode value = args.get(key);
        if (value == null || (nullable && value.isNull())) return null;
        if (!value.isTextual()) throw invalid(key + " 必须是字符串" + (nullable ? "或 null" : ""));
        return value.textValue();
    }

    private static Long time(JsonNode args, String key, boolean nullable) {
        JsonNode value = args.get(key);
        if (value == null || (nullable && value.isNull())) return null;
        if (value.isIntegralNumber() && value.canConvertToLong()) return value.longValue();
        if (value.isTextual()) {
            try {
                return OffsetDateTime.parse(value.textValue()).toInstant().toEpochMilli();
            } catch (DateTimeException | ArithmeticException invalidTime) {
                throw invalid(key + " 必须使用有效的带偏移 ISO 8601 时间");
            }
        }
        throw invalid(key + " 必须使用 Unix 毫秒或带偏移 ISO 8601 时间");
    }

    private static long requiredTime(JsonNode args, String key) {
        Long value = time(args, key, false);
        if (value == null) throw invalid(key + " 必填");
        return value;
    }

    private static long version(JsonNode args, int min) {
        JsonNode value = args.path("version");
        if (!value.isIntegralNumber() || !value.canConvertToLong() || value.longValue() < min) {
            throw invalid("需要读取并提供当前 version");
        }
        return value.longValue();
    }

    private static int integer(JsonNode args, String key, int defaultValue, int min, int max) {
        if (!args.has(key)) return defaultValue;
        JsonNode value = args.get(key);
        if (!value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() < min || value.intValue() > max) {
            throw invalid(key + " 超出支持范围");
        }
        return value.intValue();
    }

    private static void requireAny(JsonNode args, String... keys) {
        for (String key : keys) if (args.has(key)) return;
        throw invalid("请提供至少一个要修改的字段");
    }

    private static IllegalArgumentException invalid(String message) { return new IllegalArgumentException(message); }
}
