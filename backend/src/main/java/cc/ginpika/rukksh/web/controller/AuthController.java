package cc.ginpika.rukksh.web.controller;

import cc.ginpika.rukksh.config.SsoProps;
import cc.ginpika.rukksh.web.sso.SsoInterceptor;
import cc.ginpika.rukksh.web.sso.SsoService;
import cc.ginpika.rukksh.web.sso.SsoUser;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final SsoService ssoService;
    private final SsoProps ssoProps;

    public AuthController(SsoService ssoService, SsoProps ssoProps) {
        this.ssoService = ssoService;
        this.ssoProps = ssoProps;
    }

    /** 当前登录用户（拦截器已注入 / 401 处理）；未接入 hostid 时返回 dev 用户 */
    @GetMapping("/me")
    public SsoUser me(HttpServletRequest request) {
        return (SsoUser) request.getAttribute(SsoInterceptor.ATTR);
    }

    /** 桌面端用它确定 HostID 站点与 Cookie 名称，再从 WebView 的 Cookie 存储校验会话。 */
    @GetMapping("/sso")
    public Map<String, Object> sso(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        if (!ssoService.isEnabled()) {
            return Map.of("enabled", false);
        }
        return Map.of("enabled", true, "serverUrl", ssoProps.getServerUrl(),
                "cookieName", ssoProps.getCookieName());
    }

    /** 登出：服务端撤销 hostid 会话；前端随后可跳 hostid 登录页重登 */
    @PostMapping("/logout")
    public Map<String, Object> logout(HttpServletRequest request, HttpServletResponse response) {
        ssoService.revoke(cookieToken(request));
        return Map.of("success", true);
    }

    private String cookieToken(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }
        for (Cookie c : cookies) {
            if (ssoProps.getCookieName().equals(c.getName())) {
                return c.getValue();
            }
        }
        return null;
    }
}
