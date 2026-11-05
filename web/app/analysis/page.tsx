import Link from "next/link";
import { sql } from "@/lib/db";
import { 경쟁비교 } from "./compare";
import { 교차분석 } from "./crosstab";
import { 인사이트 } from "./insights";

export const dynamic = "force-dynamic";

/** 화면마다 답하는 질문이 하나씩이다. 겹치면 어느 화면을 봐야 할지 모르게 된다.
 *  최근 무엇이 바뀌었는지는 '변화' 메뉴가 따로 맡는다. */
const 탭들 = [
  { 키: "insight", 이름: "인사이트", 질문: "이 시장에서 반복되는 공식은?", 설명: "전체 기간 데이터에서 자동으로 뽑은 패턴 — 보종별 특징 소구, 보험사별 주력, 오래 가는 소재의 조건" },
  { 키: "compare", 이름: "경쟁 비교", 질문: "우리는 경쟁사와 어디가 다른가?", 설명: "자사 vs 경쟁사 고정 비교 — 게재 점유, 운영 방식, 경쟁사만 쓰는 공백" },
  { 키: "crosstab", 이름: "교차분석", 질문: "내가 궁금한 두 축의 조합은?", 설명: "행·열·광고주·기간을 직접 골라 보는 자유 피벗 — 비중 막대 / 건수 표 / CSV" },
  { 키: "offer", 이름: "오퍼", 질문: "누가 얼마를 내세우나?", 설명: "광고에 적힌 보험료·보장금액 표기를 광고주별로 모아 보기" },
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
            href={`/analysis?tab=offer${x.v ? `&보종=${encodeURIComponent(x.v)}` : ""}`}
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
  const 한값 = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // 탭 값은 영문이다(리다이렉트 헤더에 한글을 못 싣는다). 예전 주소의 한글 탭도 받는다.
  const 옛탭: Record<string, string> = { 요약: "insight", 인사이트: "insight", 경쟁: "compare", 교차: "crosstab", 오퍼: "offer" };
  const 받은탭 = 한값(p.tab) ?? 옛탭[한값(p.탭) ?? ""];
  const 탭 = 탭들.find((t) => t.키 === 받은탭)?.키 ?? "insight";
  const 업권 = 한값(p.업권) ?? "";
  const 지금탭 = 탭들.find((t) => t.키 === 탭)!;
  let 업권목록: { v: string; n: number }[] = [];
  try {
    업권목록 = (await sql`select category v, count(*)::int n from ads
      where category is not null and status <> '종료' group by 1 order by n desc`) as unknown as typeof 업권목록;
  } catch {
    // 업권 칩은 덤이다
  }

  return (
    <div className="px-7 py-6">
      <h1 className="text-[20px] font-bold tracking-tight">분석</h1>
      <div className="mt-5 mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {탭들.map((t) => (
          <Link
            key={t.키}
            href={`/analysis?${new URLSearchParams({ tab: t.키, 업권 })}`}
            className={`rounded-xl border px-4 py-3 transition ${
              탭 === t.키 ? "border-[#334fff] bg-[#f5f7ff]" : "border-[#e9eaee] bg-white hover:border-[#c3cbe4]"
            }`}
          >
            <div className={`text-[13px] font-bold ${탭 === t.키 ? "text-[#334fff]" : ""}`}>{t.이름}</div>
            <div className="mt-0.5 text-[12px] text-[#8a8f98]">{t.질문}</div>
          </Link>
        ))}
      </div>
      <p className="mb-4 text-[12px] text-[#8a8f98]">{지금탭.설명}</p>
      {탭 !== "offer" && (
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] font-medium text-[#8a8f98]">업권</span>
          {[{ v: "", n: 0 }, ...업권목록].map((x) => (
            <Link
              key={x.v || "전체"}
              href={`/analysis?${new URLSearchParams({ tab: 탭, 업권: x.v })}`}
              className={`rounded-full border px-3 py-1.5 text-[12px] ${
                업권 === x.v ? "border-[#334fff] bg-[#334fff] font-semibold text-white" : "border-[#e4e6eb] bg-white text-[#5c626d]"
              }`}
            >
              {x.v || "전체"} {x.n > 0 && <span className="opacity-60">{x.n}</span>}
            </Link>
          ))}
        </div>
      )}
      {탭 === "insight" && <인사이트 업권={업권} />}
      {탭 === "compare" && <경쟁비교 업권={업권} 범위={한값(p.범위) ?? ""} />}
      {탭 === "crosstab" && (
        <교차분석
          p={{
            행: 한값(p.행), 열: 한값(p.열), 상태: 한값(p.상태), 보기: 한값(p.보기),
            광고주: p.광고주, 시작: 한값(p.시작), 끝: 한값(p.끝), 업권,
          }}
        />
      )}
      {탭 === "offer" && <오퍼표 보종={한값(p.보종) ?? ""} />}
    </div>
  );
}
