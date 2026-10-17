/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module: load it from node_modules at runtime.
  serverExternalPackages: ["better-sqlite3"],
  // The workspace packages ship TypeScript source.
  transpilePackages: ["@kronos/core", "@kronos/db"],
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
};
export default nextConfig;
