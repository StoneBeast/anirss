# AniRSS · 追番台

AniRSS 是一个自托管的 RSS 追番工具：按「站点基础地址 + 追番路径」拼出 RSS，用正则筛出想要的标题，把新出现的条目交给 qBittorrent 下载；下载完还能挑出正片和字幕，整理进媒体库。

只用 Node.js 内置模块，没有 npm 依赖，Node 18 以上就能跑。

![version](https://img.shields.io/badge/version-1.13.4-2f81f7)
![node](https://img.shields.io/badge/node-%E2%89%A518-3c873a)
![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![platform](https://img.shields.io/badge/platform-fnOS%20%7C%20Linux%20%7C%20Windows%20%7C%20macOS-6f42c1)
![license](https://img.shields.io/badge/license-MIT-blue)

![总览](docs/overview.png)

## 功能

- 自动追番：定时抓取 RSS / Atom，按包含、排除正则筛选，只提交新条目
- 站点搜索：在配置好的站点里搜番剧，选好番剧和字幕组后自动填上追番地址
- 补番：磁力链接或 `.torrent` 单次下载，和追番共用路径预设
- 硬链接整理：下载完成后挑出正片和字幕，按季平铺到媒体库，源文件继续做种
- 外挂字幕：批量上传字幕或压缩包，也可以贴直链让应用自己抓
- 存储路径模板、集数识别、HTTP / SOCKS5 代理、列表与封面两种视图

## 安装

### fnOS

在应用中心开启「手动安装」，选 `anirss-X.Y.Z.fpk`（依赖 `nodejs_v24`，应用中心会处理）。装好后点桌面图标，浏览器会打开 `http://<NAS-IP>:18181/`。

发布包在 [Releases](https://github.com/StoneBeast/anirss/releases)，数据存放在 `$TRIM_PKGVAR`。

### 本机运行

需要 Node.js 18 或更新版本。

```bash
# Windows：双击 start.cmd，或
node app/server/index.js

# Linux / macOS
bash start.sh
```

默认打开 <http://127.0.0.1:8777>。端口、监听地址和数据目录可以分别用 `ANIRSS_PORT`、`ANIRSS_HOST`、`ANIRSS_DATA` 改。

### Docker

镜像同时发布在 Docker Hub 与 GHCR，`linux/amd64`、`linux/arm64` 都有：

| 仓库 | 镜像 |
| --- | --- |
| Docker Hub | `stonebeast/anirss` |
| GHCR | `ghcr.io/stonebeast/anirss` |

`:latest` 跟随最新正式版，也可以固定版本（如 `1.13.4`）。镜像由发版（推 tag）时的 GitHub Actions 构建推送，没有配 Docker Hub 凭据时只推 GHCR；两个仓库内容一致，Docker Hub 被限流时换 GHCR 拉。

#### 1. 准备数据目录

```bash
# compose 用仓库根目录的 ./data；手动 run 也可以换成 /vol1/1000/docker/anirss/data
mkdir -p ./data
sudo chown -R 1000:1000 ./data   # 镜像内以 node（uid/gid 1000）运行
```

#### 2. 拉取镜像

```bash
docker pull stonebeast/anirss:latest
# 固定版本：
docker pull stonebeast/anirss:1.13.4
```

#### 3. 运行

只追番、不用硬链接和字幕入库时，挂一个数据卷就够：

```bash
docker run -d --name anirss \
  --restart unless-stopped \
  -p 8777:8777 \
  -e TZ=Asia/Shanghai \
  -v "$PWD/data:/data" \
  stonebeast/anirss:latest
```

打开 `http://<NAS-IP>:8777/`。

要用补番硬链接 / 字幕入库，再把 qBittorrent 的下载目录和媒体库挂进来。**容器内路径必须和 qB 里看到的保存路径逐字符一致**（下面按 qB 用宿主机路径举例；qB 容器内是 `/downloads` 就把冒号右边换成 `/downloads`，详见第 5 节）：

```bash
docker run -d --name anirss \
  --restart unless-stopped \
  -p 8777:8777 \
  -e TZ=Asia/Shanghai \
  -v /vol1/1000/docker/anirss/data:/data \
  -v /vol1/1000/downloads:/vol1/1000/downloads:ro \
  -v /vol1/1000/media:/vol1/1000/media \
  --add-host=host.docker.internal:host-gateway \
  stonebeast/anirss:latest
```

- 下载目录挂 `:ro` 就够（硬链接只读源文件）；不确定或有权限报错时改成读写。
- `--add-host` 让容器里能用 `host.docker.internal` 访问宿主机上的 qB（Docker 20.10+）。
- 宿主机目录属主不是 1000 时，加 `--user "$(id -u):$(id -g)"`，或把这些目录 `chown` 给 1000。

#### 4. docker compose

仓库根目录的 [docker-compose.yml](docker-compose.yml) 与上面的完整命令等价：

```bash
docker compose pull
docker compose up -d
docker compose logs -f anirss
docker compose down          # 停服务；./data 里的配置和历史保留
```

改完挂载 / 环境变量后重建，升级镜像也是同一条：

```bash
docker compose pull && docker compose up -d
```

#### 5. 目录映射：除了 `/data` 还要挂什么

| 容器内路径 | 宿主机路径（示例） | 权限 | 用途 |
| --- | --- | --- | --- |
| `/data` | `/vol1/1000/docker/anirss/data` | 读写 | `config.json`（连接、追番、路径预设、记录、日志）和 `subtitles/<补番 id>/` 外挂字幕库；配置损坏时同目录生成 `config.json.corrupt-*` |
| qB 返回的 `savepath`（如 `/downloads`） | `/vol1/1000/downloads` | 只读即可 | 硬链接的源文件 |
| 你在 AniRSS 里填的硬链接目标（如 `/media`） | `/vol1/1000/media` | 读写 | 应用在这里建 `Season n`，创建硬链接 |

冒号右边到底写什么，取决于 qBittorrent 返回的路径：

- **qB 是宿主机进程 / fnOS 应用**：qB 返回的是宿主机路径，左右照抄，例如 `-v /vol1/1000/downloads:/vol1/1000/downloads:ro`。
- **qB 也是容器，内部路径是 `/downloads`**：AniRSS 也挂到 `/downloads`，例如 `-v /vol1/1000/downloads:/downloads:ro`；媒体库同理，挂到你在 AniRSS 里要填的那个路径。

一句话：`-v 宿主机路径:容器内路径`。下载目录的右边必须是 qB 返回的那个字符串；媒体库的右边则是你准备在 AniRSS 里填的路径。填错了应用就找不到文件。

三条硬性规则：

1. **下载目录和媒体库必须位于宿主机同一文件系统**（同一块盘 / 同一个 Docker 卷）。硬链接不能跨分区，跨了会报「跨文件系统无法硬链接」。
2. **AniRSS 容器里的下载路径，必须和 qBittorrent 看到的保存路径一致**。qB 把 savepath 原样交给应用，应用按这个字符串在自己容器里找文件。
3. 媒体库目录要对容器用户（默认 uid 1000）可写。宿主机目录请先自己 `mkdir`，否则 Docker 自动创建时属主是 root，容器里会写不进去。

权限上还有一个常见坑：Linux 默认开启 `fs.protected_hardlinks`，非文件属主想建硬链接，需要对源文件有写权限。最省事是让 qBittorrent 和 AniRSS 用同一个 PUID/PGID（常见 `1000:1000`）；两边用户不同时，把下载文件设成同组可写，或给 AniRSS 换成 qB 的 uid。媒体库也不要放在 SMB/CIFS 挂载上，这类文件系统通常不支持硬链接。

外挂字幕存在 `/data/subtitles`；它和媒体库不在同一分区时，字幕会退化成复制而不是硬链接（不报错，只是多占一份空间）。

#### 6. 连接 qBittorrent

容器里的 `127.0.0.1` 是容器自己，不是 NAS：

- qB 跑在宿主机：填 NAS 内网地址（如 `http://192.168.1.10:8080`），或加 `--add-host=host.docker.internal:host-gateway` 后填 `http://host.docker.internal:8080`。qB 的 WebUI 要监听 `0.0.0.0`，只听 `127.0.0.1` 时容器访问不到。
- qB 也是容器：两个容器放进同一个 Docker 网络，填容器名（如 `http://qbittorrent:8080`）。没有现成网络就先 `docker network create media`，然后给两个容器都加 `--network media`（compose 里用 `networks:`）。
- qB 里的保存路径、AniRSS 里的路径预设都填**容器内路径**，不是宿主机路径。

#### 7. 权限、备份与升级

- 镜像以 `node`（uid/gid 1000）运行；`/data`、媒体库等宿主机目录要给这个 uid 读写权限。
- 容器自带健康检查（`GET /api/health`），`docker ps` 里状态显示 `(healthy)` 即正常；`curl http://<NAS-IP>:8777/api/health` 也能直接看。
- 备份：停容器后打包 `data` 目录即可；`config.json` 里 qB 和代理密码是明文，「导出配置」不会带出密码。
- 升级：`docker compose pull && docker compose up -d`（或 `docker rm -f anirss` 后重新 `docker run`）。`/data` 是 bind mount，删容器不丢数据。
- 卸载：`docker rm -f anirss` 只删容器，数据目录要自己删。

#### 8. 自己构建 / 推到 Docker Hub

```bash
git clone https://github.com/StoneBeast/anirss.git && cd anirss
docker build -t anirss:local .
docker run -d --name anirss -p 8777:8777 -v "$PWD/data:/data" anirss:local

# 可选：推到自己的 Docker Hub 仓库
docker login
docker tag anirss:local <你的用户名>/anirss:local
docker push <你的用户名>/anirss:local
```

镜像内的 `ANIRSS_HOST=0.0.0.0`、`ANIRSS_PORT=8777`、`ANIRSS_DATA=/data` 已经设好；只改宿主机端口时动 `-p` 左侧即可，右侧容器端口和 `ANIRSS_PORT` 要保持一致。

## 使用

1. 「连接设置」里填 qBittorrent 的 WebUI 地址，保存并测试。
2. 「站点与路径」里填站点根地址，例如 `https://mikanime.tv`。默认带一个可编辑的 Mikan 预设。
3. 「追番 → 新增追番」：填站点地址之后的路径，或者直接粘完整 URL；按需写包含 / 排除正则、选存储路径、设检查间隔。
4. 之后应用按间隔自动检查并提交。卡片上可以暂停、立即检查、编辑，点开能看每条 RSS 为什么匹配、是否已提交。

默认只记录现有条目不补下历史；想补下时勾选「立即下载当前匹配的现有条目」，或在卡片上点「补下现有」。补番页粘贴磁力、上传种子即可单次下载。

路径模板、正则写法、硬链接与字幕整理、旧版升级和常见问题见 [docs/USAGE.md](docs/USAGE.md)。

## 数据与安全

- 配置在 `$TRIM_PKGVAR/config.json`（fnOS）、`$ANIRSS_DATA/config.json`（独立运行）或 `/data/config.json`（Docker），以 `0600` 写入
- 独立运行默认只监听 `127.0.0.1`；fnOS 版用独立端口 18181。Docker 版在容器内监听 `0.0.0.0` 才能被宿主机访问，且没有内置登录，请只在可信内网使用，不要直接做公网映射；要公网访问请在反向代理上加认证和 HTTPS。
- qBittorrent 和代理的密码明文存在配置文件里，「导出配置」不会带出密码

## 开发

```bash
node dev/unit.js        # 单元测试
node dev/smoke.js       # 端到端烟测，内置假 qB 和假 RSS
node dev/demo.js        # 生成演示数据
```

打包、目录结构和接口清单见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## License

[MIT](LICENSE)
