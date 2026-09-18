import { sql, 표시광고주, type 광고 } from "@/lib/db";
import { 날짜, 아바타, 지표, 칩줄, 태그 } from "./ui";

export const dynamic = "force-dynamic";

type 검색조건 = {
  q?: string;
  상태?: string;
  그룹?: string;
  구분?: string;
  소재유형?: string;
  보종?: string;
  소구포인트?: string;
  운영일수?: string;
};

/** 기본은 운영중만. 종료까지 다 나오면 지금 돌고 있는 걸 보기 어렵다. */
const 기본상태 = "운영중";

const 운영일수_구간: Record<string, [number, number]> = {
  "1-10일": [1, 10],
  "11-30일": [11, 30],
  "31-60일": [31, 60],
  "61일+": [61, 100000],
};

/** 필터 조건을 SQL 한 벌로 만든다. 조건이 늘어나도 한 곳만 고치면 되게 모아 둔다. */
function 조건절(조건: 검색조건) {
  const 상태 = 조건.상태 ?? 기본상태;
  const [최소, 최대] = 운영일수_구간[조건.운영일수 ?? ""] ?? [-1, 100000];
  const 검색어 = (조건.q ?? "").trim();
  return sql`
        (${상태} = '전체' or status = ${상태})
    and (${검색어} = '' or ad_text ilike ${"%" + 검색어 + "%"}
                        or advertiser ilike ${"%" + 검색어 + "%"})
    and (${조건.그룹 ?? ""} = '' or coalesce(advertiser_group, advertiser) = ${조건.그룹 ?? ""})
    and (${조건.구분 ?? ""} = '' or segment = ${조건.구분 ?? ""})
    and (${조건.소재유형 ?? ""} = '' or creative_type = ${조건.소재유형 ?? ""})
    and (${조건.보종 ?? ""} = '' or insurance_type = ${조건.보종 ?? ""})
    and (${조건.소구포인트 ?? ""} = '' or appeal_point = ${조건.소구포인트 ?? ""})
    and (${조건.운영일수 ?? ""} = '' or (running_days >= ${최소} and running_days <= ${최대}))
  `;
}

type 값개수 = { v: string; n: number };

/** 필터 선택지. 지금 조건에서 실제로 존재하는 값만 건수와 함께 보여준다. */
async function 선택지(컬럼: string, 조건: 검색조건) {
  return (await sql`
    select ${sql.unsafe(컬럼)} v, count(*)::int n
    from ads where ${조건절(조건)} and ${sql.unsafe(컬럼)} is not null and ${sql.unsafe(컬럼)} <> ''
    group by 1 order by n desc
  `) as unknown as 값개수[];
}

export default async function 탐색({
  searchParams,
}: {
  searchParams: Promise<검색조건>;
}) {
  const 조건 = await searchParams;
  const 상태 = 조건.상태 ?? 기본상태;

  let 행들: 광고[] = [];
  let 목록: Record<string, 값개수[]> = {};
  let 전체현황 = { 전체: 0, 운영중: 0, 광고주: 0, 미분류: 0 };
  let 오류: string | null = null;

  try {
    const [ads, 그룹, 소재, 보종, 소구, 현황] = await Promise.all([
      sql`select ad_id, advertiser, advertiser_group, segment, image_url, detail_url,
                 ad_text, summary, creative_type, insurance_type, appeal_point,
                 labels, started_on, ended_on, status, running_days
          from ads where ${조건절(조건)}
          order by started_on desc nulls last, ad_id limit 600` as unknown as Promise<광고[]>,
      sql`select coalesce(advertiser_group, advertiser) v, count(*)::int n
          from ads where ${조건절(조건)} group by 1 order by n desc limit 24` as unknown as Promise<값개수[]>,
      선택지("creative_type", 조건),
      선택지("insurance_type", 조건),
      선택지("appeal_point", 조건),
      sql`select count(*)::int 전체,
                 count(*) filter (where status = '운영중')::int 운영중,
                 count(distinct coalesce(advertiser_group, advertiser))::int 광고주,
                 count(*) filter (where creative_type is null or creative_type = '')::int 미분류
          from ads` as unknown as Promise<(typeof 전체현황)[]>,
    ]);
    행들 = ads;
    목록 = { 그룹, 소재유형: 소재, 보종, 소구포인트: 소구 };
    전체현황 = 현황[0];
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

  // 상태·구분·운영일수는 지금 조건 안에서 세면 항상 자기 자신만 남아 의미가 없다.
  // 건수 없이 선택지만 보여준다.
  const 상태목록: 값개수[] = ["운영중", "신규", "종료", "전체"].map((v) => ({ v, n: 0 }));
  const 구분목록: 값개수[] = [
    { v: "자사", n: 0 },
    { v: "경쟁사", n: 0 },
  ];
  const 일수목록: 값개수[] = Object.keys(운영일수_구간).map((v) => ({ v, n: 0 }));

  return (
    <div className="px-7 py-6">
      <div className="mb-5">
        <h1 className="text-[20px] font-bold tracking-tight">탐색</h1>
        <p className="mt-1 text-[13px] text-[#8a8f98]">
          경쟁사가 지금 돌리고 있는 소재를 광고주별로 모아 봅니다.
        </p>
      </div>

      {!오류 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <지표 값={전체현황.운영중} 단위="건" 설명="지금 게재 중인 소재" />
          <지표 값={전체현황.전체} 단위="건" 설명="지금까지 수집한 전체" />
          <지표 값={전체현황.광고주} 단위="곳" 설명="감시 중인 광고주" />
          <지표 값={전체현황.미분류} 단위="건" 설명="분류가 비어 있는 소재" />
        </div>
      )}

      {/* 검색은 값 입력이라 폼으로, 나머지 조건은 칩으로 고른다.
          칩은 누르는 즉시 걸려서 "적용" 버튼을 다시 누를 필요가 없다. */}
      <form className="mb-3 flex gap-2">
        {Object.entries(조건)
          .filter(([k, v]) => k !== "q" && v)
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v as string} />
          ))}
        <input
          name="q"
          defaultValue={조건.q ?? ""}
          placeholder="광고 텍스트 · 광고주 검색"
          className="w-[280px] rounded-full border border-[#e4e6eb] bg-white px-4 py-2 text-[13px] outline-none transition focus:border-[#334fff] focus:ring-4 focus:ring-[#ebf1fd]"
        />
        <button className="rounded-full bg-[#334fff] px-5 py-2 text-[13px] font-semibold text-white transition hover:bg-[#2840d9]">
          검색
        </button>
        <a
          href="/"
          className="rounded-full border border-[#e4e6eb] bg-white px-4 py-2 text-[13px] text-[#8a8f98] transition hover:border-[#c3cbe4] hover:text-[#334fff]"
        >
          초기화
        </a>
      </form>

      <div className="mb-7 rounded-xl border border-[#e9eaee] bg-white px-4 py-2">
        <칩줄 제목="상태" 키="상태" 현재값={상태 === 기본상태 ? "운영중" : 상태} 목록={상태목록} 조건={조건} />
        <칩줄 제목="구분" 키="구분" 현재값={조건.구분 ?? ""} 목록={구분목록} 조건={조건} />
        <칩줄 제목="소재유형" 키="소재유형" 현재값={조건.소재유형 ?? ""} 목록={목록.소재유형 ?? []} 조건={조건} />
        <칩줄 제목="소구포인트" 키="소구포인트" 현재값={조건.소구포인트 ?? ""} 목록={목록.소구포인트 ?? []} 조건={조건} />
        <칩줄 제목="보종" 키="보종" 현재값={조건.보종 ?? ""} 목록={목록.보종 ?? []} 조건={조건} />
        <칩줄 제목="운영일수" 키="운영일수" 현재값={조건.운영일수 ?? ""} 목록={일수목록} 조건={조건} />
        <칩줄 제목="광고주" 키="그룹" 현재값={조건.그룹 ?? ""} 목록={목록.그룹 ?? []} 조건={조건} />
      </div>

      {오류 && (
        <div className="rounded-xl border border-[#e9eaee] bg-[#ebf1fd] p-4 text-[13px] text-[#2840d9]">
          데이터베이스를 읽지 못했습니다.
          <div className="mt-2 text-[12px] text-[#8a8f98]">{오류}</div>
        </div>
      )}

      {!오류 && (
        <div className="mb-4 text-[13px] text-[#8a8f98]">
          검색 결과 <b className="text-[#16181d]">{행들.length.toLocaleString()}</b>건 ·
          광고주 {묶음.size}곳
        </div>
      )}

      {[...묶음.entries()].map(([그룹명, 소재들]) => (
        <section key={그룹명} className="mb-9">
          <div className="mb-3 flex items-center gap-2">
            <아바타 이름={그룹명} />
            <h2 className="text-[14px] font-bold">{그룹명}</h2>
            {소재들[0]?.segment === "자사" && (
              <span className="rounded-full bg-[#ebf1fd] px-2 py-0.5 text-[11px] font-semibold text-[#334fff]">
                자사
              </span>
            )}
            <span className="rounded-full bg-[#f2f3f5] px-2 py-0.5 text-[11px] text-[#5c626d]">
              {소재들.length}건 게재 중
            </span>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-4">
            {소재들.map((행) => (
              <article
                key={행.ad_id}
                className="group overflow-hidden rounded-xl border border-[#e9eaee] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:-translate-y-1 hover:border-[#c3cbe4] hover:shadow-[0_12px_28px_rgba(16,24,40,0.12)]"
              >
                <div className="relative aspect-square overflow-hidden bg-[#f2f3f5]">
                  {행.image_url && (
                    // 외부 저장소 이미지라 next/image 최적화 대신 그대로 쓴다.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={행.image_url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    />
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-white/92 px-2 py-0.5 text-[10px] font-semibold text-[#334fff] shadow-sm">
                    {행.status}
                  </span>
                </div>
                <div className="p-3">
                  <div className="mb-2 flex flex-wrap gap-1">
                    <태그 값={행.creative_type} 강조 />
                    <태그 값={행.insurance_type} />
                    <태그 값={행.appeal_point} />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#a7adb8]">
                    <span>{날짜(행.started_on)}</span>
                    <span>운영 {행.running_days}일</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {!오류 && 행들.length === 0 && (
        <div className="rounded-xl border border-[#e9eaee] bg-white p-10 text-center text-[13px] text-[#8a8f98]">
          조건에 맞는 소재가 없습니다.
        </div>
      )}
    </div>
  );
}
