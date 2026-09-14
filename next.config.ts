import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@nimiq/core", "@prisma/client", "@prisma/adapter-pg"],
  allowedDevOrigins: ["192.168.1.137"],
};

export default nextConfig;
