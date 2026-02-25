FROM oven/bun:1 AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --production

COPY backend/ ./backend/
COPY proto/ ./proto/
COPY index.ts ./

EXPOSE 3456
CMD ["bun", "run", "backend/server.ts"]
