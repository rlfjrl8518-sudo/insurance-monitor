import PptxGenJS from "pptxgenjs";
import { sql } from "@/lib/db";
import { 기간만들기, 분석, type 행 } from "./analyze";

/** 경쟁사 광고 모니터링 보고서(PPT). /report?시작=2026-10-01&끝=2026-10-31 → 직전 같은 일수와 비교.
 *  양식은 한화손보 장기TM 월간 운영 덱(넥슨Lv1고딕, 주황 F37321, 회색 알약 제목줄, 진회색 섹션 바,
 *  검정 머리 표, ▲빨강/▼파랑). 계산·인사이트 문장은 analyze.ts. */

export const dynamic = "force-dynamic";

const 글꼴 = "넥슨Lv1고딕";
const 굵은글꼴 = "넥슨Lv1고딕 Bold";
const 주황 = "F37321";
const 진회색 = "404040";
const 회색 = "A6A6A6";
const 연주황 = "FBE5D6";
const 연노랑 = "FFF2CC";
const pt = (v: number) => v / 72; // 덱 좌표(pt) → pptxgenjs(inch)
const 짧은날 = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const 날짜꼴 = /^\d{4}-\d{2}-\d{2}$/;

async function 이미지(url: string) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    return `${r.headers.get("content-type") ?? "image/jpeg"};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const 어제 = new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10);
  const 끝 = 날짜꼴.test(q.get("끝") ?? "") ? q.get("끝")! : 어제;
  const 시작 = 날짜꼴.test(q.get("시작") ?? "") ? q.get("시작")! : new Date(Date.parse(끝) - 29 * 86400000).toISOString().slice(0, 10);
  const k = 기간만들기(시작, 끝);
  if (k.일수 < 1 || k.일수 > 366) return new Response("기간은 1~366일로 지정하세요.", { status: 400 });

  // 비교 기간 60일 전까지 걸친 소재만 가져와 JS에서 센다(새 보종 판단에 60일 이력이 필요).
  const 행들 = (await sql`
    select coalesce(advertiser_group, advertiser) g, coalesce(segment = '자사', false) 자사,
           to_char(coalesce(started_on, first_seen_on), 'YYYY-MM-DD') s,
           to_char(coalesce(ended_on, collected_on, current_date), 'YYYY-MM-DD') e,
           insurance_type 보종, appeal_point 소구, creative_type 유형, display_format 형식,
           coalesce(running_days, 0)::int 수명, greatest(coalesce(variant_count, 1), 1)::int 변형, image_url, labels
    from ads
    where coalesce(started_on, first_seen_on) is not null
      and coalesce(started_on, first_seen_on) <= ${k.끝}::date
      and coalesce(ended_on, collected_on, current_date) >= ${k.전시작}::date - 60`) as unknown as 행[];
  const a = 분석(행들, k);
  const { 퍼, 포인트, 증감률 } = a;

  // 썸네일은 한 번에 받는다
  const 딥다이브 = a.경쟁사.slice(0, 4);
  const 그림주소 = [...new Set([...a.장수, ...a.주목신규, ...딥다이브.flatMap((c) => c.소재.slice(0, 2))].map((r) => r.image_url!))];
  const 받은 = new Map(await Promise.all(그림주소.map(async (u) => [u, await 이미지(u)] as const)));

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 960×540pt, 원본 덱과 같은 크기
  pptx.theme = { headFontFace: 굵은글꼴, bodyFontFace: 글꼴 };
  const 기간글 = `${짧은날(k.시작)}~${짧은날(k.끝)}`;
  const 비교글 = `${짧은날(k.전시작)}~${짧은날(k.전끝)}`;
  const 각주 = `*출처 : 메타 광고 라이브러리 ${기간글} VS ${비교글} (각 ${k.일수}일)`;
  let 쪽 = 1;

  const 장표 = (섹션: string, 꼬리표: string, 대제목: string, 소제목: string, 서브: string) => {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addShape(pptx.ShapeType.roundRect, { x: pt(17), y: pt(19), w: pt(752), h: pt(24), rectRadius: 0.5, fill: { color: "F2F2F2" }, line: { color: "F2F2F2" } });
    s.addText(
      [{ text: "한화손보 장기TM ", options: { color: 주황 } }, { text: `경쟁사 모니터링 ${기간글} › ${섹션}`, options: { color: "000000" } }],
      { x: pt(23), y: pt(19), w: pt(740), h: pt(24), fontFace: 굵은글꼴, fontSize: 10, valign: "middle" },
    );
    s.addText(꼬리표, { shape: pptx.ShapeType.roundRect, rectRadius: 0.5, x: pt(782), y: pt(20), w: pt(160), h: pt(23),
      fill: { color: 주황 }, color: "FFFFFF", fontFace: 굵은글꼴, fontSize: 9, align: "center", valign: "middle" });
    s.addText([{ text: `${대제목} – `, options: { color: "000000" } }, { text: 소제목, options: { color: 주황 } }],
      { x: pt(50), y: pt(68), w: pt(860), h: pt(36), fontFace: 굵은글꼴, fontSize: 18, align: "center", valign: "middle" });
    s.addText(서브, { x: pt(50), y: pt(106), w: pt(860), h: pt(56), fontFace: 글꼴, fontSize: 13, align: "center", valign: "middle" });
    s.addText(String(++쪽), { x: pt(900), y: pt(504), w: pt(40), h: pt(18), fontFace: 굵은글꼴, fontSize: 8, color: "7F7F7F", align: "right" });
    return s;
  };
  type 판 = PptxGenJS.Slide;
  const 섹션바 = (s: 판, x: number, 글: string, w = 423, y = 185) =>
    s.addText(글, { shape: pptx.ShapeType.roundRect, rectRadius: 0.5, x: pt(x), y: pt(y), w: pt(w), h: pt(22),
      fill: { color: 진회색 }, color: "FFFFFF", fontFace: 굵은글꼴, fontSize: 12, align: "center", valign: "middle" });
  const 캡션 = (s: 판, x: number, y: number, 글: string, 출처 = "", w = 423) => {
    s.addText(`< ${글} >`, { x: pt(x), y: pt(y), w: pt(w * 0.6), h: pt(16), fontFace: 굵은글꼴, fontSize: 8, color: "595959" });
    if (출처) s.addText(출처, { x: pt(x + w * 0.35), y: pt(y), w: pt(w * 0.65), h: pt(16), fontFace: 글꼴, fontSize: 6.5, color: "7F7F7F", align: "right" });
  };
  /** ✓ 사실 / → 시사점(주황) 줄 묶음. */
  const 불릿 = (s: 판, x: number, y: number, 줄들: string[], w = 423, 크기 = 10) =>
    줄들.length &&
    s.addText(
      줄들.flatMap((t, i) => {
        // 빈 글자 조각을 넣으면 pptxgenjs가 한 문단에 pPr을 두 번 써서 PowerPoint가 파일을 못 연다
        const 끝 = i < 줄들.length - 1;
        return t.startsWith("→")
          ? [{ text: t, options: { color: 주황, bold: true, breakLine: 끝 } }]
          : [{ text: "✓  ", options: { color: 주황 } }, { text: t, options: { color: "000000", breakLine: 끝 } }];
      }),
      { x: pt(x), y: pt(y), w: pt(w), h: pt(줄들.length * (크기 + 7) + 6), fontFace: 글꼴, fontSize: 크기, align: "center", valign: "top", paraSpaceAfter: 3 },
    );
  const 없음 = (s: 판, x: number, y: number, w: number, 글: string) =>
    s.addText(글, { x: pt(x), y: pt(y), w: pt(w), h: pt(30), fontFace: 글꼴, fontSize: 10, align: "center", color: "7F7F7F" });

  type 칸 = PptxGenJS.TableCell;
  const 머리 = (xs: string[]): 칸[] => xs.map((t) => ({ text: t, options: { fill: { color: "000000" }, color: "FFFFFF", fontFace: 굵은글꼴, bold: true } }));
  const 칸 = (t: string | number, o: PptxGenJS.TableCellProps = {}): 칸 => ({ text: String(t), options: o });
  const 증감칸 = (글: string, o: PptxGenJS.TableCellProps = {}) =>
    칸(글, { ...o, bold: true, color: 글.startsWith("▲") ? "FF0000" : 글.startsWith("▼") ? "0000FF" : "000000" });
  const 표 = (s: 판, x: number, y: number, 행들: 칸[][], 열폭: number[], 높이 = 13) =>
    s.addTable(행들, { x: pt(x), y: pt(y), colW: 열폭.map(pt), rowH: pt(높이), fontFace: 글꼴, fontSize: 8, align: "center", valign: "middle",
      margin: 0.75 / 72, border: { type: "solid", pt: 0.5, color: "BFBFBF" } });
  const 썸네일 = (s: 판, r: 행, x: number, y: number, w: number, h: number, 아래1: string, 아래2: string) => {
    const 그림 = 받은.get(r.image_url!);
    if (그림) s.addImage({ data: 그림, x: pt(x), y: pt(y), w: pt(w), h: pt(h), sizing: { type: "contain", w: pt(w), h: pt(h) } });
    else s.addText("이미지 없음", { x: pt(x), y: pt(y), w: pt(w), h: pt(h), fontFace: 글꼴, fontSize: 8, color: "7F7F7F", align: "center", line: { color: "BFBFBF", width: 0.5 } });
    s.addText(아래1, { shape: pptx.ShapeType.rect, x: pt(x), y: pt(y + h + 2), w: pt(w), h: pt(15), fill: { color: 주황 }, color: "FFFFFF", fontFace: 굵은글꼴, fontSize: 7.5, align: "center", valign: "middle" });
    s.addText(아래2, { x: pt(x - 25), y: pt(y + h + 17), w: pt(w + 50), h: pt(13), fontFace: 글꼴, fontSize: 7, color: "595959", align: "center" });
  };
  const 인사이트카드 = (s: 판, x: number, y: number, w: number, 번호: string, x0: { 제목: string; 근거: string; 시사점: string }, h = 54) => {
    s.addShape(pptx.ShapeType.roundRect, { x: pt(x), y: pt(y), w: pt(w), h: pt(h), rectRadius: 0.08, fill: { color: "F7F7F7" }, line: { color: "F7F7F7" } });
    s.addText(번호, { shape: pptx.ShapeType.ellipse, x: pt(x + 8), y: pt(y + 8), w: pt(18), h: pt(18), fill: { color: 주황 }, color: "FFFFFF", fontFace: 굵은글꼴, fontSize: 9, align: "center", valign: "middle" });
    s.addText(
      [
        { text: x0.제목, options: { fontFace: 굵은글꼴, fontSize: 10, color: "000000", breakLine: true } },
        { text: x0.근거, options: { fontSize: 8, color: "595959", breakLine: true } },
        { text: `→ ${x0.시사점}`, options: { fontFace: 굵은글꼴, fontSize: 8.5, color: 주황 } },
      ],
      { x: pt(x + 32), y: pt(y + 3), w: pt(w - 38), h: pt(h - 6), fontFace: 글꼴, valign: "middle", paraSpaceAfter: 2 },
    );
  };
  const 막대줄 = (s: 판, x: number, y: number, w: number, 제목: string, 항목: { v: string; p: number }[], 색 = 주황) => {
    s.addText(제목, { x: pt(x), y: pt(y), w: pt(w), h: pt(14), fontFace: 굵은글꼴, fontSize: 8, color: "595959" });
    const 최대 = Math.max(0.01, ...항목.slice(0, 3).map((x) => x.p)); // 1위를 꽉 채우는 길이로
    항목.slice(0, 3).forEach((it, i) => {
      const yy = y + 16 + i * 15;
      s.addText(it.v, { x: pt(x), y: pt(yy), w: pt(62), h: pt(12), fontFace: 글꼴, fontSize: 8, valign: "middle" });
      s.addShape(pptx.ShapeType.rect, { x: pt(x + 64), y: pt(yy + 2), w: pt(Math.max(2, (w - 100) * it.p / 최대)), h: pt(8), fill: { color: i === 0 ? 색 : 회색 }, line: { color: i === 0 ? 색 : 회색 } });
      s.addText(퍼(it.p), { x: pt(x + 66 + (w - 100) * it.p / 최대), y: pt(yy), w: pt(34), h: pt(12), fontFace: 굵은글꼴, fontSize: 7.5, valign: "middle" });
    });
  };

  // 1. 표지
  {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: pt(180), w: pt(12), h: pt(150), fill: { color: 주황 }, line: { color: 주황 } });
    s.addText("한화손보 장기TM", { x: pt(80), y: pt(190), w: pt(800), h: pt(36), fontFace: 굵은글꼴, fontSize: 24, color: 주황 });
    s.addText("경쟁사 광고 모니터링 리포트", { x: pt(80), y: pt(228), w: pt(800), h: pt(50), fontFace: 굵은글꼴, fontSize: 34, color: "000000" });
    s.addText(`${k.시작} ~ ${k.끝} (${k.일수}일) · 비교 ${k.전시작} ~ ${k.전끝}`, { x: pt(80), y: pt(290), w: pt(800), h: pt(22), fontFace: 글꼴, fontSize: 12, color: "595959" });
    s.addText(`메타 광고 라이브러리 · 경쟁사 ${a.요약.경쟁사수}곳 · PlayD`, { x: pt(80), y: pt(312), w: pt(800), h: pt(20), fontFace: 글꼴, fontSize: 10, color: "7F7F7F" });
  }

  // 2. 핵심 요약
  {
    const 위 = a.인사이트.slice(0, 5);
    const s = 장표("요약", "핵심 요약", "경쟁사 광고", "이번 기간 핵심 인사이트",
      `경쟁사 신규 소재 ${a.요약.경쟁신규.toLocaleString()}건(직전 ${증감률(a.요약.경쟁신규, a.요약.경쟁전신규)}), 공세 확대 ${a.요약.확대}곳\n` +
      (위[0] ? 위[0].제목 : "기준을 넘은 변화 없음"));
    섹션바(s, 36, "핵심 인사이트 TOP 5", 600);
    if (!위.length) 없음(s, 36, 260, 600, "이번 기간엔 기준을 넘은 변화가 없습니다");
    위.forEach((x, i) => 인사이트카드(s, 36, 213 + i * 58, 600, String(i + 1), { ...x, 제목: `[${x.분류}] ${x.제목}` }));
    섹션바(s, 660, "핵심 지표", 264);
    const 타일 = [
      ["경쟁사 신규 소재", a.요약.경쟁신규, a.요약.경쟁전신규],
      ["경쟁사 게재 소재", a.요약.경쟁게재, a.요약.경쟁전게재],
      ["자사 신규 소재", a.요약.자사신규, a.요약.자사전신규],
    ] as const;
    타일.forEach(([이름, 값, 전], i) => {
      const y = 213 + i * 78;
      const d = 증감률(값, 전);
      s.addShape(pptx.ShapeType.roundRect, { x: pt(660), y: pt(y), w: pt(264), h: pt(70), rectRadius: 0.1, fill: { color: "F2F2F2" }, line: { color: "F2F2F2" } });
      s.addText(이름, { x: pt(660), y: pt(y + 6), w: pt(264), h: pt(14), fontFace: 굵은글꼴, fontSize: 9, color: "595959", align: "center" });
      s.addText(`${값.toLocaleString()}건`, { x: pt(660), y: pt(y + 21), w: pt(264), h: pt(28), fontFace: 굵은글꼴, fontSize: 20, color: i === 2 ? 주황 : "000000", align: "center" });
      s.addText(`직전 ${전.toLocaleString()}건 대비 ${d}`, { x: pt(660), y: pt(y + 50), w: pt(264), h: pt(14), fontFace: 글꼴, fontSize: 8.5,
        color: d.startsWith("▲") ? "FF0000" : d.startsWith("▼") ? "0000FF" : "000000", align: "center" });
    });
    s.addText(`활동 경쟁사 ${a.요약.경쟁사수}곳 · 자사 주력 ${a.자사주력.join("·") || "-"}`, { x: pt(660), y: pt(447), w: pt(264), h: pt(16), fontFace: 글꼴, fontSize: 8, color: "595959", align: "center" });
    s.addText(각주, { x: pt(36), y: pt(504), w: pt(600), h: pt(14), fontFace: 글꼴, fontSize: 6.5, color: "7F7F7F" });
  }

  // 3. 경쟁사 동향표
  {
    const 위 = a.경쟁사.slice(0, 14);
    const 확대 = a.경쟁사.filter((c) => c.태그 === "확대" || c.태그 === "신규 진입");
    const 축소 = a.경쟁사.filter((c) => c.태그 === "축소");
    const s = 장표("1. 경쟁사 동향", "경쟁사 동향", "경쟁사", "누가 늘리고 무엇을 미는가",
      `경쟁사별 신규 투입량 변화와 주력 보종·소구·전략 유형을 한 표로 정리,\n확대 ${확대.length}곳 · 축소 ${축소.length}곳`);
    섹션바(s, 36, "경쟁사별 운영 현황", 888);
    캡션(s, 36, 211, "신규 = 광고 시작일 기준 / 주력 = 기간 중 게재 소재 기준", 각주, 888);
    표(s, 36, 228, [
      머리(["경쟁사", "구분", `신규 ${비교글}`, `신규 ${기간글}`, "증감", "게재", "주력 보종", "주력 소구", "전략 유형", "영상", "게재일", "새 보종"]),
      ...위.map((c) => {
        const o: PptxGenJS.TableCellProps = c.태그 === "확대" || c.태그 === "신규 진입" ? { fill: { color: 연주황 } } : {};
        return [
          칸(c.g, { ...o, bold: true }), 칸(c.태그, { ...o, color: c.태그 === "축소" ? "0000FF" : c.태그 === "유지" ? "000000" : "FF0000", bold: true }),
          칸(c.전신규, o), 칸(c.신규, { ...o, bold: true }), 증감칸(증감률(c.신규, c.전신규), o), 칸(c.게재, o),
          칸(c.보종.순위[0] ? `${c.보종.순위[0].v} ${퍼(c.보종.순위[0].p)}` : "-", o),
          칸(c.소구.순위[0] ? `${c.소구.순위[0].v} ${퍼(c.소구.순위[0].p)}` : "-", o),
          칸(c.전략, o), 칸(퍼(c.영상), o), 칸(`${c.수명}일`, o), 칸(c.새보종.map((x) => x.v).slice(0, 2).join(", ") || "-", { ...o, color: c.새보종.length ? 주황 : "000000" }),
        ];
      }),
    ], [110, 46, 58, 58, 46, 38, 118, 112, 112, 38, 42, 110]);
    const 줄: string[] = [];
    if (확대[0]) 줄.push(`${확대.slice(0, 3).map((c) => `${c.g}(${c.전신규}→${c.신규})`).join(", ")} 신규 투입 확대`);
    const 유형수 = new Map<string, number>();
    for (const c of a.경쟁사) 유형수.set(c.전략, (유형수.get(c.전략) ?? 0) + 1);
    const 많은유형 = [...유형수.entries()].sort((x, y) => y[1] - x[1])[0];
    if (많은유형) 줄.push(`경쟁사 ${a.경쟁사.length}곳 중 ${많은유형[1]}곳이 '${많은유형[0]}' — 시장 기본 문법`);
    const 새 = a.경쟁사.filter((c) => c.새보종.length);
    if (새.length) 줄.push(`→ 새 보종 진입 ${새.length}곳: ${새.slice(0, 3).map((c) => `${c.g} ${c.새보종[0].v}`).join(", ")}`);
    불릿(s, 36, 232 + (위.length + 1) * 13 + 10, 줄, 888);
  }

  // 4~5. 경쟁사별 상세
  for (let p = 0; p < 딥다이브.length; p += 2) {
    const 둘 = 딥다이브.slice(p, p + 2);
    const s = 장표("1. 경쟁사 동향", "경쟁사 상세", "주요 경쟁사", `${둘.map((c) => c.g).join(" · ")} 전략 분석`,
      `신규 투입량 상위 경쟁사의 주력 보종·소구, 대표 소재와 오퍼로\n전략 방향과 자사와 겹치는 지점 확인`);
    둘.forEach((c, i) => {
      const x = i ? 501 : 36;
      섹션바(s, x, `${c.g} · ${c.태그}`);
      s.addText(`신규 ${c.신규}건(${증감률(c.신규, c.전신규)}) · 게재 ${c.게재}건 · 영상 ${퍼(c.영상)} · 게재일 중앙 ${c.수명}일 · 변형 평균 ${c.변형.toFixed(1)}개`,
        { x: pt(x), y: pt(211), w: pt(423), h: pt(16), fontFace: 글꼴, fontSize: 8.5, align: "center", color: "404040" });
      막대줄(s, x + 8, 232, 200, "< 주력 보종 >", c.보종.순위);
      막대줄(s, x + 220, 232, 200, "< 주력 소구 >", c.소구.순위);
      const 소재 = c.소재.slice(0, 2);
      소재.forEach((r, j) => 썸네일(s, r, x + (소재.length === 1 ? 151 : 56 + j * 190), 300, 120, 92, `${r.보종 ?? "-"} · ${r.소구 ?? "-"}`, `변형 ${r.변형}개 · ${r.수명}일`));
      if (!소재.length) 없음(s, x, 320, 423, "이미지가 저장된 소재가 없습니다");
      const 겹침 = c.보종.순위.slice(0, 2).map((b) => b.v).filter((v) => a.자사주력.includes(v));
      불릿(s, x, 428, [
        `'${c.전략}' — ${c.소구.순위[0]?.v ?? "-"} 소구 ${퍼(c.소구.순위[0]?.p ?? 0)}`,
        c.새보종.length ? `새 보종 '${c.새보종.map((b) => b.v).join(", ")}' 시작` : c.소구변화 && c.소구변화.d >= 0.05 ? `'${c.소구변화.v}' 소구 비중 ${포인트(c.소구변화.d)} 확대` : `대표 오퍼: ${c.오퍼 || "표기 없음"}`,
        겹침.length ? `→ 자사 주력 '${겹침.join("·")}'과 겹침, 메시지·오퍼 비교 필요` : `→ 자사 주력 보종과 직접 겹치지 않음`,
      ], 423, 9);
    });
  }

  // 6. 보종 지도
  {
    const s = 장표("2. 보종 분석", "보종 지도", "보종", "경쟁사별 상품 포트폴리오",
      `보종 × 경쟁사 게재 소재 수로 누가 어떤 상품을 미는지 확인,\n경쟁사 신규 비중 변화로 커지는 시장과 자사 공백 보종 파악`);
    섹션바(s, 36, "보종 × 경쟁사 게재 소재 수", 888);
    캡션(s, 36, 211, "색이 진할수록 많이 게재 / 신규 비중 증감 = 직전 기간 대비", 각주, 888);
    const 최대 = Math.max(1, ...a.지도.flatMap((r) => r.칸));
    const 색 = (n: number) => (n === 0 ? "FFFFFF" : n / 최대 >= 0.6 ? "F4B183" : n / 최대 >= 0.3 ? "F8CBAD" : 연주황);
    const 열 = a.지도광고주.length;
    표(s, 36, 228, [
      머리(["보종", ...a.지도광고주, "자사", "운영사", "신규 비중", "증감"]),
      ...a.지도.map((r) => {
        const b = a.보종표.find((x) => x.v === r.v)!;
        return [
          칸(r.v, { bold: true }), ...r.칸.map((n) => 칸(n || "", { fill: { color: 색(n) } })),
          칸(r.자사 || "-", { fill: { color: 연노랑 }, bold: true }), 칸(`${b.운영사}곳`), 칸(퍼(b.신규비중)), 증감칸(포인트(b.변화)),
        ];
      }),
    ], [80, ...Array(열).fill((888 - 80 - 60 - 50 - 55 - 50) / Math.max(1, 열)), 60, 50, 55, 50]);
    const 커짐 = [...a.보종표].filter((b) => b.게재 >= 5).sort((x, y) => y.변화 - x.변화)[0];
    const 과열 = [...a.보종표].sort((x, y) => y.운영사 - x.운영사)[0];
    const 공백 = a.보종표.filter((b) => b.자사건 === 0 && b.게재비중 >= 0.05).slice(0, 3);
    const 틈새 = a.보종표.filter((b) => b.운영사 <= 2 && b.게재 >= 5).slice(0, 2);
    불릿(s, 36, 232 + (a.지도.length + 1) * 13 + 10, [
      ...(커짐 && 커짐.변화 > 0 ? [`가장 커진 보종 '${커짐.v}' 신규 비중 ${퍼(커짐.전신규비중)}→${퍼(커짐.신규비중)}, 주도 ${커짐.주도}`] : []),
      ...(과열 ? [`가장 붐비는 보종 '${과열.v}' — 경쟁사 ${과열.운영사}곳 운영`] : []),
      ...(틈새.length ? [`경쟁 적은 보종: ${틈새.map((b) => `'${b.v}'(${b.운영사}곳)`).join(", ")}`] : []),
      ...(공백.length ? [`→ 자사 미운영 보종 ${공백.map((b) => `'${b.v}' ${퍼(b.게재비중)}`).join(", ")} — 취급 상품이면 진입 검토`] : []),
    ], 888);
  }

  // 7. 보종별 메시지 전략
  {
    const s = 장표("2. 보종 분석", "보종별 메시지", "보종별", "경쟁사는 어떤 메시지로 파는가",
      `보종마다 경쟁사가 가장 많이 쓰는 소구와 가격 표기를 자사와 비교,\n같은 상품에서 메시지가 겹치는지·비어 있는 메시지가 무엇인지 확인`);
    섹션바(s, 36, "보종별 경쟁사 소구 vs 자사", 888);
    캡션(s, 36, 211, "기간 중 게재 소재 기준 / 빈 소구 = 경쟁사 비중 15% 미만", 각주, 888);
    표(s, 36, 228, [
      머리(["보종", "경쟁 1위 소구", "경쟁 2위 소구", "대표 보험료 표기", "자사 1위 소구", "판정", "경쟁이 덜 쓰는 소구"]),
      ...a.메시지.map((m) => {
        const 주력 = a.자사주력.includes(m.v);
        const o: PptxGenJS.TableCellProps = 주력 ? { fill: { color: 연노랑 } } : {};
        const 판정 = !m.우리1 ? "자사 미운영" : m.우리1.v === m.경쟁1?.v ? "동조" : "차별";
        return [
          칸(m.v, { ...o, bold: true }), 칸(m.경쟁1 ? `${m.경쟁1.v} ${퍼(m.경쟁1.p)}` : "-", o), 칸(m.경쟁2 ? `${m.경쟁2.v} ${퍼(m.경쟁2.p)}` : "-", o),
          칸(m.가격 || "-", o), 칸(m.우리1 ? `${m.우리1.v} ${퍼(m.우리1.p)}` : "-", { ...o, bold: true }),
          칸(판정, { ...o, bold: true, color: 판정 === "동조" ? "FF0000" : 판정 === "차별" ? "0000FF" : "7F7F7F" }),
          칸(m.덜쓰는.slice(0, 2).join(", ") || "-", { ...o, color: 주황 }),
        ];
      }),
    ], [90, 130, 130, 150, 130, 70, 188], 15);
    const 동조 = a.메시지.filter((m) => m.우리1 && m.우리1.v === m.경쟁1?.v);
    const 차별 = a.메시지.filter((m) => m.우리1 && m.우리1.v !== m.경쟁1?.v);
    불릿(s, 36, 232 + (a.메시지.length + 1) * 15 + 10, [
      ...(동조.length ? [`메시지 동조 보종: ${동조.map((m) => `'${m.v}'(${m.경쟁1!.v})`).join(", ")}`] : []),
      ...(차별.length ? [`차별화 중인 보종: ${차별.map((m) => `'${m.v}'(자사 ${m.우리1!.v})`).join(", ")}`] : []),
      ...(동조[0] ? [동조[0].덜쓰는[0] ? `→ '${동조[0].v}'은 경쟁이 덜 쓰는 '${동조[0].덜쓰는[0]}' 소구로 차별 테스트 제안` : `→ '${동조[0].v}'은 소구가 고르게 경쟁 중, 오퍼·가격 표기로 차별 필요`] : []),
    ], 888);
  }

  // 8. 소구 트렌드
  {
    const 표줄 = a.소구표.slice(0, 7);
    const s = 장표("3. 메시지 분석", "소구 트렌드", "소구포인트", "시장 메시지 흐름과 자사 위치",
      `경쟁사 게재 소재의 소구 비중을 직전 기간·자사와 비교,\n커지는 메시지와 자사가 비어 있는 메시지 확인`);
    섹션바(s, 36, "소구포인트 비중 비교");
    캡션(s, 36, 211, "기간 중 게재 소재 기준");
    const 막대 = [...표줄].reverse(); // 가로 막대는 첫 항목이 맨 아래라 뒤집어 1위를 위로
    if (표줄.length)
      s.addChart(pptx.ChartType.bar, [
        { name: "경쟁사(직전)", labels: 막대.map((x) => x.v), values: 막대.map((x) => Math.round(x.경쟁전 * 1000) / 10) },
        { name: "경쟁사", labels: 막대.map((x) => x.v), values: 막대.map((x) => Math.round(x.경쟁 * 1000) / 10) },
        { name: "자사", labels: 막대.map((x) => x.v), values: 막대.map((x) => Math.round(x.자사 * 1000) / 10) },
      ], { x: pt(36), y: pt(226), w: pt(423), h: pt(220), barDir: "bar", barGrouping: "clustered", chartColors: ["D9D9D9", 회색, 주황],
        valAxisHidden: true, valGridLine: { style: "none" }, showValue: true, dataLabelFontSize: 6.5, dataLabelFormatCode: '0"%"',
        showLegend: true, legendPos: "t", legendFontSize: 7, legendFontFace: 글꼴, catAxisLabelFontSize: 8, catAxisLabelFontFace: 글꼴 });
    섹션바(s, 501, "소구별 변화와 주도 경쟁사");
    캡션(s, 501, 211, "직전 대비 경쟁사 비중 증감", 각주);
    표(s, 501, 228, [
      머리(["소구", "경쟁 직전", "경쟁 이번", "증감", "자사", "가장 많이 쓰는 곳"]),
      ...표줄.map((x) => [칸(x.v, { bold: true }), 칸(퍼(x.경쟁전)), 칸(퍼(x.경쟁), { bold: true }), 증감칸(포인트(x.변화)), 칸(퍼(x.자사), { fill: { color: 연노랑 }, bold: true }), 칸(x.주도 || "-")]),
    ], [70, 55, 55, 55, 50, 138], 15);
    const 오름 = [...표줄].sort((x, y) => y.변화 - x.변화)[0];
    const 빈 = 표줄.filter((x) => x.자사 < 0.05 && x.경쟁 >= 0.1);
    const 집중 = 표줄.filter((x) => x.자사 - x.경쟁 >= 0.15);
    불릿(s, 501, 232 + (표줄.length + 1) * 15 + 10, [
      ...(오름 && 오름.변화 > 0 ? [`'${오름.v}' 경쟁사 비중 ${퍼(오름.경쟁전)}→${퍼(오름.경쟁)}, 가장 크게 상승`] : []),
      ...(집중[0] ? [`자사는 '${집중[0].v}' 집중 ${퍼(집중[0].자사)} (경쟁 ${퍼(집중[0].경쟁)})`] : []),
      ...(빈[0] ? [`→ '${빈.map((x) => x.v).join("·")}' 자사 공백 — 카피 A/B 테스트 후보`] : []),
    ], 423, 9);
  }

  // 9. 크리에이티브 방식
  {
    const s = 장표("3. 메시지 분석", "크리에이티브 방식", "크리에이티브", "어떻게 만들고 얼마나 돌리는가",
      `형식·제작방식·인물·퍼널·오퍼·긴급성을 경쟁사와 자사로 비교,\n소재 수명·변형 수로 운영 속도 차이 확인`);
    섹션바(s, 36, "제작 방식 비교", 600);
    캡션(s, 36, 211, "기간 중 게재 소재 기준 / 차이 = 자사 − 경쟁", "", 600);
    표(s, 36, 228, [
      머리(["항목", "경쟁 1위", "경쟁 비중", "자사 같은 값", "자사 1위", "가장 큰 차이"]),
      ...a.방식.map((m) => [
        칸(m.축, { bold: true }), 칸(m.경쟁1.v), 칸(퍼(m.경쟁1.p)), 칸(m.자사합 ? 퍼(m.자사같은값) : "-", { fill: { color: 연노랑 } }),
        칸(m.자사1 ? `${m.자사1.v} ${퍼(m.자사1.p)}` : "-", { fill: { color: 연노랑 }, bold: true }),
        증감칸(m.자사합 ? `${m.최대차.v} ${포인트(m.최대차.d)}` : "-"),
      ]),
    ], [70, 100, 70, 90, 120, 150], 15);
    섹션바(s, 660, "운영 속도", 264);
    const 운영줄 = [
      ["게재일 중앙", `${a.운영.경쟁.수명}일`, `${a.운영.자사.수명}일`],
      ["평균 변형 수", a.운영.경쟁.변형.toFixed(1), a.운영.자사.변형.toFixed(1)],
      ["영상 비중", 퍼(a.운영.경쟁.영상), 퍼(a.운영.자사.영상)],
    ];
    표(s, 660, 228, [머리(["지표", "경쟁사", "자사"]), ...운영줄.map(([n, x, y]) => [칸(n, { bold: true }), 칸(x), 칸(y, { fill: { color: 연노랑 }, bold: true })])], [100, 82, 82], 18);
    const 큰차 = [...a.방식].filter((m) => m.자사합).sort((x, y) => Math.abs(y.최대차.d) - Math.abs(x.최대차.d)).slice(0, 2);
    불릿(s, 36, 232 + (a.방식.length + 1) * 15 + 12, 큰차.map((m) => `${m.축}: 자사 '${m.최대차.v}' ${m.최대차.d > 0 ? "더 많이" : "덜"} 씀 (${포인트(m.최대차.d)})`), 600, 9);
    불릿(s, 660, 310, [
      a.운영.자사.수명 > a.운영.경쟁.수명 ? `자사 소재가 ${a.운영.자사.수명 - a.운영.경쟁.수명}일 더 오래 감` : `자사 소재 교체가 경쟁사보다 빠름`,
      a.운영.경쟁.영상 > a.운영.자사.영상 ? `→ 영상 비중 ${퍼(a.운영.경쟁.영상 - a.운영.자사.영상)}p 낮음, 영상화 테스트` : `→ 영상 비중은 경쟁사 이상`,
    ], 264, 9);
  }

  // 10. 장수 소재
  {
    const s = 장표("4. 소재 레퍼런스", "장수 소재", "오래 살아남은", "경쟁사 효율 추정 소재",
      `기간 중 게재된 경쟁사 소재 중 가장 오래 돌아간 소재 — 성과가 나서 유지 중인 것으로 추정,\n광고주별로 한 장씩 먼저 골라 검증된 보종·소구 조합 확인`);
    섹션바(s, 36, "게재일 상위 경쟁사 소재", 888);
    if (!a.장수.length) 없음(s, 36, 300, 888, "이미지가 저장된 소재가 없습니다");
    a.장수.forEach((r, i) => 썸네일(s, r, 76 + (i % 4) * 225, 215 + Math.floor(i / 4) * 145, 130, 105, `${r.g} · ${r.수명}일`, `${r.보종 ?? "-"} · ${r.소구 ?? "-"}`));
  }

  // 11. 신규 주목 소재
  {
    const s = 장표("4. 소재 레퍼런스", "신규 주목 소재", "새로 나온", "경쟁사 주목 소재",
      `이번 기간 경쟁사가 새로 투입한 소재 중 변형(버전) 수가 많은 순 — 힘을 싣는 소재,\n광고주별로 한 장씩 먼저 골라 새 메시지 흐름 확인`);
    섹션바(s, 36, "변형 수 상위 경쟁사 신규 소재", 888);
    if (!a.주목신규.length) 없음(s, 36, 300, 888, "이미지가 저장된 신규 소재가 없습니다");
    a.주목신규.forEach((r, i) => 썸네일(s, r, 76 + (i % 4) * 225, 215 + Math.floor(i / 4) * 145, 130, 105, `${r.g} · ${r.보종 ?? "-"}`, `${r.소구 ?? "-"} · 변형 ${r.변형}개 · 시작 ${짧은날(r.s)}`));
  }

  // 12. 가격·보장 표기
  {
    const s = 장표("4. 소재 레퍼런스", "가격·보장 비교", "오퍼", "보종별 보험료·보장금액 표기",
      `보종마다 경쟁사가 내세우는 보험료·보장금액 표기를 자사와 나란히 비교,\n가격 소구 수준과 자사 표기의 경쟁력 확인`);
    섹션바(s, 36, "보종별 보험료·보장금액 표기", 888);
    if (a.가격표.length)
      표(s, 36, 215, [머리(["보종", "광고주", "보험료 표기", "보장금액 표기"]), ...a.가격표.map((x) => {
        const o: PptxGenJS.TableCellProps = x.자사 ? { fill: { color: 연노랑 } } : {};
        return [칸(x.보종, { ...o, bold: true }), 칸(x.g, o), 칸(x.보험료 || "-", { ...o, bold: true, color: x.보험료 ? 주황 : "000000" }), 칸(x.보장 || "-", o)];
      })], [140, 180, 284, 284], 14);
    else 없음(s, 36, 260, 888, "이 기간 보험료·보장금액이 추출된 소재가 없습니다 (2026-11 이후 분류부터 채워짐)");
  }

  // 13. 전략 시사점
  {
    const s = 장표("5. 전략 시사점", "전략 시사점", "전략", "기회 · 위협 · 차별화",
      `위 분석에서 기준을 넘은 발견을 자사 관점으로 묶어 정리,\n각 항목은 근거 수치와 실행 방향을 함께 제시`);
    const 묶음: [string, string[]][] = [["기회 (공백·성장)", ["기회"]], ["위협 (경쟁 심화)", ["위협"]], ["차별화·운영", ["차별화", "운영"]]];
    묶음.forEach(([이름, 분류], i) => {
      const x = 36 + i * 302;
      섹션바(s, x, 이름, 284);
      const xs = a.인사이트.filter((v) => 분류.includes(v.분류)).slice(0, 4);
      if (!xs.length) 없음(s, x, 240, 284, "기준을 넘은 항목 없음");
      xs.forEach((v, j) => 인사이트카드(s, x, 213 + j * 72, 284, String(j + 1), v, 66));
    });
  }

  const 파일 = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const 이름 = `(PlayD)한화손보_경쟁사 광고 모니터링_${k.시작.replaceAll("-", "").slice(2)}-${k.끝.replaceAll("-", "").slice(2)}.pptx`;
  return new Response(new Uint8Array(파일), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(이름)}`,
    },
  });
}
