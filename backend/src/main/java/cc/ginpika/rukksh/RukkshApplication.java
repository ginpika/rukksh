package cc.ginpika.rukksh;

import cc.ginpika.rukksh.config.Branding;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class RukkshApplication {

    public static void main(String[] args) {
        SpringApplication app = new SpringApplication(RukkshApplication.class);
        app.setDefaultProperties(Map.of(
                "spring.application.name", Branding.applicationName(),
                "rukksh.default-db-path", defaultDatabasePath(Path.of("../data")).toString()));
        app.run(args);
    }

    static Path defaultDatabasePath(Path data) {
        Path current = data.resolve("rukksh.db");
        Path legacy = data.resolve("minis.db");
        // 优先使用新文件。升级时直接打开现有 SQLite 文件，连同其 WAL 一起使用。
        return Files.notExists(current) && Files.exists(legacy) ? legacy : current;
    }
}
