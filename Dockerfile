# ── Stage 1: Build frontend ────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN YOUTUBE_DL_SKIP_PYTHON_CHECK=1 YOUTUBE_DL_SKIP_DOWNLOAD=true npm ci --prefer-offline --legacy-peer-deps
COPY . .
RUN npm run build

# ── Stage 2: Production runtime ────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Install system dependencies: ffmpeg + python3 + pip + build tools for curl_cffi
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev \
    ffmpeg curl ca-certificates \
    gcc libssl-dev libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp from PyPI (includes curl_cffi support via extras)
# This is more reliable than the raw binary download for impersonate support
RUN pip3 install --no-cache-dir --break-system-packages \
    "yt-dlp[default]" \
    && yt-dlp --version

WORKDIR /app
COPY package*.json ./
RUN YOUTUBE_DL_SKIP_PYTHON_CHECK=1 YOUTUBE_DL_SKIP_DOWNLOAD=true npm ci --omit=dev --prefer-offline --legacy-peer-deps

# Copy built frontend + server source
COPY --from=builder /app/dist ./dist
COPY server.ts ./
COPY tsconfig.json ./

# Runtime deps for tsx
RUN npm install tsx --no-save --legacy-peer-deps

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npx", "tsx", "server.ts"]
