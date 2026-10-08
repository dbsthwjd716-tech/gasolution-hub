import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 네이버 유상실적 CSV 업로드 (Vercel 요청 한도 4.5MB 안쪽)
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
