package cc.ginpika.rukksh.web.terminal;
import java.util.function.LongSupplier;
import org.springframework.stereotype.Component;
@Component
public class CodingTerminalTickets extends TerminalTickets {
    public CodingTerminalTickets(){super("/ws/coding/terminals/");}
    CodingTerminalTickets(LongSupplier clock){super("/ws/coding/terminals/",clock);}
}
