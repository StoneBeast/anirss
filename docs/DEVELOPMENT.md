# 开发与打包参考

> 面向改代码 / 重新打包的人。普通使用请看 [README](../README.md)。

## 环境

- Node.js 18+（fnOS 包依赖 `nodejs_v24`）
- 零 npm 依赖：`node app/server/index.js` 直接跑，没有构建步骤
- 测试数据与假 qB / 假 RSS 都在 `dev/`，不会进入发布包

## 测试

```bash
node dev/unit.js        # 单元测试（29 项）：RSS 2.0 / Atom、实体解码、正则、URL 拼接、infohash、集数识别、硬链接规划
node dev/smoke.js       # 端到端烟测（46 项）：拉起真实服务 + 内置假 qBittorrent / 假 RSS 站点
node dev/perf-check.js  # 性能行为验证：静态资源与 /api/state 的 gzip、ETag/304、写盘合并
node dev/ui-actions.js  # 浏览器交互测试（75 项）：需要 Chrome CDP 9222 + 演示实例 8777
node dev/ui-subs-check.js # 字幕弹窗抽查：弹窗打开、zip 上传入库、列表刷新（同上前提）
node dev/ui-patch-check.js # keyed patch 抽查：软刷新后列表节点复用、滚动不跳（同上前提）
node dev/ui-modal-check.js # 弹窗误触抽查：点表单旁边/拖选松手到外面不会把表单关掉（同上前提，可用 ANIRSS_APP 指向别的实例）
node dev/ui-history-check.js # 返回栈抽查：站内切页不压历史、弹层打开时返回先关弹层（同上前提）
node dev/ui-shot.js     # 重新生成 docs/ 下的截图
node dev/ui-empty.js    # 空数据首启引导截图
```

### 性能要点

- **配置写盘合并**：下载循环 / 后台巡检这类连续变更走 `store.scheduleSave()`（200ms 合并一次），用户主动改配置仍走 `save()` 同步落盘；进程退出（含 SIGTERM 与 exit 兜底）时会 flush 排队的写入。
- **静态资源**：内存缓存 + ETag/304 + gzip，浏览器重复加载页面只走 304。
- **/api/state**：前端每 12 秒轮询，带 ETag；数据没变（`store.rev` + 检查队列指纹）返回 304，跳过全量重建与序列化；响应按需 gzip。
- **出站连接复用**：qBittorrent API 与 RSS 抓取使用 keep-alive 连接池（`app/server/agents.js`），省掉每次请求的 TCP/TLS 握手。
- **解析热点缓存**：RSS 标签正则按标签名编译一次复用；集数识别 `guessEpisode` 按标题缓存。

### 站点搜索为什么慢 / 怎么快的

搜索一次要打站点很多页面，实测（mikanime.tv，12 条搜索命中、1~3 部番剧）：

| 阶段 | 请求数 | 单条 p50 | 耗时 |
| --- | --- | --- | --- |
| 站点搜索 RSS | 1 | 0.9~1.8s | 0.9~1.8s |
| 单集页（拿番组/字幕组 id） | 12 | 0.9s | 4~7s |
| 番组主页（名称/封面/集数/大小列） | 1~3 | 0.5~2.4s | 与单集页重叠 |
| 字幕组 RSS（精确集数/种子体积） | 10~20 | 0.4~2s | 2~5s |

改造前是一次性等全部阶段（约 9~11s），所以点搜索要愣很久。现在的做法：

- **站点级并发闸门**（`app/server/limiter.js`）：一次搜索的单集页 / 主页 / RSS 共用每个 origin 6 条在飞的队列。实测单条 p90 ≈ 1.5~2s，12 个单集页 4 并发要 3 轮、6 并发只要 2 轮；再高（8/12 并发）站点会给出 20s 级慢响应。主页是「卡住整体进度」的请求，走 high 优先队列。
- **请求硬超时**：`http.js` 的 `deadline` 限制整个请求（含重定向与慢速回传）。原来的 `timeout` 只管连接空闲，站点慢速回传能拖到 20~30s。
- **阶段预算**：单集页总预算 8s、首屏 12s、整次搜索 14s，超预算就带着已有结果返回（`timings.episodesTruncated` / `timings.rssPartial`），不再空等。
- **两段式返回**：`/api/search?phase=core` 在「搜索 RSS + 单集页 + 主页」就绪时先返回（体积用主页大小列），`phase=full` 再用字幕组 RSS 校正精确集数与种子体积。前端先渲染 core，full 回来后原地替换，首屏从 ~9s 降到 4~7s。
- **抓取复用**：同一查询的 core / full 共用一个 job（`searchJobs`），搜索 RSS、单集页、主页、字幕组 RSS 都有 TTL 缓存 + in-flight 去重，第二次请求不会重复抓。

```bash
# 演示数据（假 qB、假 RSS、4 个追番、4 条补番记录、5 个预设）
node dev/demo.js
# 另开终端：
ANIRSS_DATA=../work/anirss-demo-data ANIRSS_PORT=8777 node app/server/index.js
```

### 打包 fnOS FPK

用 fnOS 官方的 `fnpack` 打包，然后用 `dev/repack-fpk.py` 修正生命周期脚本权限（Windows 上 `fnpack` 会把 `cmd/*` 写成 `0666`）：

```powershell
# 1) 打包（fnpack.exe 换成你自己的路径）
fnpack.exe build -d <项目目录>

# 2) 修正 cmd/ 权限并改名输出
python dev/repack-fpk.py anirss.fpk anirss-1.13.2.fpk
```

`repack-fpk.py` 只重写外层 tar（把生命周期脚本改成 `0755`），不改动 `app.tgz`，因此 `manifest.checksum` 仍然有效。构建后用 `tar -tzf` 检查顶层结构：`app.tgz`、`manifest`、`cmd/`、`config/`、`wizard/`、两个图标。

不想装 `fnpack` 也可以直接构建：`dev/build-fpk.py` 会自己拼出 `app.tgz` 与完整外层结构（权限、checksum 都按同一套 fnOS 约定），CI 用的就是它。

```bash
python dev/build-fpk.py                          # 产物 dist/anirss-<manifest 版本>.fpk
python dev/build-fpk.py --expect-version 1.13.3  # manifest 版本不是 1.13.3 就失败
python dev/build-fpk.py -o /tmp/anirss.fpk       # 指定输出路径
SOURCE_DATE_EPOCH=1700000000 python dev/build-fpk.py   # 固定时间戳，产物可复现
```

构建完会自检结构、权限、`manifest.checksum` 与文件清单，任何一项不对就非零退出。

### GitHub Actions：自动打包与发布

`.github/workflows/` 下两条流水线，都不依赖 fnpack：

| 工作流 | 触发 | 做什么 |
| --- | --- | --- |
| `ci.yml` | push 到 `main`、PR、手动 | Node 20 / 24 各跑一遍单元测试、烟测、性能自检；再用 Python 3.12 构建一次 FPK，连 `SHA256SUMS` 存成 artifact（保留 7 天） |
| `release.yml` | push tag `v1.13.3`、手动 | 先跑测试，再校验 manifest 版本与 tag 一致并构建 FPK，发布 GitHub Release（`anirss-1.13.3.fpk` + `SHA256SUMS`）；同时构建 amd64 + arm64 的 Docker 镜像推到 GHCR（`:1.13.3` / `:latest`） |

发版流程：

1. 在 `release/x.y.z` 分支里把 `manifest` 的 `version`、`changelog` 和 `package.json` 的 `version` 改成 `x.y.z`，提 PR 合进 `main`；
2. 打 tag 并推送：`git tag v1.13.3 && git push origin v1.13.3`；
3. `release.yml` 自动出包并发版。tag 和 manifest 版本不一致时流水线直接失败（`--expect-version`），不会发出错版本的包。

手动触发 `release.yml`（填写版本号）只构建 FPK 并作为 artifact 留存，不发 Release、不推镜像，适合验证打包。GHCR 镜像默认私有，想公开就到仓库的 Packages 设置里改可见性；不需要镜像可以删掉 `release.yml` 里的 `docker` job。

### 本地装机测试：别动仓库里的版本号

fnOS 只允许安装版本号高于已装版本的 FPK，所以反复真机测试时不能一直用 `manifest` 里的正式版本号，但也不该为了测试去改仓库（版本号改动会跟着 PR 进 `main`）。做法是：**dev 的差异只写进打包产物**。

#### 推荐：给 dev 包一个独立身份，与正式版共存

```bash
fnpack.exe build -d <项目目录>                      # 仓库版本号保持不动
python dev/pack-dev.py anirss.fpk anirss-dev.fpk --dev-identity
# 独立身份：appname=anirss-dev 端口=18182 入口=anirss-dev.main
```

`--dev-identity` 会把这些东西一起换掉，装完就是应用中心里的第二个条目：

| 位置 | 改什么 |
| --- | --- |
| `manifest` | `appname`、`display_name`（加 ` dev`）、`service_port`、`desktop_applaunchname` |
| `app/ui/config` | 桌面入口 key（`anirss.main` → `anirss-dev.main`）、端口、标题 |
| `config/privilege` | 运行用户/组（`anirss` → `anirss-dev`） |

好处是两边**互不覆盖**：正式版照常升级，dev 包想装多少次装多少次，数据目录由 fnOS 按 appname 隔离（`/var/apps/anirss-dev/var` vs `/var/apps/anirss/var`）。代价：

- dev 应用是另一个运行用户，需要在它的「应用设置 → 访问权限」里重新授权 qB 下载目录与硬链接目标目录；
- 配置不互通，想用现有配置就在正式版里「配置导出」，再在 dev 版里导入。

版本号仍按 `900 + 提交数` 递增，但只和它自己的上一版比较，所以不会把正式版挡在门外。

#### 次选：只换版本号，数字段递增

```bash
python dev/pack-dev.py anirss.fpk anirss-dev.fpk                      # 900 + git 提交数
python dev/pack-dev.py anirss.fpk anirss-dev.fpk --version 1.13.917
```

`pack-dev.py` 重写外层 tar 里的 `manifest`（版本、必要时的 checksum），`app.tgz` 没动时 checksum 保持不变，所以包仍然有效；它同时套用 `repack-fpk.py` 的权限修正，可以单独使用。装完 `git status` 仍是干净的。

代价是：dev 号高于正式版，之后装正式版会被判为降级，**得先卸载 dev 包**（卸载会带走 `/var/apps/anirss/var` 里的配置和下载记录，先导出配置）。

#### 不要用 `-dev` 后缀

**实测结论（2026-10，fnOS）：`-dev` 后缀不参与版本比较。** 装 `1.13.3-dev15` 之后再装 `1.13.3-dev16`，fnOS 判为同一版本、拒绝覆盖；而 `1.13.3-dev15` 本身能装上 `1.13.2`，说明后缀格式合法，只是不参与比较。

| 想写 | 实际参与比较的版本 | 能否覆盖上一版 dev |
| --- | --- | --- |
| `1.13.917`（900 + 提交数） | `1.13.917` | ✅ |
| `1.13.3-dev15` → `1.13.3-dev16` | 都是 `1.13.3` | ❌ |

四段号（`1.13.3.16`）仍未验证：测试机先装 `1.13.2`，再装 `1.13.2.1`，应用中心显示「升级」即四段可用。即便可用，之后装 `1.13.3` 正式版也会被判为降级，所以还是推荐独立身份。

> dev 包只用于本机测试，不要提交、不要发布。仓库 `manifest` 的版本号仍然只在 `release/x.y.z` 的 PR 里改。

### 发布注意

> ⚠️ `manifest` 里**不要**再写 `disable_authorization_path = true`。这一行会隐藏 fnOS「应用设置 → 访问权限」，而补番硬链接需要用户在那里授权 qB 下载目录与目标目录（应用以独立用户 `anirss` 运行，未授权时读不到文件）。`config/resource` 的 `data-share` 保持为空即可，用户通过「访问权限 → 添加」自行授权任意目录。

## 目录结构

```text
anirss/
├── app/
│   ├── server/         # Node.js 后端（HTTP、RSS、qB、调度、存储）
│   ├── www/            # 原生 HTML/CSS/JS 前端 + 主题初始化
│   └── ui/             # fnOS 桌面入口配置与图标
├── cmd/                # fnOS 生命周期脚本
├── config/             # fnOS privilege / resource
├── wizard/             # 卸载向导
├── docs/               # 截图与开发文档
├── dev/                # 单元测试、烟测、假 qB/RSS、截图脚本、打包脚本
├── .github/workflows/  # CI：测试 + 自动打包 FPK；Release：发版 + GHCR 镜像
├── manifest            # fnOS 应用元数据
├── ICON.PNG            # 64×64
├── ICON_256.PNG        # 256×256
├── start.cmd / start.sh
├── package.json
├── LICENSE
└── README.md
```

## 后端接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/state` | 全量状态（追番、预设、统计、最近下载、日志） |
| POST | `/api/qb/test` | 测试 qBittorrent 连接 |
| PUT | `/api/qb/config` | 保存连接配置 |
| GET | `/api/qb/status` | qB 版本、速度、活动任务 |
| PUT | `/api/proxy` | 保存网络代理配置 |
| POST | `/api/proxy/test` | 通过当前/表单代理测试请求 |
| GET | `/api/cover/:id` | 同源代理追番封面图片 |
| POST | `/api/subs/:id/meta` | 刷新追番的封面/番组信息 |
| POST | `/api/resolve` | 从追番地址解析名称 / 番组信息，不落库 |
| POST | `/api/guess-episode` | 从文件名/种子名猜集数（最多 50 行） |
| GET | `/api/search` | 在站点搜索番剧与发布组（`q`、`baseId`、`limit`、`phase=core\|full`）；`core` 先返回番剧/发布组/主页大小，`full` 再补字幕组 RSS 的精确体积 |
| GET | `/api/image` | 同源代理搜索结果封面（仅允许配置站点与 Mikan/bgm 域名） |
| GET/POST | `/api/extras` | 补番记录列表 / 新增磁力链接 |
| POST | `/api/extras/upload` | 新增种子文件（base64） |
| POST | `/api/extras/status` | 批量刷新补番任务状态（下载完成的会顺带自动硬链接） |
| PUT | `/api/hardlink` | 保存硬链接设置（扩展名 / 默认目标目录 / 去掉种子顶层目录） |
| POST | `/api/extras/:id/hardlink` | 立即对某条补番执行硬链接（幂等，已有的文件跳过） |
| PUT | `/api/extras/:id/hardlink` | 修改某条补番的硬链接目标/季/开关/重命名/集数偏移（`dest` 支持 `${name}`/`${season}`，空串 = 取消硬链接） |
| POST | `/api/extras/:id/subs/upload` | 批量上传外挂字幕（`{files:[{name,data(base64)}]}`）；zip/tar 压缩包自动解压，非字幕文件跳过 |
| POST | `/api/extras/:id/subs/fetch` | 从 http 直链抓取字幕（字幕文件或 zip/tar 压缩包，≤96MB） |
| DELETE | `/api/extras/:id/subs` | 删除字幕库文件；`?name=<相对路径>` 删单个，`?all=1` 清空 |
| DELETE | `/api/extras/:id` | 删除补番记录（同时清空其字幕库）；`?deleteTorrent=1&deleteFiles=1` 同时删除 qB 任务与文件 |
| POST | `/api/preview` | 预览任意 RSS + 正则，不落库 |
| GET/POST | `/api/subs` | 追番列表 / 新增 |
| PUT/DELETE | `/api/subs/:id` | 修改 / 删除 |
| POST | `/api/subs/:id/check` | 立即检查并提交新匹配 |
| POST | `/api/subs/:id/preview` | 预览该追番 |
| POST | `/api/subs/:id/download` | 手动下载某条 |
| POST | `/api/subs/:id/toggle` | 暂停 / 启用 |
| POST | `/api/subs/:id/reset` | 清空已见记录 |
| GET/DELETE | `/api/downloads` | 下载记录 / 清空 |
| POST | `/api/downloads/:id/retry` | 重试失败记录 |
| GET | `/api/export` | 导出配置（不含密码） |
| POST | `/api/import` | 导入配置（站点 / 路径 / 追番 / 补番 / 连接；密码不从文件读取） |

所有接口都基于同源访问，没有额外的 API Token。独立端口不要把 18181 直接暴露到公网。

## 限制

- 只按标题匹配，不解析简介、字幕组字段或集数范围。
- 不做多用户隔离，也没有内置登录（依赖本机回环、网络控制或反向代理）。
- 不把追番同步到 qBittorrent 自带 RSS 列表。
- 应用停止运行期间不会检查 RSS；重新启动后由调度器继续。
- 路径模板只在前端展开成最终 `savepath`，不会保存变量本身；修改预设不会回改已有追番；`${name}` 在保存时替换为当时的追番名称，之后改名不会自动改已有追番的路径，需要重新保存追番。
- 站点搜索只支持 Mikan 系站点，依赖站点的 RSS 搜索与页面结构；站点改版可能导致搜索失效，此时手动填写追番路径仍然可用。
- 补番记录里的种子文件不会保存在应用数据里（只记录 infohash、文件名和路径），需要重新上传才能再次提交。
- 补番硬链接只作用于「补番」，追番下载暂不参与；默认「正片 + 字幕」模式依赖集数识别，识别不到集数的剧场版会退化为链接最浅一层的视频；同集多个版本只保留路径最浅/体积最大的那个；硬链接要求目标目录与 qBittorrent 保存目录在同一文件系统，跨分区会失败；qBittorrent 在 Docker 里时，容器内路径必须在本机同样存在，否则会看到「下载目录在本机不存在或应用没有访问权限」。
- 依赖 Node.js 18+ 和 qBittorrent WebAPI v2（qB 4.x / 5.x）。
