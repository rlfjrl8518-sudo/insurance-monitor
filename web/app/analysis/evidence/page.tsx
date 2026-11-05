import Link from "next/link";
import { sql, 형식이름 } from "@/lib/db";
import { 아바타 } from "../../ui";

export const dynamic = "force-dynamic";

/** 근거 = 카드 하나의 주장만 파고드는 화면. 인사이트·경쟁 비교 카드의 '근거 보기'가 여기로 온다.
 *  주소: 축·값(무엇을) + 집단(누가: 보종:x / 광고주:x / 자사 / 경쟁사 / 비우면 전체) + 비교(시장/경쟁사/자사)
 *       + 종류(비중/장수) + 범위(전체/게재중/90일) + 업권. */

const 장수기준 = 60;
const 축컬럼: Record<string, string> = {
  보종: "insurance_type",
  소구포인트: "appeal_point",
  소재유형: "creative_type",
  형식: "display_format",
  퍼널단계: "labels->>'퍼널단계'",
  오퍼: "labels->>'오퍼'",
};

type 행 = {
  ad_id: string; g: string; 자사: boolean; image_url: string | null; ad_text: string | null;
  일수: number; 종료: boolean; 보종: string | null; 축값: string | null;
};

type 조건 = Record<string, string | string[] | undefined>;
const 한값 = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const 퍼 = (x: number) => `${Math.round(x * 100)}%`;

export default async function 근거({ searchParams }: { searchParams: Promise<조건> }) {
  const p = await searchParams;
  const 축 = 축컬럼[한값(p.축)] ? 한값(p.축) : "소구포인트";
  const 값 = 한값(p.값);
  const 집단 = 한값(p.집단);
  const 비교 = ["경쟁사", "자사"].includes(한값(p.비교)) ? 한값(p.비교) : "시장";
  const 종류 = 한값(p.종류) === "장수" ? "장수" : "비중";
  const 범위 = ["게재중", "90일"].includes(한값(p.범위)) ? 한값(p.범위) : "전체";
  const 업권 = 한값(p.업권);
  const 짧은순 = 한값(p.순서) === "짧은";
  const 값이름 = (v: string) => (축 === "형식" ? (형식이름[v] ?? v) : v);

  const 기간 =
    범위 === "게재중" ? sql`status <> '종료'` : 범위 === "90일" ? sql`coalesce(ended_on, current_date) >= current_date - 90` : sql`true`;
  // 자사 비교일 땐 업권과 상관없이 자사를 넣는다(경쟁 비교 화면과 같은 기준).
  const 자사포함 = 집단 === "자사" || 집단 === "경쟁사" || 비교 !== "시장";

  let 행들: 행[] = [];
  let 오류: string | null = null;
  try {
    행들 = (await sql`
      select ad_id, coalesce(advertiser_group, advertiser) g, coalesce(segment = '자사', false) 자사,
             image_url, ad_text, coalesce(running_days, 0)::int 일수, status = '종료' 종료,
             insurance_type 보종, ${sql.unsafe(축컬럼[축])} 축값
      from ads
      where (${업권} = '' or category = ${업권} or (${자사포함} and segment = '자사')) and ${기간}
        and coalesce(${sql.unsafe(축컬럼[축])}, '') <> ''
        ${종류 === "장수" ? sql`and running_days > 0` : sql``}
    `) as unknown as 행[];
  } catch (e) {
    오류 = e instanceof Error ? e.message : String(e);
  }

  // 집단 고르기
  const [집단축, 집단값] = 집단.includes(":") ? [집단.split(":")[0], 집단.slice(집단.indexOf(":") + 1)] : [집단, ""];
  const 집단에듦 = (r: 행) =>
    집단축 === "보종" ? r.보종 === 집단값 : 집단축 === "광고주" ? r.g === 집단값 : 집단축 === "자사" ? r.자사 : 집단축 === "경쟁사" ? !r.자사 : true;
  const 집단이름 = 집단값 ? `${집단값}` : 집단축 === "자사" ? "자사" : 집단축 === "경쟁사" ? "경쟁사" : "전체";
  const 비교에듦 = (r: 행) => (비교 === "경쟁사" ? !r.자사 : 비교 === "자사" ? r.자사 : true);
  const 맞음 = (r: 행) => r.축값 === 값;
  const 장수 = (r: 행) => r.일수 >= 장수기준;

  const 집단행 = 행들.filter(집단에듦);
  const 비교행 = 행들.filter(비교에듦);

  // 광고주별 비중 (경쟁사 평균은 광고주마다 같은 무게, 경쟁 비교 화면과 같은 기준)
  const 광고주별 = new Map<string, { 자사: boolean; 전체: number; 맞음: number; 장수: number }>();
  for (const r of 종류 === "장수" ? 행들.filter(맞음) : 집단축 === "보종" ? 집단행 : 행들) {
    const m = 광고주별.get(r.g) ?? { 자사: r.자사, 전체: 0, 맞음: 0, 장수: 0 };
    m.전체++;
    if (맞음(r)) m.맞음++;
    if (장수(r)) m.장수++;
    광고주별.set(r.g, m);
  }

  let A = 0, B = 0, A설명 = "", B설명 = "", 주장 = "";
  if (종류 === "장수") {
    const 값행 = 행들.filter(맞음);
    A = 값행.length ? 값행.filter(장수).length / 값행.length : 0;
    B = 행들.length ? 행들.filter(장수).length / 행들.length : 0;
    A설명 = `'${값이름(값)}' 소재 ${값행.length}건 중 ${장수기준}일+`;
    B설명 = `전체 ${행들.length}건 평균`;
    주장 = A >= B ? `'${값이름(값)}' 소재는 오래 간다` : `'${값이름(값)}' 소재는 빨리 내려간다`;
  } else {
    const 비율 = (xs: 행[]) => (xs.length ? xs.filter(맞음).length / xs.length : 0);
    // 경쟁사 쪽은 광고주마다 같은 무게로 평균 낸다(경쟁 비교 화면 카드와 같은 숫자).
    const 경쟁 = [...광고주별.values()].filter((m) => !m.자사 && m.전체 >= 5);
    const 경쟁평균 = 경쟁.length ? 경쟁.reduce((s, m) => s + m.맞음 / m.전체, 0) / 경쟁.length : 0;
    const 경쟁설명 = `경쟁사 ${경쟁.length}곳 평균 (광고주별 같은 무게)`;
    A = 집단축 === "경쟁사" ? 경쟁평균 : 비율(집단행);
    A설명 = 집단축 === "경쟁사" ? 경쟁설명 : `${집단이름} 소재 ${집단행.length}건 중`;
    if (비교 === "경쟁사") {
      B = 경쟁평균;
      B설명 = 경쟁설명;
    } else {
      B = 비율(비교행);
      B설명 = `${비교 === "시장" ? (업권 || "시장 전체") : 비교} ${비교행.length}건`;
    }
    주장 = `${집단이름}의 '${값이름(값)}' 비중`;
  }
  const 차이 = A - B;
  const 배수 = B ? A / B : 0;

  // 같은 축 전체 분포: 집단 vs 비교 (장수면 값별 장수 비율)
  const 분포 = (xs: 행[]) => {
    const m = new Map<string, number>();
    for (const r of xs) m.set(r.축값!, (m.get(r.축값!) ?? 0) + 1);
    return m;
  };
  const 집단분포 = 분포(집단행);
  const 비교분포 = 분포(비교행);
  const 분포값 = [...new Set([...집단분포.keys(), ...비교분포.keys()])]
    .filter((v) => v !== "기타")
    .sort((a, b) => (비교분포.get(b) ?? 0) + (집단분포.get(b) ?? 0) - ((비교분포.get(a) ?? 0) + (집단분포.get(a) ?? 0)))
    .slice(0, 10);
  if (값 && !분포값.includes(값)) 분포값.push(값);

  // 실제 소재: 집단 ∩ 값. 장수면 오래 간 순(또는 짧게 끝난 순).
  const 소재후보 = (종류 === "장수" ? 행들 : 집단행).filter(맞음);
  const 갤러리 = 소재후보
    .filter((r) => r.image_url && !r.image_url.includes("fbcdn.net")) // 만료되는 메타 CDN 주소는 뺀다
    .filter((r) => (종류 === "장수" && 짧은순 ? r.종료 : true))
    .sort((a, b) => (짧은순 ? a.일수 - b.일수 : b.일수 - a.일수))
    .slice(0, 40);

  const 누가 = [...광고주별.entries()]
    .filter(([, m]) => (종류 === "장수" ? m.맞음 >= 1 : m.전체 >= 5))
    .map(([g, m]) => ({ g, ...m, 비율: 종류 === "장수" ? m.장수 / m.전체 : m.맞음 / m.전체 }))
    .filter((x) => 종류 === "장수" || x.맞음 > 0 || x.자사 || x.g === 집단값)
    .sort((a, b) => (종류 === "장수" ? b.전체 - a.전체 : b.비율 - a.비율))
    .slice(0, 15);
  const 강조 = (x: { g: string; 자사: boolean }) => x.g === 집단값 || ((집단축 === "자사" || 집단축 === "경쟁사") && x.자사);

  const 큰색 = 차이 >= 0 ? "#18794e" : "#c23934";

  return (
    <div className="px-7 py-6">
      <Link href={`/analysis?${new URLSearchParams({ tab: 한값(p.출처) || "insight", 업권 })}`} className="text-[12px] text-[#8a8f98] hover:text-[#334fff]">
        ← {한값(p.출처) === "compare" ? "경쟁 비교" : "인사이트"}로 돌아가기
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[#8a8f98]">
        <span className="rounded bg-[#f2f3f5] px-1.5 py-0.5">{축}</span>
        {업권 && <span className="rounded bg-[#f2f3f5] px-1.5 py-0.5">{업권}</span>}
        <span className="rounded bg-[#f2f3f5] px-1.5 py-0.5">{범위 === "전체" ? "전체 기간" : 범위 === "게재중" ? "지금 게재 중" : "최근 90일"}</span>
      </div>
      <h1 className="mt-2 text-[22px] font-bold tracking-tight">{주장}</h1>
      {오류 && <div className="mt-4 rounded-xl bg-[#ebf1fd] p-4 text-[13px] text-[#2840d9]">{오류}</div>}

      {/* 1. 숫자 한 쌍 */}
      <section className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        {[
          { 이름: 종류 === "장수" ? `'${값이름(값)}' 소재` : 집단이름, 값: A, 설명: A설명, 색: "#334fff" },
          { 이름: 종류 === "장수" ? "전체 평균" : 비교 === "시장" ? "시장" : 비교, 값: B, 설명: B설명, 색: "#8a8f98" },
        ].map((x) => (
          <div key={x.이름} className="rounded-xl border border-[#e9eaee] bg-white p-5">
            <div className="text-[12px] font-medium text-[#8a8f98]">{x.이름}</div>
            <div className="mt-1 text-[36px] font-bold leading-none tabular-nums" style={{ color: x.색 }}>
              {퍼(x.값)}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#f2f3f5]">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, x.값 * 100)}%`, background: x.색 }} />
            </div>
            <div className="mt-2 text-[11px] text-[#a7adb8]">{x.설명}</div>
          </div>
        ))}
        <div className="flex flex-col items-center justify-center rounded-xl px-6 py-4" style={{ background: 차이 >= 0 ? "#e7f6ec" : "#fff1f0" }}>
          <div className="text-[28px] font-bold tabular-nums" style={{ color: 큰색 }}>
            {차이 >= 0 ? "+" : ""}{Math.round(차이 * 100)}%p
          </div>
          {B > 0 && <div className="text-[12px] font-semibold" style={{ color: 큰색 }}>×{배수.toFixed(1)}</div>}
        </div>
      </section>

      {/* 2. 실제 소재 */}
      <section className="mt-9">
        <h2 className="text-[16px] font-bold">
          실제 소재 <span className="text-[12px] font-normal text-[#a7adb8]">{소재후보.length}건 중 {갤러리.length}건 · {짧은순 ? "짧게 끝난 순" : "오래 돈 순"}</span>
        </h2>
        <p className="mb-3 mt-1 text-[12px] text-[#8a8f98]">
          {종류 === "장수" ? `'${값이름(값)}'로 분류된 소재` : `${집단이름} 소재 중 '${값이름(값)}'로 분류된 것`}. 눌러서 상세를 봅니다.
        </p>
        {갤러리.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {갤러리.map((r) => (
              <Link
                key={r.ad_id}
                href={`/?소재=${encodeURIComponent(r.ad_id)}&상태=전체`}
                className="overflow-hidden rounded-xl border border-[#e9eaee] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:-translate-y-1 hover:border-[#c3cbe4]"
              >
                <div className="aspect-square bg-[#f2f3f5]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.image_url!} alt="" loading="lazy" className="h-full w-full object-cover" />
                </div>
                <div className="p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-[12px] font-semibold ${r.자사 ? "text-[#334fff]" : ""}`}>{r.g}</span>
                    <span className={`shrink-0 rounded px-1.5 text-[10px] ${r.종료 ? "bg-[#f2f3f5] text-[#8a8f98]" : "bg-[#e7f6ec] text-[#18794e]"}`}>
                      {r.종료 ? "종료" : "게재중"} · {r.일수}일
                    </span>
                  </div>
                  {r.ad_text && <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-[#5c626d]">{r.ad_text}</div>}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[#dfe2e8] bg-white px-4 py-6 text-center text-[12px] text-[#a7adb8]">
            이미지가 있는 소재가 없습니다.
          </div>
        )}
      </section>

      <div className="mt-9 grid gap-6 xl:grid-cols-2">
        {/* 3. 누가 쓰나 */}
        <section>
          <h2 className="text-[16px] font-bold">{종류 === "장수" ? "누가 이 소재를 돌리나" : "광고주별로 보면"}</h2>
          <p className="mb-3 mt-1 text-[12px] text-[#8a8f98]">
            {종류 === "장수"
              ? `'${값이름(값)}' 소재 수와 그중 ${장수기준}일 넘긴 비율`
              : `각 광고주 소재 중 '${값이름(값)}' 비중${집단축 === "보종" ? ` (${집단값} 소재 기준)` : ""}`}
          </p>
          <div className="space-y-1.5 rounded-xl border border-[#e9eaee] bg-white p-4">
            {누가.map((x) => (
              <div key={x.g} className="flex items-center gap-3 text-[12px]">
                <Link href={`/brands/${encodeURIComponent(x.g)}`} className={`flex w-[150px] shrink-0 items-center gap-2 truncate ${강조(x) ? "font-bold text-[#334fff]" : "font-medium"}`}>
                  <아바타 이름={x.g} />
                  <span className="truncate">{x.g}</span>
                </Link>
                <div className="h-3.5 flex-1 overflow-hidden rounded bg-[#f2f3f5]">
                  <div className={강조(x) ? "h-full bg-[#334fff]" : "h-full bg-[#a8b6ff]"} style={{ width: `${x.비율 * 100}%` }} />
                </div>
                <span className="w-[86px] shrink-0 text-right tabular-nums text-[#5c626d]">
                  {퍼(x.비율)} <span className="text-[#a7adb8]">({종류 === "장수" ? x.전체 : x.맞음}건)</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* 4. 같은 축 전체 분포 */}
        <section>
          <h2 className="text-[16px] font-bold">{축} 전체에서 보면</h2>
          <p className="mb-3 mt-1 text-[12px] text-[#8a8f98]">
            {종류 === "장수" ? `값별 ${장수기준}일+ 비율` : `${집단이름} vs ${비교 === "시장" ? "시장" : 비교}, 같은 축의 다른 값들`}
          </p>
          <div className="rounded-xl border border-[#e9eaee] bg-white p-4">
            {분포값.map((v) => {
              const 이값 = 행들.filter((r) => r.축값 === v);
              const a = 종류 === "장수" ? (이값.length ? 이값.filter(장수).length / 이값.length : 0) : (집단분포.get(v) ?? 0) / (집단행.length || 1);
              const b = 종류 === "장수" ? B : (비교분포.get(v) ?? 0) / (비교행.length || 1);
              return (
                <div key={v} className={`flex items-center gap-3 py-1 text-[12px] ${v === 값 ? "rounded bg-[#f5f7ff] font-bold" : ""}`}>
                  <span className="w-[90px] shrink-0 truncate pl-1">{값이름(v)}</span>
                  <div className="flex-1 space-y-0.5">
                    <div className="h-2 rounded-full bg-[#334fff]" style={{ width: `${Math.max(1, a * 100)}%` }} />
                    {종류 === "비중" && <div className="h-2 rounded-full bg-[#c9ced8]" style={{ width: `${Math.max(1, b * 100)}%` }} />}
                  </div>
                  <span className="w-[72px] shrink-0 text-right tabular-nums">
                    {퍼(a)}
                    {종류 === "비중" && <span className="text-[#a7adb8]"> / {퍼(b)}</span>}
                  </span>
                </div>
              );
            })}
            <div className="mt-2 flex gap-4 text-[11px] text-[#a7adb8]">
              <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-[#334fff]" />{종류 === "장수" ? `${장수기준}일+ 비율` : 집단축 === "경쟁사" ? "경쟁사 (전체 합산)" : 집단이름}</span>
              {종류 === "비중" && <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-[#c9ced8]" />{비교 === "시장" ? "시장" : `${비교} (전체 합산)`}</span>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
