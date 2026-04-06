# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FRANK-DEV is a multi-module Java Spring Boot 3.5.5 backend application following Domain-Driven Design (DDD) principles. The project uses Maven for builds, Java 17, MyBatis-Plus for ORM, and PostgreSQL as the primary database.

## Common Commands

### Building the Project
```bash
# Build all modules (from project root)
mvn clean install

# Build with specific profile
mvn clean install -P dev   # Development (default)
mvn clean install -P prod  # Production

# Build only specific module
mvn clean install -pl frank-dev-starter

# Skip tests during build
mvn clean install -DskipTests
```

### Running the Application
```bash
# Run via Maven (from frank-dev-starter directory)
mvn spring-boot:run

# Run with specific profile
mvn spring-boot:run -Dspring-boot.run.profiles=dev
mvn spring-boot:run -Dspring-boot.run.profiles=prod

# Run the JAR directly (after build)
java -jar frank-dev-starter/target/frank-dev-starter-1.0.0.jar
```

### Testing
```bash
# Run all tests
mvn test

# Run tests for specific module
mvn test -pl frank-dev-application
```

### Database Setup
Before running the application, execute the SQL schema located at:
```
sql/pg.sql
```

## Architecture

The project follows DDD layering with strict dependency rules (dependencies flow downward only):

```
┌─────────────────────────────────────────────────────────┐
│  frank-dev-starter (Entry Point & Configuration)       │
│  - Main: org.frank.starter.FrankStarterApplication     │
│  - Port: 9040, Context: /frank-dev                     │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  frank-dev-adapter (Web API Layer)                     │
│  - Controllers (org.frank.adapter.controller)          │
│  - Handles HTTP requests/responses                     │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  frank-dev-application (Business Logic)                │
│  - Services (org.frank.application.service)            │
│  - Service interfaces + implementations                │
└─────────────────────────────────────────────────────────┘
                           │
            ┌──────────────┴──────────────┐
            ▼                             ▼
┌──────────────────────┐    ┌────────────────────────────┐
│ frank-dev-infrastructure│   │ frank-dev-shared (DTOs)   │
│ - Mappers (MyBatis)   │    │ - Request/Response objects│
│ - Gateway Impl        │    │ - org.frank.shared.*      │
└──────────────────────┘    └────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  frank-dev-domain (Core Domain)                        │
│  - Entities (org.frank.domain.entity)                  │
│  - Gateway interfaces                                  │
└─────────────────────────────────────────────────────────┘
```

### Module Dependencies

- **starter** depends on: adapter, application, infrastructure
- **adapter** depends on: application, shared, domain
- **application** depends on: infrastructure, shared, domain
- **infrastructure** depends on: domain, common-core, mybatis-plus
- **shared** depends on: domain, common-core, mybatis-plus
- **domain** depends on: common-core
- All modules may use: common-*, token, redis, schedule

### Key Architecture Patterns

1. **Gateway Pattern**: Domain layer defines gateway interfaces (`org.frank.domain.gateway`); infrastructure provides implementations (`org.frank.infrastructure.gateway`)

2. **JWT Authentication**: Stateless token-based auth via `TokenService` with Redis caching. Tokens are sent via `Authorization` header (configurable in `application.yml`)

3. **Unified Response**: All API responses wrapped in `AjaxResult<T>` from `common-core`

4. **Logical Delete**: Soft delete using `del_flag` field (0=deleted, 1=active)

5. **Base Entity**: `BaseEntity` provides audit fields (`create_by`, `create_time`, `update_by`, `update_time`)

6. **Pagination**: Use `PageQuery` for input, `PageResult<T>` for output

## Configuration

### Profiles
- **dev** (default): Development environment
- **prod**: Production environment

Profile selection is handled via Maven resource filtering. The `@profile.active@` placeholder in `application.yml` is replaced during build.

### Server Configuration
- Port: 9040
- Context path: /frank-dev
- Full URL example: `http://localhost:9040/frank-dev/sys-login/login`

### Token Configuration
```yaml
token:
  header: Authorization
  secret: "frank-web-jwt-secret-key-must-be-at-least-32-bytes-long"
  expireTime: 30  # minutes
```

### Interceptor Exclusions
The following paths are excluded from token authentication (configurable):
- `/frank-dev/sys-login/login`
- `/frank-dev/sys-login/logout`

## Common Utilities

### Redis Cache
```java
@Autowired
private RedisCache redisCache;

// Set cache
redisCache.setCacheObject("key", value);

// Get cache
redisCache.getCacheObject("key");
```

### Token Service
```java
@Autowired
private TokenService tokenService;

// Create token
String token = tokenService.createToken(loginUser);

// Get user from token
LoginUser loginUser = tokenService.getLoginUser(request);
```

### Global Exception Handling
All exceptions are caught by `GlobalExceptionHandler` and wrapped in `AjaxResult`. Use `BusinessException` for business logic errors.

## Database Notes

- Primary database: PostgreSQL
- Also supports: MySQL, Oracle
- Connection pool: Druid
- MyBatis-Plus with logical delete enabled on `del_flag`
- ID generation: ASSIGN_ID (snowflake-like)

## Package Structure Reference

| Layer | Package |
|-------|---------|
| Controllers | `org.frank.adapter.controller` |
| Services | `org.frank.application.service` |
| Entities | `org.frank.domain.entity` |
| Gateways (interface) | `org.frank.domain.gateway` |
| Gateways (impl) | `org.frank.infrastructure.gateway` |
| Mappers | `org.frank.infrastructure.mapper` |
| DTOs (req/resp) | `org.frank.shared.{feature}.req`, `org.frank.shared.{feature}.resp` |

## Working Standards

- **Read code before modifying, never guess about unchecked code**
- **Code comments in Chinese, variable names in English**
- **Ask when uncertain, don't make assumptions**

## Common Pitfalls

(To be updated as issues arise)