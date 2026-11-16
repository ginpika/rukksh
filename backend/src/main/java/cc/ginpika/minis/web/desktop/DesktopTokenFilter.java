package cc.ginpika.minis.web.desktop;

import cc.ginpika.minis.config.DesktopProps;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.UriUtils;

/**
 * 桌面壳的本机访问闸门：只有带上壳注入的一次性令牌，才允许调用 {@code /api/**}。
 *
 * <p>本机模式把后端只绑在回环地址上，但回环不等于安全——同机任何进程都能访问 127.0.0.1，
 * 而本后端的 terminal 工具可以执行任意命令（见 {@code TerminalService}）。所以壳每次启动
 * 生成一枚随机令牌，经环境变量注入（{@code MINIS_LOCAL_TOKEN}），并只交付给本机后端的主页面。
 * 前端同源 API 请求统一在请求头 {@value #HEADER} 上带回来。
 *
 * <p>未开启桌面模式、或令牌为空时<b>完全直通</b>（Web 部署与本地开发不受影响）。
 * 静态资源与页面不校验：它们本身不含权限，而且壳必须先加载页面、拿到令牌后才有后续请求。
 */
@Component
public class DesktopTokenFilter extends OncePerRequestFilter {

    /** 壳与前端约定的令牌请求头 */
    public static final String HEADER = "X-Minis-Token";

    private final DesktopProps props;

    public DesktopTokenFilter(DesktopProps props) {
        this.props = props;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        if (!props.isEnabled() || props.getLocalToken().isBlank()
                || !isApiRequest(request)) {
            chain.doFilter(request, response);
            return;
        }
        String supplied = request.getHeader(HEADER);
        if (supplied != null && MessageDigest.isEqual(
                props.getLocalToken().getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8))) {
            chain.doFilter(request, response);
            return;
        }
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"error\":\"invalid local token\"}");
    }

    private static boolean isApiRequest(HttpServletRequest request) {
        // Use the servlet's normalized path and Spring's decoded path segment semantics.
        String pathInfo = request.getPathInfo();
        String servletPath = request.getServletPath();
        if (isApiPath(pathInfo) || isApiPath(servletPath) || isApiPath(servletPath + (pathInfo == null ? "" : pathInfo))) {
            return true;
        }
        String path = request.getRequestURI().substring(request.getContextPath().length());
        if (!path.startsWith("/")) {
            return false;
        }
        int slash = path.indexOf('/', 1);
        String segment = slash < 0 ? path.substring(1) : path.substring(1, slash);
        int parameters = segment.indexOf(';');
        if (parameters >= 0) {
            segment = segment.substring(0, parameters);
        }
        try {
            return "api".equals(UriUtils.decode(segment, StandardCharsets.UTF_8));
        } catch (IllegalArgumentException malformedPath) {
            return false;
        }
    }

    private static boolean isApiPath(String path) {
        return path != null && (path.equals("/api") || path.startsWith("/api/") || path.startsWith("/api;"));
    }
}
