import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    cpus: 1,
  },
  generateBuildId: async () => {
    const releaseSha = process.env.RELEASE_SHA;
    return releaseSha && /^[0-9a-f]{40}$/.test(releaseSha)
      ? releaseSha
      : "local-build";
  },
};

export default nextConfig;
