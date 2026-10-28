# AniRSS 的 Docker 打包

本文记录 AniRSS 打成 Docker 镜像的可行性验证结果与使用方式。仓库根目录提供了 `Dockerfile`、`.dockerignore` 和 `docker-compose.yml`。

## 结论

**可行，且成本很低。** 已在 Ubuntu 22.04 + Docker 27.3.1（overlay2）上实测：镜像构建成功（约 137 MB）、容器健康检查通过、页面与接口正常、`/data` 数据跨重启保留、`SIGTERM` 优雅退出正常。

适合容器化的原因是这个项目本身的形态：

- **零第三方依赖**：`package.json` 没有 `dependencies`，服务端只用 Node 内置模块，因此镜像里**不需要 `npm install`、不需要 node-gyp / 编译工具链**，构建过程只是复制文件。
- **单进程 HTTP 服务**：前端静态资源（`app/www`）随仓库一起提供，没有单独的前端构建产物或反向代理依赖。
- **单一数据目录**：配置与历史都在 `ANIRSS_DATA`（镜像内默认 `/data`）。
- **自带健康接口**：`GET /api/health` 返回版本与 uptime，可直接用作 `HEALTHCHECK`。
- **自带优雅退出**：进程处理 `SIGTERM` / `SIGINT` 并 `store.flush()` 落盘，适合直接当 PID 1。

## 构建

```bash
git clone https://github.com/StoneBeast/anirss.git
cd anirss
docker build -t anirss:local .
```

国内网络下构建步骤需要 `apk add tzdata`（Alpine 源），如果直连被阻断，可让构建走宿主机代理：

```bash
docker build --network=host \
  --build-arg http_proxy=http://127.0.0.1:7890 \
  --build-arg https_proxy=http://127.0.0.1:7890 \
  -t anirss:local .
```

> 代理只影响构建过程，不会被写进镜像的运行配置。

## 运行

```bash
docker run -d --name anirss \
  -p 8777:8777 \
  -v "$PWD/data:/data" \
  -e TZ=Asia/Shanghai \
  --add-host=host.docker.internal:host-gateway \
  anirss:local
```

或使用仓库内的 `docker-compose.yml`：

```bash
docker compose up -d --build
```

打开 <http://<宿主机IP>:8777>。

## 环境变量

| 变量 | 镜像默认值 | 说明 |
| --- | --- | --- |
| `ANIRSS_HOST` | `0.0.0.0` | 监听地址。**必须保持 `0.0.0.0`**：应用在非 fnOS 环境下默认只听 `127.0.0.1`，容器外将无法访问 |
| `ANIRSS_PORT` | `8777` | 监听端口，改端口时同步改 `EXPOSE` / `-p` 映射 |
| `ANIRSS_DATA` | `/data` | 配置与历史数据目录，建议挂卷 |
| `TZ` | `Asia/Shanghai` | 时区；镜像已装 `tzdata`，`TZ` 生效 |

## 卷与路径

只能挂一个数据卷：

| 容器内路径 | 用途 |
| --- | --- |
| `/data` | `config.json` 及历史数据；**必须可写** |

若要使用「补番硬链接 / 外挂字幕入库」，还需要把 qBittorrent 真正写入文件的目录挂进来，并遵守两条硬性约束：

1. **容器内路径必须与宿主机路径完全一致**。应用是拿 qBittorrent 返回的 `content_path` / `savepath` 直接在本机文件系统上做 `link()` 的；宿主机 `/mnt/media/downloads` 在容器里也必须叫 `/mnt/media/downloads`，否则会提示「下载目录在本机不存在或应用没有访问权限」。
2. **下载目录与硬链接目标必须在同一文件系统**。硬链接不能跨分区，跨分区会直接报错。

```bash
-v /mnt/media/downloads:/mnt/media/downloads \
-v /mnt/media/library:/mnt/media/library
```

同时，qBittorrent 里配置的保存路径也应当是**容器视角**的路径（与上面挂载点一致）。

## 连接 qBittorrent

容器里的 `127.0.0.1` 是容器自己，不是宿主机。所以「连接设置」里的 WebUI 地址不能填 `http://127.0.0.1:8080`，按 qBittorrent 的部署方式二选一：

- qBittorrent 跑在宿主机：填宿主机内网 IP（如 `http://192.168.59.128:8080`），或启动时加 `--add-host=host.docker.internal:host-gateway` 后填 `http://host.docker.internal:8080`；
- qBittorrent 也是容器：把两个容器放进同一个 Docker 网络，地址填容器名（如 `http://qbittorrent:8080`）。

## 权限

镜像默认以 `node` 用户（uid/gid `1000`）运行，与常见 NAS 用户对齐。若宿主机目录属于其他 uid，两种处理方式：

```bash
# 方式一：运行时覆盖用户（宿主机目录需对该 uid 可读写）
docker run ... --user 1026:100 anirss:local

# 方式二：改宿主目录属主
sudo chown -R 1000:1000 /path/to/data
```

## 已知限制

- **单实例、无内置鉴权**：和裸机运行一样，暴露到公网前请在反向代理上加 Basic Auth / 访问控制。
- **子路径反代**：应用内置的网关前缀固定为 `/app/anirss`（fnOS 网关用）；用 Nginx 子路径反代时要么直接走根路径，要么按该前缀改写。
- **压缩包支持范围**：zip / tar / tar.gz 由内置 zlib 处理，RAR / 7z 会明确报「暂不支持」，与裸机一致。
- **时区依赖 `tzdata`**：镜像已内置；自行改基础镜像时注意别丢。

## 验证记录

环境：Ubuntu 22.04.5 LTS / x86_64 / Docker 27.3.1 / overlay2 / Node 20.20.2（镜像内）。

| 检查项 | 结果 |
| --- | --- |
| `docker build` | 成功，镜像 `anirss:verify`，137 MB |
| 容器状态 | `Up (healthy)`，`0.0.0.0:18777->8777/tcp` |
| 启动日志 | `listening on http://0.0.0.0:8777`，数据目录 `/data`，调度器已启动 |
| `GET /api/health` | `{"ok":true,"app":"anirss","version":"1.13.2","socket":false,"port":8777}` |
| `GET /api/state` | 200，`dataDir:"/data"`，revision 正常递增 |
| `GET /` | 200，`text/html`，4532 B |
| 静态资源 | `app.js` 返回 `Content-Encoding: gzip` + `ETag`，条件请求返回 304 |
| 数据持久化 | `/data/config.json` 生成；`docker stop/start` 后 revision 保留 |
| 优雅退出 | 日志出现 `SIGTERM received, shutting down`，配置已落盘 |
| 运行身份 | 容器内 `uid=1000(node)`，非 root |
| 时区 | 容器内 `date` 输出 CST |
| 挂载路径探测 | 同路径挂载的下载/目标目录 `probe` 返回 `writable:true`、属主 `1000:1000` |
| 项目自带单测 | `node dev/unit.js` 29 项全部通过（宿主机 Node 20） |

容器内不需要 `npm install`，也不存在构建期编译产物，因此镜像内容基本等于源码体积加 Node 运行时。
