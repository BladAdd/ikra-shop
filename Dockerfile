# Сервер магазина «Икра & Рыба»: Node 22 + better-sqlite3
# Сборка: npm ci → vite build + tsc. Запуск: node dist-server/index.js
FROM node:22-slim AS build
WORKDIR /app
# better-sqlite3 — нативный модуль: нужен python3/make/g++ для сборки из исходников
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/data ./data
COPY --from=build /app/package.json ./package.json
# Том для SQLite: монтируется платформой (Railway: /data)
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "dist-server/index.js"]