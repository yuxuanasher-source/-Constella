-- 提高 jy-private 桶单文件上限：50MB (52428800) → 2GB (2147483648)，
-- 支撑整段直播录屏原始文件上传。幂等：按 id 定位 update，重复执行无副作用
-- （id/name 均为 'jy-private'，见 20260601161000_initial_foundation.sql 建桶语句）。
--
-- 注意（运维手工项）：storage 容器的全局 FILE_SIZE_LIMIT 环境变量需要在
-- 服务器 docker 配置中同步调大，否则上传仍会被容器级限制拦下——本迁移
-- 只能改桶级限制，管不到容器 env。
update storage.buckets
set file_size_limit = 2147483648
where id = 'jy-private';
