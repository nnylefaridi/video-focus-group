# One container runs the whole app: the website (server.mjs) and the video worker.
# Built and run by Railway (see README "Going live"); works with any Docker host.

# 1. whisper.cpp speech-to-text, built portable so it runs on any x86-64 CPU.
FROM debian:bookworm-slim AS whisper
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates build-essential cmake curl && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp /src \
  && cmake -S /src -B /build -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release \
  && cmake --build /build --target whisper-cli -j"$(nproc)"
RUN mkdir -p /models && curl -fsSL -o /models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

# 2. The Next.js build. NEXT_PUBLIC_* values are baked into the browser code, so they're needed here.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

# 3. What runs.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=whisper /build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper /models/ggml-base.en.bin /opt/whisper/ggml-base.en.bin
WORKDIR /app
COPY --from=build /app ./
# DATA_DIR should be a persistent volume (working media files and the key that hashes visitor IPs).
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data WHISPER_MODEL=/opt/whisper/ggml-base.en.bin NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["node", "scripts/start.mjs"]
