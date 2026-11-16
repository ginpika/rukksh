package cc.ginpika.rukksh.coding.api;
import cc.ginpika.rukksh.web.terminal.TerminalTickets;
import java.util.function.LongSupplier;
import org.springframework.stereotype.Component;
@Component
public class CodingTerminalTickets extends TerminalTickets {
    public CodingTerminalTickets(){super("/ws/coding/terminals/");}
    CodingTerminalTickets(LongSupplier clock){super("/ws/coding/terminals/",clock);}
}
