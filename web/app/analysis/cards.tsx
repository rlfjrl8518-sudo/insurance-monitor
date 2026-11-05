import Link from "next/link";
import { sql } from "@/lib/db";

/** 인사이트·경쟁 비교가 같이 쓰는 카드. 표는 교차분석에만 두고, 두 화면은 '발견'만 카드로 보여준다.
 *  카드마다 근거 링크가 교차분석(같은 축·필터)으로 이어진다. */

export const 톤 = {
  발견: { 글: "#9a6412", 바탕: "#fff4e5" },
  좋음: { 글: "#18794e", 바탕: "#e7f6ec" },
  나쁨: { 글: "#c23934", 바탕: "#fff1f0" },
  자사: { 글: "#334fff", 바탕: "#eef1ff" },
} as const;
export type 톤이름 = keyof typeof 톤;

export type 카드 = {
  키: string;
  수치: string; // 크게 보이는 숫자 (×2.4, 18%p …)
  수치설명: string; // 숫자 밑 한 단어
  태그: string; // 축 이름
  제목: React.ReactNode; // 한 문장
  보조: string; // 근거 숫자 한 줄
  링크: string;
  링크이름?: string;
  톤: 톤이름;
  예시?: 소재[];
};

/** 카드에 붙일 예시 소재. 열 이름을 축 이름(보종·소구포인트…)으로 맞춰 x[축]으로 고른다. */
export type 소재 = {
  ad_id: string; image_url: string; g: string; 자사: boolean; 일수: number; 종료: boolean;
  보종: string | null; 소구포인트: string | null; 소재유형: string | null; 형식: string | null;
  퍼널단계: string | null; 오퍼: string | null;
};

export function 소재질의(조건: ReturnType<typeof sql>) {
  return sql`select ad_id, image_url, coalesce(advertiser_group, advertiser) g, coalesce(segment = '자사', false) 자사,
                    coalesce(running_days, 0)::int 일수, status = '종료' 종료,
                    insurance_type 보종, appeal_point 소구포인트, creative_type 소재유형, display_format 형식,
                    labels->>'퍼널단계' 퍼널단계, labels->>'오퍼' 오퍼
             -- ponytail: 메타 CDN 주소는 만료돼 깨진다. GCS로 옮겨지지 않은 소재는 예시에서 뺀다(수집에서 옮기면 풀 것)
             from ads where coalesce(image_url, '') <> '' and image_url not like '%fbcdn.net%' and ${조건}
             order by running_days desc nulls last` as unknown as Promise<소재[]>;
}

/** 조건에 맞는 소재 n개. 한 광고주로 몰리지 않게 광고주마다 하나씩 먼저 고르고 남는 자리를 채운다.
 *  목록 순서(오래 돈 순 등)를 그대로 따른다. */
export function 예시고르기(소재들: 소재[], 맞나: (x: 소재) => boolean, n = 4) {
  const 맞는것 = 소재들.filter(맞나);
  const 고른 = new Set<소재>();
  const 본광고주 = new Set<string>();
  for (const x of 맞는것) {
    if (고른.size >= n) break;
    if (!본광고주.has(x.g)) { 고른.add(x); 본광고주.add(x.g); }
  }
  for (const x of 맞는것) {
    if (고른.size >= n) break;
    고른.add(x);
  }
  return [...고른];
}

/** 받침에 맞는 조사. 받침 있으면 앞 것(은·을·이), 없으면 뒤 것. 한글이 아니면 뒤 것. */
export function 조사(단어: string, 쌍: "은는" | "을를" | "이가") {
  const 끝 = 단어.trim().slice(-1).charCodeAt(0) - 0xac00;
  const 받침 = 끝 >= 0 && 끝 < 11172 && 끝 % 28 !== 0;
  return 단어 + (받침 ? 쌍[0] : 쌍[1]);
}
console.assert(조사("AIA생명", "은는") === "AIA생명은" && 조사("한화손보", "은는") === "한화손보는");

/** 교차분석으로 가는 주소. 업권·행·열·상태 등은 교차분석 화면이 그대로 받는다. */
export function 근거주소(조건: Record<string, string | undefined>) {
  const q = new URLSearchParams({ tab: "crosstab" });
  for (const [k, v] of Object.entries(조건)) if (v) q.set(k, v);
  return `/analysis?${q}`;
}

export function 구역({
  번호,
  제목,
  질문,
  개수,
  children,
}: {
  번호: number;
  제목: string;
  질문: string;
  개수?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#334fff] text-[12px] font-bold text-white">
          {번호}
        </span>
        <h2 className="text-[16px] font-bold">{제목}</h2>
        {개수 !== undefined && <span className="text-[12px] text-[#a7adb8]">{개수}개</span>}
      </div>
      <p className="mb-4 pl-[34px] text-[12px] text-[#8a8f98]">{질문}</p>
      {children}
    </section>
  );
}

export function 카드목록({ 카드들, 최대 = 6, 없을때, 더보기 }: { 카드들: 카드[]; 최대?: number; 없을때: string; 더보기?: string }) {
  if (!카드들.length)
    return (
      <div className="rounded-xl border border-dashed border-[#dfe2e8] bg-white px-4 py-6 text-center text-[12px] text-[#a7adb8]">
        {없을때}
      </div>
    );
  const 남은 = 카드들.length - 최대;
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {카드들.slice(0, 최대).map((c) => (
          <발견카드 key={c.키} {...c} />
        ))}
      </div>
      {남은 > 0 && 더보기 && (
        <Link href={더보기} className="mt-2 inline-block text-[12px] text-[#334fff] hover:underline">
          외 {남은}개 — 교차분석에서 전체 보기 →
        </Link>
      )}
    </>
  );
}

export function 발견카드(c: 카드) {
  const t = 톤[c.톤];
  return (
    <div className="flex flex-col rounded-xl border border-[#e9eaee] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex gap-4">
        <div className="flex w-[64px] shrink-0 flex-col items-center justify-center rounded-lg py-2" style={{ background: t.바탕 }}>
          <span className="text-[20px] font-bold leading-none tabular-nums" style={{ color: t.글 }}>
            {c.수치}
          </span>
          <span className="mt-1 text-[10px] font-medium" style={{ color: t.글 }}>
            {c.수치설명}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <span className="mb-1 inline-block rounded bg-[#f2f3f5] px-1.5 py-0.5 text-[10px] font-medium text-[#5c626d]">{c.태그}</span>
          <div className="text-[13px] font-semibold leading-snug">{c.제목}</div>
          <div className="mt-1 text-[11px] text-[#8a8f98]">{c.보조}</div>
        </div>
      </div>
      {!!c.예시?.length && (
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {c.예시.map((e) => (
            <Link
              key={e.ad_id}
              href={`/?소재=${encodeURIComponent(e.ad_id)}&상태=전체`}
              title={`${e.g} · 운영 ${e.일수}일`}
              className="relative aspect-square overflow-hidden rounded-md bg-[#f2f3f5] ring-[#334fff] transition hover:ring-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[9px] text-white">
                {e.g} · {e.일수}일
              </span>
            </Link>
          ))}
        </div>
      )}
      <Link href={c.링크} className="mt-auto pt-2.5 text-[11px] font-medium text-[#334fff] hover:underline">
        {c.링크이름 ?? "근거 보기"} →
      </Link>
    </div>
  );
}

/** 맨 위 '한눈에' 띠. 구역마다 가장 센 발견 하나씩. */
export function 한눈에({ 줄들 }: { 줄들: { 이름: string; 내용: React.ReactNode }[] }) {
  if (!줄들.length) return null;
  return (
    <div className="rounded-xl border border-[#d6dcff] bg-[#f5f7ff] p-4">
      <div className="mb-2 text-[12px] font-bold text-[#334fff]">한눈에</div>
      <ul className="space-y-1.5">
        {줄들.map((x) => (
          <li key={x.이름} className="flex gap-2 text-[13px]">
            <span className="w-[88px] shrink-0 text-[12px] font-medium text-[#8a8f98]">{x.이름}</span>
            <span className="min-w-0">{x.내용}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
