import Link from "next/link";
import { sql, 형식이름 } from "@/lib/db";
import { 구역, 근거링크, 소재질의, 예시고르기, 조사, 카드목록, 톤, type 카드, type 소재 } from "./cards";

/** 경쟁 비교 = 자사 성적표. 비교 틀이 고정이고, 결과를 '할 일(공백·열세)'과 '강점(자사 집중)' 카드로 낸다.
 *  축별 숫자 전체는 각 카드의 근거 링크로 교차분석에서 본다. */

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

/** 공백: 자사 비중이 이보다 낮은데 경쟁사 평균은 경쟁_공백기준 이상, 2곳 이상이 씀. 열세·집중: 차이 %p 기준. */
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
    줄: 값목록.map((v) => {
      const 우리 = 자사합 ? (자사.get(v) ?? 0) / 자사합 : 0;
      const 비중들 = 경쟁사들.map(([g, m]) => ({ g, p: (m.get(v) ?? 0) / 합(m) }));
      const 평균 = 비중들.length ? 비중들.reduce((s, x) => s + x.p, 0) / 비중들.length : 0;
      const 최다 = [...비중들].sort((a, b) => b.p - a.p)[0];
      const 쓰는곳 = 비중들.filter((x) => x.p > 0).length;
      return { v, 이름: 값이름(v), 우리, 평균, 차이: 우리 - 평균, 최다, 쓰는곳 };
    }),
  };
}

function 타일({ 값, 이름, 설명, 색 }: { 값: string; 이름: string; 설명: string; 색?: string }) {
  return (
    <div className="rounded-xl border border-[#e9eaee] bg-white px-4 py-3">
      <div className="text-[11px] font-medium text-[#8a8f98]">{이름}</div>
      <div className="mt-1 text-[24px] font-bold leading-none tabular-nums" style={{ color: 색 ?? "#191f28" }}>
        {값}
      </div>
      <div className="mt-1.5 text-[11px] text-[#a7adb8]">{설명}</div>
    </div>
  );
}

export async function 경쟁비교({ 업권, 범위 }: { 업권: string; 범위: string }) {
  const 최근 = 범위 === "90일";
  const 기간 = 최근 ? sql`coalesce(ended_on, current_date) >= current_date - 90` : sql`status <> '종료'`;
  // 자사는 업권과 상관없이 늘 넣는다(생명보험 업권을 골라도 자사와 비교할 수 있게).
  const 대상 = sql`(${업권} = '' or category = ${업권} or segment = '자사') and ${기간}`;

  let 운영들: 운영[] = [];
  let 분포들: 분포[][] = [];
  let 소재들: 소재[] = [];
  let 오류: string | null = null;
  try {
    [운영들, 소재들, ...분포들] = (await Promise.all([
      sql`select coalesce(advertiser_group, advertiser) g, bool_or(segment = '자사') 자사,
                 count(*) filter (where status <> '종료')::int 게재중,
                 count(*) filter (where coalesce(started_on, first_seen_on) >= current_date - 30)::int 신규30,
                 (percentile_cont(0.5) within group (order by running_days) filter (where status = '종료'))::int 수명,
                 avg(variant_count)::float 변형,
                 (count(*) filter (where display_format = 'VIDEO'))::float / nullif(count(*), 0) 영상
          from ads where ${대상} group by 1 order by 게재중 desc, 신규30 desc`,
      소재질의(대상),
      ...축들.map(
        ([, 식]) => sql`select coalesce(advertiser_group, advertiser) g, bool_or(segment = '자사') 자사,
                              ${sql.unsafe(식)} v, count(*)::int n
                       from ads where ${대상} and coalesce(${sql.unsafe(식)}, '') <> ''
                       group by 1, 3`,
      ),
    ])) as unknown as [운영[], 소재[], ...분포[][]];
  } catch (e) {
    오류 = e instanceof Error ? e.message : String(e);
  }

  const 자사행 = 운영들.find((x) => x.자사);
  const 게재순 = 운영들.filter((x) => x.게재중 > 0);
  const 총게재 = Math.max(1, 게재순.reduce((s, x) => s + x.게재중, 0));
  const 자사순위 = 자사행 ? 게재순.findIndex((x) => x.자사) + 1 : 0;
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

  // 축마다 비교해서 할 일(공백·열세)과 강점(자사 집중) 카드로 모은다.
  const 할일: (카드 & { 무게: number })[] = [];
  const 강점: (카드 & { 무게: number })[] = [];
  축들.forEach(([축], i) => {
    const 비교 = 축비교(분포들[i] ?? [], (v) => (축 === "형식" ? (형식이름[v] ?? v) : v));
    if (!비교.자사합) return;
    비교.줄 = 비교.줄.filter((x) => x.v !== "기타");
    for (const x of 비교.줄) {
      const 최다 = x.최다 && x.최다.p > 0 ? ` · 가장 많이: ${x.최다.g} ${퍼센트(x.최다.p)}` : "";
      const 공백 = x.우리 < 자사_공백기준 && x.평균 >= 경쟁_공백기준 && x.쓰는곳 >= 2;
      if (공백 || x.차이 <= -강조_차이)
        할일.push({
          키: `${축}-${x.v}`,
          무게: -x.차이,
          수치: 퍼센트(x.평균),
          수치설명: "경쟁 평균",
          태그: `${축} · ${공백 ? "공백" : "열세"}`,
          제목: 공백 ? (
            <>경쟁사는 &lsquo;{x.이름}&rsquo;{조사(x.이름, "을를").slice(x.이름.length)} 쓰는데 우리는 {퍼센트(x.우리)}</>
          ) : (
            <>&lsquo;{x.이름}&rsquo; 비중이 경쟁사보다 {Math.round(-x.차이 * 100)}%p 낮음</>
          ),
          보조: `자사 ${퍼센트(x.우리)} · 경쟁 ${비교.경쟁수}곳 중 ${x.쓰는곳}곳 사용${최다}`,
          // 공백은 자사 소재가 없으니 경쟁사 소재를 보여준다
          링크: 근거링크({ 축, 값: x.v, 집단: "경쟁사", 비교: "자사", 범위: 최근 ? "90일" : "게재중", 업권, 출처: "compare" }),
          톤: "나쁨",
          예시: 예시고르기(소재들, (s) => !s.자사 && s[축] === x.v),
        });
      else if (x.차이 >= 강조_차이)
        강점.push({
          키: `${축}-${x.v}`,
          무게: x.차이,
          수치: `+${Math.round(x.차이 * 100)}`,
          수치설명: "%p",
          태그: `${축} · 자사 집중`,
          제목: <>우리는 &lsquo;{x.이름}&rsquo; 비중 {퍼센트(x.우리)}</>,
          보조: `경쟁 평균 ${퍼센트(x.평균)} · ${비교.경쟁수}곳 중 ${x.쓰는곳}곳 사용${최다}`,
          링크: 근거링크({ 축, 값: x.v, 집단: "자사", 비교: "경쟁사", 범위: 최근 ? "90일" : "게재중", 업권, 출처: "compare" }),
          톤: "자사",
          예시: 예시고르기(소재들, (s) => s.자사 && s[축] === x.v),
        });
    }
  });
  할일.sort((a, b) => b.무게 - a.무게);
  강점.sort((a, b) => b.무게 - a.무게);

  const 칩 = (선택: boolean) =>
    `rounded-full border px-3 py-1.5 text-[12px] ${선택 ? "border-[#334fff] bg-[#334fff] font-semibold text-white" : "border-[#e4e6eb] bg-white text-[#5c626d]"}`;
  const 범위링크 = (v: string) => `/analysis?${new URLSearchParams({ tab: "compare", 업권, 범위: v })}`;
  // 운영 지표: 자사가 경쟁 중앙값보다 높으면 초록, 낮으면 빨강(높을수록 좋다고 보는 지표만)
  const 비교색 = (우리: number | null | undefined, 기준: number | null) =>
    우리 == null || 기준 == null || 기준 === 0 ? "" : 우리 >= 기준 * 1.1 ? "text-[#18794e]" : 우리 <= 기준 * 0.9 ? "text-[#c23934]" : "";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-[#8a8f98]">대상</span>
        {[["게재중", "지금 게재 중"], ["90일", "최근 90일 게재"]].map(([v, 라벨]) => (
          <Link key={v} href={범위링크(v)} className={칩((최근 ? "90일" : "게재중") === v)}>{라벨}</Link>
        ))}
      </div>
      {오류 && <div className="mb-5 rounded-xl bg-[#ebf1fd] p-4 text-[13px] text-[#2840d9]">{오류}</div>}
      {!오류 && !자사행 && (
        <div className="mb-5 rounded-xl border border-[#ffe0a3] bg-[#fff8ea] px-4 py-3 text-[12px] text-[#7a5a12]">
          이 범위에 자사 소재가 없습니다. 설정에서 자사 그룹(한화손보)에 페이지가 묶여 있는지 확인하세요.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <타일
          이름="게재 점유"
          값={자사행 ? 퍼센트(자사행.게재중 / 총게재) : "-"}
          설명={자사행 ? `${게재순.length}곳 중 ${자사순위}위 · ${자사행.게재중}건` : "자사 소재 없음"}
          색={톤.자사.글}
        />
        <타일 이름="할 일 (공백·열세)" 값={String(할일.length)} 설명="경쟁사보다 덜 쓰는 것" 색={톤.나쁨.글} />
        <타일 이름="강점 (자사 집중)" 값={String(강점.length)} 설명={`경쟁 평균보다 ${Math.round(강조_차이 * 100)}%p+ 더 쓰는 것`} 색={톤.좋음.글} />
        <타일
          이름="최근 30일 신규 투입"
          값={자사행 ? String(자사행.신규30) : "-"}
          설명={`경쟁사 중앙값 ${경쟁기준.신규30 ?? "-"}건`}
        />
      </div>

      <구역 번호={1} 제목="할 일: 경쟁사는 하는데 우리는 덜 하는 것" 질문={`공백 = 경쟁 평균 ${퍼센트(경쟁_공백기준)} 이상(2곳 이상 사용)인데 자사 ${퍼센트(자사_공백기준)} 미만 · 열세 = 경쟁 평균보다 ${Math.round(강조_차이 * 100)}%p 이상 낮음`} 개수={할일.length}>
        <카드목록 카드들={할일} 최대={9} 없을때="경쟁사 대비 크게 비는 곳이 없습니다." />
      </구역>

      <구역 번호={2} 제목="강점: 우리가 유난히 많이 하는 것" 질문="지킬지 줄일지 판단할 대상. 성과가 났다면 강점, 아니라면 쏠림입니다." 개수={강점.length}>
        <카드목록 카드들={강점} 최대={6} 없을때="경쟁사보다 크게 쏠린 곳이 없습니다." />
      </구역>

      <구역 번호={3} 제목="게재 점유 (Share of Voice)" 질문="동시에 돌리는 소재 수 기준입니다. 광고비가 아닙니다.">
        <div className="space-y-1.5 rounded-xl border border-[#e9eaee] bg-white p-4">
          {게재순.map((x) => (
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
      </구역>

      <구역 번호={4} 제목="운영 방식" 질문="경쟁사 기준값은 소재 5건 이상 광고주들의 중앙값입니다. 자사 칸 색: 중앙값보다 10% 이상 높음(초록) / 낮음(빨강).">
        <div className="overflow-x-auto rounded-xl border border-[#e9eaee] bg-white">
          <table className="w-full table-fixed text-[12px]">
            <thead className="bg-[#fafbfc] text-[11px] text-[#8a8f98]">
              <tr>
                <th className="w-[28%] px-4 py-2 text-left font-medium">광고주</th>
                <th className="px-4 py-2 text-right font-medium">최근 30일 신규 투입</th>
                <th className="px-4 py-2 text-right font-medium">소재 수명(중앙값)</th>
                <th className="px-4 py-2 text-right font-medium">평균 변형 수</th>
                <th className="px-4 py-2 text-right font-medium">영상 비중</th>
              </tr>
            </thead>
            <tbody>
              {자사행 && (
                <tr className="bg-[#f5f7ff] font-semibold">
                  <td className="px-4 py-2 text-[#334fff]">{자사행.g} (자사)</td>
                  <td className={`px-4 py-2 text-right ${비교색(자사행.신규30, 경쟁기준.신규30)}`}>{자사행.신규30}</td>
                  <td className={`px-4 py-2 text-right ${비교색(자사행.수명, 경쟁기준.수명)}`}>{자사행.수명 != null ? `${자사행.수명}일` : "-"}</td>
                  <td className={`px-4 py-2 text-right ${비교색(자사행.변형, 경쟁기준.변형)}`}>{자사행.변형?.toFixed(1) ?? "-"}</td>
                  <td className={`px-4 py-2 text-right ${비교색(자사행.영상, 경쟁기준.영상)}`}>{자사행.영상 !== null ? 퍼센트(자사행.영상) : "-"}</td>
                </tr>
              )}
              <tr className="border-t border-[#e9eaee] bg-[#fafbfc] font-semibold">
                <td className="px-4 py-2">경쟁사 중앙값</td>
                <td className="px-4 py-2 text-right">{경쟁기준.신규30 ?? "-"}</td>
                <td className="px-4 py-2 text-right">{경쟁기준.수명 != null ? `${경쟁기준.수명}일` : "-"}</td>
                <td className="px-4 py-2 text-right">{경쟁기준.변형?.toFixed(1) ?? "-"}</td>
                <td className="px-4 py-2 text-right">{경쟁기준.영상 !== null ? 퍼센트(경쟁기준.영상) : "-"}</td>
              </tr>
            </tbody>
          </table>
          <details className="border-t border-[#f0f1f4]">
            <summary className="cursor-pointer px-4 py-2 text-[11px] text-[#8a8f98] hover:text-[#334fff]">광고주별 보기 ({경쟁운영.length}곳)</summary>
            <table className="w-full table-fixed text-[12px]">
              <tbody>
                {경쟁운영.map((x) => (
                  <tr key={x.g} className="border-t border-[#f0f1f4]">
                    <td className="px-4 py-2">{x.g}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{x.신규30}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{x.수명 != null ? `${x.수명}일` : "-"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{x.변형?.toFixed(1) ?? "-"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{x.영상 !== null ? 퍼센트(x.영상) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      </구역>
    </div>
  );
}
