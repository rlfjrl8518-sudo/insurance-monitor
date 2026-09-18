import Link from "next/link";
import { sql } from "@/lib/db";
import { 날짜, 아바타 } from "../ui";

export const dynamic = "force-dynamic";

type 브랜드 = {
  그룹: string;
  전체: number;
  운영중: number;
  신규: number;
  자사: boolean;
  최근: string | Date | null;
  페이지수: number;
};

type 썸네일 = { 그룹: string; image_url: string | null; status: string };

export default async function 브랜드목록() {
  let 브랜드들: 브랜드[] = [];
  let 썸네일들: 썸네일[] = [];
  let 오류: string | null = null;

  try {
    [브랜드들, 썸네일들] = await Promise.all([
      sql`
        select coalesce(advertiser_group, advertiser) 그룹,
               count(*)::int 전체,
               count(*) filter (where status = '운영중')::int 운영중,
               count(*) filter (where status = '신규')::int 신규,
               bool_or(segment = '자사') 자사,
               max(started_on) 최근,
               count(distinct advertiser)::int 페이지수
        from ads group by 1 order by 운영중 desc, 전체 desc
      ` as unknown as Promise<브랜드[]>,
      // 브랜드마다 최근 소재 몇 장. REFHUB의 "최근 게재된 미디어" 줄에 해당한다.
      sql`
        select 그룹, image_url, status from (
          select coalesce(advertiser_group, advertiser) 그룹, image_url, status,
                 row_number() over (
                   partition by coalesce(advertiser_group, advertiser)
                   order by (status = '종료'), started_on desc nulls last
                 ) rn
          from ads where image_url is not null
        ) t where rn <= 6
      ` as unknown as Promise<썸네일[]>,
    ]);
  } catch (e) {
    오류 = e instanceof Error ? e.message : String(e);
  }

  const 썸네일맵 = new Map<string, 썸네일[]>();
  for (const t of 썸네일들) {
    (썸네일맵.get(t.그룹) ?? 썸네일맵.set(t.그룹, []).get(t.그룹)!).push(t);
  }

  return (
    <div className="px-7 py-6">
      <h1 className="text-[20px] font-bold tracking-tight">브랜드</h1>
      <p className="mt-1 text-[13px] text-[#8a8f98]">
        감시 중인 광고주와 각 브랜드가 최근 내보낸 소재입니다.
      </p>

      {오류 && (
        <div className="mt-5 rounded-xl border border-[#e9eaee] bg-[#ebf1fd] p-4 text-[13px] text-[#2840d9]">
          {오류}
        </div>
      )}

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {브랜드들.map((b) => (
          <section
            key={b.그룹}
            className="rounded-xl border border-[#e9eaee] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <아바타 이름={b.그룹} />
              <h2 className="text-[14px] font-bold">{b.그룹}</h2>
              {b.자사 && (
                <span className="rounded-full bg-[#ebf1fd] px-2 py-0.5 text-[11px] font-semibold text-[#334fff]">
                  자사
                </span>
              )}
              <span className="rounded-full bg-[#f2f3f5] px-2 py-0.5 text-[11px] text-[#5c626d]">
                {b.운영중}건 게재 중
              </span>
              {b.신규 > 0 && (
                <span className="rounded-full bg-[#e7f6ec] px-2 py-0.5 text-[11px] font-medium text-[#18794e]">
                  신규 {b.신규}
                </span>
              )}
              <Link
                href={`/?그룹=${encodeURIComponent(b.그룹)}`}
                className="ml-auto rounded-full border border-[#e4e6eb] px-3 py-1 text-[12px] text-[#5c626d] transition hover:border-[#334fff] hover:text-[#334fff]"
              >
                소재 보기
              </Link>
            </div>

            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#8a8f98]">
              <span>누적 {b.전체.toLocaleString()}건</span>
              <span>페이지 {b.페이지수}개</span>
              <span>최근 게재 {날짜(b.최근)}</span>
            </div>

            <div className="grid grid-cols-6 gap-1.5">
              {(썸네일맵.get(b.그룹) ?? []).map((t, i) => (
                <div
                  key={i}
                  className="relative aspect-square overflow-hidden rounded-lg bg-[#f2f3f5]"
                >
                  {t.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.image_url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  )}
                  {t.status === "운영중" && (
                    <span className="absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-[#18794e] ring-2 ring-white" />
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
