package cc.ginpika.rukksh.web.controller;

import cc.ginpika.rukksh.ai.core.MemoryExec;
import cc.ginpika.rukksh.ai.memory.graph.MemoryGraphStore;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Administrative provenance inspection. Agent tools use their execution scope, never this human endpoint. */
@RestController
@RequestMapping("/api/memory/graph")
public class MemoryGraphController {
    private final MemoryGraphStore graph;

    public MemoryGraphController(MemoryGraphStore graph) {
        this.graph = graph;
    }

    @GetMapping("/claims/{id}/evidence")
    public MemoryGraphStore.EvidencePage evidence(@PathVariable long id,
                                                  @RequestParam(defaultValue = "0") int offset,
                                                  @RequestParam(defaultValue = "8") int limit) {
        return graph.evidence(MemoryExec.system(null), id, offset, limit);
    }

    public record Review(long expectedVersion, boolean accept, String reason) {}

    @PostMapping("/claims/{id}/review")
    public Map<String, Object> review(@PathVariable long id, @RequestBody Review review) {
        try {
            graph.reviewLegacy(id, review.expectedVersion(), review.accept(), review.reason());
        } catch (IllegalArgumentException e) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST, e.getMessage(), e);
        } catch (IllegalStateException e) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.CONFLICT, e.getMessage(), e);
        }
        return Map.of("id", id, "status", review.accept() ? "active" : "revoked");
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        return graph.statusSummary();
    }
}
