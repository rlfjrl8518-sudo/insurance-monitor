import Link from "next/link";
import { sql } from "@/lib/db";
import { 태그 } from "../ui";
import { 보드_삭제 } from "./actions";

export const dynamic = "force-dynamic";

type 담긴소재 = {
  board_name: string;
  ad_id: string;
  image_url: string | null;
  그룹: string;
  creative_type: string | null;
  insurance_type: string | null;
  appeal_point: string | null;
  status: string | null;
};

export default async function 보드() {
  let 소재들: 담긴소재[] = [];
  let 오류: string | null = null;
  try {
    소재들 = (await sql`
      select b.board_name, a.ad_id, a.image_url,
             coalesce(a.advertiser_group, a.advertiser) 그룹,
             a.creative_type, a.insurance_type, a.appeal_point, a.status
      from boards b join ads a on a.ad_id = b.ad_id
      order by b.board_name, b.created_at desc
    `) as unknown as 담긴소재[];
  } catch (e) {
    오류 = e instanceof Error ? e.message : String(e);
  }

  const 보드맵 = new Map<string, 담긴소재[]>();
  for (const s of 소재들) {
    (보드맵.get(s.board_name) ?? 보드맵.set(s.board_name, []).get(s.board_name)!).push(s);
  }

  return (
    <div className="px-7 py-6">
      <h1 className="text-[20px] font-bold tracking-tight">보드</h1>
      <p className="mt-1 text-[13px] text-[#8a8f98]">
        참고할 소재를 주제별로 모아둡니다. 소재 카드의 담기 버튼으로 추가합니다.
      </p>

      {오류 && (
        <div className="mt-5 rounded-xl border border-[#e9eaee] bg-[#ebf1fd] p-4 text-[13px] text-[#2840d9]">
          {오류}
        </div>
      )}

      {!오류 && 보드맵.size === 0 && (
        <div className="mt-6 rounded-xl border border-[#e9eaee] bg-white p-10 text-center">
          <div className="text-[14px] font-semibold">아직 담아둔 소재가 없습니다</div>
          <p className="mt-1.5 text-[13px] text-[#8a8f98]">
            탐색에서 카드 위의 담기 버튼을 누르면 여기에 모입니다.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-full bg-[#334fff] px-5 py-2 text-[13px] font-semibold text-white"
          >
            탐색으로 가기
          </Link>
        </div>
      )}

      {[...보드맵.entries()].map(([이름, 목록]) => (
        <section key={이름} className="mt-7">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[14px] font-bold">{이름}</h2>
            <span className="rounded-full bg-[#f2f3f5] px-2 py-0.5 text-[11px] text-[#5c626d]">
              {목록.length}건
            </span>
            <form action={보드_삭제} className="ml-auto">
              <input type="hidden" name="보드명" value={이름} />
              <button className="rounded-full border border-[#e4e6eb] px-3 py-1 text-[12px] text-[#8a8f98] transition hover:border-[#c23934] hover:text-[#c23934]">
                보드 비우기
              </button>
            </form>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-4">
            {목록.map((s) => (
              <article
                key={s.ad_id}
                className="overflow-hidden rounded-xl border border-[#e9eaee] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
              >
                <div className="aspect-square bg-[#f2f3f5]">
                  {s.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="p-3">
                  <div className="mb-1.5 truncate text-[12px] font-semibold">{s.그룹}</div>
                  <div className="flex flex-wrap gap-1">
                    <태그 값={s.creative_type} 강조 />
                    <태그 값={s.insurance_type} />
                    <태그 값={s.appeal_point} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
