# 数据库每日备份 Runbook（阶段0 整改 R1 / 验收清单 C1）

生产库跑在腾讯云轻量服务器的 Supabase 自托管容器里，本 runbook 覆盖每日
`pg_dump` 备份 + 上传 COS + 本地滚动保留的部署与验收。恢复演练属运维项 R2，
本文只给一句话指引（见末节）。

## 组成

| 文件                               | 作用                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `scripts/backup.sh`                | 备份主脚本：pg_dump -Fc 导出 → 大小校验 → 调用上传脚本 → 本地保留最近 3 份 → 失败发企微告警并非 0 退出 |
| `scripts/backup-upload-to-cos.mjs` | 用仓库已有依赖 `cos-nodejs-sdk-v5` 把备份文件 `sliceUploadFile` 到 COS 的 `db/` 前缀                   |

两个脚本均不进应用运行时，只依赖服务器上已有的 docker / node / 仓库
`node_modules`（deploy.sh 每次部署都会 `pnpm install`）。

## 环境变量清单

| 变量                    | 必填 | 默认值                        | 说明                                                                           |
| ----------------------- | ---- | ----------------------------- | ------------------------------------------------------------------------------ |
| `DB_CONTAINER`          | 否   | `supabase-db`                 | Supabase DB 容器名，同 `deploy.sh`                                             |
| `BACKUP_DIR`            | 否   | `/var/backups/jingying-cabin` | 本地备份目录（脚本自动 `mkdir -p`）                                            |
| `BACKUP_MIN_BYTES`      | 否   | `1048576`（1MB）              | 导出文件小于该值判定为异常并告警                                               |
| `BACKUP_KEEP`           | 否   | `3`                           | 本地保留的最近备份份数                                                         |
| `WECOM_WEBHOOK_URL`     | 否   | 空                            | 企业微信机器人 webhook；配置后任一步失败会发文本告警（含主机名与错误摘要）     |
| `BACKUP_COS_SECRET_ID`  | 是   | —                             | 备份专用 COS 密钥 SecretId（建议独立于业务密钥 `TENCENT_*`，最小授权到备份桶） |
| `BACKUP_COS_SECRET_KEY` | 是   | —                             | 备份专用 COS 密钥 SecretKey                                                    |
| `BACKUP_COS_BUCKET`     | 是   | —                             | 备份目标桶（形如 `example-1250000000`）                                        |
| `BACKUP_COS_REGION`     | 是   | —                             | 桶所在地域（形如 `ap-guangzhou`）                                              |

建议把上述 env 收敛到 `/etc/jingying-cabin/backup.env`（`chmod 600`，root 持有），
不要写进仓库或 crontab 明文之外的多处。

## crontab 配置

以 root（或有 docker 权限的运维账号）安装，每天 03:30 备份：

```cron
30 3 * * * . /etc/jingying-cabin/backup.env && bash /var/www/jingying-cabin/scripts/backup.sh >> /var/log/jingying-cabin-backup.log 2>&1
```

`/etc/jingying-cabin/backup.env` 示例（自行替换真实值）：

```sh
export BACKUP_COS_SECRET_ID=AKIDxxxxxxxx
export BACKUP_COS_SECRET_KEY=xxxxxxxx
export BACKUP_COS_BUCKET=example-1250000000
export BACKUP_COS_REGION=ap-guangzhou
export WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx
```

## 验收方法（对应清单 C1）

1. **手动跑通**：`. /etc/jingying-cabin/backup.env && bash scripts/backup.sh`，
   退出码为 0，日志依次出现「导出完成 / 上传 COS / 备份完成」。
2. **本地产物**：`ls -l /var/backups/jingying-cabin/` 有当天 `db-YYYYmmdd.dump`
   且大小 ≥ 1MB。
3. **COS 产物**：COS 控制台（或 coscli）在备份桶 `db/` 前缀下能看到同名对象，
   大小与本地一致。
4. **滚动保留**：连跑 4 天（或手动伪造 4 个 `db-*.dump` 后再跑一次），本地
   目录只剩最近 3 份。
5. **失败告警**：临时去掉 `BACKUP_COS_SECRET_ID` 再跑一次，脚本非 0 退出，
   且（配置了 webhook 时）企微群收到「数据库备份失败」文本告警；验完记得还原。
6. **cron 生效**：次日检查 `/var/log/jingying-cabin-backup.log` 有新一轮成功日志。

## 恢复指引（R2 引用）

恢复与演练属运维项 R2，不在本 PR 范围。应急时一句话恢复（务必先在演练库验证）：

```sh
docker exec -i supabase-db pg_restore -U postgres -d postgres --clean --if-exists < /var/backups/jingying-cabin/db-YYYYmmdd.dump
```

恢复后按 `deploy.sh` 的提示刷新 PostgREST schema 缓存
（`notify pgrst, 'reload schema'`）。完整演练流程以 R2 的产出为准。
