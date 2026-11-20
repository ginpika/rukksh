package cc.ginpika.rukksh.persistence.migration;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.transaction.support.TransactionTemplate;

class MemoryMigrationTest {
    @Test void v4PreservesUnknownHistoryAndDemotesUnconfirmedSharedFacts() throws Exception {
        var ds = new SingleConnectionDataSource("jdbc:sqlite::memory:",true);
        try {
            ScriptUtils.executeSqlScript(ds.getConnection(),new ClassPathResource("schema.sql"));
            var jdbc = new JdbcTemplate(ds);
            jdbc.update("UPDATE _schema SET version=3");
            jdbc.update("INSERT INTO graph_claim(scope,body,source,valid_from,created_at,updated_at,owner,domain,layer,project_id,session_id,status,version) "
                    + "VALUES('fact','模型假设','auto',1,1,1,'PROJECT','PROJECT','L1','p','s','active',0)");
            jdbc.update("INSERT INTO memory_event(event_key,kind,actor,ref_type,ref_id,created_at) VALUES('legacy','chat','user','chat_message',1,1)");
            var migration = new SchemaMigrations(jdbc,new TransactionTemplate(new DataSourceTransactionManager(ds)),"jdbc:sqlite::memory:");
            migration.apply(); migration.apply();
            assertEquals(8,jdbc.queryForObject("SELECT version FROM _schema",Integer.class));
            assertEquals("L3",jdbc.queryForObject("SELECT layer FROM graph_claim",String.class));
            assertNull(jdbc.queryForObject("SELECT agent_id FROM memory_event",String.class));
            assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM memory_event",Integer.class));
        } finally { ds.destroy(); }
    }

    @Test void v7PreservesScopeOfExistingSubagentTasks() throws Exception {
        var source = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        try {
            ScriptUtils.executeSqlScript(source.getConnection(), new ClassPathResource("schema.sql"));
            var jdbc = new JdbcTemplate(source);
            jdbc.update("UPDATE _schema SET version=6");
            jdbc.update("INSERT INTO task(id,kind,status,created_at,updated_at,payload) VALUES(1,'subagent','done',1,1,?)",
                    """
                    {"task":"keep this","_minis_context":{"parent_task_id":24,"refs":["message:5"]}}
                    """);
            jdbc.update("INSERT INTO task(id,kind,status,created_at,updated_at,payload) VALUES(2,'subagent','done',1,1,'plain text')");
            var migration = new SchemaMigrations(jdbc,
                    new TransactionTemplate(new DataSourceTransactionManager(source)), "jdbc:sqlite::memory:");
            migration.apply();
            migration.apply();
            assertEquals(24, jdbc.queryForObject(
                    "SELECT json_extract(payload, '$._rukksh_context.parent_task_id') FROM task WHERE id=1", Integer.class));
            assertEquals("message:5", jdbc.queryForObject(
                    "SELECT json_extract(payload, '$._rukksh_context.refs[0]') FROM task WHERE id=1", String.class));
            assertEquals("keep this", jdbc.queryForObject(
                    "SELECT json_extract(payload, '$.task') FROM task WHERE id=1", String.class));
            assertNull(jdbc.queryForObject(
                    "SELECT json_type(payload, '$._minis_context') FROM task WHERE id=1", String.class));
            assertEquals("plain text", jdbc.queryForObject("SELECT payload FROM task WHERE id=2", String.class));
        } finally {
            source.destroy();
        }
    }
}
