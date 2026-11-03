# 全国人口公开数据态势平台

这是一个面向公开人口统计数据的持续采集、治理、审核发布与态势展示平台。系统只处理国家及地方统计机构公开发布的聚合数据，不采集、不推断、不展示个人身份、个人状态或个人实时位置。

## 公开访问

- 源码仓库：https://github.com/HOWLIDAY222/national-population-monitor
- 网页演示：https://population-monitor-howliday222.hrcyu522.chatgpt.site/
- GitHub Pages 备用地址（需先启用）：https://howliday222.github.io/national-population-monitor/

公开网站由 Sites 托管静态演示版，使用内置演示数据展示地图、分析、回放及巡航功能，不运行 Node.js 采集服务，也不宣称实时更新官方统计数据。完整数据采集、审核及 SSE 功能需要按下文运行后端。

推送 `main` 分支会触发 `.github/workflows/deploy-pages.yml`，运行前端测试和静态构建。启用 Pages 后也会自动部署 GitHub Pages；未启用时跳过部署。首次开启需在仓库 **Settings → Pages → Source** 选择 **GitHub Actions**，然后在 Actions 中手动运行此工作流。

本地构建静态演示版：

```powershell
$env:VITE_PUBLIC_BASE='./'
$env:VITE_STATIC_PUBLISH='true'
pnpm build
pnpm preview
```

## 当前实现

- 已接入国家统计局 2025 年年度人口公报、2025 年全国 1% 人口抽样调查、第六和第七次全国人口普查 31 省地区人口表，以及 31 个省级地区的 2025 年度人口公报；每个来源使用独立数据集键和统计时点，禁止混合口径。
- 支持 HTML、JSON、CSV、Excel、PDF 与旧版 Word 六类来源；纯图片 PDF 和旧版 Word 使用原始文件 SHA-256 锁定的人工复核记录，文件变化后必须重新审核。
- 已实现来源变更检测、条件请求、SHA-256 去重、原始文件追加存档、解析批次、待验证层、校验规则、人工发布门禁、不可变正式版本与回滚事件。
- 已实现定时调度、指数退避重试、崩溃作业恢复、来源健康状态、结构化日志、查询 API 与 SSE 增量事件。
- 前端优先读取正式快照，并通过 SSE 接收版本事件；接口不可用时进入明确标注的演示降级模式，不把演示值写入正式快照。
- 总人口图层默认展示 31 个省级地区 2025 年度公报正式人口，并可在“历年”模式离散回放 2010-11-01、2020-11-01 两次普查和 2025 年末省级公报三个完整切片；密度、流动、城市级详情及高频趋势仍是明确标注的演示层。
- 已配置 31 个省级统计门户发现监测器，与省级行政区一一对应；2026-07-16 真实审计覆盖全部 31 个地区并保留 164 条有效候选。系统从门户页面提取人口、公报、年鉴及 Excel/CSV/PDF/JSON 候选资源；候选只进入发现清单和事件，不会未经专用解析、校验和审核直接进入正式指标。

需求完成度与验收门槛见 [docs/requirements-matrix.md](docs/requirements-matrix.md)，架构说明见 [docs/architecture.md](docs/architecture.md)。

## 数据链路

```text
公开来源 → 条件请求/内容哈希 → 追加式原始存档
        → 格式解析 → staging 待验证记录 → 规则校验
        → 人工审核或自动发布门禁 → 正式版本 → REST API / SSE → 前端
```

任何采集、解析或校验失败都会保留上一正式版本。新数据只有通过校验和发布门禁后才会进入查询快照。

## 本地运行

需要 Node.js 22+ 与 pnpm。

```powershell
pnpm install
pnpm --dir server start
pnpm dev
```

默认地址：

- Web：`http://127.0.0.1:5173/`
- API：`http://127.0.0.1:8787/api/v1`
- SSE：`http://127.0.0.1:8787/api/v1/stream`

如果 8787 被占用，可以改用其他端口并把 Vite 代理指向它：

```powershell
$env:PORT = '8788'
pnpm --dir server start

$env:POPULATION_API_TARGET = 'http://127.0.0.1:8788'
pnpm dev
```

## 数据采集与审核

查看状态：

```powershell
pnpm --dir server status
```

查看全部待审核批次，或查看某一个批次的来源、原始快照元数据、记录差异与校验问题：

```powershell
pnpm --dir server review
pnpm --dir server review <parser-run-id>
```

采集指定公开来源：

```powershell
pnpm --dir server collect nbs-2025-national-bulletin
pnpm --dir server collect nbs-2025-sample-survey
pnpm --dir server collect nbs-sixth-census-provinces
pnpm --dir server collect nbs-seventh-census-provinces
```

并发采集全部 31 个省级年度公报、先做只读审核预检，再显式批准全部就绪批次：

```powershell
pnpm --dir server collect:provincial-annual
pnpm --dir server review:provincial-annual
pnpm --dir server review:provincial-annual -- --approve --actor=<reviewer-id>
```

默认不会自动发布。开发环境如需显式批准本次解析批次，可使用 `--approve`；正式环境应通过受保护的发布接口并记录审核人。

审计全部省级门户，或只复检当前非健康门户：

```powershell
pnpm audit:portals
pnpm --dir server audit:portals:unhealthy
pnpm --dir server audit:portals --refresh-discovery
```

门户审计默认并发数为 4，可通过 `PORTAL_AUDIT_CONCURRENCY` 调整为 1–8。`--refresh-discovery` 仅在来源尚无候选且条件请求返回 304 时追加一次无条件读取，用于新部署或发现规则升级后的安全回填。部分地方站点的 HTTPS 配置存在兼容性问题；平台会显式标记降级传输或官方备用页，不把它计作主入口正常。

## 存储模式

- `file`：本地开发与自动化测试适配器，状态写入 `server/.local-data/`。
- `postgres`：生产目标。迁移位于 `database/migrations/`，包含外键索引、JSONB GIN 索引、待处理部分索引、唯一正式版本约束和 `SKIP LOCKED` 作业领取。
- 原始响应存放于 `raw-storage/`，只追加不覆盖。
- 结构化运行日志存放于 `monitoring/`，不记录个人信息。

数据库迁移与仓储契约已在隔离的真实 PostgreSQL 17 实例中执行验证，覆盖角色权限、三层数据、审核查询、并发 `SKIP LOCKED` 作业领取、正式发布与回滚。生产部署仍需配置独立的 PostgreSQL 服务、备份策略与监控，不应使用测试实例。

备份命令、逐文件 SHA-256 校验、PostgreSQL `pg_dump` 配置与恢复门禁见 [docs/operations.md](docs/operations.md)。

## API 摘要

- `GET /api/v1/snapshot`：当前正式快照
- `GET /api/v1/status`：平台与来源聚合状态
- `GET /api/v1/sources`：来源状态与采集时间
- `GET /api/v1/events`：发布、回滚、校验和失败事件
- `GET /api/v1/discoveries`：地方门户发现的人口统计资源候选，可按 `sourceId`、`regionCode`、`status` 过滤
- `GET /api/v1/versions`：版本历史
- `GET /api/v1/review-runs`：待审核解析批次摘要
- `GET /api/v1/review-runs/:id`：待审核批次记录、差异与校验问题
- `GET /api/v1/indicators/:code/history`：指标历史；`regionCode=all` 返回所有地区的已发布正式记录
- `GET /api/v1/regions/:code`：区域正式记录
- `GET /api/v1/stream`：SSE 增量事件

管理接口只有配置 `ADMIN_TOKEN` 后才启用，且通过 `x-admin-token` 鉴权。

## 验证

```powershell
pnpm check
```

该命令运行文件仓储服务端测试、真实 PostgreSQL 17 集成测试、前端年度地图单元测试与前端生产构建。测试覆盖六类来源契约、哈希锁定人工复核、完整采集发布链路、重复内容去重、关系校验阻断、修订阈值、单位变化阻断、人工/自动发布门禁、回滚、来源失败保留旧版本、作业超时恢复、管理鉴权、审核队列、API、SSE 与三个完整省级人口时间切片。

## 专题路由

| 专题 | 地址 |
| --- | --- |
| 态势总览 | `#/overview` |
| 人口分布 | `#/distribution` |
| 结构分析 | `#/structure` |
| 流动监测 | `#/flow` |
| 城镇化观察 | `#/urbanization` |
| 区域对比 | `#/compare` |
| 数据更新状态 | `#/data-status` |
