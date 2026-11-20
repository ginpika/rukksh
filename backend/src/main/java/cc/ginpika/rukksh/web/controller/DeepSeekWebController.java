package cc.ginpika.rukksh.web.controller;

import cc.ginpika.rukksh.ai.knowledge.web.DeepSeekWebClient;
import cc.ginpika.rukksh.config.DeepSeekWebSettings;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/settings/deepseek-web")
public class DeepSeekWebController {
    public record TestRequest(DeepSeekWebSettings.Draft config, String query, String url) {}
    public record TestResult(boolean ok, long elapsedMs, String detail, String error) {}
    private final DeepSeekWebSettings settings;
    private final DeepSeekWebClient client;
    public DeepSeekWebController(DeepSeekWebSettings settings, DeepSeekWebClient client) { this.settings = settings; this.client = client; }
    @GetMapping public DeepSeekWebSettings.View view() { return settings.view(); }
    @PutMapping public DeepSeekWebSettings.View save(@RequestBody DeepSeekWebSettings.Draft draft) { return settings.save(draft); }
    @PostMapping("/test/{tool}")
    public TestResult test(@PathVariable String tool, @RequestBody TestRequest request) {
        long start = System.nanoTime();
        try {
            if (!tool.equals("search") && !tool.equals("fetch")) throw new IllegalArgumentException("仅支持 search 或 fetch 测试");
            var config = settings.validate(request.config(), true);
            String detail;
            if (tool.equals("search")) {
                var results = client.search(config, request.query(), 1, false);
                detail = "Search 请求成功，返回 " + results.size() + " 条结果";
            } else {
                var page = client.fetch(config, request.url());
                detail = "Fetch 请求成功，返回 " + page.content().length() + " 字符正文";
            }
            return new TestResult(true, elapsed(start), detail, null);
        } catch (RuntimeException e) {
            return new TestResult(false, elapsed(start), null, e.getMessage());
        }
    }
    private static long elapsed(long start) { return (System.nanoTime() - start) / 1_000_000; }
}
