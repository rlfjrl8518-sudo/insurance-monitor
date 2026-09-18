import Link from "next/link";
import { sql } from "@/lib/db";
import { 날짜, 지표 } from "../ui";

export const dynamic = "force-dynamic";

type 이름값 = { v: string; n: number };
type 신규행 = {
  ad_id: string;
  image_url: string | null;
  그룹: string;
  creative_type: string | null;
  started_on: string | Date | null;
};

export default async function 인사이트() {
  let 현황 = { 전체: 0, 운영중: 0, 신규: 0, 종료: 0, 광고주: 0, 미분류: 0 };
  let 장수명: { 그룹: string; ad_id: string; running_days: number; image_url: string | null }[] = [];
  let 최근신규: 신규행[] = [];
  let 주간: 이름값[] = [];
  let 오류: string | null = null;

  try {
    const [a, b, c, d] = await Promise.all([
      sql`select count(*)::int 전체,
                 count(*) filter (where status='운영중')::int 운영중,
                 count(*) filter (where status='신규')::int 신규,
                 count(*) filter (where status='종료')::int 종료,
                 count(distinct coalesce(advertiser_group, advertiser))::int 광고주,
                 count(*) filter (where creative_type is null or creative_type='')::int 미분류
          from ads` as unknown as Promise<(typeof 현황)[]>,
      // 오래 돌린 소재 = 성과가 났을 가능성이 높은 소재. 경쟁사 벤치마크의 핵심 단서다.
      sql`select coalesce(advertiser_group, advertiser) 그룹, ad_id, running_days, image_url
          from ads where status <> '종료'
          order by running_days desc limit 12` as unknown as Promise<typeof 장수명>,
      sql`select ad_id, image_url, coalesce(advertiser_group, advertiser) 그룹,
                 creative_type, started_on
          from ads where status = '신규'
          order by started_on desc nulls last limit 12` as unknown as Promise<신규행[]>,
      // 최근 8주 게재 시작 추이
      sql`select to_char(date_trunc('week', started_on), 'MM/DD') v, count(*)::int n
          from ads where started_on >= current_date - interval '8 weeks'
          group by date_trunc('week', started_on)
          order by date_trunc('week', started_on)` as unknown as Promise<이름값[]>,
    ]);
    현황 = a[0];
    장수명 = b;
    최근신규 = c;
    주간 = d;
  } catch (e) {
    오류 = e instanceof Error ? e.message : String(e);
  }

  const 최대주 = Math.max(1, ...주간.map((x) => x.n));

  return (
    <div className="px-7 py-6">
      <h1 className="text-[20px] font-bold tracking-tight">인사이트</h1>
      <p className="mt-1 text-[13px] text-[#8a8f98]">
        지금 무엇이 돌고 있고, 무엇이 오래 버티고 있는지 한눈에 봅니다.
      </p>

      {오류 && (
        <div className="mt-5 rounded-xl border border-[#e9eaee] bg-[#ebf1fd] p-4 text-[13px] text-[#2840d9]">
          {오류}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <지표 값={현황.운영중} 단위="건" 설명="게재 중" />
        <지표 값={현황.신규} 단위="건" 설명="신규" />
        <지표 값={현황.종료} 단위="건" 설명="종료" />
        <지표 값={현황.전체} 단위="건" 설명="누적 수집" />
        <지표 값={현황.광고주} 단위="곳" 설명="광고주" />
        <지표 값={현황.미분류} 단위="건" 설명="미분류" />
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-[14px] font-bold">최근 8주 신규 게재</h2>
        <div className="flex items-end gap-2 rounded-xl border border-[#e9eaee] bg-white p-5">
          {주간.length === 0 && (
            <div className="w-full py-6 text-center text-[13px] text-[#8a8f98]">
              최근 8주 데이터가 없습니다.
            </div>
          )}
          {주간.map((w) => (
            <div key={w.v} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="text-[11px] font-semibold text-[#334fff]">{w.n}</span>
              <div
                className="w-full rounded-t bg-[#334fff]"
                style={{ height: `${Math.max(4, (w.n / 최대주) * 120)}px` }}
              />
              <span className="text-[10px] text-[#a7adb8]">{w.v}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-[14px] font-bold">오래 버티는 소재</h2>
        <p className="mb-3 text-[12px] text-[#8a8f98]">
          오래 돌린다는 건 성과가 났다는 신호일 가능성이 큽니다. 벤치마크 후보입니다.
        </p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {장수명.map((r) => (
            <div
              key={r.ad_id}
              className="overflow-hidden rounded-xl border border-[#e9eaee] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            >
              <div className="aspect-square bg-[#f2f3f5]">
                {r.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="p-2.5">
                <div className="truncate text-[12px] font-semibold">{r.그룹}</div>
                <div className="mt-0.5 text-[11px] text-[#334fff]">운영 {r.running_days}일</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-[14px] font-bold">이번에 새로 뜬 소재</h2>
        <p className="mb-3 text-[12px] text-[#8a8f98]">
          경쟁사가 막 시작한 소재입니다.{" "}
          <Link href="/?상태=신규" className="text-[#334fff] hover:underline">
            전체 보기
          </Link>
        </p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {최근신규.map((r) => (
            <div
              key={r.ad_id}
              className="overflow-hidden rounded-xl border border-[#e9eaee] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
            >
              <div className="aspect-square bg-[#f2f3f5]">
                {r.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="p-2.5">
                <div className="truncate text-[12px] font-semibold">{r.그룹}</div>
                <div className="mt-0.5 text-[11px] text-[#a7adb8]">
                  {날짜(r.started_on)} · {r.creative_type ?? "미분류"}
                </div>
              </div>
            </div>
          ))}
          {최근신규.length === 0 && (
            <div className="col-span-full rounded-xl border border-[#e9eaee] bg-white p-8 text-center text-[13px] text-[#8a8f98]">
              신규 소재가 없습니다.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
