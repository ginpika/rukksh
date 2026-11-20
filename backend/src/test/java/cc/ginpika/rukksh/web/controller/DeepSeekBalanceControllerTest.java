package cc.ginpika.rukksh.web.controller;

import cc.ginpika.rukksh.shared.error.DomainException;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import cc.ginpika.rukksh.ai.llm.DeepSeekBalanceService;
import cc.ginpika.rukksh.config.*;
import cc.ginpika.rukksh.config.store.SettingsStore;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class DeepSeekBalanceControllerTest {
    @Test void usesSavedModelAndIndependentWebCredentialsAndDisablesBrowserCaching() {
        var models = mock(SettingsService.class);
        var web = mock(DeepSeekWebSettings.class);
        var balances = mock(DeepSeekBalanceService.class);
        var controller = new DeepSeekBalanceController(models, web, balances);
        var view = new DeepSeekBalanceService.View("ready", true, List.of(), 100L, 100L, null);
        when(models.requireModelTarget("env")).thenReturn(new ModelTarget("https://api.deepseek.com/v1", "model-secret", "model"));
        when(web.resolve()).thenReturn(new DeepSeekWebSettings.Config("https://api.deepseek.com", "web-secret", false, false, true, 5, 15));
        when(balances.balance(anyString(), anyString(), anyBoolean())).thenReturn(view);
        var result = controller.model("env", true);
        assertSame(view, result.getBody()); assertEquals("no-store", result.getHeaders().getCacheControl());
        assertSame(view, controller.web(false).getBody());
        verify(balances).balance("https://api.deepseek.com/v1", "model-secret", true);
        verify(balances).balance("https://api.deepseek.com", "web-secret", false);
    }

    @Test void deletedModelNeverFallsBackToTheEnvironmentAccount() {
        var store = mock(SettingsStore.class);
        when(store.model("deleted")).thenReturn(Optional.empty());
        var props = new LlmProps(); props.setBaseUrl("https://api.deepseek.com"); props.setApiKey("env-secret");
        var models = new SettingsService(props, store);
        var balances = mock(DeepSeekBalanceService.class);
        var controller = new DeepSeekBalanceController(models, mock(DeepSeekWebSettings.class), balances);
        assertEquals(404, assertThrows(DomainException.class, () -> controller.model("deleted", false)).statusCode());
        verifyNoInteractions(balances);
        assertEquals("env-secret", models.requireModelTarget("env").apiKey());
    }
}
