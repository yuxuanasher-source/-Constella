-- 收紧 jy-private 桶单文件上限：2GB (2147483648) → 300MB (314572800)，
-- 与解析侧 RECORDING_MAX_FILE_BYTES 闸门对齐（阶段0 整改 R7），从存储层
-- 兜底拦下超大录屏。幂等：按 id 定位 update，重复执行无副作用
-- （id/name 均为 'jy-private'，见 20260601161000_initial_foundation.sql 建桶语句）。
--
-- 注意（运维手工项）：storage 容器的全局 FILE_SIZE_LIMIT 环境变量需要在
-- 服务器 docker 配置中同步调整，否则容器级限制与桶级限制不一致——本迁移
-- 只能改桶级限制，管不到容器 env。
update storage.buckets
set file_size_limit = 314572800
where id = 'jy-private';
