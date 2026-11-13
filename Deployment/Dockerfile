# VIGO BILLIARDS PARTY — máy chủ game + client web (build từ thư mục gốc repo)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY GameClient/package.json GameClient/package-lock.json ./GameClient/
RUN npm --prefix GameClient ci
COPY . .
ARG VITE_SERVER_URL=""
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN npm run build:client && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data WEB_ROOT=/app/web
COPY --from=build /app/dist/server.js ./server.js
COPY --from=build /app/GameClient/dist ./web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "server.js"]
