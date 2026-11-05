import { sql } from "@/lib/db";
import { 광고주_저장, 그룹_저장, 분류값_저장, 분류규칙_저장, 모델_저장 } from "./actions";

export const dynamic = "force-dynamic";

type 설정행 = { key: string; value: unknown; updated_at: Date | string };
type 수집현황 = { advertiser: string; n: number; 최근: string | null; 운영중: number; 그룹: string | null };
type 수집기록 = {
  advertiser: string; status: string; shown: number | null; collected: number | null; coverage: number | null;
  run_at: string | Date; message: string | null; candidates: string[] | null; 마지막정상: string | null;
};

const 분류축 = ["소재유형", "보종", "소구포인트"] as const;

function 날짜문자(v: Date | string | null) {
  if (!v) return "-";
  return (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
}

/** 며칠째 수집이 없는지. 이 값이 커지는 걸 못 보고 지나쳐서 AIA생명이 석 달을 놓쳤다. */
function 경과일(최근: string | null) {
  if (!최근) return null;
  const d = Math.floor((Date.now() - new Date(최근).getTime()) / 86400000);
  return Number.isFinite(d) ? d : null;
}

export default async function 설정() {
  let 저장됨: Record<string, any> = {};
  let 현황: 수집현황[] = [];
  let 기록: 수집기록[] = [];
  let 오류: string | null = null;

  try {
    const [a, b, c] = await Promise.all([
      sql`select key, value, updated_at from settings` as unknown as Promise<설정행[]>,
      sql`select advertiser, max(advertiser_group) 그룹, count(*)::int n,
                 max(collected_on)::text 최근,
                 count(*) filter (where status <> '종료')::int 운영중
          from ads group by 1 order by 최근 asc nulls first, n desc` as unknown as Promise<수집현황[]>,
      // 광고주별 가장 최근 회차. 상태가 정상이 아니면 위로 올린다.
      sql`select * from (
            select distinct on (advertiser) advertiser, status, shown, collected, coverage, run_at, message, candidates,
                   (select max(run_at)::date::text from collection_runs x
                     where x.advertiser = r.advertiser and x.status in ('정상', '게재없음')) 마지막정상
            from collection_runs r order by advertiser, run_at desc) t
          -- '새 페이지'는 주 1회 점검 결과라 다음 점검(7일)이 지나면 내린다. 등록하면 다음 점검부터 안 뜬다.
          where not (status = '새 페이지' and run_at < now() - interval '8 days')
          order by (status in ('정상', '게재없음')), coverage nulls first, advertiser` as unknown as Promise<수집기록[]>,
    ]);
    for (const r of a) 저장됨[r.key] = r.value;
    현황 = b;
    기록 = c;
  } catch (e) {
    오류 = e instanceof Error ? e.message : String(e);
  }

  const 카테고리: Record<string, string[]> = 저장됨.advertiser_categories ?? {};
  const 분류값: Record<string, string[]> = 저장됨.classification ?? {};
  const 규칙: Record<string, string> = 저장됨.classification_rules ?? {};
  const 모델: Record<string, string> = 저장됨.ai_model ?? {};
  // 웹에서 저장한 그룹이 없으면, 지금 DB에 들어가 있는 묶음(수집 파이프라인이 채운 값)을 보여준다.
  const 그룹: Record<string, string[]> = 저장됨.advertiser_groups ?? {};
  if (!저장됨.advertiser_groups) {
    for (const r of 현황) if (r.그룹) (그룹[r.그룹] ??= []).push(r.advertiser);
  }
  const 묶인페이지 = new Set(Object.values(그룹).flat());
  // 페이지명이 그룹명과 같으면(예: 옛 '삼성화재' 페이지와 '삼성화재' 그룹) 화면에선 이미 한 광고주로 합쳐 보인다.
  const 미지정 = 현황.map((r) => r.advertiser).filter((a) => !묶인페이지.has(a) && !(a in 그룹)).sort();

  const 카테고리이름 =
    Object.keys(카테고리).length > 0 ? Object.keys(카테고리) : ["손해보험", "생명보험", "GA"];

  return (
    <div className="px-7 py-6">
      <h1 className="text-[20px] font-bold tracking-tight">설정</h1>
      <p className="mt-1 text-[13px] text-[#8a8f98]">
        수집 대상과 분류 기준을 여기서 고칩니다. 저장하면 다음 수집(09:05 / 15:05 KST)부터 적용됩니다.
      </p>

      {오류 && (
        <div className="mt-5 rounded-xl border border-[#e9eaee] bg-[#ebf1fd] p-4 text-[13px] text-[#2840d9]">
          {오류}
        </div>
      )}

      <div className="mt-5 rounded-xl border border-[#ffe0a3] bg-[#fff8ea] px-4 py-3 text-[12px] leading-relaxed text-[#7a5a12]">
        구글시트 설정 탭도 아직 살아 있습니다. <b>두 곳에 값이 있으면 여기 값이 이깁니다.</b>{" "}
        아래 칸이 비어 있는 항목은 시트 값을 그대로 씁니다.
      </div>

      {/* 수집 현황을 설정 바로 위에 둔다. 어떤 이름이 실제로 먹히고 있는지 보지 않고
          이름만 고치면, 오타 하나로 몇 달치를 조용히 놓친다. 실제로 그랬다. */}
      <section className="mt-7">
        <h2 className="mb-1 text-[14px] font-bold">최근 수집 회차</h2>
        <p className="mb-3 text-[12px] text-[#8a8f98]">
          수집률 = 이번에 읽은 건수 ÷ 광고 라이브러리가 말하는 게재 건수. 100%가 아닌 회차에는 종료 판정을 하지 않습니다.
          &lsquo;페이지없음&rsquo;이면 아래 후보 페이지명을 보고 수집 대상 칸에 &lsquo;검색어&gt;실제페이지명&rsquo;으로 고쳐 주세요. &lsquo;새 페이지&rsquo;는 주 1회 주요 보험사 이름으로 검색해 찾은, 광고를 내는데 수집 대상에 없는 페이지입니다. 같은 회사 채널이면 수집 대상에 페이지명을 추가하세요.
        </p>
        <div className="mb-8 overflow-hidden rounded-xl border border-[#e9eaee] bg-white">
          <table className="w-full text-[12px]">
            <thead className="bg-[#fafbfc] text-[11px] text-[#8a8f98]">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">광고주</th>
                <th className="px-4 py-2.5 text-left font-medium">상태</th>
                <th className="px-4 py-2.5 text-right font-medium">수집 / 게재</th>
                <th className="px-4 py-2.5 text-right font-medium">수집률</th>
                <th className="px-4 py-2.5 text-right font-medium">마지막 정상</th>
                <th className="px-4 py-2.5 text-left font-medium">메모</th>
              </tr>
            </thead>
            <tbody>
              {기록.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-4 text-center text-[#8a8f98]">새 수집기 첫 실행 뒤부터 보입니다.</td></tr>
              )}
              {기록.map((r) => {
                const 정상 = r.status === "정상" || r.status === "게재없음";
                return (
                  <tr key={r.advertiser} className="border-t border-[#f0f1f4] align-top">
                    <td className="px-4 py-2 font-medium">{r.advertiser}</td>
                    <td className={`px-4 py-2 ${정상 ? "text-[#18794e]" : "font-semibold text-[#c23934]"}`}>{r.status}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.collected ?? 0} / {r.shown ?? "-"}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${r.coverage !== null && r.coverage < 0.999 ? "font-semibold text-[#9a6412]" : ""}`}>
                      {r.coverage !== null ? `${Math.round(r.coverage * 100)}%` : "-"}
                    </td>
                    <td className="px-4 py-2 text-right text-[#8a8f98]">{r.마지막정상 ?? "-"}</td>
                    <td className="px-4 py-2 text-[#5c626d]">
                      {r.message}
                      {r.candidates && r.candidates.length > 0 && <div className="text-[11px] text-[#9a6412]">후보: {r.candidates.join(", ")}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h2 className="mb-1 text-[14px] font-bold">광고주별 누적</h2>
        <p className="mb-3 text-[12px] text-[#8a8f98]">
          마지막 수집이 오래된 광고주는 페이지명이 바뀌었거나 집행을 멈춘 것입니다.
        </p>
        <div className="overflow-hidden rounded-xl border border-[#e9eaee] bg-white">
          <table className="w-full text-[12px]">
            <thead className="bg-[#fafbfc] text-[11px] text-[#8a8f98]">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">광고주(페이지명)</th>
                <th className="px-4 py-2.5 text-right font-medium">누적</th>
                <th className="px-4 py-2.5 text-right font-medium">게재중</th>
                <th className="px-4 py-2.5 text-right font-medium">마지막 수집</th>
              </tr>
            </thead>
            <tbody>
              {현황.map((r) => {
                const d = 경과일(r.최근);
                const 경고 = d !== null && d >= 14;
                return (
                  <tr key={r.advertiser} className="border-t border-[#f0f1f4]">
                    <td className="px-4 py-2 font-medium">{r.advertiser}</td>
                    <td className="px-4 py-2 text-right text-[#5c626d]">{r.n}</td>
                    <td className="px-4 py-2 text-right text-[#5c626d]">{r.운영중}</td>
                    <td
                      className={`px-4 py-2 text-right ${
                        경고 ? "font-semibold text-[#c23934]" : "text-[#8a8f98]"
                      }`}
                    >
                      {날짜문자(r.최근)}
                      {경고 && ` (${d}일째 없음)`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-[14px] font-bold">수집 대상 광고주</h2>
        <p className="mb-3 text-[12px] leading-relaxed text-[#8a8f98]">
          한 줄에 한 광고주. 메타 페이지명이 검색어와 다르면{" "}
          <code className="rounded bg-[#f2f3f5] px-1 py-0.5 text-[11px]">검색어&gt;실제페이지명</code>{" "}
          으로 적습니다. 예: <code className="rounded bg-[#f2f3f5] px-1 py-0.5 text-[11px]">AIA생명&gt;AIA</code>{" "}
          — &quot;AIA생명&quot;으로 검색하고, 페이지명이 &quot;AIA&quot;인 광고만 가져옵니다.
        </p>
        <form action={광고주_저장} className="rounded-xl border border-[#e9eaee] bg-white p-5">
          <div className="grid gap-4 md:grid-cols-3">
            {카테고리이름.map((이름) => (
              <label key={이름} className="block">
                <span className="mb-1.5 block text-[12px] font-semibold">{이름}</span>
                <textarea
                  name={`cat:${이름}`}
                  rows={8}
                  defaultValue={(카테고리[이름] ?? []).join("\n")}
                  className="w-full rounded-lg border border-[#e4e6eb] px-3 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[#334fff]"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <input
              name="새카테고리"
              placeholder="카테고리 추가 (예: 핀테크)"
              className="rounded-lg border border-[#e4e6eb] px-3 py-2 text-[12px] outline-none focus:border-[#334fff]"
            />
            <button className="ml-auto rounded-full bg-[#334fff] px-5 py-2 text-[13px] font-semibold text-white">
              광고주 저장
            </button>
          </div>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-[14px] font-bold">광고주 그룹</h2>
        <p className="mb-3 text-[12px] leading-relaxed text-[#8a8f98]">
          같은 회사의 여러 페이지(채널)를 그룹명 하나로 묶어 탐색·교차분석 등에서 한 광고주로 봅니다.
          한 줄에 페이지명 하나, 페이지명은 위 수집 현황과 똑같이 적습니다. 그룹명을 비우고 저장하면 그 그룹은 지워집니다.
          저장하면 바로 반영됩니다.
        </p>
        <form action={그룹_저장} className="rounded-xl border border-[#e9eaee] bg-white p-5">
          <div className="grid gap-4 md:grid-cols-3">
            {Object.entries(그룹).map(([이름, 페이지들], i) => (
              <div key={이름}>
                <input
                  name={`grpname:${i}`}
                  defaultValue={이름}
                  className="mb-1.5 w-full rounded-lg border border-[#e4e6eb] px-3 py-1.5 text-[12px] font-semibold outline-none focus:border-[#334fff]"
                />
                <textarea
                  name={`grppages:${i}`}
                  rows={5}
                  defaultValue={페이지들.join("\n")}
                  className="w-full rounded-lg border border-[#e4e6eb] px-3 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[#334fff]"
                />
              </div>
            ))}
          </div>
          {미지정.length > 0 && (
            <p className="mt-4 text-[12px] leading-relaxed text-[#8a8f98]">
              <span className="font-semibold text-[#5c626d]">그룹 없는 페이지</span> (페이지명 그대로 표시됨):{" "}
              {미지정.join(" · ")}
            </p>
          )}
          <div className="mt-4 flex items-center gap-2">
            <input
              name="새그룹"
              placeholder="그룹 추가 (예: 삼성화재)"
              className="rounded-lg border border-[#e4e6eb] px-3 py-2 text-[12px] outline-none focus:border-[#334fff]"
            />
            <button className="ml-auto rounded-full bg-[#334fff] px-5 py-2 text-[13px] font-semibold text-white">
              그룹 저장
            </button>
          </div>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-[14px] font-bold">분류 선택지</h2>
        <form action={분류값_저장} className="rounded-xl border border-[#e9eaee] bg-white p-5">
          <div className="grid gap-4 md:grid-cols-3">
            {분류축.map((축) => (
              <label key={축} className="block">
                <span className="mb-1.5 block text-[12px] font-semibold">{축}</span>
                <textarea
                  name={축}
                  rows={8}
                  defaultValue={(분류값[축] ?? []).join("\n")}
                  className="w-full rounded-lg border border-[#e4e6eb] px-3 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[#334fff]"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex">
            <button className="ml-auto rounded-full bg-[#334fff] px-5 py-2 text-[13px] font-semibold text-white">
              선택지 저장
            </button>
          </div>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-[14px] font-bold">분류 판단 기준</h2>
        <p className="mb-3 text-[12px] text-[#8a8f98]">
          축별로 적은 글이 그대로 분류 프롬프트에 들어갑니다. 비워두면 코드 기본 규칙을 씁니다.
        </p>
        <form action={분류규칙_저장} className="rounded-xl border border-[#e9eaee] bg-white p-5">
          <div className="space-y-4">
            {분류축.map((축) => (
              <label key={축} className="block">
                <span className="mb-1.5 block text-[12px] font-semibold">{축}</span>
                <textarea
                  name={`rule:${축}`}
                  rows={6}
                  defaultValue={규칙[축] ?? ""}
                  placeholder="예) 상투적인 CTA는 소구 근거가 아니다. 본문이 실제로 무엇을 약속하는지로 판단한다."
                  className="w-full rounded-lg border border-[#e4e6eb] px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-[#334fff]"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex">
            <button className="ml-auto rounded-full bg-[#334fff] px-5 py-2 text-[13px] font-semibold text-white">
              기준 저장
            </button>
          </div>
        </form>
      </section>

      <section className="mt-8 mb-4">
        <h2 className="mb-1 text-[14px] font-bold">AI 분류 모델</h2>
        <p className="mb-3 text-[12px] text-[#8a8f98]">
          Vertex AI(GCP 프로젝트 insurance-monitor-playd)의 Gemini를 씁니다. 키 파일 없이 Cloud Run 서비스계정 권한으로 호출합니다.
          비워 두면 기본 후보(gemini-3-flash-preview → gemini-3-flash → gemini-2.5-flash) 중 응답하는 첫 모델을 씁니다.
        </p>
        <form action={모델_저장} className="rounded-xl border border-[#e9eaee] bg-white p-5">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold">우선 쓸 모델</span>
            <input
              name="model"
              defaultValue={모델.model ?? ""}
              placeholder="예: google/gemini-3-flash-preview"
              className="w-full rounded-lg border border-[#e4e6eb] px-3 py-2 font-mono text-[12px] outline-none focus:border-[#334fff]"
            />
          </label>
          <div className="mt-4 flex">
            <button className="ml-auto rounded-full bg-[#334fff] px-5 py-2 text-[13px] font-semibold text-white">
              모델 저장
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
