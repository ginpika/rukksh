package cc.ginpika.rukksh.web.controller;

import cc.ginpika.rukksh.agent.roundtable.CollaborationQuality;
import cc.ginpika.rukksh.web.advice.WebExceptionAdvice;
import cc.ginpika.rukksh.web.sso.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class CollaborationQualityControllerTest {
    final CollaborationQuality quality=mock(CollaborationQuality.class);
    final org.springframework.test.web.servlet.MockMvc mvc=MockMvcBuilders.standaloneSetup(new CollaborationQualityController(quality)).setControllerAdvice(new WebExceptionAdvice()).build();
    @Test void evidenceRequiresAuthenticationAndForwardsTheSessionBoundary() throws Exception {
        mvc.perform(get("/api/agents/collaboration/tasks/session/todos/todo/quality")).andExpect(status().isUnauthorized());
        verifyNoInteractions(quality);
        var json=new ObjectMapper();when(quality.find("session","todo")).thenReturn(new CollaborationQuality.Quality(json.nullNode(),json.createArrayNode(),json.nullNode()));
        mvc.perform(get("/api/agents/collaboration/tasks/session/todos/todo/quality").requestAttr(SsoInterceptor.ATTR,new SsoUser("alice","alice","用户","","user","")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.findings").isArray());
        verify(quality).find("session","todo");
    }
}
