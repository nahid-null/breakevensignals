FROM oven/bun:1.3.10
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY engine-worker ./engine-worker
COPY src/lib/config.ts ./src/lib/config.ts
COPY src/lib/engine ./src/lib/engine
CMD ["bun", "run", "engine-worker/main.ts"]