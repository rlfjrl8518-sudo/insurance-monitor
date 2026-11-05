import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run 이미지에 필요한 파일만 담는다 (web/Dockerfile).
  output: "standalone",
  // 리다이렉트 헤더엔 한글을 못 싣는다(인코딩해도 Next가 풀어서 500). 그래서 탭 값은 영문.
  // 인사이트·경쟁 비교·교차분석은 '분석' 한 화면으로 합쳤다. 예전 북마크가 깨지지 않게 넘긴다.
  async redirects() {
    return [
      { source: "/insights", destination: "/analysis?tab=insight", permanent: false },
      { source: "/compare", destination: "/analysis?tab=compare", permanent: false },
      { source: "/crosstab", destination: "/analysis?tab=crosstab", permanent: false },
    ];
  },
};

export default nextConfig;
