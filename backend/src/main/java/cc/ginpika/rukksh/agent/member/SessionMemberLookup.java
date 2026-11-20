package cc.ginpika.rukksh.agent.member;

import java.util.Optional;

/**
 * 按会话 ID 查询固定成员列表 JSON 的只读端口，使名册模块不反向依赖圆桌存储实现。
 */
@FunctionalInterface
public interface SessionMemberLookup {
    Optional<String> memberIdsJson(String sessionId);
}
