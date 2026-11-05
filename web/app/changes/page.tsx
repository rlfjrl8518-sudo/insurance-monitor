import Link from "next/link";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type 광고주변화 = { g: string; 이번: number; 지난: number; 게재중: number; 종료: number };
type 진입 = { g: string; v: string; n: number };
type 장수종료 = { ad_id: string; g: string; running_days: number; insurance_type: string | null; image_url: string | null };
type 썸네일 = { ad_id: string; g: string; image_url: string | null; insurance_type: string | null };

/** 이번 주(최근 7일)에 무엇이 바뀌었나. 주간 회의 전에 이 화면 하나만 보면 되게 한다.
 *
 *  - 광고주별 신규 투입량: 지난주 대비 급증하면 캠페인을 새로 시작한 것
 *  - 새로 들어온 보종: 최근 60일엔 없던 보종을 이번 주에 처음 돌리기 시작한 광고주
 *  - 오래 돌던 소재의 종료: 60일 이상 돌던 소재를 내렸다면 교체 신호 */
export default async function 변화({ searchParams }: { searchParams: Promise<{ 일?: string }> }) {
  const 일 = Math.min(30, Math.max(3, Number((await searchParams).일) || 7));
  let 광고주: 광고주변화[] = [];
  let 신규보종: 진입[] = [];
  let 장수: 장수종료[] = [];
  let 새소재: 썸네일[] = [];
  let 추이: { v: string; n: number }[] = [];
  let 주별: { v: string; n: number }[] = [];
  let 오류: string | null = null;
  try {
    [광고주, 신규보종, 장수, 새소재, 추이, 주별] = (await Promise.all([
      sql`select coalesce(advertiser_group, advertiser) g,
                 count(*) filter (where coalesce(started_on, first_seen_on) >= current_date - ${일}::int)::int 이번,
                 count(*) filter (where coalesce(started_on, first_seen_on) >= current_date - ${일 * 2}::int
                                    and coalesce(started_on, first_seen_on) < current_date - ${일}::int)::int 지난,
                 count(*) filter (where status <> '종료')::int 게재중,
                 count(*) filter (where status = '종료' and ended_on >= current_date - ${일}::int)::int 종료
          from ads group by 1
          having count(*) filter (where coalesce(started_on, first_seen_on) >= current_date - ${일 * 2}::int) > 0
              or count(*) filter (where status = '종료' and ended_on >= current_date - ${일}::int) > 0
          order by 이번 desc`,
      sql`select coalesce(advertiser_group, advertiser) g, insurance_type v, count(*)::int n
          from ads a
          where coalesce(started_on, first_seen_on) >= current_date - ${일}::int and insurance_type not in ('', '기타')
            and not exists (
              select 1 from ads b
              where coalesce(b.advertiser_group, b.advertiser) = coalesce(a.advertiser_group, a.advertiser)
                and b.insurance_type = a.insurance_type
                and coalesce(b.started_on, b.first_seen_on) < current_date - ${일}::int
                and coalesce(b.ended_on, current_date) >= current_date - 60)
          group by 1, 2 order by 3 desc`,
      sql`select ad_id, coalesce(advertiser_group, advertiser) g, running_days, insurance_type, image_url
          from ads where status = '종료' and ended_on >= current_date - ${일}::int and running_days >= 60
          order by running_days desc limit 16`,
      sql`select ad_id, coalesce(advertiser_group, advertiser) g, image_url, insurance_type
          from ads where coalesce(started_on, first_seen_on) >= current_date - ${일}::int and status <> '종료' and segment <> '자사'
          order by coalesce(started_on, first_seen_on) desc, variant_count desc nulls last limit 24`,
      sql`select to_char(seen_on, 'MM/DD') v, count(*)::int n from ad_sightings
          where seen_on >= current_date - 42 group by seen_on order by seen_on`,
      sql`select to_char(date_trunc('week', coalesce(started_on, first_seen_on)), 'MM/DD') v, count(*)::int n
          from ads where coalesce(started_on, first_seen_on) >= current_date - interval '12 weeks'
          group by date_trunc('week', coalesce(started_on, first_seen_on)) order by date_trunc('week', coalesce(started_on, first_seen_on))`,
    ])) as unknown as [광고주변화[], 진입[], 장수종료[], 썸네일[], { v: string; n: number }[], { v: string; n: number }[]];
  } catch (e) {
    오류 = e instanceof Error ? e.message : String(e);
  }

  const 급증 = (x: 광고주변화) => x.이번 >= 5 && x.이번 >= x.지난 * 2;

  return (
    <div className="px-7 py-6">
      <h1 className="text-[20px] font-bold tracking-tight">변화</h1>
      <p className="mt-1 text-[13px] text-[#8a8f98]">최근 {일}일 동안 경쟁사 소재에서 달라진 것만 모았습니다.</p>
      <div className="mt-4 mb-6 flex gap-1.5">
        {[7, 14, 30].map((d) => (
          <Link key={d} href={`/changes?일=${d}`} className={`rounded-full border px-3 py-1.5 text-[12px] ${일 === d ? "border-[#334fff] bg-[#334fff] font-semibold text-white" : "border-[#e4e6eb] bg-white text-[#5c626d]"}`}>
            최근 {d}일
          </Link>
        ))}
      </div>
      {오류 && <div className="mb-5 rounded-xl bg-[#ebf1fd] p-4 text-[13px] text-[#2840d9]">{오류}</div>}

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        {[
          ["게재 중 소재 수 (일별, 최근 6주)", 추이, "2026-11 수집 개편 이후부터 쌓입니다."],
          ["새로 시작한 소재 (주별, 12주)", 주별, "광고 시작일 기준입니다(시작일이 없으면 처음 발견일)."],
        ].map(([제목, 값들, 메모]) => {
          const 목록 = 값들 as { v: string; n: number }[];
          const 최대 = Math.max(1, ...목록.map((x) => x.n));
          return (
            <section key={제목 as string} className="rounded-xl border border-[#e9eaee] bg-white p-5">
              <h2 className="text-[13px] font-bold">{제목 as string}</h2>
              <p className="mb-3 text-[11px] text-[#a7adb8]">{메모 as string}</p>
              <div className="flex h-[110px] items-end gap-[3px]">
                {목록.length === 0 && <div className="w-full self-center text-center text-[12px] text-[#8a8f98]">기록 없음</div>}
                {목록.map((x) => (
                  <div key={x.v} title={`${x.v} ${x.n}건`} className="flex-1 rounded-t bg-[#8496ff] hover:bg-[#334fff]" style={{ height: `${Math.max(3, (x.n / 최대) * 100)}%` }} />
                ))}
              </div>
              {목록.length > 0 && (
                <div className="mt-1 flex justify-between text-[10px] text-[#a7adb8]">
                  <span>{목록[0].v}</span>
                  <span>{목록[목록.length - 1].v}</span>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-[14px] font-bold">광고주별 신규 투입</h2>
        <div className="overflow-hidden rounded-xl border border-[#e9eaee] bg-white">
          <table className="w-full text-[12px]">
            <thead className="bg-[#fafbfc] text-[11px] text-[#8a8f98]">
              <tr>
                <th className="px-4 py-2 text-left font-medium">광고주</th>
                <th className="px-4 py-2 text-right font-medium">이번 {일}일 신규</th>
                <th className="px-4 py-2 text-right font-medium">직전 {일}일</th>
                <th className="px-4 py-2 text-right font-medium">종료</th>
                <th className="px-4 py-2 text-right font-medium">게재 중</th>
              </tr>
            </thead>
            <tbody>
              {광고주.map((x) => (
                <tr key={x.g} className="border-t border-[#f0f1f4]">
                  <td className="px-4 py-2 font-medium">
                    <Link href={`/brands/${encodeURIComponent(x.g)}`} className="hover:text-[#334fff]">{x.g}</Link>
                    {급증(x) && <span className="ml-2 rounded-full bg-[#fff1f0] px-2 py-0.5 text-[10px] font-bold text-[#c23934]">급증</span>}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">
                    <Link href={`/?그룹=${encodeURIComponent(x.g)}&신규=1`} className="text-[#334fff]">{x.이번}</Link>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-[#8a8f98]">{x.지난}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[#8a8f98]">{x.종료}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{x.게재중}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-[14px] font-bold">새로 들어온 보종</h2>
        <p className="mb-3 text-[12px] text-[#8a8f98]">최근 60일 동안 돌리지 않던 보종을 이번에 시작한 광고주입니다.</p>
        <div className="flex flex-wrap gap-2">
          {신규보종.length === 0 && <span className="text-[12px] text-[#8a8f98]">없음</span>}
          {신규보종.map((x) => (
            <Link key={`${x.g}-${x.v}`} href={`/?그룹=${encodeURIComponent(x.g)}&보종=${encodeURIComponent(x.v)}`} className="rounded-full border border-[#e4e6eb] bg-white px-3 py-1.5 text-[12px] hover:border-[#334fff]">
              <b>{x.g}</b> → {x.v} <span className="text-[#a7adb8]">{x.n}건</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-[14px] font-bold">이번에 새로 뜬 경쟁사 소재</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
          {새소재.map((x) => (
            <Link key={x.ad_id} href={`/?소재=${x.ad_id}&신규=1`} className="overflow-hidden rounded-lg border border-[#e9eaee] bg-white">
              <div className="aspect-square bg-[#f2f3f5]">
                {x.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={x.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="truncate px-2 py-1 text-[10px] text-[#5c626d]">{x.g} · {x.insurance_type ?? "미분류"}</div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-[14px] font-bold">오래 돌던 소재의 종료</h2>
        <p className="mb-3 text-[12px] text-[#8a8f98]">60일 이상 게재되다 내려간 소재. 교체 소재가 곧 나올 가능성이 큽니다.</p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
          {장수.length === 0 && <span className="text-[12px] text-[#8a8f98]">없음</span>}
          {장수.map((x) => (
            <Link key={x.ad_id} href={`/?소재=${x.ad_id}&상태=종료`} className="overflow-hidden rounded-lg border border-[#e9eaee] bg-white">
              <div className="aspect-square bg-[#f2f3f5]">
                {x.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={x.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="truncate px-2 py-1 text-[10px] text-[#5c626d]">{x.g} · {x.running_days}일</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
