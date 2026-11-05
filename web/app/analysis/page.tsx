import Link from "next/link";
import { sql } from "@/lib/db";
import { 교차분석 } from "./crosstab";
import { 인사이트 } from "./insights";

export const dynamic = "force-dynamic";

const 탭들 = [
  { 키: "요약", 설명: "지금 무엇이 돌고 있고, 무엇이 오래 버티는지" },
  { 키: "교차", 설명: "광고주·분류축을 겹쳐 비중과 조합을 비교 (예전 경쟁 비교·교차분석)" },
  { 키: "오퍼", 설명: "광고에 적힌 보험료·보장금액 표기를 광고주별로 모아 보기" },
] as const;

type 오퍼행 = {
  그룹: string;
  ad_id: string;
  insurance_type: string | null;
  보험료: string | null;
  보장: string | null;
  오퍼: string | null;
  image_url: string | null;
};

/** 보험료·보장금액 표기. 분류 단계에서 Gemini가 광고 문구·이미지에서 그대로 옮겨 적은 값이다. */
async function 오퍼표({ 보종 }: { 보종: string }) {
  let 행들: 오퍼행[] = [];
  let 보종목록: { v: string; n: number }[] = [];
  try {
    [행들, 보종목록] = (await Promise.all([
      sql`select coalesce(advertiser_group, advertiser) 그룹, ad_id, insurance_type,
                 labels->>'보험료표기' 보험료, labels->>'보장금액표기' 보장, labels->>'오퍼' 오퍼, image_url
          from ads
          where status <> '종료'
            and (labels ? '보험료표기' or labels ? '보장금액표기' or coalesce(labels->>'오퍼', '없음') <> '없음')
            and (${보종} = '' or insurance_type = ${보종})
          order by 1, insurance_type, first_seen_on desc`,
      sql`select insurance_type v, count(*)::int n from ads
          where status <> '종료' and insurance_type is not null
            and (labels ? '보험료표기' or labels ? '보장금액표기')
          group by 1 order by n desc`,
    ])) as unknown as [오퍼행[], { v: string; n: number }[]];
  } catch (e) {
    return <div className="rounded-xl bg-[#ebf1fd] p-4 text-[13px] text-[#2840d9]">{String(e)}</div>;
  }

  const 묶음 = new Map<string, 오퍼행[]>();
  for (const r of 행들) (묶음.get(r.그룹) ?? 묶음.set(r.그룹, []).get(r.그룹)!).push(r);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[12px] font-medium text-[#8a8f98]">보종</span>
        {[{ v: "", n: 0 }, ...보종목록].map((x) => (
          <Link
            key={x.v || "전체"}
            href={`/analysis?탭=오퍼${x.v ? `&보종=${encodeURIComponent(x.v)}` : ""}`}
            className={`rounded-full border px-3 py-1.5 text-[12px] ${
              보종 === x.v ? "border-[#334fff] bg-[#334fff] font-semibold text-white" : "border-[#e4e6eb] bg-white text-[#5c626d]"
            }`}
          >
            {x.v || "전체"} {x.n > 0 && <span className="opacity-60">{x.n}</span>}
          </Link>
        ))}
      </div>
      {묶음.size === 0 && (
        <div className="rounded-xl border border-[#e9eaee] bg-white p-10 text-center text-[13px] text-[#8a8f98]">
          아직 추출된 오퍼가 없습니다. 새 분류(2026-11 이후)부터 채워집니다.
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {[...묶음.entries()].map(([그룹, 줄들]) => (
          <section key={그룹} className="rounded-xl border border-[#e9eaee] bg-white p-4">
            <h3 className="mb-2 text-[13px] font-bold">
              {그룹} <span className="font-normal text-[#a7adb8]">{줄들.length}건</span>
            </h3>
            <table className="w-full text-[12px]">
              <tbody>
                {줄들.map((r) => (
                  <tr key={r.ad_id} className="border-t border-[#f0f1f4]">
                    <td className="py-1.5 pr-2">
                      <Link href={`/?소재=${r.ad_id}&상태=전체`} className="text-[#334fff] hover:underline">
                        {r.insurance_type ?? "-"}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-2 font-semibold">{r.보험료 ?? ""}</td>
                    <td className="py-1.5 pr-2">{r.보장 ?? ""}</td>
                    <td className="py-1.5 text-right text-[#8a8f98]">{r.오퍼 && r.오퍼 !== "없음" ? r.오퍼 : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}

export default async function 분석({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  const 탭 = 탭들.find((t) => t.키 === p.탭)?.키 ?? "요약";
  const 한값 = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  return (
    <div className="px-7 py-6">
      <h1 className="text-[20px] font-bold tracking-tight">분석</h1>
      <p className="mt-1 text-[13px] text-[#8a8f98]">{탭들.find((t) => t.키 === 탭)!.설명}</p>
      <div className="mt-5 mb-6 flex gap-1 border-b border-[#e9eaee]">
        {탭들.map((t) => (
          <Link
            key={t.키}
            href={`/analysis?탭=${encodeURIComponent(t.키)}`}
            className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-semibold ${
              탭 === t.키 ? "border-[#334fff] text-[#334fff]" : "border-transparent text-[#8a8f98] hover:text-[#16181d]"
            }`}
          >
            {t.키}
          </Link>
        ))}
      </div>
      {탭 === "요약" && <인사이트 />}
      {탭 === "교차" && (
        <교차분석
          p={{
            행: 한값(p.행), 열: 한값(p.열), 상태: 한값(p.상태), 보기: 한값(p.보기),
            광고주: p.광고주, 시작: 한값(p.시작), 끝: 한값(p.끝),
          }}
        />
      )}
      {탭 === "오퍼" && <오퍼표 보종={한값(p.보종) ?? ""} />}
    </div>
  );
}
