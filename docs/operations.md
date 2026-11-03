# 运行、备份与恢复门禁

## 健康检查

- `GET /api/health` 用于进程与存储连接探活。
- `GET /api/v1/status` 用于来源在线、延迟、失败、候选资源、待审核记录、正式版本和作业队列监测。
- 采集或解析失败不会清空正式数据；前端继续使用上一正式快照并通过 SSE 重连。

## 生成并校验备份

文件仓储模式会备份 `state.json`、原始快照与来源配置；PostgreSQL 模式使用 `pg_dump` 自定义格式，同时备份原始快照与来源配置。备份目录必须位于数据输入目录之外。

```powershell
pnpm --dir server backup -- --output D:\population-backups
pnpm --dir server verify:backup D:\population-backups\population-<timestamp>-<id>
```

每个备份包含 `manifest.json`，逐文件记录 SHA-256 与字节数；创建命令只有在复制完成并重新校验全部文件后才返回成功。失败的半成品目录会自动删除。

PostgreSQL 模式需要：

```powershell
$env:STORAGE_DRIVER = 'postgres'
$env:DATABASE_URL = '<从安全凭据存储注入>'
$env:PG_DUMP_PATH = 'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe'
pnpm --dir server backup -- --output D:\population-backups
```

数据库密码只通过子进程环境传入 `pg_dump`，不会写入命令参数、清单或控制台输出。备份目录仍应使用受限 ACL，并由独立介质或对象存储进行异地复制。

## 周期任务建议

- PostgreSQL：每日逻辑备份、每周恢复演练，并结合托管服务的连续归档或时间点恢复。
- 原始快照：每日增量复制，保留策略应覆盖至少一个完整年度发布周期。
- `manifest.json`：每次异地复制后重新执行 `verify:backup`。
- 不要在运行中的数据目录内创建备份，避免递归复制和故障域重叠。

## 恢复门禁

恢复会覆盖运行状态，因此不提供隐式“一键恢复”。正式恢复应在隔离环境执行：先校验清单，再恢复数据库或文件状态，核对版本数、指标数、原始哈希与最新快照，最后切换流量。恢复前必须保留当前故障现场和一份新的只读备份。

## 当前验收边界

自动化测试验证文件备份的完整性清单与损坏检测；PostgreSQL 迁移、发布和回滚使用真实 PostgreSQL 17 验证。生产环境的定时任务、异地存储和真实灾难恢复仍需在目标基础设施上执行演练后才能视为完成。
