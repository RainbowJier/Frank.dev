#!/bin/bash
# init.sh - Development server startup script for Frank.dev
# Usage: bash init.sh [backend|frontend|all]

start_backend() {
    echo "=== Starting Backend (Spring Boot) ==="
    cd frank-dev-server
    mvn clean install -DskipTests -q
    cd frank-dev-starter
    mvn spring-boot:run -Dspring-boot.run.profiles=dev &
    BACKEND_PID=$!
    echo "Backend starting on http://localhost:9040/frank-dev (PID: $BACKEND_PID)"
    cd ..
}

start_frontend() {
    echo "=== Starting Frontend (Vite) ==="
    cd frank-dev-front
    npm install --silent 2>/dev/null
    npm run dev &
    FRONTEND_PID=$!
    echo "Frontend starting on http://localhost (PID: $FRONTEND_PID)"
    cd ..
}

case "${1:-all}" in
    backend)
        start_backend
        ;;
    frontend)
        start_frontend
        ;;
    all)
        start_backend
        start_frontend
        ;;
    *)
        echo "Usage: bash init.sh [backend|frontend|all]"
        exit 1
        ;;
esac

echo ""
echo "=== Development servers are starting ==="
echo "Backend:  http://localhost:9040/frank-dev"
echo "Frontend: http://localhost"
echo ""
echo "Press Ctrl+C to stop all servers"
wait
