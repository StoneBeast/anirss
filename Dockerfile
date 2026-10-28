# AniRSS · 追番台 —— 运行镜像（纯 Node.js，零第三方依赖，无需 npm install）
FROM node:20-alpine

LABEL org.opencontainers.image.title="AniRSS" \
      org.opencontainers.image.description="Self-hosted RSS anime tracker that filters releases and pushes them to qBittorrent" \
      org.opencontainers.image.source="https://github.com/StoneBeast/anirss" \
      org.opencontainers.image.licenses="MIT"

# tzdata：让 TZ 生效（页面与日志时间）。node:20-alpine 已带 uid/gid 1000 的 node 用户，直接复用。
RUN apk add --no-cache tzdata

WORKDIR /app

# 只复制运行所需内容：app/（服务端 + 前端静态资源）与 package.json
COPY --chown=node:node app ./app
COPY --chown=node:node package.json ./

# 默认数据目录（config.json 等），可用 ANIRSS_DATA 覆盖
RUN mkdir -p /data && chown node:node /data

# 应用在非 fnOS 环境下默认监听 127.0.0.1，容器内必须显式改成 0.0.0.0
ENV NODE_ENV=production \
    ANIRSS_HOST=0.0.0.0 \
    ANIRSS_PORT=8777 \
    ANIRSS_DATA=/data \
    TZ=Asia/Shanghai

VOLUME ["/data"]
EXPOSE 8777

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${ANIRSS_PORT}/api/health" >/dev/null 2>&1 || exit 1

# 应用自身处理 SIGTERM/SIGINT 并 flush 配置，可直接作为 PID 1
CMD ["node", "app/server/index.js"]
