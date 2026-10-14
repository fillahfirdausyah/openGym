# Read-only MCP bridge over streamable HTTP. Built from the repo root (docker-compose.yml sets
# context: .), so the relative imports in mcp/src (../../frontend/src/lib/*) still resolve: the
# image mirrors that layout at /app/mcp/src and /app/frontend/src/lib.
FROM node:22-alpine

ARG VERSION=dev
ARG VCS_REF=dev
ARG BUILD_DATE=unknown

LABEL maintainer="Duarte Santos https://gitlab.com/DuarteSantos8" \
    org.opencontainers.image.title="opengym-mcp" \
    org.opencontainers.image.description="Read-only Model Context Protocol bridge for openGym over streamable HTTP — lets a remote LLM client (Claude Desktop, Cursor, Hermes) read routines, workouts, 1RMs and muscle balance from the same data volume the api writes." \
    org.opencontainers.image.source="https://gitlab.com/DuarteSantos8/opengym" \
    org.opencontainers.image.url="https://gitlab.com/DuarteSantos8/opengym/container_registry" \
    org.opencontainers.image.documentation="https://gitlab.com/DuarteSantos8/opengym#readme" \
    org.opencontainers.image.licenses="AGPL-3.0-or-later" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$VCS_REF \
    org.opencontainers.image.created=$BUILD_DATE

WORKDIR /app

# Keep the base at alpine's current state (same reasoning as api/Dockerfile).
RUN apk upgrade --no-cache

COPY mcp/package.json mcp/package-lock.json ./mcp/
RUN cd mcp && npm ci --omit=dev && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Only what the server imports: its own src/ and the pure training helpers it shares with the
# frontend. Test files and the rest of frontend/ stay out of the image.
COPY mcp/src ./mcp/src
COPY frontend/src/lib ./frontend/src/lib

ENV NODE_ENV=production
ENV PORT=3200
WORKDIR /app/mcp
EXPOSE 3200
CMD ["node", "src/http.js"]

# Liveness only: the data volume is shared read-only, so this checks the process is up, not data.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget --spider -q "http://127.0.0.1:${PORT}/health" || exit 1
