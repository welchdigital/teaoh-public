FROM node:26-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:26-slim AS ui
WORKDIR /ui
COPY admin-ui/package.json admin-ui/package-lock.json ./
RUN npm ci
COPY admin-ui/ ./
RUN node ./node_modules/vite/bin/vite.js build

FROM node:26-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY config ./config
COPY --from=ui /ui/dist ./admin-ui/dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8078 8079 8080
CMD ["node", "src/main.ts"]
