package cc.ginpika.rukksh.shared.error;

/**
 * Framework-free domain and application exception carrying semantic failure categories
 * instead of HTTP transport status codes.
 */
public class DomainException extends RuntimeException {

    public enum ErrorKind {
        BAD_REQUEST(400),
        UNAUTHORIZED(401),
        FORBIDDEN(403),
        NOT_FOUND(404),
        CONFLICT(409),
        PAYLOAD_TOO_LARGE(413),
        TOO_MANY_REQUESTS(429),
        BAD_GATEWAY(502),
        SERVICE_UNAVAILABLE(503),
        GATEWAY_TIMEOUT(504);

        private final int statusCode;

        ErrorKind(int statusCode) {
            this.statusCode = statusCode;
        }

        public int statusCode() {
            return statusCode;
        }
    }

    private final ErrorKind kind;

    public DomainException(ErrorKind kind, String message) {
        super(message);
        this.kind = kind == null ? ErrorKind.BAD_REQUEST : kind;
    }

    public DomainException(ErrorKind kind, String message, Throwable cause) {
        super(message, cause);
        this.kind = kind == null ? ErrorKind.BAD_REQUEST : kind;
    }

    public ErrorKind kind() {
        return kind;
    }

    public int statusCode() {
        return kind.statusCode();
    }

    public static DomainException badRequest(String message) {
        return new DomainException(ErrorKind.BAD_REQUEST, message);
    }

    public static DomainException badRequest(String message, Throwable cause) {
        return new DomainException(ErrorKind.BAD_REQUEST, message, cause);
    }

    public static DomainException unauthorized(String message) {
        return new DomainException(ErrorKind.UNAUTHORIZED, message);
    }

    public static DomainException forbidden(String message) {
        return new DomainException(ErrorKind.FORBIDDEN, message);
    }

    public static DomainException notFound(String message) {
        return new DomainException(ErrorKind.NOT_FOUND, message);
    }

    public static DomainException conflict(String message) {
        return new DomainException(ErrorKind.CONFLICT, message);
    }

    public static DomainException tooManyRequests(String message) {
        return new DomainException(ErrorKind.TOO_MANY_REQUESTS, message);
    }

    public static DomainException badGateway(String message) {
        return new DomainException(ErrorKind.BAD_GATEWAY, message);
    }

    public static DomainException badGateway(String message, Throwable cause) {
        return new DomainException(ErrorKind.BAD_GATEWAY, message, cause);
    }

    public static DomainException serviceUnavailable(String message) {
        return new DomainException(ErrorKind.SERVICE_UNAVAILABLE, message);
    }

    public static DomainException payloadTooLarge(String message) {
        return new DomainException(ErrorKind.PAYLOAD_TOO_LARGE, message);
    }

    public static DomainException gatewayTimeout(String message) {
        return new DomainException(ErrorKind.GATEWAY_TIMEOUT, message);
    }
}
