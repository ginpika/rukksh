package cc.ginpika.rukksh.agent.maintenance;

import cc.ginpika.rukksh.ai.knowledge.anchor.AnchorSeeder;
import cc.ginpika.rukksh.ai.knowledge.store.ChunkStore;
import cc.ginpika.rukksh.ai.knowledge.store.GraphStore;
import cc.ginpika.rukksh.ai.memory.MemoryMaintenanceService;
import cc.ginpika.rukksh.config.dto.SettingsDtos;
import cc.ginpika.rukksh.shared.error.DomainException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 知识库与记忆子系统全局重置编排服务（设置页危险操作）。 */
@Service
public class KnowledgeResetService {

    private final JdbcTemplate jdbc;
    private final ChunkStore chunkStore;
    private final GraphStore graphStore;
    private final MemoryMaintenanceService memoryMaintenance;
    private final AnchorSeeder anchorSeeder;

    public KnowledgeResetService(JdbcTemplate jdbc, ChunkStore chunkStore, GraphStore graphStore,
                                 MemoryMaintenanceService memoryMaintenance, AnchorSeeder anchorSeeder) {
        this.jdbc = jdbc;
        this.chunkStore = chunkStore;
        this.graphStore = graphStore;
        this.memoryMaintenance = memoryMaintenance;
        this.anchorSeeder = anchorSeeder;
    }

    /** 重置知识库与记忆子系统（不删除项目文档时保留项目级上下文）。 */
    @Transactional
    public SettingsDtos.ResetResult resetKnowledgeBase() {
        return resetKnowledgeBase(false);
    }

    @Transactional
    public SettingsDtos.ResetResult resetKnowledgeBase(boolean deleteProjectKnowledge) {
        memoryMaintenance.beginReset();
        if (jdbc.queryForObject("SELECT count(*) FROM task WHERE status='running'", Integer.class) > 0) {
            throw new DomainException(DomainException.ErrorKind.CONFLICT,
                    "请先结束正在运行的 Agent 对话、协作或编码执行，再重置知识库，避免执行中的旧上下文回写。");
        }
        int episodes = jdbc.queryForObject("SELECT count(*) FROM graph_episode", Integer.class);
        int jobs = jdbc.queryForObject("SELECT count(*) FROM graph_ingest_job", Integer.class);
        int projectDocuments = jdbc.queryForObject("SELECT count(*) FROM project_document", Integer.class);
        int checkpoints = jdbc.update("UPDATE task SET memory_checkpoint=NULL WHERE memory_checkpoint IS NOT NULL");
        int recalls = jdbc.update("DELETE FROM rag_recall");
        GraphStore.Cleared graph = graphStore.clearAll();
        int chunks = chunkStore.clearAll();
        MemoryMaintenanceService.Cleared mem = memoryMaintenance.clearAll(deleteProjectKnowledge);
        jdbc.update("UPDATE web_snapshot SET index_status=CASE WHEN enabled=1 THEN 'reset' ELSE 'disabled' END");
        anchorSeeder.seed();
        int keptEpisodes = jdbc.queryForObject("SELECT count(*) FROM graph_episode", Integer.class);
        return new SettingsDtos.ResetResult(chunks, graph.entities(), graph.relations(), mem.entries(),
                mem.events(), mem.items(), mem.candidates(), mem.shares(), Math.max(0, episodes - keptEpisodes), jobs,
                checkpoints, recalls, deleteProjectKnowledge ? projectDocuments : 0,
                deleteProjectKnowledge ? 0 : projectDocuments);
    }
}
