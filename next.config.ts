import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@nimiq/core", "@prisma/client", "@prisma/adapter-pg"],
};

export default nextConfig;