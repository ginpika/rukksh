package cc.ginpika.rukksh.ai.knowledge.web;

import java.net.InetAddress;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;

/** Validate navigations, redirects and browser subresources, not just the initial URL. */
@Component
public class WebUrlPolicy {
    @Value("${rukksh.web.allow-fake-ip:false}")
    private boolean allowFakeIp;
    public String validate(String raw) {
        return cc.ginpika.rukksh.ai.computer.browser.BrowserUrls.validate(raw, allowFakeIp);
    }

    static boolean publicAddress(InetAddress address) {
        return cc.ginpika.rukksh.ai.computer.browser.BrowserUrls.publicAddress(address);
    }
}
