FROM node:20-alpine AS base
WORKDIR /app

RUN apk add --no-cache curl

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY backend/ ./backend/
COPY proto/ ./proto/
COPY index.ts ./

EXPOSE 3456
CMD ["npx", "tsx", "backend/server.ts"]
