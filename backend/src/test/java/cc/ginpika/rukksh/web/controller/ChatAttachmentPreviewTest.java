package cc.ginpika.rukksh.web.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cc.ginpika.rukksh.agent.chat.ChatAttachments.Content;
import cc.ginpika.rukksh.agent.chat.ChatSessionService;
import cc.ginpika.rukksh.agent.chat.store.ChatMessageStore;
import cc.ginpika.rukksh.web.advice.WebExceptionAdvice;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ChatAttachmentPreviewTest {
    private static final String ROUTE = "/api/sessions/{id}/messages/{messageId}/attachments/{index}";
    private static final String TEXT = "测试正文\n<em>按文本读取</em>";
    private static final byte[] PNG = Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3S0AAAAASUVORK5CYII=");

    private SingleConnectionDataSource database;
    private MockMvc mvc;
    private long messageId;
    private long oldMessageId;

    @BeforeEach
    void setUp() {
        database = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        new ResourceDatabasePopulator(new ClassPathResource("schema.sql")).execute(database);
        var jdbc = new JdbcTemplate(database);
        jdbc.update("INSERT INTO hub_session (id, created_at, updated_at) VALUES ('first', 1, 1), ('second', 1, 1)");
        var messages = new ChatMessageStore(jdbc);
        var json = new ObjectMapper();
        String stored = json.valueToTree(List.of(
                new Content("report.pdf", "text/plain", TEXT),
                new Content("chart.png", "image/png", "data:image/png;base64," + Base64.getEncoder().encodeToString(PNG))))
                .toString();
        messageId = messages.insert("first", "user", "读取附件", null, null, null, null, null, stored);
        oldMessageId = messages.insert("first", "user", "早期消息", null, null, null, null, null);
        var sessions = new ChatSessionService(null, messages, null, null, json, null, null, null, null, null);
        mvc = MockMvcBuilders.standaloneSetup(new ChatController(null, null, sessions, null, null, null, json, null)).setControllerAdvice(new WebExceptionAdvice()).build();
    }

    @AfterEach
    void tearDown() {
        database.destroy();
    }

    @Test
    void returnsExtractedTextAndDecodesImageBytesOnDemand() throws Exception {
        mvc.perform(get(ROUTE, "first", messageId, 0))
                .andExpect(status().isOk())
                .andExpect(content().contentType("text/plain;charset=UTF-8"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().bytes(TEXT.getBytes(StandardCharsets.UTF_8)));
        mvc.perform(get(ROUTE, "first", messageId, 1))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.IMAGE_PNG))
                .andExpect(content().bytes(PNG));
    }

    @Test
    void refusesUnknownIndicesAndAttachmentsFromOtherConversations() throws Exception {
        mvc.perform(get(ROUTE, "second", messageId, 0)).andExpect(status().isNotFound());
        mvc.perform(get(ROUTE, "first", messageId, -1)).andExpect(status().isNotFound());
        mvc.perform(get(ROUTE, "first", messageId, 2)).andExpect(status().isNotFound());
        mvc.perform(get(ROUTE, "first", oldMessageId, 0)).andExpect(status().isNotFound());
    }
}
