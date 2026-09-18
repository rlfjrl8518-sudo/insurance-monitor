import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "보험업종 DA소재 모니터링",
  description: "경쟁사 메타 광고 소재 수집·분류·분석",
};

// 좌측 고정 내비. 기능이 늘어날 자리를 먼저 잡아둔다.
// 아직 안 만든 화면은 준비중으로 두고, 링크를 눌러도 빈 화면이 뜨지 않게 한다.
const 메뉴 = [
  { 이름: "탐색", 경로: "/", 준비됨: true },
  { 이름: "브랜드", 경로: "/brands", 준비됨: false },
  { 이름: "경쟁 비교", 경로: "/compare", 준비됨: false },
  { 이름: "인사이트", 경로: "/insights", 준비됨: false },
  { 이름: "교차분석", 경로: "/crosstab", 준비됨: false },
  { 이름: "보드", 경로: "/boards", 준비됨: false },
  { 이름: "AI 어시스턴트", 경로: "/assistant", 준비됨: false },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="bg-[#fdfdfe] text-[#16181d] antialiased">
        <div className="flex min-h-screen">
          <aside className="w-[200px] shrink-0 border-r border-[#e9eaee] bg-white">
            <div className="px-5 py-5 text-[15px] font-bold tracking-tight">
              DA소재 모니터링
            </div>
            <nav className="px-2">
              {메뉴.map((m) =>
                m.준비됨 ? (
                  <Link
                    key={m.경로}
                    href={m.경로}
                    className="block rounded-lg px-3 py-2 text-[13px] text-[#16181d] hover:bg-[#ebf1fd]"
                  >
                    {m.이름}
                  </Link>
                ) : (
                  <span
                    key={m.경로}
                    className="block cursor-default rounded-lg px-3 py-2 text-[13px] text-[#c2c6cd]"
                    title="준비 중"
                  >
                    {m.이름}
                  </span>
                ),
              )}
            </nav>
          </aside>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
