import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Dev-server origins allowed to open the HMR socket. Without the LAN address
  // here, pages opened from another device render but never hydrate, so nothing
  // on them is clickable. Add your machine's LAN IP when it changes.
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.68.84", "192.168.68.*"],
};

export default nextConfig;
