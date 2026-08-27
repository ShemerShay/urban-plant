import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: "/pos/:spotSlug",
        destination: "/checkout/pos/:spotSlug",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
