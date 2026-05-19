import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "http",  hostname: "localhost",     port: "5001", pathname: "/uploads/**" },
      { protocol: "http",  hostname: "127.0.0.1",     port: "5001", pathname: "/uploads/**" },
      { protocol: "https", hostname: "res.cloudinary.com", pathname: "/**" },
      // add production hosts here when deploying
    ],
  },
};

export default nextConfig;
