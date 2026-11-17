# syntax=docker/dockerfile:1
# One image, one process: Next.js's standalone server.js, which also makes the reviews
# (src/server/runner.ts runs inside it; there's no separate worker). Videos are prepared in the
# visitor's browser, so the image has no ffmpeg or speech model. Build and host: docs/hosting.md.

# ---- the app: install and build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# The lock file is written by npm 11; npm 10 (node 22's own) reads it as out of sync, so use 11.
RUN npm install -g npm@11.6.2 && npm ci
COPY . .
# The NEXT_PUBLIC_ settings are built into the pages, so they're needed here. They're the
# Supabase project's public address and publishable key, not secrets. Never declare a secret as
# an ARG: Render passes every environment variable as a build argument, and only the ones
# declared here are used.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    PANEL_MODE=hosted \
    PANEL_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1
# npm run build also runs scripts/after-build.mjs, which keeps any data folder out of the output.
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
# The standalone build is self-contained: server.js plus only the packages it uses. The static
# files and public/ sit beside it, as Next.js's output docs describe.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Scratch space only: a review's files are copied here while it's made, from storage. The host's
# disk can be wiped at any restart; everything that matters is in Supabase.
RUN mkdir -p /tmp/panel-data && chown node:node /tmp/panel-data

# HOSTNAME is what server.js listens on. Docker sets it to the container's id unless it's set here.
# The old-space cap keeps Node's heap well inside a 512 MB instance (measured peak: docs/hosting.md).
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PANEL_MODE=hosted \
    HOSTNAME=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/tmp/panel-data \
    NODE_OPTIONS=--max-old-space-size=320
USER node
EXPOSE 8080
CMD ["node", "server.js"]
