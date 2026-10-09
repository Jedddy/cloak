# syntax=docker/dockerfile:1

# Bun installs and builds (bun.lock, packageManager bun@1.3.14). Node runs the
# server, the same as `bun dev` / `bun run start` do locally through the next
# bin shebang. tesseract.js worker threads and sharp are tested on Node.

ARG BUN_VERSION=1.3.14
ARG NODE_VERSION=22

FROM oven/bun:${BUN_VERSION}-debian AS bun

# --- deps: install dependencies from the lockfile ---
FROM node:${NODE_VERSION}-bookworm-slim AS deps
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
# The "prepare" script runs husky, which has no .git to hook into here.
ENV HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# --- build: build Next and fetch the OCR language data ---
FROM deps AS build
COPY . .
RUN bun run build
# workspace/ is not in git, so the OCR model is downloaded here. It goes
# outside workspace/ so that the workspace volume does not hide it.
RUN SENTINEL_TESSERACT_MODEL_DIR=/app/models/tesseract bun scripts/setup-ocr-data.ts

# --- runtime ---
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    SENTINEL_WORKSPACE_DIR=/app/workspace \
    SENTINEL_TESSERACT_MODEL_DIR=/app/models/tesseract

COPY --from=build --chown=node:node /app/package.json /app/next.config.ts ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
# tesseract.js also writes its cache into the model directory (cachePath).
COPY --from=build --chown=node:node /app/models ./models
# Packages, settings and uploads live here. Mount a persistent volume on it.
RUN mkdir -p /app/workspace && chown node:node /app/workspace

USER node
EXPOSE 3000

# The "start" script binds 127.0.0.1, which is not reachable from outside the
# container, so call next directly on all interfaces.
CMD ["sh", "-c", "exec node_modules/.bin/next start -H 0.0.0.0 -p \"$PORT\""]
