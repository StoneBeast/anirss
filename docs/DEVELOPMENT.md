# 开发与打包参考

> 面向改代码 / 重新打包的人。普通使用请看 [README](../README.md)。

## 环境

- Node.js 18+（fnOS 包依赖 `nodejs_v24`）
- 零 npm 依赖：`node app/server/index.js` 直接跑，没有构建步骤
- 测试数据与假 qB / 假 RSS 都在 `dev/`，不会进入发布包

## 测试

```bash
node dev/unit.js        # 单元测试（19 项）：RSS 2.0 / Atom、实体解码、正则、URL 拼接、infohash、集数识别
node dev/smoke.js       # 端到端烟测（34 项）：拉起真实服务 + 内置假 qBittorrent / 假 RSS 站点
node dev/ui-actions.js  # 浏览器交互测试（45 项）：需要 Chrome CDP 9222 + 演示实例 8777
node dev/ui-shot.js     # 重新生成 docs/ 下的截图
node dev/ui-empty.js    # 空数据首启引导截图
```

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
python dev/repack-fpk.py anirss.fpk anirss-1.7.0.fpk
```

`repack-fpk.py` 只重写外层 tar（把生命周期脚本改成 `0755`），不改动 `app.tgz`，因此 `manifest.checksum` 仍然有效。构建后用 `tar -tzf` 检查顶层结构：`app.tgz`、`manifest`、`cmd/`、`config/`、`wizard/`、两个图标。

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
| GET | `/api/search` | 在站点搜索番剧与发布组（`q`、`baseId`、`limit`） |
| GET | `/api/image` | 同源代理搜索结果封面（仅允许配置站点与 Mikan/bgm 域名） |
| GET/POST | `/api/extras` | 补番记录列表 / 新增磁力链接 |
| POST | `/api/extras/upload` | 新增种子文件（base64） |
| POST | `/api/extras/status` | 批量刷新补番任务状态 |
| DELETE | `/api/extras/:id` | 删除补番记录；`?deleteTorrent=1&deleteFiles=1` 同时删除 qB 任务与文件 |
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
- 依赖 Node.js 18+ 和 qBittorrent WebAPI v2（qB 4.x / 5.x）。
