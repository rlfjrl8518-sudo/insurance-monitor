import { sql, 표시광고주, type 광고 } from "@/lib/db";

export const dynamic = "force-dynamic";

type 검색조건 = { q?: string; 상태?: string; 그룹?: string };

/** 기본은 운영중만. 종료까지 다 나오면 지금 돌고 있는 걸 보기 어렵다. */
const 기본상태 = "운영중";

async function 광고목록(조건: 검색조건) {
  const 상태 = 조건.상태 ?? 기본상태;
  const 검색어 = (조건.q ?? "").trim();
  const 그룹 = 조건.그룹 ?? "";

  return (await sql`
    select ad_id, advertiser, advertiser_group, segment, image_url, detail_url,
           ad_text, summary, creative_type, insurance_type, appeal_point,
           labels, started_on, ended_on, status, running_days
    from ads
    where (${상태} = '전체' or status = ${상태})
      and (${검색어} = '' or ad_text ilike ${"%" + 검색어 + "%"}
                          or advertiser ilike ${"%" + 검색어 + "%"})
      and (${그룹} = '' or coalesce(advertiser_group, advertiser) = ${그룹})
    order by started_on desc nulls last, ad_id
    limit 600
  `) as 광고[];
}

/** 필터 드롭다운에 쓸 그룹 목록. 데이터에 실제로 있는 것만 보여준다. */
async function 그룹목록(상태: string) {
  return (await sql`
    select coalesce(advertiser_group, advertiser) g, count(*)::int n
    from ads
    where (${상태} = '전체' or status = ${상태})
    group by 1 order by n desc
  `) as { g: string; n: number }[];
}

function 태그({ 값, 강조 }: { 값: string | null; 강조?: boolean }) {
  if (!값)
    return (
      <span className="rounded-full bg-[#fff1f0] px-2 py-0.5 text-[11px] font-medium text-[#c23934]">
        미분류
      </span>
    );
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        강조 ? "bg-[#ebf1fd] text-[#334fff]" : "bg-[#f2f3f5] text-[#5c626d]"
      }`}
    >
      {값}
    </span>
  );
}

export default async function 탐색({
  searchParams,
}: {
  searchParams: Promise<검색조건>;
}) {
  const 조건 = await searchParams;
  const 상태 = 조건.상태 ?? 기본상태;

  let 행들: 광고[] = [];
  let 그룹들: { g: string; n: number }[] = [];
  let 오류: string | null = null;
  try {
    [행들, 그룹들] = await Promise.all([광고목록(조건), 그룹목록(상태)]);
  } catch (e) {
    오류 = e instanceof Error ? e.message : String(e);
  }

  // 광고주 그룹으로 묶는다. 같은 회사가 페이지 여러 개로 쪼개져 있어서
  // 한 줄로 늘어놓으면 어느 회사가 뭘 돌리는지 읽히지 않는다.
  const 묶음 = new Map<string, 광고[]>();
  for (const 행 of 행들) {
    const k = 표시광고주(행);
    (묶음.get(k) ?? 묶음.set(k, []).get(k)!).push(행);
  }
  const 미분류수 = 행들.filter((r) => !r.creative_type).length;

  return (
    <div className="px-6 py-5">
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[18px] font-bold">탐색</h1>
        {!오류 && (
          <span className="text-[13px] text-[#8a8f98]">
            {행들.length.toLocaleString()}건 · 광고주 {묶음.size}곳
            {미분류수 > 0 && (
              <span className="ml-2 text-[#c23934]">미분류 {미분류수}건</span>
            )}
          </span>
        )}
      </div>

      <form className="mb-6 flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={조건.q ?? ""}
          placeholder="광고 텍스트 / 광고주 검색"
          className="w-[240px] rounded-lg border border-[#e9eaee] px-3 py-2 text-[13px] outline-none focus:border-[#334fff]"
        />
        <select
          name="그룹"
          defaultValue={조건.그룹 ?? ""}
          className="rounded-lg border border-[#e9eaee] px-3 py-2 text-[13px]"
        >
          <option value="">광고주: 전체</option>
          {그룹들.map((x) => (
            <option key={x.g} value={x.g}>
              {x.g} ({x.n})
            </option>
          ))}
        </select>
        <select
          name="상태"
          defaultValue={상태}
          className="rounded-lg border border-[#e9eaee] px-3 py-2 text-[13px]"
        >
          {["운영중", "신규", "종료", "전체"].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <button className="rounded-full bg-[#334fff] px-5 py-2 text-[13px] font-semibold text-white">
          적용
        </button>
      </form>

      {오류 && (
        <div className="rounded-lg border border-[#e9eaee] bg-[#ebf1fd] p-4 text-[13px] text-[#2840d9]">
          데이터베이스를 읽지 못했습니다.
          <div className="mt-2 text-[12px] text-[#8a8f98]">{오류}</div>
        </div>
      )}

      {[...묶음.entries()].map(([그룹명, 목록]) => (
        <section key={그룹명} className="mb-8">
          <div className="mb-3 flex items-baseline gap-2 border-b border-[#e9eaee] pb-2">
            <h2 className="text-[14px] font-bold">{그룹명}</h2>
            {목록[0]?.segment === "자사" && (
              <span className="rounded-full bg-[#ebf1fd] px-2 py-0.5 text-[11px] font-medium text-[#334fff]">
                자사
              </span>
            )}
            <span className="text-[12px] text-[#8a8f98]">{목록.length}건</span>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5">
            {목록.map((행) => (
              <article
                key={행.ad_id}
                className="overflow-hidden rounded-xl border border-[#e9eaee] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(16,24,40,0.10)]"
              >
                <div className="aspect-square bg-[#f2f3f5]">
                  {행.image_url && (
                    // 외부 저장소 이미지라 next/image 최적화 대신 그대로 쓴다.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={행.image_url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="p-3">
                  <div className="mb-2 flex flex-wrap gap-1">
                    <태그 값={행.creative_type} 강조 />
                    <태그 값={행.insurance_type} />
                    <태그 값={행.appeal_point} />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#8a8f98]">
                    <span>{행.status}</span>
                    <span>운영 {행.running_days}일</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {!오류 && 행들.length === 0 && (
        <div className="rounded-lg border border-[#e9eaee] p-8 text-center text-[13px] text-[#8a8f98]">
          조건에 맞는 소재가 없습니다.
        </div>
      )}
    </div>
  );
}
