package cc.ginpika.rukksh.web.controller;

import cc.ginpika.rukksh.ai.memory.MemoryCatalogService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Human-facing catalog. Page and lifecycle counts are computed before limiting the result set. */
@RestController
@RequestMapping("/api/memory/catalog")
public class MemoryCatalogController {

    private final MemoryCatalogService catalogService;

    public MemoryCatalogController(MemoryCatalogService catalogService) {
        this.catalogService = catalogService;
    }

    @GetMapping
    public MemoryCatalogService.Catalog catalog(@RequestParam(defaultValue = "remembered") String view,
                                                @RequestParam(defaultValue = "") String q,
                                                @RequestParam(defaultValue = "") String agentId,
                                                @RequestParam(defaultValue = "") String projectId,
                                                @RequestParam(defaultValue = "1") int page,
                                                @RequestParam(defaultValue = "20") int size) {
        return catalogService.catalog(view, q, agentId, projectId, page, size);
    }
}
