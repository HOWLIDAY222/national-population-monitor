# 系统架构与边界

## 纵向数据链路

```text
官方公开来源
  → 条件请求与内容哈希
  → 原始快照（只追加）
  → 格式解析与字段标准化
  → 待验证记录与质量问题
  → 自动发布或等待审核
  → 不可变正式版本
  → 查询API与SSE变更事件
  → React地图、指标、趋势、排名和来源状态
```

## 运行模块

| 目录 | 职责 |
| --- | --- |
| `server/src/collection` | HTTP条件请求、哈希、原始快照保存 |
| `server/src/parsers` | HTML、JSON、CSV、Excel、PDF解析 |
| `server/src/validation` | 记录级、批次级和版本差异校验 |
| `server/src/publishing` | 版本发布、事件生成和回滚 |
| `server/src/storage` | 文件开发仓储与PostgreSQL正式仓储 |
| `server/src/scheduler` | 来源检查计划、重试和作业领取 |
| `server/src/api` | 快照、历史、来源、版本、状态与SSE |
| `database/migrations` | PostgreSQL模式、索引和只读/写入角色 |
| `raw-storage` | 原始HTML、JSON、CSV、Excel、PDF和响应元数据 |
| `monitoring` | 结构化运行日志；不存储个人信息 |

## 存储策略

- 正式环境使用PostgreSQL，应用通过连接池访问。
- 当前本机没有PostgreSQL或Docker，因此开发和自动化测试使用文件仓储适配器；它不是正式部署替代品。
- 两种仓储实现同一方法契约，发布、校验、API和SSE逻辑不依赖具体数据库。
- 原始快照按来源和日期保存，内容哈希去重，只追加不覆盖。
- 正式指标记录绑定不可变版本；回滚通过切换发布状态实现，不删除历史记录。

## 安全边界

- 公开查询API只读。
- 发布、回滚和手动采集接口必须提供管理令牌；未配置令牌时接口关闭。
- 数据模型不包含姓名、身份证号、手机号、地址轨迹或个人定位字段。
- 高频数据只能保存合法授权的聚合指数或客流，不包装为个人级人口数量。
