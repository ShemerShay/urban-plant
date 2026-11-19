import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/plant-library/[filename]": ["./data/plant-library/**"],
  },
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
