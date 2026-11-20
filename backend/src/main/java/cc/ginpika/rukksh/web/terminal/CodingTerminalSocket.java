package cc.ginpika.rukksh.web.terminal;
import cc.ginpika.rukksh.coding.CodingService;
import cc.ginpika.rukksh.coding.runner.CodingTerminals;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
@Component
public class CodingTerminalSocket extends TerminalSocket {
    public CodingTerminalSocket(CodingTerminals terminals,CodingTerminalTickets tickets,CodingService coding,ObjectMapper json){
        super(terminals,tickets,()->{if(!coding.capabilities().enabled()){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"编程模块未启用");}},json);
    }
}
