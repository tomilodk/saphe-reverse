FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production

COPY backend/ ./backend/
COPY proto/ ./proto/
COPY index.ts ./

EXPOSE 3456
CMD ["bun", "run", "backend/server.ts"]
