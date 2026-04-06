package org.frank.starter;

import lombok.extern.slf4j.Slf4j;
import org.frank.common.properties.CorsProperties;
import org.frank.token.properties.ExcludePathsProperties;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.ComponentScan;

/**
 * FRANK项目启动类
 * DDD架构多模块Spring Boot应用
 */

@Slf4j
@SpringBootApplication
@MapperScan("org.frank.infrastructure.mapper")
@ComponentScan("org.frank")
@EnableConfigurationProperties({CorsProperties.class, ExcludePathsProperties.class})
public class FrankStarterApplication {
    public static final String ANSI_RESET = "\u001B[0m";  // 重置颜色（必选）
    public static final String ANSI_CYAN = "\u001B[35m";  // 比较骚气
    public static final String START_SUCCESS = """
            \s
               _____   _    _    _____    _____   ______    _____    _____\s
              / ____| | |  | |  / ____|  / ____| |  ____|  / ____|  / ____|
             | (___   | |  | | | |      | |      | |__    | (___   | (___ \s
              \\___ \\  | |  | | | |      | |      |  __|    \\___ \\   \\___ \\\s
              ____) | | |__| | | |____  | |____  | |____   ____) |  ____) |
             |_____/   \\____/   \\_____|  \\_____| |______| |_____/  |_____/\s
                                                                          \s
                                                                          \s
            """;

    public static void main(String[] args) {
        SpringApplication.run(FrankStarterApplication.class, args);
        log.info(ANSI_CYAN + START_SUCCESS + ANSI_RESET);
    }

}
