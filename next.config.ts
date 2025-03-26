import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    domains: [
      'via.placeholder.com',
      'i.scdn.co',      // Spotify album art
      'platform-lookaside.fbsbx.com',
      'avatars.githubusercontent.com'
    ],
  },
  webpack: (config, { isServer }) => {
    // If client-side, don't include fs module
    if (!isServer) {
      config.resolve.fallback = {
        fs: false,
        path: false,
      };
    }
    return config;
  },
};

export default nextConfig;