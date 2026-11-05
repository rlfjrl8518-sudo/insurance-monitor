import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "보험업종 DA소재 모니터링",
  description: "경쟁사 메타 광고 소재 수집·분류·분석",
};

// 좌측 고정 내비. REFHUB처럼 어두운 사이드바로 두어 본문(밝은 배경)과 층을 나눈다.
const 메뉴: { 이름: string; 경로: string; 아이콘: string }[] = [
  { 이름: "탐색", 경로: "/", 아이콘: "◎" },
  { 이름: "변화", 경로: "/changes", 아이콘: "↗" },
  { 이름: "브랜드", 경로: "/brands", 아이콘: "▤" },
  { 이름: "분석", 경로: "/analysis", 아이콘: "◫" },
  { 이름: "보드", 경로: "/boards", 아이콘: "❏" },
  { 이름: "설정", 경로: "/settings", 아이콘: "⚙" },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="bg-[#f7f8fa] text-[#16181d] antialiased">
        <div className="flex min-h-screen">
          <aside className="flex w-[212px] shrink-0 flex-col bg-[#1b1f33] text-white">
            <div className="px-5 pb-6 pt-6">
              <div className="text-[15px] font-bold tracking-tight">
                DA소재 모니터링
              </div>
              <div className="mt-0.5 text-[11px] text-white/40">
                보험업종 경쟁사 레퍼런스
              </div>
            </div>

            <nav className="flex-1 px-3">
              {메뉴.map((m) => (
                <Link
                  key={m.경로}
                  href={m.경로}
                  className="mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
                >
                  <span className="w-4 text-center text-[12px] opacity-70">{m.아이콘}</span>
                  {m.이름}
                </Link>
              ))}
            </nav>

            <div className="px-5 py-5 text-[11px] leading-relaxed text-white/30">
              수집 자동화 · 하루 2회
              <br />
              09:05 · 15:05 (Cloud Run 예약 실행)
            </div>
          </aside>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
