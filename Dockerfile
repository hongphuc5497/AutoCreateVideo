# ── Build stage ──────────────────────────────────────────────────────────
FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --production

# ── Runtime stage ─────────────────────────────────────────────────────────
FROM node:26-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
COPY --from=build /app/src ./src

RUN groupadd -r appuser && useradd -r -g appuser -d /app appuser \
    && chown -R appuser:appuser /app
USER appuser

ENV HOST=0.0.0.0 \
    PORT=4317 \
    PUBLIC_BASE_PATH=/news-video-creating \
    PUBLIC_DEMO_MODE=1

EXPOSE 4317

CMD ["node", "dist/server.js"]
