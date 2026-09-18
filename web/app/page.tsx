import { sql, 표시광고주, type 광고 } from "@/lib/db";

export const dynamic = "force-dynamic";

type 검색조건 = {
  q?: string;
  상태?: string;
  광고주?: string;
};

/** 기본은 운영중만 본다. 종료된 소재까지 다 나오면 지금 돌고 있는 걸 보기 어렵다. */
const 기본상태 = "운영중";

async function 광고목록(조건: 검색조건) {
  const 상태 = 조건.상태 ?? 기본상태;
  const 검색어 = (조건.q ?? "").trim();

  // neon의 태그드 템플릿은 값만 파라미터로 넘기므로 조건을 이렇게 분기해 둔다.
  // 조건 조합이 더 늘어나면 쿼리 빌더로 바꾼다.
  const 행들 = (await sql`
    select ad_id, advertiser, advertiser_group, segment, image_url, detail_url,
           ad_text, summary, creative_type, insurance_type, appeal_point,
           labels, started_on, ended_on, status, running_days
    from ads
    where (${상태} = '전체' or status = ${상태})
      and (${검색어} = '' or ad_text ilike ${"%" + 검색어 + "%"}
                          or advertiser ilike ${"%" + 검색어 + "%"})
      and (${조건.광고주 ?? ""} = ''
           or coalesce(advertiser_group, advertiser) = ${조건.광고주 ?? ""})
    order by started_on desc nulls last, ad_id
    limit 300
  `) as 광고[];
  return 행들;
}

export default async function 탐색({
  searchParams,
}: {
  searchParams: Promise<검색조건>;
}) {
  const 조건 = await searchParams;

  let 행들: 광고[] = [];
  let 오류: string | null = null;
  try {
    행들 = await 광고목록(조건);
  } catch (e) {
    // DB 연결 전에도 화면 구조는 확인할 수 있어야 한다.
    오류 = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="px-6 py-5">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-[18px] font-bold">탐색</h1>
        <span className="text-[13px] text-[#8a8f98]">
          {오류 ? "—" : `총 ${행들.length.toLocaleString()}건`}
        </span>
      </div>

      <form className="mb-5 flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={조건.q ?? ""}
          placeholder="광고 텍스트 / 광고주 검색"
          className="w-[260px] rounded-lg border border-[#e9eaee] px-3 py-2 text-[13px] outline-none focus:border-[#334fff]"
        />
        <select
          name="상태"
          defaultValue={조건.상태 ?? 기본상태}
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
          아직 데이터베이스에 연결되지 않았습니다. Vercel에 Neon을 붙이고
          적재(push_to_postgres.py)를 한 번 돌리면 이 자리에 소재가 나옵니다.
          <div className="mt-2 text-[12px] text-[#8a8f98]">{오류}</div>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3.5">
        {행들.map((행) => (
          <article
            key={행.ad_id}
            className="overflow-hidden rounded-xl border border-[#e9eaee] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(16,24,40,0.10)]"
          >
            <div className="aspect-square bg-[#f2f3f5]">
              {행.image_url && (
                // 외부 CDN(scontent) 이미지라 next/image 최적화 대신 그대로 쓴다.
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
              <div className="mb-1.5 truncate text-[12px] font-semibold">
                {표시광고주(행)}
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                {[행.creative_type, 행.insurance_type, 행.appeal_point]
                  .filter(Boolean)
                  .map((v, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-[#ebf1fd] px-2 py-0.5 text-[11px] font-medium text-[#334fff]"
                    >
                      {v}
                    </span>
                  ))}
              </div>
              <div className="flex items-center justify-between text-[11px] text-[#8a8f98]">
                <span>{행.status}</span>
                <span>운영 {행.running_days}일</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
