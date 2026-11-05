import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 인사이트·경쟁 비교·교차분석은 '분석' 한 화면으로 합쳤다. 예전 북마크가 깨지지 않게 넘긴다.
  async redirects() {
    return [
      { source: "/insights", destination: "/analysis?탭=요약", permanent: false },
      { source: "/compare", destination: "/analysis?탭=교차&행=광고주&보기=비중", permanent: false },
      { source: "/crosstab", destination: "/analysis?탭=교차&보기=표", permanent: false },
    ];
  },
};

export default nextConfig;
