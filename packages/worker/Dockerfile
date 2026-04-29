# Playwright base ships with Chromium and all OS deps preinstalled.
# IMPORTANT: keep this version in lockstep with the `playwright` dep version in
# packages/worker/package.json — mismatch breaks the browser launch.
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

# Install ffmpeg for video assembly
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace package manifests first for better caching
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/worker/package.json packages/worker/

RUN npm ci --workspaces --include-workspace-root || npm install

# Copy sources
COPY packages/shared packages/shared
COPY packages/worker packages/worker

# Build shared first, then worker (worker depends on @ghl-vc/shared's compiled output)
RUN npm run build --workspace @ghl-vc/shared \
 && npm run build --workspace @ghl-vc/worker

ENV NODE_ENV=production
CMD ["node", "packages/worker/dist/index.js"]
