/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Dev-server origins allowed to open the HMR socket. Without the LAN address
  // here, pages opened from another device render but never hydrate, so nothing
  // on them is clickable. Add your machine's LAN IP when it changes.
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.68.84", "192.168.68.*"],
  // Desktop build output and runtime uploads live inside the project. Without
  // this the dev file watcher walks ~1.8GB of packaged binaries on every change.
  webpack(config) {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/release/**", "**/public/uploads/**"],
    };
    return config;
  },
};

module.exports = nextConfig;
