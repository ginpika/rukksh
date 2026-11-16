package cc.ginpika.rukksh.config;

import cc.ginpika.rukksh.web.sso.SsoInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final SsoInterceptor ssoInterceptor;

    public WebConfig(SsoInterceptor ssoInterceptor) {
        this.ssoInterceptor = ssoInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(ssoInterceptor)
                .addPathPatterns("/**")
                .excludePathPatterns(
                        // 公开展健康检查
                        "/api/health",
                        // 静态资源（后端托管 dist 时；页面本身仍需登录）
                        "/assets/**", "/favicon.svg", "/vite.svg",
                        "/*.svg", "/*.png", "/*.ico", "/*.js", "/*.css",
                        // 桌面端在登录前需要知道 HostID 地址和 Cookie 名称
                        "/api/auth/sso",
                        // 登出需在未登录（或 token 已过期）时也可调用
                        "/api/auth/logout",
                        // Only a short-lived, single-use ticket from an authenticated REST request
                        // can authorize this socket; its handshake also validates the exact Origin.
                        "/ws/coding/terminals/**",
                        // Spring 错误页
                        "/error");
    }
}
