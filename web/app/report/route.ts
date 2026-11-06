import PptxGenJS from "pptxgenjs";
import { sql } from "@/lib/db";

/** 월간 경쟁사 광고 모니터링 보고서(PPT). 한화손보 장기TM 월간 운영 덱 양식(넥슨Lv1고딕, 주황 F37321,
 *  회색 알약 제목줄, 진회색 섹션 바, 검정 헤더 표, ▲빨강/▼파랑)을 그대로 따른다.
 *  /report?월=2026-10 → 그 달 1일~말일(진행 중이면 어제까지)을 전월 같은 경과일과 비교.
 *  사실 문장만 자동으로 쓰고, 시사점·제안은 파란 점선 박스(담당자 작성 메모)로 비워 둔다. */

export const dynamic = "force-dynamic";

const 글꼴 = "넥슨Lv1고딕";
const 굵은글꼴 = "넥슨Lv1고딕 Bold";
const 주황 = "F37321";
const 진회색 = "404040";
const 회색 = "A6A6A6";
const pt = (v: number) => v / 72; // 덱 좌표(pt) → pptxgenjs(inch)

type 광고주행 = { g: string; 자사: boolean; 당월: number; 전월: number; 게재: number; 주력: string | null };
type 분포행 = { p: "당월" | "전월"; 자사: boolean; v: string; n: number };
type 일별행 = { d: string; p: "당월" | "전월"; n: number };
type 진입행 = { g: string; v: string; n: number };
type 소재행 = { g: string; image_url: string; 보종: string | null; 소구: string | null; 일수: number; 변형: number };
type 오퍼행 = { g: string; 보종: string | null; 보험료: string | null; 보장: string | null };

const 날짜 = (d: Date) => d.toISOString().slice(0, 10);
function 기간(월: string) {
  const [y, m] = 월.split("-").map(Number);
  const 시작 = new Date(Date.UTC(y, m - 1, 1));
  const 말일 = new Date(Date.UTC(y, m, 0));
  const 어제 = new Date(Date.now() + 9 * 3600000 - 86400000); // 서울 기준 어제
  const 끝 = 말일 < 어제 ? 말일 : new Date(Date.UTC(어제.getUTCFullYear(), 어제.getUTCMonth(), 어제.getUTCDate()));
  const 일수 = Math.round((끝.getTime() - 시작.getTime()) / 86400000) + 1;
  const 전시작 = new Date(Date.UTC(y, m - 2, 1));
  const 전말일 = new Date(Date.UTC(y, m - 1, 0));
  const 전끝 = new Date(Math.min(전말일.getTime(), 전시작.getTime() + (일수 - 1) * 86400000));
  return { y, m, 시작: 날짜(시작), 끝: 날짜(끝), 전시작: 날짜(전시작), 전끝: 날짜(전끝), 일수, 진행중: 끝 < 말일 };
}

const 짧은날 = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const 증감 = (지금: number, 전: number) => {
  if (!전) return { 글: "-", 색: "000000" };
  const r = Math.round(((지금 - 전) / 전) * 100);
  return { 글: r === 0 ? "0%" : `${r > 0 ? "▲" : "▼"}${Math.abs(r)}%`, 색: r > 0 ? "FF0000" : r < 0 ? "0000FF" : "000000" };
};
const 포인트 = (지금: number, 전: number) => {
  const d = Math.round((지금 - 전) * 1000) / 10;
  return { 글: d === 0 ? "0.0%p" : `${d > 0 ? "▲" : "▼"}${Math.abs(d).toFixed(1)}%p`, 색: d > 0 ? "FF0000" : d < 0 ? "0000FF" : "000000" };
};
const 퍼 = (x: number) => `${(x * 100).toFixed(1)}%`;

/** 축 분포를 {값: {당월자사, 당월경쟁, 전월경쟁 …}} 비중으로. */
function 비중표(행들: 분포행[]) {
  const 합 = (p: string, 자사: boolean) => 행들.filter((r) => r.p === p && r.자사 === 자사).reduce((s, r) => s + r.n, 0) || 1;
  const 값 = (v: string, p: string, 자사: boolean) => (행들.find((r) => r.v === v && r.p === p && r.자사 === 자사)?.n ?? 0) / 합(p, 자사);
  const 건 = (v: string, p: string, 자사: boolean) => 행들.find((r) => r.v === v && r.p === p && r.자사 === 자사)?.n ?? 0;
  return [...new Set(행들.map((r) => r.v))]
    .filter((v) => v !== "기타")
    .map((v) => ({
      v,
      경쟁당월: 값(v, "당월", false), 경쟁전월: 값(v, "전월", false), 자사당월: 값(v, "당월", true),
      경쟁건: 건(v, "당월", false), 자사건: 건(v, "당월", true),
    }))
    .sort((a, b) => b.경쟁당월 - a.경쟁당월);
}

async function 이미지(url: string) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const 종류 = r.headers.get("content-type") ?? "image/jpeg";
    return `${종류};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const 기본 = new Date(Date.now() + 9 * 3600000);
  기본.setUTCDate(0); // 지난달
  const 월 = /^\d{4}-\d{2}$/.test(q.get("월") ?? "") ? q.get("월")! : 날짜(기본).slice(0, 7);
  const k = 기간(월);
  if (k.일수 < 1) return new Response("아직 시작하지 않은 달입니다.", { status: 400 });

  const 기초 = sql`(select coalesce(advertiser_group, advertiser) g, coalesce(segment = '자사', false) 자사,
      coalesce(started_on, first_seen_on) s, coalesce(ended_on, collected_on, current_date) e, a.*
    from ads a) t`;
  const 당월신규 = sql`s between ${k.시작}::date and ${k.끝}::date`;
  const 전월신규 = sql`s between ${k.전시작}::date and ${k.전끝}::date`;
  const 당월게재 = sql`s <= ${k.끝}::date and e >= ${k.시작}::date`;
  const 전월게재 = sql`s <= ${k.전끝}::date and e >= ${k.전시작}::date`;
  const 분포 = (식: string, 신규: boolean) => sql`
    select '당월' p, 자사, ${sql.unsafe(식)} v, count(*)::int n from ${기초}
      where ${신규 ? 당월신규 : 당월게재} and coalesce(${sql.unsafe(식)}, '') <> '' group by 2, 3
    union all
    select '전월' p, 자사, ${sql.unsafe(식)} v, count(*)::int n from ${기초}
      where ${신규 ? 전월신규 : 전월게재} and coalesce(${sql.unsafe(식)}, '') <> '' group by 2, 3`;

  const [광고주, 일별, 보종, 소구, 소재유형, 진입, 후보, 오퍼] = (await Promise.all([
    sql`select g, bool_or(자사) 자사,
               count(*) filter (where ${당월신규})::int 당월,
               count(*) filter (where ${전월신규})::int 전월,
               count(*) filter (where ${당월게재})::int 게재,
               mode() within group (order by insurance_type) filter (where ${당월신규} and insurance_type <> '기타') 주력
        from ${기초} group by g
        having count(*) filter (where ${당월게재} or ${전월게재}) > 0
        order by bool_or(자사) desc, 3 desc, 5 desc`,
    // 일별 게재 수는 광고 시작일~종료일 구간으로 센다. ad_sightings는 2026-11 수집 개편 이후분만 있어 과거 달이 빈다.
    sql`select to_char(d, 'YYYY-MM-DD') d, case when d >= ${k.시작}::date then '당월' else '전월' end p,
               (select count(*) from ${기초} where not 자사 and s <= d and e >= d)::int n
        from (select generate_series(${k.전시작}::date, ${k.전끝}::date, '1 day')::date d
              union all select generate_series(${k.시작}::date, ${k.끝}::date, '1 day')::date) 날
        order by 1`,
    분포("insurance_type", true),
    분포("appeal_point", false),
    분포("creative_type", false),
    sql`select g, insurance_type v, count(*)::int n from ${기초}
        where ${당월신규} and not 자사 and insurance_type not in ('', '기타')
          and not exists (select 1 from ads b
            where coalesce(b.advertiser_group, b.advertiser) = t.g and b.insurance_type = t.insurance_type
              and coalesce(b.started_on, b.first_seen_on) < ${k.시작}::date
              and coalesce(b.ended_on, b.collected_on, current_date) >= ${k.시작}::date - 60)
        group by 1, 2 order by 3 desc limit 12`,
    // ponytail: 메타 CDN 주소는 만료돼 깨진다(cards.tsx와 같은 기준). GCS로 옮긴 소재만 쓴다
    sql`select g, image_url, insurance_type 보종, appeal_point 소구, coalesce(running_days, 0)::int 일수,
               coalesce(variant_count, 1)::int 변형
        from ${기초}
        where ${당월신규} and not 자사 and coalesce(image_url, '') <> '' and image_url not like '%fbcdn.net%'
        order by variant_count desc nulls last, running_days desc nulls last limit 60`,
    sql`select g, insurance_type 보종, labels->>'보험료표기' 보험료, labels->>'보장금액표기' 보장 from ${기초}
        where ${당월게재} and (labels ? '보험료표기' or labels ? '보장금액표기')
        order by 자사 desc, g, insurance_type limit 16`,
  ])) as unknown as [광고주행[], 일별행[], 분포행[], 분포행[], 분포행[], 진입행[], 소재행[], 오퍼행[]];

  // ── 숫자 정리 ──
  const 경쟁 = 광고주.filter((x) => !x.자사);
  const 자사 = 광고주.find((x) => x.자사);
  const 경쟁당월 = 경쟁.reduce((s, x) => s + x.당월, 0);
  const 경쟁전월 = 경쟁.reduce((s, x) => s + x.전월, 0);
  const 전체당월 = 경쟁당월 + (자사?.당월 ?? 0);
  const 늘린곳 = [...경쟁].filter((x) => x.전월 >= 3).sort((a, b) => b.당월 - b.전월 - (a.당월 - a.전월))[0];
  const 보종표 = 비중표(보종).slice(0, 10);
  const 오른보종 = [...보종표].filter((x) => x.경쟁건 >= 5).sort((a, b) => b.경쟁당월 - b.경쟁전월 - (a.경쟁당월 - a.경쟁전월))[0];
  const 소구표 = 비중표(소구).slice(0, 8);
  const 유형표 = 비중표(소재유형).slice(0, 6);
  // 경쟁 비교 화면(compare.tsx)과 같은 기준: 자사 3% 미만인데 경쟁 10% 이상이면 공백, 차이 15%p 이상이면 열세/집중
  const 공백 = 소구표.filter((x) => (x.자사당월 < 0.03 && x.경쟁당월 >= 0.1) || x.자사당월 - x.경쟁당월 <= -0.15);
  const 집중 = 소구표.filter((x) => x.자사당월 - x.경쟁당월 >= 0.15);
  const 일평균 = (p: string) => {
    const xs = 일별.filter((r) => r.p === p);
    return xs.length ? Math.round(xs.reduce((s, r) => s + r.n, 0) / xs.length) : 0;
  };

  // 주목 소재: 광고주마다 하나씩 먼저, 남는 자리는 순서대로
  const 고른: 소재행[] = [];
  for (const 한바퀴 of [true, false])
    for (const x of 후보) {
      if (고른.length >= 8) break;
      if (고른.includes(x) || (한바퀴 && 고른.some((y) => y.g === x.g))) continue;
      고른.push(x);
    }
  const 그림들 = await Promise.all(고른.map((x) => 이미지(x.image_url)));

  // ── 덱 ──
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 960×540pt, 원본 덱과 같은 크기
  pptx.theme = { headFontFace: 굵은글꼴, bodyFontFace: 글꼴 };
  const 월이름 = `${k.m}월`;
  const 각주 = `*출처 : 메타 광고 라이브러리 ${짧은날(k.시작)}~${짧은날(k.끝)} VS ${짧은날(k.전시작)}~${짧은날(k.전끝)}${k.진행중 ? ` (동일 경과 ${k.일수}일)` : ""}`;
  let 쪽 = 1;

  const 장표 = (섹션: string, 꼬리표: string, 대제목: string, 소제목: string, 서브: string) => {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addShape(pptx.ShapeType.roundRect, { x: pt(17), y: pt(19), w: pt(752), h: pt(24), rectRadius: 0.5, fill: { color: "F2F2F2" }, line: { color: "F2F2F2" } });
    s.addText(
      [
        { text: "한화손보 장기TM ", options: { color: 주황 } },
        { text: `${월이름} 경쟁 모니터링 › ${섹션}`, options: { color: "000000" } },
      ],
      { x: pt(23), y: pt(19), w: pt(740), h: pt(24), fontFace: 굵은글꼴, fontSize: 10, valign: "middle" },
    );
    s.addText(꼬리표, { shape: pptx.ShapeType.roundRect, rectRadius: 0.5, x: pt(782), y: pt(20), w: pt(160), h: pt(23),
      fill: { color: 주황 }, color: "FFFFFF", fontFace: 굵은글꼴, fontSize: 9, align: "center", valign: "middle" });
    s.addText(
      [{ text: `${대제목} – `, options: { color: "000000" } }, { text: 소제목, options: { color: 주황 } }],
      { x: pt(50), y: pt(68), w: pt(860), h: pt(36), fontFace: 굵은글꼴, fontSize: 18, align: "center", valign: "middle" },
    );
    s.addText(서브, { x: pt(50), y: pt(106), w: pt(860), h: pt(56), fontFace: 글꼴, fontSize: 13, align: "center", valign: "middle" });
    s.addText(String(++쪽), { x: pt(900), y: pt(504), w: pt(40), h: pt(18), fontFace: 굵은글꼴, fontSize: 8, color: "7F7F7F", align: "right" });
    return s;
  };
  const 섹션바 = (s: PptxGenJS.Slide, x: number, 글: string, w = 423) =>
    s.addText(글, { shape: pptx.ShapeType.roundRect, rectRadius: 0.5, x: pt(x), y: pt(185), w: pt(w), h: pt(22),
      fill: { color: 진회색 }, color: "FFFFFF", fontFace: 굵은글꼴, fontSize: 12, align: "center", valign: "middle" });
  const 캡션 = (s: PptxGenJS.Slide, x: number, y: number, 글: string, 출처 = "") => {
    s.addText(`< ${글} >`, { x: pt(x), y: pt(y), w: pt(260), h: pt(16), fontFace: 굵은글꼴, fontSize: 8, color: "595959" });
    if (출처) s.addText(출처, { x: pt(x + 140), y: pt(y), w: pt(283), h: pt(16), fontFace: 글꼴, fontSize: 6.5, color: "7F7F7F", align: "right" });
  };
  const 불릿 = (s: PptxGenJS.Slide, x: number, y: number, 줄들: string[], w = 423) =>
    s.addText(
      줄들.flatMap((t, i) => {
        const 시사 = t.startsWith("→");
        return [
          { text: 시사 ? "" : "✓  ", options: { color: 주황, breakLine: false } },
          { text: t, options: { color: 시사 ? 주황 : "000000", breakLine: i < 줄들.length - 1 } },
        ];
      }),
      { x: pt(x), y: pt(y), w: pt(w), h: pt(줄들.length * 17 + 6), fontFace: 글꼴, fontSize: 10, align: "center", valign: "top", paraSpaceAfter: 3 },
    );
  const 메모 = (s: PptxGenJS.Slide, x: number, y: number, w: number, h: number, 글: string) =>
    s.addText(글, { x: pt(x), y: pt(y), w: pt(w), h: pt(h), fontFace: 글꼴, fontSize: 9, color: "0070C0", align: "center", valign: "middle",
      line: { color: "0070C0", width: 1, dashType: "dash" } });

  type 칸 = PptxGenJS.TableCell;
  const 머리 = (xs: string[]): 칸[] => xs.map((t) => ({ text: t, options: { fill: { color: "000000" }, color: "FFFFFF", fontFace: 굵은글꼴, bold: true } }));
  const 칸 = (t: string | number, o: PptxGenJS.TableCellProps = {}): 칸 => ({ text: String(t), options: o });
  const 표 = (s: PptxGenJS.Slide, x: number, y: number, 행들: 칸[][], 열폭: number[]) =>
    s.addTable(행들, { x: pt(x), y: pt(y), colW: 열폭.map(pt), rowH: pt(13), fontFace: 글꼴, fontSize: 8, align: "center", valign: "middle",
      margin: 0.75 / 72, border: { type: "solid", pt: 0.5, color: "BFBFBF" } });

  // 1. 표지
  {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addText(`${k.y} ${월이름} 한화손보`, { x: pt(80), y: pt(200), w: pt(800), h: pt(40), fontFace: 굵은글꼴, fontSize: 28, color: 주황 });
    s.addText("경쟁사 광고 모니터링 리뷰", { x: pt(80), y: pt(240), w: pt(800), h: pt(50), fontFace: 굵은글꼴, fontSize: 34, color: "000000" });
    s.addText(`메타 광고 라이브러리 · ${짧은날(k.시작)}~${짧은날(k.끝)} 기준 · PlayD`, { x: pt(80), y: pt(300), w: pt(800), h: pt(24), fontFace: 글꼴, fontSize: 12, color: "7F7F7F" });
  }

  // 2. 요약
  {
    const 신규증감 = 증감(경쟁당월, 경쟁전월);
    const s = 장표("1. 월간 요약", "월간 요약", "경쟁사 광고", `${월이름} 시장 한눈에`,
      `${월이름} 경쟁사 신규 소재 ${경쟁당월.toLocaleString()}건 (전월 동기간 ${신규증감.글}),\n` +
      `${늘린곳 ? `${늘린곳.g} 신규 투입 확대` : "광고주별 투입 변화"}${오른보종 ? ` · '${오른보종.v}' 비중 상승` : ""}`);
    섹션바(s, 36, "핵심 지표");
    const 타일 = [
      ["경쟁사 신규 소재", `${경쟁당월.toLocaleString()}건`, 신규증감],
      ["경쟁사 일평균 게재 소재", `${일평균("당월").toLocaleString()}건`, 증감(일평균("당월"), 일평균("전월"))],
      ["자사 신규 소재", `${(자사?.당월 ?? 0).toLocaleString()}건`, 증감(자사?.당월 ?? 0, 자사?.전월 ?? 0)],
      ["자사 신규 점유", 퍼((자사?.당월 ?? 0) / (전체당월 || 1)), { 글: `${광고주.length}곳 중`, 색: "7F7F7F" }],
    ] as const;
    타일.forEach(([이름, 값, d], i) => {
      const x = 36 + (i % 2) * 216, y = 216 + Math.floor(i / 2) * 104;
      s.addShape(pptx.ShapeType.roundRect, { x: pt(x), y: pt(y), w: pt(207), h: pt(94), rectRadius: 0.1, fill: { color: "F2F2F2" }, line: { color: "F2F2F2" } });
      s.addText(이름, { x: pt(x), y: pt(y + 10), w: pt(207), h: pt(16), fontFace: 굵은글꼴, fontSize: 9, color: "595959", align: "center" });
      s.addText(값, { x: pt(x), y: pt(y + 30), w: pt(207), h: pt(34), fontFace: 굵은글꼴, fontSize: 22, color: i >= 2 ? 주황 : "000000", align: "center" });
      s.addText(i === 3 ? d.글 : `전월 동기간 대비 ${d.글}`, { x: pt(x), y: pt(y + 66), w: pt(207), h: pt(16), fontFace: 글꼴, fontSize: 9, color: d.색, align: "center" });
    });
    s.addText(각주, { x: pt(36), y: pt(424), w: pt(423), h: pt(14), fontFace: 글꼴, fontSize: 6.5, color: "7F7F7F", align: "right" });
    섹션바(s, 501, `${월이름} 주요 변화`);
    const 줄 = [
      늘린곳 && `${늘린곳.g} 신규 ${늘린곳.전월}→${늘린곳.당월}건, 경쟁사 중 가장 많이 늘림`,
      오른보종 && `'${오른보종.v}' 신규 비중 ${퍼(오른보종.경쟁전월)}→${퍼(오른보종.경쟁당월)}, 보종 중 최대 상승`,
      진입.length > 0 && `새로 시작한 보종 ${진입.length}건 (예: ${진입.slice(0, 2).map((x) => `${x.g} ${x.v}`).join(", ")})`,
      공백[0] && `소구 '${공백[0].v}' 경쟁사 ${퍼(공백[0].경쟁당월)} vs 자사 ${퍼(공백[0].자사당월)}`,
      집중[0] && `자사는 '${집중[0].v}' 집중 (${퍼(집중[0].자사당월)}, 경쟁 ${퍼(집중[0].경쟁당월)})`,
    ].filter(Boolean) as string[];
    불릿(s, 501, 220, 줄.length ? 줄 : ["이번 달 기준을 넘은 변화가 없습니다"]);
    메모(s, 501, 330, 423, 100, "[담당자 작성] 위 변화에 대한 자사 대응 방향\n(예: 보종 확장·소재 교체·지면 조정)");
  }

  // 3. 광고주 동향
  {
    const s = 장표("2. 시장 동향", "광고주 동향", "광고주", "신규 투입량 및 게재 추이",
      `광고주별 ${월이름} 신규 소재와 게재 소재 수를 전월 동기간과 비교,\n일별 게재 중 소재 추이로 캠페인 시작·종료 시점 확인`);
    섹션바(s, 36, "광고주별 신규 소재");
    캡션(s, 36, 212, "광고주별 신규·게재 소재 수", "*신규 = 광고 시작일 기준");
    const 행들 = 광고주.slice(0, 13).map((x) => {
      const d = 증감(x.당월, x.전월);
      const o = x.자사 ? { fill: { color: "FFF2CC" } } : {};
      return [칸(x.g, { ...o, bold: x.자사 }), 칸(x.전월, o), 칸(x.당월, { ...o, bold: true }), 칸(d.글, { ...o, color: d.색, bold: true }), 칸(x.게재, o), 칸(x.주력 ?? "-", o)];
    });
    표(s, 36, 230, [머리(["광고주", `전월 ${짧은날(k.전시작)}~${짧은날(k.전끝).slice(-2)}`, `당월 ${짧은날(k.시작)}~${짧은날(k.끝).slice(-2)}`, "증감", "당월 게재", "주력 보종"]), ...행들],
      [100, 70, 70, 55, 55, 73]);
    섹션바(s, 501, "경쟁사 게재 소재 추이");
    캡션(s, 501, 212, "일별 게재 중 소재 수 (경쟁사)", "*같은 일차끼리 비교");
    const 일차 = (p: string) => 일별.filter((r) => r.p === p).map((r) => r.n);
    const 당 = 일차("당월"), 전 = 일차("전월");
    const 길이 = Math.max(당.length, 전.length, 1);
    if (당.length || 전.length)
      s.addChart(pptx.ChartType.line, [
        { name: `전월`, labels: Array.from({ length: 길이 }, (_, i) => `${i + 1}일`), values: 전 },
        { name: `${월이름}`, labels: Array.from({ length: 길이 }, (_, i) => `${i + 1}일`), values: 당 },
      ], { x: pt(501), y: pt(230), w: pt(423), h: pt(170), chartColors: [회색, 주황], lineSize: 2, lineDataSymbol: "none",
        valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" }, showLegend: true, legendPos: "t",
        legendFontSize: 7, legendFontFace: 글꼴, catAxisLabelFontSize: 7, catAxisLabelFontFace: 글꼴, catAxisLabelFrequency: "5" });
    else s.addText("이 기간 게재 기록이 없습니다", { x: pt(501), y: pt(280), w: pt(423), h: pt(40), fontFace: 글꼴, fontSize: 10, align: "center", color: "7F7F7F" });
    const d = 증감(일평균("당월"), 일평균("전월"));
    불릿(s, 501, 410, [
      `경쟁사 일평균 게재 ${일평균("전월")}→${일평균("당월")}건 (${d.글})`,
      ...(늘린곳 ? [`${늘린곳.g} 신규 ${늘린곳.전월}→${늘린곳.당월}건으로 가장 많이 늘림`] : []),
    ]);
  }

  // 4. 보종 트렌드
  {
    const s = 장표("2. 시장 동향", "보종 트렌드", "보종", "경쟁사 신규 소재 비중 변화",
      `경쟁사가 ${월이름}에 새로 투입한 소재의 보종 비중을 전월과 비교,\n새로 시작한 보종으로 상품 확장 움직임 확인`);
    섹션바(s, 36, "보종별 신규 소재 비중");
    캡션(s, 36, 212, "보종별 신규 소재 비중 (경쟁사 / 자사)", 각주);
    표(s, 36, 230, [
      머리(["보종", "경쟁 전월", "경쟁 당월", "증감", "경쟁 건수", "자사 당월"]),
      ...보종표.map((x) => {
        const d = 포인트(x.경쟁당월, x.경쟁전월);
        return [칸(x.v), 칸(퍼(x.경쟁전월)), 칸(퍼(x.경쟁당월), { bold: true }), 칸(d.글, { color: d.색, bold: true }), 칸(x.경쟁건), 칸(x.자사건 ? 퍼(x.자사당월) : "-", { fill: { color: "FFF2CC" } })];
      }),
    ], [93, 62, 62, 62, 62, 82]);
    섹션바(s, 501, "새로 시작한 보종");
    캡션(s, 501, 212, "직전 60일엔 없던 보종을 이번 달 시작한 광고주");
    if (진입.length) 표(s, 501, 230, [머리(["광고주", "보종", "신규 소재"]), ...진입.map((x) => [칸(x.g), 칸(x.v, { color: 주황, bold: true }), 칸(`${x.n}건`)])], [160, 160, 103]);
    else s.addText("이번 달 새로 시작한 보종이 없습니다", { x: pt(501), y: pt(240), w: pt(423), h: pt(30), fontFace: 글꼴, fontSize: 10, align: "center", color: "7F7F7F" });
    불릿(s, 36, 420, [
      ...(오른보종 ? [`'${오른보종.v}' 경쟁사 신규 비중 ${퍼(오른보종.경쟁전월)}→${퍼(오른보종.경쟁당월)}`] : []),
      ...(보종표[0] ? [`경쟁사 신규 1위 보종 '${보종표[0].v}' (${퍼(보종표[0].경쟁당월)})`] : []),
    ]);
    메모(s, 501, 420, 423, 60, "[담당자 작성] 자사 핵심전략상품과 겹치는 보종 → 대응 소재·예산 제안");
  }

  // 5. 소구포인트·소재유형
  {
    const s = 장표("3. 소재 전략", "소구 비교", "소구포인트", "경쟁사 vs 자사 메시지 비교",
      `${월이름} 게재 소재의 소구포인트·소재유형 비중을 경쟁사와 자사로 나눠 비교,\n경쟁사는 쓰는데 자사가 덜 쓰는 메시지(공백)를 확인`);
    섹션바(s, 36, "소구포인트 비중");
    캡션(s, 36, 212, `${월이름} 게재 소재 소구포인트 비중`);
    const 막대 = [...소구표].reverse(); // 가로 막대는 첫 항목이 맨 아래라 뒤집어 1위를 위로
    if (소구표.length)
      s.addChart(pptx.ChartType.bar, [
        { name: "경쟁사", labels: 막대.map((x) => x.v), values: 막대.map((x) => Math.round(x.경쟁당월 * 1000) / 10) },
        { name: "자사", labels: 막대.map((x) => x.v), values: 막대.map((x) => Math.round(x.자사당월 * 1000) / 10) },
      ], { x: pt(36), y: pt(228), w: pt(423), h: pt(190), barDir: "bar", barGrouping: "clustered", chartColors: [회색, 주황],
        valAxisHidden: true, valGridLine: { style: "none" }, showValue: true, dataLabelFontSize: 7, dataLabelFormatCode: '0.0"%"',
        showLegend: true, legendPos: "t", legendFontSize: 7, legendFontFace: 글꼴, catAxisLabelFontSize: 8, catAxisLabelFontFace: 글꼴});
    섹션바(s, 501, "소재유형 비중");
    캡션(s, 501, 212, `${월이름} 게재 소재 소재유형 비중`);
    표(s, 501, 230, [
      머리(["소재유형", "경쟁사", "자사", "차이"]),
      ...유형표.map((x) => {
        const d = 포인트(x.자사당월, x.경쟁당월);
        return [칸(x.v), 칸(퍼(x.경쟁당월)), 칸(퍼(x.자사당월), { fill: { color: "FFF2CC" }, bold: true }), 칸(d.글, { color: d.색, bold: true })];
      }),
    ], [123, 100, 100, 100]);
    불릿(s, 36, 430, [
      ...공백.slice(0, 2).map((x) => `'${x.v}' 경쟁사 ${퍼(x.경쟁당월)} vs 자사 ${퍼(x.자사당월)} (공백)`),
      ...집중.slice(0, 1).map((x) => `자사 '${x.v}' 집중 ${퍼(x.자사당월)} (경쟁 ${퍼(x.경쟁당월)})`),
    ].slice(0, 3).concat(공백.length + 집중.length ? [] : ["경쟁사와 15%p 이상 차이 나는 소구 없음"]));
    메모(s, 501, 330, 423, 90, "[담당자 작성] 공백 소구 테스트 소재 제안\n(카피·이미지 방향)");
  }

  // 6. 주목 소재
  {
    const s = 장표("3. 소재 전략", "주목 소재", "경쟁사 신규 소재", `${월이름} 주목 소재`,
      `${월이름} 경쟁사가 새로 투입한 소재 중 변형(버전) 수·게재일이 많은 순으로 선정,\n광고주별로 한 장씩 먼저 골라 시장 메시지 흐름 확인`);
    섹션바(s, 36, `${월이름} 경쟁사 주목 소재`, 888);
    if (!고른.length) s.addText("이번 달 이미지가 저장된 경쟁사 신규 소재가 없습니다", { x: pt(36), y: pt(300), w: pt(888), h: pt(30), fontFace: 글꼴, fontSize: 10, align: "center", color: "7F7F7F" });
    고른.forEach((x, i) => {
      const cx = 36 + (i % 4) * 225, cy = 215 + Math.floor(i / 4) * 150;
      const 그림 = 그림들[i];
      if (그림) s.addImage({ data: 그림, x: pt(cx + 40), y: pt(cy), w: pt(130), h: pt(110), sizing: { type: "contain", w: pt(130), h: pt(110) } });
      else s.addText("이미지 없음", { x: pt(cx + 40), y: pt(cy), w: pt(130), h: pt(110), fontFace: 글꼴, fontSize: 8, color: "7F7F7F", align: "center", line: { color: "BFBFBF", width: 0.5 } });
      s.addText(`${x.g} · ${x.보종 ?? "-"}`, { shape: pptx.ShapeType.rect, x: pt(cx + 40), y: pt(cy + 112), w: pt(130), h: pt(15), fill: { color: 주황 }, color: "FFFFFF", fontFace: 굵은글꼴, fontSize: 7.5, align: "center", valign: "middle" });
      s.addText(`${x.소구 ?? ""} · 변형 ${x.변형}개 · ${x.일수}일`, { x: pt(cx + 20), y: pt(cy + 127), w: pt(170), h: pt(13), fontFace: 글꼴, fontSize: 7, color: "595959", align: "center" });
    });
  }

  // 7. 오퍼
  {
    const s = 장표("3. 소재 전략", "오퍼 비교", "오퍼", "보험료·보장금액 표기 비교",
      `${월이름} 게재 소재에 적힌 보험료·보장금액 표기를 광고주별로 정리,\n가격·보장 소구 수준을 자사와 비교`);
    섹션바(s, 36, "광고주별 보험료·보장금액 표기", 888);
    if (오퍼.length)
      표(s, 36, 215, [머리(["광고주", "보종", "보험료 표기", "보장금액 표기"]), ...오퍼.map((x) => {
        const o = x.g === 자사?.g ? { fill: { color: "FFF2CC" } } : {};
        return [칸(x.g, o), 칸(x.보종 ?? "-", o), 칸(x.보험료 ?? "", { ...o, bold: true }), 칸(x.보장 ?? "", o)];
      })], [150, 150, 294, 294]);
    else s.addText("이번 달 보험료·보장금액이 추출된 소재가 없습니다 (2026-11 이후 분류부터 채워짐)", { x: pt(36), y: pt(260), w: pt(888), h: pt(30), fontFace: 글꼴, fontSize: 10, align: "center", color: "7F7F7F" });
  }

  const 파일 = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const 이름 = `(PlayD)한화손보_${월이름} 경쟁사 광고 모니터링_${String(k.y).slice(2)}${String(k.m).padStart(2, "0")}.pptx`;
  return new Response(new Uint8Array(파일), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(이름)}`,
    },
  });
}
