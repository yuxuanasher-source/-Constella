const currentLink = process.env.CURRENT_LINK;
const releaseSha = process.env.RELEASE_SHA;
const releaseManifestSha256 = process.env.RELEASE_MANIFEST_SHA256;

if (!currentLink || !currentLink.startsWith("/")) {
  throw new Error("CURRENT_LINK must be an absolute path");
}
if (!releaseSha || !/^[0-9a-f]{40}$/.test(releaseSha)) {
  throw new Error("RELEASE_SHA must be a full lowercase Git SHA");
}
if (!releaseManifestSha256 || !/^[0-9a-f]{64}$/.test(releaseManifestSha256)) {
  throw new Error("RELEASE_MANIFEST_SHA256 must be a full lowercase SHA-256");
}

module.exports = {
  apps: [
    {
      name: process.env.PM2_NAME || "jingying-cabin",
      cwd: process.env.CURRENT_LINK,
      script: ".next/standalone/server.js",
      interpreter: process.execPath,
      env: {
        ...process.env,
        NODE_ENV: "production",
        NODE_PATH: `${currentLink}/.next/standalone/node_modules/.pnpm/node_modules`,
        RELEASE_SHA: process.env.RELEASE_SHA,
        RELEASE_MANIFEST_SHA256: releaseManifestSha256,
        PORT: process.env.PORT || "3000",
        HOSTNAME: "127.0.0.1",
      },
    },
  ],
};
