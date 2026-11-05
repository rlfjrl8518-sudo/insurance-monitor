import Link from "next/link";
import { sql, 광고컬럼, 신규_일수, 신규인가, 표시광고주, 형식이름, type 광고 } from "@/lib/db";
import { 날짜, 아바타, 조건링크, 지표, 칩줄, 태그 } from "./ui";
import { 보드_토글 } from "./boards/actions";
import { 라벨_수정 } from "./actions";

export const dynamic = "force-dynamic";

type 검색조건 = {
  q?: string;
  상태?: string;
  신규?: string;
  검수?: string;
  업권?: string;
  그룹?: string;
  구분?: string;
  소재유형?: string;
  보종?: string;
  소구포인트?: string;
  형식?: string;
  운영일수?: string;
  정렬?: string;
  쪽?: string;
  소재?: string;   // 상세를 펼칠 소재. 검색 조건이 아니라 보기 상태다.
};

/** 상태는 게재중/종료 둘뿐이다. 예전의 '신규'는 상태가 아니라 '최근 7일 안에 처음 발견'이라는
 *  표시라서 따로 칩(신규만)으로 뺐다. '운영중'과 '게재중'이 따로 있어 헷갈리던 문제를 없앤다. */
const 기본상태 = "게재중";
const 쪽크기 = 120;

/** 분류 확신도가 이보다 낮으면 사람이 한 번 보는 게 좋다. */
const 검수기준 = 0.7;

const 운영일수_구간: Record<string, [number, number]> = {
  "1-10일": [0, 10],
  "11-30일": [11, 30],
  "31-60일": [31, 60],
  "61일+": [61, 100000],
};

const 정렬식: Record<string, string> = {
  최신: "first_seen_on desc nulls last, started_on desc nulls last, ad_id",
  오래간: "running_days desc, ad_id",
  변형많은: "variant_count desc nulls last, running_days desc, ad_id",
};

function 조건절(조건: 검색조건) {
  const 상태 = 조건.상태 ?? 기본상태;
  const [최소, 최대] = 운영일수_구간[조건.운영일수 ?? ""] ?? [-1, 100000];
  const 검색어 = (조건.q ?? "").trim();
  const 패턴 = "%" + 검색어 + "%";
  return sql`
        (${상태} = '전체' or status = ${상태})
    and (${조건.신규 ?? ""} = '' or (status <> '종료' and first_seen_on >= current_date - ${신규_일수}::int))
    and (${조건.검수 ?? ""} = '' or ((creative_type is null or creative_type = '' or confidence < ${검수기준})
                                     and not exists (select 1 from label_overrides o where o.ad_id = ads.ad_id)))
    and (${검색어} = '' or (coalesce(ad_text, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(title, '')) ilike ${패턴}
                        or advertiser ilike ${패턴} or coalesce(advertiser_group, '') ilike ${패턴})
    and (${조건.업권 ?? ""} = '' or category = ${조건.업권 ?? ""})
    and (${조건.그룹 ?? ""} = '' or coalesce(advertiser_group, advertiser) = ${조건.그룹 ?? ""})
    and (${조건.구분 ?? ""} = '' or segment = ${조건.구분 ?? ""})
    and (${조건.소재유형 ?? ""} = '' or creative_type = ${조건.소재유형 ?? ""})
    and (${조건.보종 ?? ""} = '' or insurance_type = ${조건.보종 ?? ""})
    and (${조건.소구포인트 ?? ""} = '' or appeal_point = ${조건.소구포인트 ?? ""})
    and (${조건.형식 ?? ""} = '' or display_format = ${조건.형식 ?? ""})
    and (${조건.운영일수 ?? ""} = '' or (running_days >= ${최소} and running_days <= ${최대}))
  `;
}

type 값개수 = { v: string; n: number };

async function 선택지(컬럼: string, 조건: 검색조건) {
  return (await sql`
    select ${sql.unsafe(컬럼)} v, count(*)::int n
    from ads where ${조건절(조건)} and ${sql.unsafe(컬럼)} is not null and ${sql.unsafe(컬럼)} <> ''
    group by 1 order by n desc
  `) as unknown as 값개수[];
}

/** 상세 화면의 '비슷한 소재'. 메타가 묶어 준 같은 묶음(변형)을 먼저, 그다음 문구가 비슷한 것. */
async function 비슷한소재(상세: 광고) {
  return (await sql`
    select ad_id, image_url, coalesce(advertiser_group, advertiser) 그룹, status,
           (case when collation_id is not null and collation_id = ${상세.collation_id ?? ""} then 2 else 0 end)
           + similarity(coalesce(ad_text, ''), ${상세.ad_text ?? ""}) 점수
    from ads
    where ad_id <> ${상세.ad_id}
      and (collation_id = ${상세.collation_id ?? "-"} or coalesce(ad_text, '') % ${상세.ad_text ?? ""})
    order by 점수 desc limit 8
  `) as unknown as { ad_id: string; image_url: string | null; 그룹: string; status: string; 점수: number }[];
}

export default async function 탐색({
  searchParams,
}: {
  searchParams: Promise<검색조건>;
}) {
  const { 소재: 펼친소재, ...조건 } = await searchParams;
  const 상태 = 조건.상태 ?? 기본상태;
  const 정렬 = 정렬식[조건.정렬 ?? ""] ? 조건.정렬! : "최신";
  const 쪽 = Math.max(1, Number(조건.쪽) || 1);

  let 행들: 광고[] = [];
  let 건수 = 0;
  let 목록: Record<string, 값개수[]> = {};
  let 전체현황 = { 전체: 0, 게재중: 0, 신규: 0, 광고주: 0, 미분류: 0, 검수: 0 };
  const 선택값: Record<string, string[]> = {};
  let 오류: string | null = null;

  try {
    const [ads, 수, 그룹, 업권, 소재, 보종, 소구, 형식, 현황, 축값] = await Promise.all([
      sql`select ${광고컬럼} from ads where ${조건절(조건)}
          order by ${sql.unsafe(정렬식[정렬])} limit ${쪽크기} offset ${(쪽 - 1) * 쪽크기}` as unknown as Promise<광고[]>,
      sql`select count(*)::int n from ads where ${조건절(조건)}` as unknown as Promise<{ n: number }[]>,
      sql`select coalesce(advertiser_group, advertiser) v, count(*)::int n
          from ads where ${조건절(조건)} group by 1 order by n desc limit 30` as unknown as Promise<값개수[]>,
      선택지("category", 조건),
      선택지("creative_type", 조건),
      선택지("insurance_type", 조건),
      선택지("appeal_point", 조건),
      선택지("display_format", 조건),
      sql`select count(*)::int 전체,
                 count(*) filter (where status <> '종료')::int 게재중,
                 count(*) filter (where status <> '종료' and first_seen_on >= current_date - ${신규_일수}::int)::int 신규,
                 count(distinct coalesce(advertiser_group, advertiser)) filter (where status <> '종료')::int 광고주,
                 count(*) filter (where creative_type is null or creative_type = '')::int 미분류,
                 count(*) filter (where creative_type <> '' and confidence < ${검수기준}
                                  and not exists (select 1 from label_overrides o where o.ad_id = ads.ad_id))::int 검수
          from ads` as unknown as Promise<(typeof 전체현황)[]>,
      sql`select 'creative_type' k, creative_type v from ads where creative_type <> '' group by 2
          union all select 'insurance_type', insurance_type from ads where insurance_type <> '' group by 2
          union all select 'appeal_point', appeal_point from ads where appeal_point <> '' group by 2` as unknown as Promise<{ k: string; v: string }[]>,
    ]);
    행들 = ads;
    건수 = 수[0]?.n ?? 0;
    목록 = { 그룹, 업권, 소재유형: 소재, 보종, 소구포인트: 소구, 형식: 형식.map((x) => ({ ...x, 라벨: 형식이름[x.v] ?? x.v })) };
    전체현황 = 현황[0];
    for (const { k, v } of 축값) (선택값[k] ??= []).push(v);
  } catch (e) {
    오류 = e instanceof Error ? e.message : String(e);
  }

  const 묶음 = new Map<string, 광고[]>();
  for (const 행 of 행들) {
    const k = 표시광고주(행);
    (묶음.get(k) ?? 묶음.set(k, []).get(k)!).push(행);
  }

  let 상세: 광고 | null = 펼친소재 ? (행들.find((r) => r.ad_id === 펼친소재) ?? null) : null;
  let 비슷: Awaited<ReturnType<typeof 비슷한소재>> = [];
  if (펼친소재) {
    try {
      if (!상세) {
        const r = (await sql`select ${광고컬럼} from ads where ad_id = ${펼친소재} limit 1`) as unknown as 광고[];
        상세 = r[0] ?? null;
      }
      if (상세) 비슷 = await 비슷한소재(상세);
    } catch {
      // 비슷한 소재는 덤이다. 못 읽어도 상세는 띄운다.
    }
  }

  const 상태목록: 값개수[] = ["게재중", "종료", "전체"].map((v) => ({ v, n: 0 }));
  const 구분목록: 값개수[] = [{ v: "자사", n: 0 }, { v: "경쟁사", n: 0 }];
  const 일수목록: 값개수[] = Object.keys(운영일수_구간).map((v) => ({ v, n: 0 }));
  const 정렬목록: 값개수[] = Object.keys(정렬식).map((v) => ({ v, n: 0 }));
  const 마지막쪽 = Math.max(1, Math.ceil(건수 / 쪽크기));

  return (
    <div className="px-7 py-6">
      <div className="mb-5">
        <h1 className="text-[20px] font-bold tracking-tight">탐색</h1>
        <p className="mt-1 text-[13px] text-[#8a8f98]">
          경쟁사가 지금 돌리고 있는 소재를 광고주별로 모아 봅니다.
        </p>
      </div>

      {!오류 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Link href="/"><지표 값={전체현황.게재중} 단위="건" 설명="지금 게재 중인 소재" /></Link>
          <Link href="/?신규=1"><지표 값={전체현황.신규} 단위="건" 설명={`최근 ${신규_일수}일 새로 발견`} /></Link>
          <지표 값={전체현황.광고주} 단위="곳" 설명="게재 중인 광고주" />
          <지표 값={전체현황.전체} 단위="건" 설명="지금까지 수집한 전체" />
          <Link href="/?검수=1&상태=전체">
            <지표 값={전체현황.미분류 + 전체현황.검수} 단위="건" 설명="미분류 · 확신 낮은 분류 (검수)" />
          </Link>
        </div>
      )}

      <form className="mb-3 flex flex-wrap gap-2">
        {Object.entries(조건)
          .filter(([k, v]) => k !== "q" && k !== "쪽" && v)
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v as string} />
          ))}
        <input
          name="q"
          defaultValue={조건.q ?? ""}
          placeholder="문구 · 요약 · 광고주 검색"
          className="w-[280px] rounded-full border border-[#e4e6eb] bg-white px-4 py-2 text-[13px] outline-none transition focus:border-[#334fff] focus:ring-4 focus:ring-[#ebf1fd]"
        />
        <button className="rounded-full bg-[#334fff] px-5 py-2 text-[13px] font-semibold text-white transition hover:bg-[#2840d9]">
          검색
        </button>
        <Link
          href="/"
          className="rounded-full border border-[#e4e6eb] bg-white px-4 py-2 text-[13px] text-[#8a8f98] transition hover:border-[#c3cbe4] hover:text-[#334fff]"
        >
          초기화
        </Link>
        <Link
          href={조건링크({ ...조건, 쪽: "" }, "신규", 조건.신규 ? "" : "1")}
          className={`rounded-full border px-4 py-2 text-[13px] ${
            조건.신규 ? "border-[#18794e] bg-[#e7f6ec] font-semibold text-[#18794e]" : "border-[#e4e6eb] bg-white text-[#5c626d]"
          }`}
        >
          NEW만
        </Link>
        <Link
          href={조건링크({ ...조건, 쪽: "" }, "검수", 조건.검수 ? "" : "1")}
          className={`rounded-full border px-4 py-2 text-[13px] ${
            조건.검수 ? "border-[#c23934] bg-[#fff1f0] font-semibold text-[#c23934]" : "border-[#e4e6eb] bg-white text-[#5c626d]"
          }`}
        >
          검수 필요만
        </Link>
      </form>

      <div className="mb-7 rounded-xl border border-[#e9eaee] bg-white px-4 py-2">
        <칩줄 제목="상태" 키="상태" 현재값={상태} 목록={상태목록} 조건={{ ...조건, 쪽: "" }} />
        <칩줄 제목="업권" 키="업권" 현재값={조건.업권 ?? ""} 목록={목록.업권 ?? []} 조건={{ ...조건, 쪽: "" }} />
        <칩줄 제목="광고주" 키="그룹" 현재값={조건.그룹 ?? ""} 목록={목록.그룹 ?? []} 조건={{ ...조건, 쪽: "" }} />
        <칩줄 제목="구분" 키="구분" 현재값={조건.구분 ?? ""} 목록={구분목록} 조건={{ ...조건, 쪽: "" }} />
        <칩줄 제목="소재유형" 키="소재유형" 현재값={조건.소재유형 ?? ""} 목록={목록.소재유형 ?? []} 조건={{ ...조건, 쪽: "" }} />
        <칩줄 제목="소구포인트" 키="소구포인트" 현재값={조건.소구포인트 ?? ""} 목록={목록.소구포인트 ?? []} 조건={{ ...조건, 쪽: "" }} />
        <칩줄 제목="보종" 키="보종" 현재값={조건.보종 ?? ""} 목록={목록.보종 ?? []} 조건={{ ...조건, 쪽: "" }} />
        <칩줄 제목="형식" 키="형식" 현재값={조건.형식 ?? ""} 목록={목록.형식 ?? []} 조건={{ ...조건, 쪽: "" }} />
        <칩줄 제목="운영일수" 키="운영일수" 현재값={조건.운영일수 ?? ""} 목록={일수목록} 조건={{ ...조건, 쪽: "" }} />
        <칩줄 제목="정렬" 키="정렬" 현재값={정렬} 목록={정렬목록} 조건={{ ...조건, 쪽: "" }} 전체없음 />
      </div>

      {오류 && (
        <div className="rounded-xl border border-[#e9eaee] bg-[#ebf1fd] p-4 text-[13px] text-[#2840d9]">
          데이터베이스를 읽지 못했습니다.
          <div className="mt-2 text-[12px] text-[#8a8f98]">{오류}</div>
        </div>
      )}

      {!오류 && (
        <div className="mb-4 flex items-center gap-2 text-[13px] text-[#8a8f98]">
          검색 결과 <b className="text-[#16181d]">{건수.toLocaleString()}</b>건 · 이 쪽 광고주 {묶음.size}곳
          {마지막쪽 > 1 && <span>· {쪽}/{마지막쪽}쪽</span>}
        </div>
      )}

      {[...묶음.entries()].map(([그룹명, 소재들]) => (
        <section key={그룹명} className="mb-9">
          <div className="mb-3 flex items-center gap-2">
            <아바타 이름={그룹명} />
            <Link href={`/brands/${encodeURIComponent(그룹명)}`} className="text-[14px] font-bold hover:text-[#334fff]">
              {그룹명}
            </Link>
            {소재들[0]?.segment === "자사" && (
              <span className="rounded-full bg-[#ebf1fd] px-2 py-0.5 text-[11px] font-semibold text-[#334fff]">자사</span>
            )}
            {소재들[0]?.category && (
              <span className="rounded-full bg-[#f2f3f5] px-2 py-0.5 text-[11px] text-[#5c626d]">{소재들[0].category}</span>
            )}
            <span className="rounded-full bg-[#f2f3f5] px-2 py-0.5 text-[11px] text-[#5c626d]">{소재들.length}건</span>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-4">
            {소재들.map((행) => (
              <article
                key={행.ad_id}
                className="group relative overflow-hidden rounded-xl border border-[#e9eaee] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:-translate-y-1 hover:border-[#c3cbe4] hover:shadow-[0_12px_28px_rgba(16,24,40,0.12)]"
              >
                <Link href={조건링크(조건, "소재", 행.ad_id)} className="block">
                  <div className="relative aspect-square overflow-hidden bg-[#f2f3f5]">
                    {행.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={행.image_url}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                      />
                    )}
                    <div className="absolute left-2 top-2 flex gap-1">
                      {신규인가(행) && (
                        <span className="rounded-full bg-[#18794e] px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">NEW</span>
                      )}
                      {행.status === "종료" && (
                        <span className="rounded-full bg-white/92 px-2 py-0.5 text-[10px] font-semibold text-[#8a8f98] shadow-sm">종료</span>
                      )}
                      {행.display_format === "VIDEO" && (
                        <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">▶ 영상</span>
                      )}
                    </div>
                    {(행.variant_count ?? 1) > 1 && (
                      <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
                        변형 {행.variant_count}
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="mb-2 flex flex-wrap gap-1">
                      <태그 값={행.creative_type} 강조 />
                      <태그 값={행.insurance_type} />
                      <태그 값={행.appeal_point} />
                      {행.confidence !== null && 행.confidence < 검수기준 && (
                        <span className="rounded-full bg-[#fff4e5] px-2 py-0.5 text-[11px] font-medium text-[#9a6412]">검수</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#a7adb8]">
                      <span>{날짜(행.started_on)}</span>
                      <span>운영 {행.running_days}일</span>
                    </div>
                  </div>
                </Link>

                <form action={보드_토글} className="absolute right-2 top-2">
                  <input type="hidden" name="ad_id" value={행.ad_id} />
                  <input type="hidden" name="보드명" value="참고 소재" />
                  <button
                    title="보드에 담기 / 빼기"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-white/92 text-[13px] text-[#334fff] opacity-0 shadow-sm transition group-hover:opacity-100 hover:bg-[#334fff] hover:text-white"
                  >
                    ＋
                  </button>
                </form>
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

      {마지막쪽 > 1 && (
        <div className="mt-2 flex justify-center gap-2 text-[13px]">
          {쪽 > 1 && (
            <Link href={조건링크(조건, "쪽", String(쪽 - 1))} className="rounded-full border border-[#e4e6eb] bg-white px-4 py-2">
              ← 이전
            </Link>
          )}
          {쪽 < 마지막쪽 && (
            <Link href={조건링크(조건, "쪽", String(쪽 + 1))} className="rounded-full border border-[#e4e6eb] bg-white px-4 py-2">
              다음 →
            </Link>
          )}
        </div>
      )}

      {상세 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Link href={조건링크(조건, "소재", "")} aria-label="닫기" className="absolute inset-0 bg-[#16181d]/55" />
          <div className="relative flex max-h-[90vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_64px_rgba(16,24,40,0.28)] md:flex-row">
            <div className="flex shrink-0 items-center justify-center bg-[#f2f3f5] md:w-[44%]">
              {상세.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={상세.image_url} alt="" className="max-h-[42vh] w-full object-contain md:max-h-[90vh]" />
              ) : (
                <div className="px-6 py-20 text-center text-[12px] text-[#a7adb8]">이미지가 만료되어 표시할 수 없습니다.</div>
              )}
            </div>

            <div className="min-w-0 flex-1 overflow-y-auto p-6">
              <div className="mb-3 flex items-center gap-2">
                <아바타 이름={표시광고주(상세)} />
                <Link href={`/brands/${encodeURIComponent(표시광고주(상세))}`} className="text-[14px] font-bold hover:text-[#334fff]">
                  {표시광고주(상세)}
                </Link>
                <span className="rounded-full bg-[#f2f3f5] px-2 py-0.5 text-[11px] text-[#5c626d]">{상세.status}</span>
                {신규인가(상세) && <span className="rounded-full bg-[#e7f6ec] px-2 py-0.5 text-[11px] font-semibold text-[#18794e]">NEW</span>}
                <Link
                  href={조건링크(조건, "소재", "")}
                  className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-[15px] text-[#8a8f98] hover:bg-[#f2f3f5]"
                >
                  ✕
                </Link>
              </div>

              <div className="mb-3 flex flex-wrap gap-1">
                <태그 값={상세.creative_type} 강조 />
                <태그 값={상세.insurance_type} />
                <태그 값={상세.appeal_point} />
                {Object.entries(상세.labels ?? {}).map(([k, v]) => (
                  <태그 key={k} 값={`${k}·${v}`} />
                ))}
              </div>

              <dl className="mb-4 grid grid-cols-2 gap-y-1.5 text-[12px]">
                <dt className="text-[#8a8f98]">게재 시작</dt>
                <dd className="text-right font-medium">{날짜(상세.started_on)}</dd>
                <dt className="text-[#8a8f98]">처음 발견 · 운영일수</dt>
                <dd className="text-right font-medium">{날짜(상세.first_seen_on)} · {상세.running_days}일</dd>
                {상세.ended_on && (
                  <>
                    <dt className="text-[#8a8f98]">마지막 확인(종료)</dt>
                    <dd className="text-right font-medium">{날짜(상세.ended_on)}</dd>
                  </>
                )}
                <dt className="text-[#8a8f98]">형식 · 변형</dt>
                <dd className="text-right font-medium">
                  {형식이름[상세.display_format ?? ""] ?? 상세.display_format ?? "-"} · {상세.variant_count ?? 1}개
                </dd>
                {상세.platforms && (
                  <>
                    <dt className="text-[#8a8f98]">게재 지면</dt>
                    <dd className="text-right font-medium">{상세.platforms.toLowerCase().replaceAll(",", " · ")}</dd>
                  </>
                )}
                {상세.cta && (
                  <>
                    <dt className="text-[#8a8f98]">CTA</dt>
                    <dd className="text-right font-medium">{상세.cta}</dd>
                  </>
                )}
                <dt className="text-[#8a8f98]">페이지명 · 분류 확신도</dt>
                <dd className="truncate text-right font-medium">
                  {상세.advertiser} · {상세.confidence !== null ? `${Math.round(상세.confidence * 100)}%` : "-"}
                </dd>
              </dl>

              {상세.summary && (
                <p className="mb-3 rounded-lg bg-[#ebf1fd] px-3 py-2 text-[12px] leading-relaxed text-[#2840d9]">{상세.summary}</p>
              )}

              {상세.title && <div className="mb-1.5 text-[13px] font-bold">{상세.title}</div>}
              <div className="mb-1.5 text-[12px] font-semibold">소재 문구</div>
              <p className="mb-4 max-h-[220px] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-[#e9eaee] bg-[#fafbfc] px-3 py-2.5 text-[12px] leading-relaxed text-[#3d434d]">
                {상세.ad_text?.trim() || "문구가 없는 소재입니다."}
              </p>

              <div className="mb-5 flex flex-wrap gap-2">
                {상세.detail_url && (
                  <a href={상세.detail_url} target="_blank" rel="noopener noreferrer" className="rounded-full bg-[#334fff] px-4 py-2 text-[12px] font-semibold text-white">
                    광고 라이브러리 ↗
                  </a>
                )}
                {상세.landing_url && (
                  <a href={상세.landing_url} target="_blank" rel="noopener noreferrer" className="rounded-full border border-[#334fff] px-4 py-2 text-[12px] font-semibold text-[#334fff]">
                    랜딩페이지 ↗
                  </a>
                )}
                <form action={보드_토글}>
                  <input type="hidden" name="ad_id" value={상세.ad_id} />
                  <input type="hidden" name="보드명" value="참고 소재" />
                  <button className="rounded-full border border-[#e4e6eb] px-4 py-2 text-[12px] font-semibold text-[#5c626d] hover:border-[#334fff] hover:text-[#334fff]">
                    보드에 담기 / 빼기
                  </button>
                </form>
              </div>

              {/* 분류가 틀렸으면 여기서 고친다. 고친 값은 다음 적재 때도 유지되고, AI 정확도 측정의 정답이 된다. */}
              <form action={라벨_수정} className="mb-5 rounded-lg border border-[#e9eaee] p-3">
                <input type="hidden" name="ad_id" value={상세.ad_id} />
                <div className="mb-2 text-[12px] font-semibold">분류 고치기</div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ["소재유형", "creative_type", 상세.creative_type],
                    ["보종", "insurance_type", 상세.insurance_type],
                    ["소구포인트", "appeal_point", 상세.appeal_point],
                  ] as const).map(([이름, 컬럼, 현재]) => (
                    <label key={이름} className="text-[11px] text-[#8a8f98]">
                      {이름}
                      <select name={이름} defaultValue={현재 ?? ""} className="mt-1 w-full rounded-md border border-[#e4e6eb] px-2 py-1 text-[12px] text-[#16181d]">
                        <option value="">-</option>
                        {(선택값[컬럼] ?? []).sort().map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <button className="mt-2 rounded-full bg-[#16181d] px-4 py-1.5 text-[12px] font-semibold text-white">저장</button>
              </form>

              {비슷.length > 0 && (
                <div>
                  <div className="mb-2 text-[12px] font-semibold">비슷한 소재 (같은 묶음 · 비슷한 문구)</div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {비슷.map((b) => (
                      <Link key={b.ad_id} href={조건링크(조건, "소재", b.ad_id)} title={`${b.그룹} · ${b.status}`} className="relative aspect-square overflow-hidden rounded-lg bg-[#f2f3f5]">
                        {b.image_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={b.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                        )}
                        <span className="absolute bottom-0.5 left-0.5 max-w-[95%] truncate rounded bg-white/90 px-1 text-[9px]">{b.그룹}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
