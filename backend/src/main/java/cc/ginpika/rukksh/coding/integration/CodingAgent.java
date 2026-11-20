package cc.ginpika.rukksh.coding.integration;

import cc.ginpika.rukksh.ai.core.BuiltinAgents;
import cc.ginpika.rukksh.agent.member.AgentPromptService;
import cc.ginpika.rukksh.agent.member.AgentStore;
import cc.ginpika.rukksh.coding.dto.CodingDtos.Agent;
import org.springframework.context.annotation.DependsOn;
import org.springframework.stereotype.Component;

/** Adapter for the default agent while it is working in the programming IDE. */
@Component
@DependsOn({"schemaMigrations", "agentSeeder"})
public class CodingAgent {
    private final AgentStore agents;
    private final AgentPromptService prompts;
    public CodingAgent(AgentStore agents, AgentPromptService prompts) {
        this.agents = agents;
        this.prompts = prompts;
    }
    public Agent profile() {
        var row = agents.peer(BuiltinAgents.CORE)
                .orElseThrow(() -> new IllegalStateException("默认 Agent 不存在"));
        return new Agent(row.id(), row.name(), row.modelId(), row.avatar());
    }
    public String instructions() { return prompts.ideSystem(); }
    public String modelId(String requested) {
        return requested == null || requested.isBlank() ? profile().modelId() : requested;
    }
}
