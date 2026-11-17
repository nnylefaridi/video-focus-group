# syntax=docker/dockerfile:1
# One image for both the website (`app` process) and the background worker (`worker` process).
# The process is chosen by the host (fly.toml). Build: see docs/hosting.md.

# ---- whisper.cpp (speech to text), built from a pinned release, plus its model ----
FROM node:22-bookworm-slim AS whisper
ARG WHISPER_CPP_TAG=v1.7.6
# SHA-1 of ggml-base.en.bin as published in whisper.cpp's models/README.md for this model.
ARG WHISPER_MODEL_SHA1=137c40403d78fd54d454da0f9bd998f78703390c
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${WHISPER_CPP_TAG}" https://github.com/ggml-org/whisper.cpp /src/whisper.cpp \
 && cmake -S /src/whisper.cpp -B /src/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF \
 && cmake --build /src/whisper.cpp/build --config Release -j2 --target whisper-cli \
 && install -D /src/whisper.cpp/build/bin/whisper-cli /out/whisper-cli
RUN mkdir -p /out/models \
 && curl -fsSL -o /out/models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin \
 && echo "${WHISPER_MODEL_SHA1}  /out/models/ggml-base.en.bin" | sha1sum -c -

# ---- the app: install and build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The NEXT_PUBLIC_ settings are built into the pages, so they're needed here. They're the
# Supabase project's public address and publishable key, not secrets. Never pass secrets as build args.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    PANEL_MODE=hosted \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgomp1 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=whisper /out/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper /out/models /opt/models

WORKDIR /app
# Dev dependencies stay: next.config.ts and the worker (tsx) need TypeScript tooling at run time.
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /tmp/panel-data && chown node:node /tmp/panel-data

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PANEL_MODE=hosted \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/tmp/panel-data \
    WHISPER_MODEL=/opt/models/ggml-base.en.bin \
    WHISPER_BIN=/usr/local/bin/whisper-cli
USER node
EXPOSE 8080
# Default is the website; the worker process runs: node --import tsx worker/index.mts
CMD ["node", "server.mjs"]
