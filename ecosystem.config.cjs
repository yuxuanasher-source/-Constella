const currentLink = process.env.CURRENT_LINK;
const releaseSha = process.env.RELEASE_SHA;

if (!currentLink || !currentLink.startsWith("/")) {
  throw new Error("CURRENT_LINK must be an absolute path");
}
if (!releaseSha || !/^[0-9a-f]{40}$/.test(releaseSha)) {
  throw new Error("RELEASE_SHA must be a full lowercase Git SHA");
}

module.exports = {
  apps: [
    {
      name: process.env.PM2_NAME || "jingying-cabin",
      cwd: process.env.CURRENT_LINK,
      script: "pnpm",
      args: "start",
      env: {
        NODE_ENV: "production",
        RELEASE_SHA: process.env.RELEASE_SHA,
        PORT: process.env.PORT || "3000",
      },
    },
  ],
};
