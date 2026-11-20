package cc.ginpika.rukksh.web.advice;

import cc.ginpika.rukksh.shared.error.DomainException;
import java.io.IOException;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

/**
 * Translates domain and transport exceptions into consistent HTTP error payloads across REST controllers.
 */
@RestControllerAdvice
public class WebExceptionAdvice {

    private static final Logger log = LoggerFactory.getLogger(WebExceptionAdvice.class);

    @ExceptionHandler(DomainException.class)
    public ResponseEntity<Map<String, String>> handleDomain(DomainException error) {
        String message = error.getMessage() == null || error.getMessage().isBlank()
                ? "请求失败" : error.getMessage();
        return ResponseEntity.status(error.statusCode()).body(Map.of("message", message));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, String>> handleResponseStatus(ResponseStatusException error) {
        String message = error.getReason() == null || error.getReason().isBlank()
                ? "请求失败" : error.getReason();
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("message", message));
    }

    @ExceptionHandler(IOException.class)
    public void handleDisconnectedStream(IOException error) {
        log.debug("流式连接已断开，按客户端关闭收尾：{}", error.getMessage());
    }
}
