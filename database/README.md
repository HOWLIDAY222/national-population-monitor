# PostgreSQL数据库

迁移顺序：

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f database/migrations/001_initial.sql
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f database/migrations/002_roles.sql
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f database/migrations/003_operational_hardening.sql
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f database/migrations/004_source_discovery.sql
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f database/migrations/005_document_source_kind.sql
```

应用不得使用超级用户连接。查询API继承 `population_api_readonly`，采集发布服务继承 `population_pipeline_writer`。生产连接应通过PgBouncer事务池或云数据库连接池。

完整迁移链已通过隔离的真实 PostgreSQL 17 实例验证，覆盖约束、角色权限、种子数据、审核发布、回滚与并发 `SKIP LOCKED` 作业领取。生产部署仍应在目标数据库先执行备份，再按顺序迁移并检查查询计划。
