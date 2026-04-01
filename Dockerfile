# ── Stage 1: Build frontend ────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --prefer-offline
COPY . .
RUN npm run build

# ── Stage 2: Production runtime ────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Install system dependencies: ffmpeg + yt-dlp
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --prefer-offline

# Copy built frontend + server source
COPY --from=builder /app/dist ./dist
COPY server.ts ./
COPY tsconfig.json ./

# Runtime deps for tsx (used to run server.ts directly)
RUN npm install tsx --no-save

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npx", "tsx", "server.ts"]
