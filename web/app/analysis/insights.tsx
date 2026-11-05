import Link from "next/link";
import { sql } from "@/lib/db";
import { 구역, 근거링크, 근거주소, 소재질의, 예시고르기, 조사, 카드목록, 한눈에, type 카드, type 소재 } from "./cards";

/** 인사이트 = 전체 기간에 반복되는 '시장의 공식' 중 기준을 넘은 것만 문장 카드로.
 *  숫자 표는 교차분석에만 두고, 카드의 '근거 보기'가 같은 축으로 교차분석을 연다.
 *  자사 대비는 '경쟁 비교', 최근 변화는 '변화' 화면이 맡는다. */

/** 60일 이상 돌아간 소재를 "장수 소재"로 본다. 실제 중앙값 15일, 60일이면 상위 약 14%. */
const 장수기준 = 60;
/** 시장 평균보다 이만큼 더 쓰면 '특징'으로 부른다. */
const 특징배수 = 1.5;
/** 배수가 커도 그 안에서 비중이 이보다 작으면 '주력'이 아니라 곁가지라 띄우지 않는다. */
const 최소비중 = 15;
/** 장수 비율이 평균의 이 배수 이상이면 오래 가는 조건, 이하면 빨리 내려가는 조건. */
const 오래배수 = 1.3;
const 빨리배수 = 0.7;

type 교차 = { r: string; c: string; n: number };
type 생존 = { v: string; n: number; 장수: number };

/** 한 줄(r)에서 각 값(c)의 비중과 시장 평균 대비 배수. 건수 1위는 어디나 같아서(대비유도가 3분의 1)
 *  '유난히 많이 쓰는 것'을 특징으로 집는다. 2~3건짜리는 우연이라 뺀다. */
function 비중과특징(칸들: 교차[], 최소건수 = 10) {
  const 행합 = new Map<string, number>();
  const 열합 = new Map<string, number>();
  const 표 = new Map<string, number>();
  let 총 = 0;
  for (const x of 칸들) {
    행합.set(x.r, (행합.get(x.r) ?? 0) + x.n);
    열합.set(x.c, (열합.get(x.c) ?? 0) + x.n);
    표.set(`${x.r}\u0000${x.c}`, x.n);
    총 += x.n;
  }
  return [...행합.entries()]
    .filter(([, n]) => n >= 최소건수)
    .sort((a, b) => b[1] - a[1])
    .map(([r, 합]) => {
      const 값들 = [...열합.keys()]
        .map((c) => {
          const n = 표.get(`${r}\u0000${c}`) ?? 0;
          const 시장비 = (열합.get(c) ?? 0) / (총 || 1);
          return { c, n, 비중: (n / 합) * 100, 시장: 시장비 * 100, 배수: 시장비 ? n / 합 / 시장비 : 0 };
        })
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n);
      const 특징 = 값들.filter((x) => x.n >= 3 && x.c !== "기타").sort((a, b) => b.배수 - a.배수)[0];
      return { r, 합, 값들, 특징 };
    });
}

function 생존율(행들: 생존[], 최소건수 = 20) {
  const 총 = 행들.reduce((s, x) => s + x.n, 0);
  const 기준 = 총 ? 행들.reduce((s, x) => s + x.장수, 0) / 총 : 0;
  return 행들
    .filter((x) => x.n >= 최소건수)
    .map((x) => ({ ...x, 비율: (x.장수 / x.n) * 100, 기준: 기준 * 100, 배수: 기준 ? x.장수 / x.n / 기준 : 0 }));
}

const 배 = (x: number) => `×${x.toFixed(1)}`;
const 퍼 = (x: number) => `${x.toFixed(0)}%`;

export async function 인사이트({ 업권 }: { 업권: string }) {
  let 장수명: { 그룹: string; ad_id: string; running_days: number; image_url: string | null }[] = [];
  let 보종소구: 교차[] = [];
  let 광고주보종: 교차[] = [];
  let 장수소구: 생존[] = [];
  let 장수보종: 생존[] = [];
  let 장수유형: 생존[] = [];
  let 광고주장수: { g: string; 전체: number; 장수: number }[] = [];
  let 장수광고주보종: 교차[] = [];
  let 소재들: 소재[] = [];
  let 오류: string | null = null;
  const 범위 = sql`(${업권} = '' or category = ${업권})`;
  const 기준일 = sql.unsafe(String(장수기준));

  const 생존질의 = (컬럼: string) =>
    sql`select ${sql.unsafe(컬럼)} v, count(*)::int n,
               count(*) filter (where running_days >= ${기준일})::int 장수
        from ads
        where ${범위} and ${sql.unsafe(컬럼)} is not null and ${sql.unsafe(컬럼)} <> '' and running_days > 0
        group by 1` as unknown as Promise<생존[]>;

  try {
    [장수명, 보종소구, 광고주보종, 장수소구, 장수보종, 장수유형, 광고주장수, 장수광고주보종, 소재들] = (await Promise.all([
      sql`select coalesce(advertiser_group, advertiser) 그룹, ad_id, running_days, image_url
          from ads where ${범위} and status <> '종료'
          order by running_days desc limit 12`,
      sql`select insurance_type r, appeal_point c, count(*)::int n from ads
          where ${범위} and insurance_type <> '' and appeal_point <> '' group by 1, 2`,
      sql`select coalesce(advertiser_group, advertiser) r, insurance_type c, count(*)::int n from ads
          where ${범위} and insurance_type <> '' group by 1, 2`,
      생존질의("appeal_point"),
      생존질의("insurance_type"),
      생존질의("creative_type"),
      sql`select coalesce(advertiser_group, advertiser) g, count(*)::int 전체,
                 count(*) filter (where running_days >= ${기준일})::int 장수
          from ads where ${범위} and running_days > 0
          group by 1 having count(*) >= 30`,
      sql`select coalesce(advertiser_group, advertiser) r, insurance_type c, count(*)::int n from ads
          where ${범위} and running_days >= ${기준일} and insurance_type <> '' group by 1, 2`,
      소재질의(범위),
    ])) as unknown as [typeof 장수명, 교차[], 교차[], 생존[], 생존[], 생존[], typeof 광고주장수, 교차[], 소재[]];
  } catch (e) {
    오류 = e instanceof Error ? e.message : String(e);
  }

  // 1. 보종별 색깔: 그 보종에서 유난히 많이 쓰는 소구
  const 보종카드: 카드[] = 비중과특징(보종소구, 20)
    .filter((x) => x.특징 && x.특징.배수 >= 특징배수 && x.특징.비중 >= 최소비중)
    .sort((a, b) => b.특징!.배수 - a.특징!.배수)
    .map(({ r, 합, 특징: f }) => ({
      키: r,
      수치: 배(f!.배수),
      수치설명: "시장 대비",
      태그: "보종 × 소구",
      제목: <><b>{r}</b> 광고는 &lsquo;{f!.c}&rsquo; 소구가 {퍼(f!.비중)}</>,
      보조: `시장 평균 ${퍼(f!.시장)} · ${r} 소재 ${합}건`,
      링크: 근거링크({ 축: "소구포인트", 값: f!.c, 집단: `보종:${r}`, 업권, 출처: "insight" }),
      톤: "발견",
      예시: 예시고르기(소재들, (x) => x.보종 === r && x.소구포인트 === f!.c),
    }));

  // 2. 보험사별 무기: 시장보다 유독 많이 미는 보종. 장수 소재 주력이 다르면 그것도 붙인다.
  const 장수주력 = new Map(비중과특징(장수광고주보종, 5).map((x) => [x.r, x.값들.find((v) => v.c !== "기타")]));
  const 장수비율 = new Map(광고주장수.map((x) => [x.g, (x.장수 / x.전체) * 100]));
  const 광고주카드: 카드[] = 비중과특징(광고주보종, 20)
    .filter((x) => x.특징 && x.특징.배수 >= 특징배수 && x.특징.비중 >= 최소비중)
    .sort((a, b) => b.특징!.배수 - a.특징!.배수)
    .map(({ r, 합, 값들, 특징: f }) => {
      const 장수1 = 장수주력.get(r);
      const 물량1 = 값들.find((v) => v.c !== "기타");
      const 갈림 = 장수1 && 물량1 && 장수1.c !== 물량1.c;
      return {
        키: r,
        수치: 배(f!.배수),
        수치설명: "시장 대비",
        태그: "보험사 × 보종",
        제목: <><b>{조사(r, "은는")}</b> &lsquo;{f!.c}&rsquo; 비중이 {퍼(f!.비중)}</>,
        보조:
          `시장 평균 ${퍼(f!.시장)} · 소재 ${합}건` +
          (갈림 ? ` · 물량은 ${물량1!.c}, 오래 버티는 건 ${장수1!.c}` : "") +
          (장수비율.has(r) ? ` · ${장수기준}일+ ${퍼(장수비율.get(r)!)}` : ""),
        링크: 근거링크({ 축: "보종", 값: f!.c, 집단: `광고주:${r}`, 업권, 출처: "insight" }),
        톤: "발견" as const,
        예시: 예시고르기(소재들, (x) => x.g === r && x.보종 === f!.c),
      };
    });

  // 3. 오래 가는 / 빨리 내려가는 조건
  const 생존들 = [
    ...생존율(장수소구).map((x) => ({ ...x, 축: "소구포인트" })),
    ...생존율(장수보종).map((x) => ({ ...x, 축: "보종" })),
    ...생존율(장수유형).map((x) => ({ ...x, 축: "소재유형" })),
  ];
  const 생존카드 = (x: (typeof 생존들)[number], 좋음: boolean): 카드 => ({
    키: `${x.축}-${x.v}`,
    수치: 배(x.배수),
    수치설명: "장수 비율",
    태그: x.축,
    제목: 좋음 ? (
      <>&lsquo;{x.v}&rsquo; 소재는 {퍼(x.비율)}가 {장수기준}일을 넘김</>
    ) : (
      <>&lsquo;{x.v}&rsquo; 소재는 빨리 내려감 ({장수기준}일+ {퍼(x.비율)})</>
    ),
    보조: `전체 평균 ${퍼(x.기준)} · 소재 ${x.n}건`,
    링크: 근거링크({ 축: x.축, 값: x.v, 종류: "장수", 순서: 좋음 ? "" : "짧은", 업권, 출처: "insight" }),
    톤: 좋음 ? "좋음" : "나쁨",
    // 오래 가는 쪽은 60일 넘긴 것 중 오래 돈 순, 빨리 지는 쪽은 종료된 것 중 짧게 끝난 순
    예시: 좋음
      ? 예시고르기(소재들, (s) => s[x.축 as "보종"] === x.v && s.일수 >= 장수기준)
      : 예시고르기([...소재들].reverse(), (s) => s[x.축 as "보종"] === x.v && s.종료 && s.일수 > 0),
  });
  const 오래카드 = 생존들.filter((x) => x.배수 >= 오래배수 && x.v !== "기타").sort((a, b) => b.배수 - a.배수).map((x) => 생존카드(x, true));
  const 빨리카드 = 생존들.filter((x) => x.배수 <= 빨리배수 && x.v !== "기타").sort((a, b) => a.배수 - b.배수).map((x) => 생존카드(x, false));

  const 첫줄 = (c?: 카드) => (c ? <>{c.제목} <span className="text-[#a7adb8]">({c.수치})</span></> : null);
  const 요약 = [
    { 이름: "보종 공식", 내용: 첫줄(보종카드[0]) },
    { 이름: "보험사 무기", 내용: 첫줄(광고주카드[0]) },
    { 이름: "오래 가는 것", 내용: 첫줄(오래카드[0]) },
    { 이름: "빨리 지는 것", 내용: 첫줄(빨리카드[0]) },
  ].filter((x) => x.내용);

  return (
    <div>
      {오류 && <div className="mb-5 rounded-xl bg-[#ebf1fd] p-4 text-[13px] text-[#2840d9]">{오류}</div>}

      <한눈에 줄들={요약} />
      <p className="mt-2 text-[11px] text-[#a7adb8]">
        시장 평균의 {특징배수}배 이상이면서 비중 {최소비중}% 이상인 것만 &lsquo;특징&rsquo;으로 띄웁니다. 각 카드의 &lsquo;근거 보기&rsquo;에서 숫자 비교와 실제 소재를 볼 수 있습니다.
      </p>

      <구역 번호={1} 제목="보종별 공식" 질문="이 보종 광고는 무엇을 앞세우나? — 시장 평균보다 유난히 많이 쓰는 소구" 개수={보종카드.length}>
        <카드목록
          카드들={보종카드}
          없을때="기준을 넘는 보종별 특징이 없습니다."
          더보기={근거주소({ 업권, 행: "보종", 열: "소구포인트", 상태: "전체" })}
        />
      </구역>

      <구역 번호={2} 제목="보험사별 무기" 질문="각 보험사가 시장보다 유독 많이 미는 보종은? — 물량 주력과 오래 버티는 주력이 다르면 함께 표시" 개수={광고주카드.length}>
        <카드목록
          카드들={광고주카드}
          없을때="기준을 넘는 보험사별 특징이 없습니다."
          더보기={근거주소({ 업권, 행: "광고주", 열: "보종", 상태: "전체" })}
        />
      </구역>

      <구역 번호={3} 제목="오래 가는 소재의 조건" 질문={`${장수기준}일 넘게 살아남는 비율이 평균보다 높은 것 / 낮은 것. 오래 돌린다 = 성과가 났을 가능성이 큽니다.`}>
        <div className="mb-2 text-[12px] font-semibold text-[#18794e]">오래 간다 ({오래카드.length})</div>
        <카드목록 카드들={오래카드} 없을때="평균보다 확실히 오래 가는 조건이 없습니다." />
        <div className="mb-2 mt-5 text-[12px] font-semibold text-[#c23934]">빨리 내려간다 ({빨리카드.length})</div>
        <카드목록 카드들={빨리카드} 최대={3} 없을때="평균보다 확실히 빨리 내려가는 조건이 없습니다." />
      </구역>

      <구역 번호={4} 제목="벤치마크 후보" 질문="지금 가장 오래 돌고 있는 소재">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {장수명.map((r) => (
            <Link
              key={r.ad_id}
              href={`/?소재=${encodeURIComponent(r.ad_id)}&상태=전체`}
              className="overflow-hidden rounded-xl border border-[#e9eaee] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:-translate-y-1 hover:border-[#c3cbe4]"
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
            </Link>
          ))}
        </div>
      </구역>
    </div>
  );
}
