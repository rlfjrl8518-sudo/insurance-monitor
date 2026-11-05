import Link from "next/link";
import { sql, 형식이름 } from "@/lib/db";

/** 경쟁 비교 = 자사 대비 경쟁사. 축을 고르는 자유 분석(교차분석)과 달리 비교 틀이 고정돼 있고,
 *  '경쟁사는 하는데 우리는 안 하는 것(공백)'과 '우리만 유난히 많이 하는 것'을 바로 짚는다. */

const 축들 = [
  ["소재유형", "creative_type"],
  ["보종", "insurance_type"],
  ["소구포인트", "appeal_point"],
  ["형식", "display_format"],
  ["퍼널단계", "labels->>'퍼널단계'"],
  ["오퍼", "labels->>'오퍼'"],
] as const;

type 운영 = {
  g: string; 자사: boolean; 게재중: number; 신규30: number; 수명: number | null; 변형: number | null; 영상: number | null;
};
type 분포 = { g: string; 자사: boolean; v: string; n: number };

/** 공백: 자사 비중이 이보다 낮은데 경쟁사 평균은 경쟁_공백기준 이상. 차이 강조 기준(%p). */
const 자사_공백기준 = 0.03;
const 경쟁_공백기준 = 0.1;
const 강조_차이 = 0.15;

const 퍼센트 = (x: number) => `${Math.round(x * 100)}%`;

function 축비교(행들: 분포[], 값이름: (v: string) => string) {
  const 자사 = new Map<string, number>();
  const 광고주별 = new Map<string, Map<string, number>>();
  for (const r of 행들) {
    if (r.자사) 자사.set(r.v, (자사.get(r.v) ?? 0) + r.n);
    else {
      const m = 광고주별.get(r.g) ?? 광고주별.set(r.g, new Map()).get(r.g)!;
      m.set(r.v, r.n);
    }
  }
  const 자사합 = [...자사.values()].reduce((a, b) => a + b, 0);
  const 합 = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  // 경쟁사 평균은 광고주마다 같은 무게로 낸다. 물량 큰 한 곳이 평균을 끌고 가지 않게.
  const 경쟁사들 = [...광고주별.entries()].filter(([, m]) => 합(m) >= 5);
  const 값목록 = [...new Set(행들.map((r) => r.v))];
  return {
    자사합,
    경쟁수: 경쟁사들.length,
    줄: 값목록
      .map((v) => {
        const 우리 = 자사합 ? (자사.get(v) ?? 0) / 자사합 : 0;
        const 비중들 = 경쟁사들.map(([g, m]) => ({ g, p: (m.get(v) ?? 0) / 합(m) }));
        const 평균 = 비중들.length ? 비중들.reduce((s, x) => s + x.p, 0) / 비중들.length : 0;
        const 최다 = [...비중들].sort((a, b) => b.p - a.p)[0];
        const 쓰는곳 = 비중들.filter((x) => x.p > 0).length;
        return { v, 이름: 값이름(v), 우리, 평균, 차이: 우리 - 평균, 최다, 쓰는곳 };
      })
      .filter((x) => x.우리 > 0 || x.평균 >= 0.02)
      .sort((a, b) => b.평균 + b.우리 - (a.평균 + a.우리)),
  };
}

export async function 경쟁비교({ 업권, 범위 }: { 업권: string; 범위: string }) {
  const 최근 = 범위 === "90일";
  const 기간 = 최근 ? sql`coalesce(ended_on, current_date) >= current_date - 90` : sql`status <> '종료'`;
  // 자사는 업권과 상관없이 늘 넣는다(생명보험 업권을 골라도 자사와 비교할 수 있게).
  const 대상 = sql`(${업권} = '' or category = ${업권} or segment = '자사') and ${기간}`;

  let 운영들: 운영[] = [];
  let 분포들: 분포[][] = [];
  let 오류: string | null = null;
  try {
    [운영들, ...분포들] = (await Promise.all([
      sql`select coalesce(advertiser_group, advertiser) g, bool_or(segment = '자사') 자사,
                 count(*) filter (where status <> '종료')::int 게재중,
                 count(*) filter (where first_seen_on >= current_date - 30)::int 신규30,
                 (percentile_cont(0.5) within group (order by running_days) filter (where status = '종료'))::int 수명,
                 avg(variant_count)::float 변형,
                 (count(*) filter (where display_format = 'VIDEO'))::float / nullif(count(*), 0) 영상
          from ads where ${대상} group by 1 order by 게재중 desc, 신규30 desc`,
      ...축들.map(
        ([, 식]) => sql`select coalesce(advertiser_group, advertiser) g, bool_or(segment = '자사') 자사,
                              ${sql.unsafe(식)} v, count(*)::int n
                       from ads where ${대상} and coalesce(${sql.unsafe(식)}, '') <> ''
                       group by 1, 3`,
      ),
    ])) as unknown as [운영[], ...분포[][]];
  } catch (e) {
    오류 = e instanceof Error ? e.message : String(e);
  }

  const 자사행 = 운영들.find((x) => x.자사);
  const 총게재 = Math.max(1, 운영들.reduce((s, x) => s + x.게재중, 0));
  const 경쟁운영 = 운영들.filter((x) => !x.자사 && x.게재중 + x.신규30 >= 5);
  const 중앙 = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  const 경쟁기준 = {
    신규30: 중앙(경쟁운영.map((x) => x.신규30)),
    수명: 중앙(경쟁운영.flatMap((x) => (x.수명 === null ? [] : [x.수명]))),
    변형: 중앙(경쟁운영.flatMap((x) => (x.변형 === null ? [] : [x.변형]))),
    영상: 중앙(경쟁운영.flatMap((x) => (x.영상 === null ? [] : [x.영상]))),
  };
  const 링크 = (k: string, v: string) => {
    const q = new URLSearchParams({ tab: "compare", 업권, 범위, [k]: v });
    return `/analysis?${q}`;
  };
  const 칩 = (선택: boolean) =>
    `rounded-full border px-3 py-1.5 text-[12px] ${선택 ? "border-[#334fff] bg-[#334fff] font-semibold text-white" : "border-[#e4e6eb] bg-white text-[#5c626d]"}`;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-[#8a8f98]">대상</span>
        {[["게재중", "지금 게재 중"], ["90일", "최근 90일 게재"]].map(([v, 라벨]) => (
          <Link key={v} href={링크("범위", v)} className={칩((최근 ? "90일" : "게재중") === v)}>{라벨}</Link>
        ))}
      </div>
      {오류 && <div className="mb-5 rounded-xl bg-[#ebf1fd] p-4 text-[13px] text-[#2840d9]">{오류}</div>}
      {!오류 && !자사행 && (
        <div className="mb-5 rounded-xl border border-[#ffe0a3] bg-[#fff8ea] px-4 py-3 text-[12px] text-[#7a5a12]">
          이 범위에 자사 소재가 없습니다. 설정에서 자사 그룹(한화손보)에 페이지가 묶여 있는지 확인하세요.
        </div>
      )}

      {/* 1. 점유 */}
      <section className="mb-8">
        <h2 className="mb-1 text-[14px] font-bold">게재 점유 (Share of Voice)</h2>
        <p className="mb-3 text-[12px] text-[#8a8f98]">게재 중 소재 수 기준. 광고비가 아니라 &lsquo;동시에 돌리는 소재 수&rsquo;입니다.</p>
        <div className="space-y-1.5 rounded-xl border border-[#e9eaee] bg-white p-4">
          {운영들.filter((x) => x.게재중 > 0).map((x) => (
            <div key={x.g} className="flex items-center gap-3 text-[12px]">
              <Link href={`/brands/${encodeURIComponent(x.g)}`} className={`w-[140px] shrink-0 truncate ${x.자사 ? "font-bold text-[#334fff]" : "font-medium"}`}>
                {x.g}
              </Link>
              <div className="h-4 flex-1 overflow-hidden rounded bg-[#f2f3f5]">
                <div className={x.자사 ? "h-full bg-[#334fff]" : "h-full bg-[#a8b6ff]"} style={{ width: `${(x.게재중 / 총게재) * 100}%` }} />
              </div>
              <span className="w-[90px] text-right tabular-nums text-[#5c626d]">{x.게재중}건 {퍼센트(x.게재중 / 총게재)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 2. 운영 방식 */}
      <section className="mb-8">
        <h2 className="mb-1 text-[14px] font-bold">운영 방식 비교</h2>
        <p className="mb-3 text-[12px] text-[#8a8f98]">경쟁사 기준값은 소재 5건 이상 광고주들의 중앙값입니다.</p>
        <div className="overflow-x-auto rounded-xl border border-[#e9eaee] bg-white">
          <table className="w-full text-[12px]">
            <thead className="bg-[#fafbfc] text-[11px] text-[#8a8f98]">
              <tr>
                <th className="px-4 py-2 text-left font-medium">광고주</th>
                <th className="px-4 py-2 text-right font-medium">최근 30일 신규 투입</th>
                <th className="px-4 py-2 text-right font-medium">소재 수명(중앙값)</th>
                <th className="px-4 py-2 text-right font-medium">평균 변형 수</th>
                <th className="px-4 py-2 text-right font-medium">영상 비중</th>
              </tr>
            </thead>
            <tbody>
              {자사행 && (
                <tr className="bg-[#f5f7ff] font-semibold text-[#334fff]">
                  <td className="px-4 py-2">{자사행.g} (자사)</td>
                  <td className="px-4 py-2 text-right">{자사행.신규30}</td>
                  <td className="px-4 py-2 text-right">{자사행.수명 ?? "-"}일</td>
                  <td className="px-4 py-2 text-right">{자사행.변형?.toFixed(1) ?? "-"}</td>
                  <td className="px-4 py-2 text-right">{자사행.영상 !== null ? 퍼센트(자사행.영상) : "-"}</td>
                </tr>
              )}
              <tr className="border-t border-[#e9eaee] bg-[#fafbfc] font-semibold">
                <td className="px-4 py-2">경쟁사 중앙값</td>
                <td className="px-4 py-2 text-right">{경쟁기준.신규30 ?? "-"}</td>
                <td className="px-4 py-2 text-right">{경쟁기준.수명 ?? "-"}일</td>
                <td className="px-4 py-2 text-right">{경쟁기준.변형?.toFixed(1) ?? "-"}</td>
                <td className="px-4 py-2 text-right">{경쟁기준.영상 !== null ? 퍼센트(경쟁기준.영상) : "-"}</td>
              </tr>
              {경쟁운영.map((x) => (
                <tr key={x.g} className="border-t border-[#f0f1f4]">
                  <td className="px-4 py-2">{x.g}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{x.신규30}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{x.수명 ?? "-"}일</td>
                  <td className="px-4 py-2 text-right tabular-nums">{x.변형?.toFixed(1) ?? "-"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{x.영상 !== null ? 퍼센트(x.영상) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. 축별 격차 */}
      <section>
        <h2 className="mb-1 text-[14px] font-bold">축별 격차: 자사 vs 경쟁사 평균</h2>
        <p className="mb-3 text-[12px] text-[#8a8f98]">
          <span className="rounded bg-[#fff1f0] px-1.5 font-semibold text-[#c23934]">공백</span> 경쟁사 평균은 {퍼센트(경쟁_공백기준)} 이상 쓰는데 자사는 거의 안 쓰는 것 ·{" "}
          <span className="rounded bg-[#e7f6ec] px-1.5 font-semibold text-[#18794e]">자사 집중</span> 자사가 {Math.round(강조_차이 * 100)}%p 이상 더 쓰는 것
        </p>
        <div className="grid gap-4 xl:grid-cols-2">
          {축들.map(([이름], i) => {
            const 비교 = 축비교(분포들[i] ?? [], (v) => (이름 === "형식" ? (형식이름[v] ?? v) : v));
            return (
              <div key={이름} className="rounded-xl border border-[#e9eaee] bg-white p-4">
                <div className="mb-2 flex items-baseline gap-2">
                  <h3 className="text-[13px] font-bold">{이름}</h3>
                  <span className="text-[11px] text-[#a7adb8]">자사 {비교.자사합}건 · 경쟁사 {비교.경쟁수}곳</span>
                </div>
                <table className="w-full text-[12px]">
                  <thead className="text-[10px] text-[#a7adb8]">
                    <tr>
                      <th className="py-1 text-left font-medium">값</th>
                      <th className="py-1 text-right font-medium">자사</th>
                      <th className="py-1 text-right font-medium">경쟁 평균</th>
                      <th className="py-1 text-right font-medium">가장 많이 쓰는 곳</th>
                    </tr>
                  </thead>
                  <tbody>
                    {비교.줄.slice(0, 10).map((x) => {
                      const 공백 = 비교.자사합 > 0 && x.우리 < 자사_공백기준 && x.평균 >= 경쟁_공백기준;
                      const 집중 = 비교.자사합 > 0 && x.차이 >= 강조_차이;
                      return (
                        <tr key={x.v} className="border-t border-[#f0f1f4]">
                          <td className="py-1.5">
                            {x.이름}
                            {공백 && <span className="ml-1.5 rounded bg-[#fff1f0] px-1.5 text-[10px] font-bold text-[#c23934]">공백</span>}
                            {집중 && <span className="ml-1.5 rounded bg-[#e7f6ec] px-1.5 text-[10px] font-bold text-[#18794e]">자사 집중</span>}
                          </td>
                          <td className="py-1.5 text-right font-semibold tabular-nums text-[#334fff]">{비교.자사합 ? 퍼센트(x.우리) : "-"}</td>
                          <td className="py-1.5 text-right tabular-nums">{퍼센트(x.평균)}</td>
                          <td className="py-1.5 text-right text-[#8a8f98]">
                            {x.최다 && x.최다.p > 0 ? `${x.최다.g} ${퍼센트(x.최다.p)}` : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
