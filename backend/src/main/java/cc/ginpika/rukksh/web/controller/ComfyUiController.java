package cc.ginpika.rukksh.web.controller;

import cc.ginpika.rukksh.ai.comfyui.ComfyUiService;
import cc.ginpika.rukksh.ai.comfyui.ComfyUiSettings;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class ComfyUiController {
    private final ComfyUiSettings settings;
    private final ComfyUiService service;
    public record Selection(String profileId) {}
    public record Generate(String profileId, String prompt) {}
    public ComfyUiController(ComfyUiSettings settings, ComfyUiService service) { this.settings = settings; this.service = service; }
    @GetMapping("/api/settings/comfyui") public ComfyUiSettings.View view() { return settings.view(); }
    @PostMapping("/api/settings/comfyui/endpoints") public ComfyUiSettings.View createEndpoint(@RequestBody ComfyUiSettings.Endpoint e) { return settings.saveEndpoint(null,e); }
    @PutMapping("/api/settings/comfyui/endpoints/{id}") public ComfyUiSettings.View updateEndpoint(@PathVariable String id, @RequestBody ComfyUiSettings.Endpoint e) { return settings.saveEndpoint(id,e); }
    @DeleteMapping("/api/settings/comfyui/endpoints/{id}") public ComfyUiSettings.View deleteEndpoint(@PathVariable String id) { return settings.deleteEndpoint(id); }
    @PostMapping("/api/settings/comfyui/endpoints/test") public ComfyUiService.TestResult testEndpoint(@RequestBody ComfyUiSettings.Endpoint e) { return service.testEndpoint(e); }
    @PostMapping("/api/settings/comfyui/endpoints/{id}/test") public ComfyUiService.TestResult testEndpoint(@PathVariable String id) { return service.testEndpoint(settings.endpoint(id)); }
    @PostMapping("/api/settings/comfyui/profiles") public ComfyUiSettings.View createProfile(@RequestBody ComfyUiSettings.Profile p) { return settings.saveProfile(null,p); }
    @PutMapping("/api/settings/comfyui/profiles/{id}") public ComfyUiSettings.View updateProfile(@PathVariable String id, @RequestBody ComfyUiSettings.Profile p) { return settings.saveProfile(id,p); }
    @DeleteMapping("/api/settings/comfyui/profiles/{id}") public ComfyUiSettings.View deleteProfile(@PathVariable String id) { return settings.deleteProfile(id); }
    @PutMapping("/api/settings/comfyui/default") public ComfyUiSettings.View select(@RequestBody Selection s) { return settings.select(s.profileId()); }
    @PostMapping("/api/comfyui/generate") public ComfyUiService.Result generate(@RequestBody Generate request) { return service.generate(request.profileId(),request.prompt()); }
    @GetMapping("/api/comfyui/images/{id}") public ResponseEntity<byte[]> image(@PathVariable String id) {
        var image = service.image(id);
        return ResponseEntity.ok().header("Content-Type", image.mediaType()).header("Cache-Control", "private, max-age=86400")
            .header("X-Content-Type-Options", "nosniff").body(image.bytes());
    }
}
