#!/usr/bin/env node
// 经营舱数据库备份上传腾讯云 COS（阶段0 整改 R1）。
// 供 scripts/backup.sh 调用，不进应用运行时。
//
//   node scripts/backup-upload-to-cos.mjs /var/backups/jingying-cabin/db-20260706.dump
//
// 必需环境变量（缺任一即明确报错、非 0 退出）：
//   BACKUP_COS_SECRET_ID   COS 密钥 SecretId
//   BACKUP_COS_SECRET_KEY  COS 密钥 SecretKey
//   BACKUP_COS_BUCKET      目标桶（形如 example-1250000000）
//   BACKUP_COS_REGION      桶所在地域（形如 ap-guangzhou）
//
// 上传到桶内 db/ 前缀（key = db/<文件名>），成功打印 COS key。
// 有意与应用运行时的 TENCENT_COS_*（lib/config/env.ts）分开命名：
// 备份桶/密钥建议独立于业务桶授权，避免应用密钥泄漏波及备份。

import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

import COS from "cos-nodejs-sdk-v5";

function die(message) {
  console.error(`[backup-upload] ${message}`);
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  die("用法：node scripts/backup-upload-to-cos.mjs <备份文件路径>");
}
const absolutePath = resolve(filePath);
if (!existsSync(absolutePath)) {
  die(`找不到备份文件：${absolutePath}`);
}

const REQUIRED_ENV = [
  "BACKUP_COS_SECRET_ID",
  "BACKUP_COS_SECRET_KEY",
  "BACKUP_COS_BUCKET",
  "BACKUP_COS_REGION",
];
const missing = REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  die(`缺少必需环境变量：${missing.join("、")}`);
}

const cos = new COS({
  SecretId: process.env.BACKUP_COS_SECRET_ID.trim(),
  SecretKey: process.env.BACKUP_COS_SECRET_KEY.trim(),
});

const key = `db/${basename(absolutePath)}`;

// sliceUploadFile：SDK 自带分块上传与失败重试，适配数百 MB 级别的备份文件。
try {
  await new Promise((resolvePromise, rejectPromise) => {
    cos.sliceUploadFile(
      {
        Bucket: process.env.BACKUP_COS_BUCKET.trim(),
        Region: process.env.BACKUP_COS_REGION.trim(),
        Key: key,
        FilePath: absolutePath,
      },
      (error) => (error ? rejectPromise(error) : resolvePromise(undefined)),
    );
  });
} catch (error) {
  die(`COS 上传失败：${error?.message || error}`);
}

console.log(key);
