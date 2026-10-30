# AniRSS · 追番台

AniRSS 是一个自托管的 RSS 追番工具：按「站点基础地址 + 追番路径」拼出 RSS，用正则筛出想要的标题，把新出现的条目交给 qBittorrent 下载；下载完还能挑出正片和字幕，整理进媒体库。

只用 Node.js 内置模块，没有 npm 依赖，Node 18 以上就能跑。

![version](https://img.shields.io/badge/version-1.13.2-2f81f7)
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

```bash
docker pull ghcr.io/stonebeast/anirss:latest
docker run -d --name anirss -p 8777:8777 -v "$PWD/data:/data" ghcr.io/stonebeast/anirss:latest
```

或者用仓库里的 `docker-compose.yml`（`docker compose up -d`）。配置和历史存在 `/data`；要用补番硬链接或字幕入库，把 qB 的下载目录和硬链接目标目录按宿主机相同路径挂进容器，两者需要在同一文件系统。

## 使用

1. 「连接设置」里填 qBittorrent 的 WebUI 地址，保存并测试。
2. 「站点与路径」里填站点根地址，例如 `https://mikanime.tv`。默认带一个可编辑的 Mikan 预设。
3. 「追番 → 新增追番」：填站点地址之后的路径，或者直接粘完整 URL；按需写包含 / 排除正则、选存储路径、设检查间隔。
4. 之后应用按间隔自动检查并提交。卡片上可以暂停、立即检查、编辑，点开能看每条 RSS 为什么匹配、是否已提交。

默认只记录现有条目不补下历史；想补下时勾选「立即下载当前匹配的现有条目」，或在卡片上点「补下现有」。补番页粘贴磁力、上传种子即可单次下载。

路径模板、正则写法、硬链接与字幕整理、旧版升级和常见问题见 [docs/USAGE.md](docs/USAGE.md)。

## 数据与安全

- 配置在 `$TRIM_PKGVAR/config.json`（fnOS）或 `$ANIRSS_DATA/config.json`（独立运行），以 `0600` 写入
- 独立运行默认只监听 `127.0.0.1`；fnOS 版用独立端口 18181，不经过 fnOS 登录态，请只在可信内网使用，不要直接做公网映射
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
