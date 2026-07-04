// PM2 进程配置：用 `pm2 start deploy/pm2/ecosystem.config.js` 启动经营舱
// 前提：已经执行过 `pnpm install` 和 `pnpm build`，且根目录有 .env.local
module.exports = {
  apps: [
    {
      name: "jingying-cabin",
      // 用 pnpm 调用 next start；端口固定 3000，由 Nginx 反代
      script: "pnpm",
      args: "start",
      cwd: __dirname + "/../..",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
  ],
};
