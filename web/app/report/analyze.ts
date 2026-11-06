/** 경쟁사 광고 모니터링 보고서의 계산부. DB 행을 받아 장표에 넣을 숫자·문장을 만든다(순수 함수).
 *  기간은 [시작, 끝], 비교는 직전 같은 일수. 날짜는 모두 'YYYY-MM-DD' 문자열이라 문자열 비교로 충분하다. */

export type 행 = {
  g: string; 자사: boolean; s: string; e: string;
  보종: string | null; 소구: string | null; 유형: string | null; 형식: string | null;
  수명: number; 변형: number; image_url: string | null; labels: Record<string, string>;
};

export type 기간 = { 시작: string; 끝: string; 전시작: string; 전끝: string; 일수: number };

const 하루 = 86400000;
const 날 = (d: Date) => d.toISOString().slice(0, 10);
const 더하기 = (s: string, n: number) => 날(new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 하루));

export function 기간만들기(시작: string, 끝: string): 기간 {
  const 일수 = Math.round((Date.parse(끝) - Date.parse(시작)) / 하루) + 1;
  return { 시작, 끝, 일수, 전끝: 더하기(시작, -1), 전시작: 더하기(시작, -일수) };
}

/** 대표 소구로 읽는 경쟁사의 전략 유형. 문장에 쓰는 이름이라 짧게. */
const 전략유형: Record<string, string> = {
  경제적혜택: "가격·혜택 경쟁형", 대비유도: "불안 환기형", 상품신뢰: "상품·신뢰 강조형",
  정서유도: "공감 스토리형", 시즌이슈: "이슈 편승형", 가입유도: "전환 직행형",
};

// "없음"은 빼지 않는다: 인물노출·긴급성·오퍼에선 의미 있는 값이라 빼면 나머지가 100%로 부푼다
const 비어있나 = (v: string | null | undefined) => !v || v === "기타";

/** 보험료 표기 중 금액으로 읽히는 것만. 분류가 "+0원", "첫달 ???원"처럼 옮긴 잡음을 거른다. */
export const 금액표기 = (t: string | undefined) => !!t && /[1-9]/.test(t) && /원/.test(t) && !/\?/.test(t) && !t.startsWith("+");

function 세기(xs: 행[], 값: (r: 행) => string | null | undefined) {
  const m = new Map<string, number>();
  for (const r of xs) {
    const v = 값(r);
    if (!비어있나(v)) m.set(v!, (m.get(v!) ?? 0) + 1);
  }
  const 합 = [...m.values()].reduce((a, b) => a + b, 0);
  const 순위 = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ v, n, p: 합 ? n / 합 : 0 }));
  return { 합, 순위, 비중: (v: string) => (합 ? (m.get(v) ?? 0) / 합 : 0), 건: (v: string) => m.get(v) ?? 0 };
}

const 중앙 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const 퍼 = (x: number) => `${Math.round(x * 100)}%`;
const 포인트 = (d: number) => {
  const n = Math.round(d * 100);
  return n === 0 ? "0%p" : `${n > 0 ? "▲" : "▼"}${Math.abs(n)}%p`;
};
const 증감률 = (지금: number, 전: number) => {
  if (!전) return 지금 ? "신규" : "-";
  const n = Math.round(((지금 - 전) / 전) * 100);
  return n === 0 ? "0%" : `${n > 0 ? "▲" : "▼"}${Math.abs(n)}%`;
};

export type 인사이트 = { 분류: "기회" | "위협" | "차별화" | "운영"; 제목: string; 근거: string; 시사점: string; 점수: number };

export function 분석(전체: 행[], k: 기간) {
  const 이번신규 = 전체.filter((r) => r.s >= k.시작 && r.s <= k.끝);
  const 이전신규 = 전체.filter((r) => r.s >= k.전시작 && r.s <= k.전끝);
  const 이번게재 = 전체.filter((r) => r.s <= k.끝 && r.e >= k.시작);
  const 이전게재 = 전체.filter((r) => r.s <= k.전끝 && r.e >= k.전시작);
  const 경 = (xs: 행[]) => xs.filter((r) => !r.자사);
  const 자 = (xs: 행[]) => xs.filter((r) => r.자사);

  // ── 경쟁사 프로필 ──
  const 이름들 = [...new Set(경(이번게재).map((r) => r.g))];
  const 경쟁사 = 이름들
    .map((g) => {
      const 게재 = 이번게재.filter((r) => r.g === g);
      const 신규 = 이번신규.filter((r) => r.g === g);
      const 전신규 = 이전신규.filter((r) => r.g === g);
      const 보종 = 세기(게재, (r) => r.보종);
      const 소구 = 세기(게재, (r) => r.소구);
      // 직전 60일 안에 없던 보종을 이번 기간에 시작
      const 과거보종 = new Set(전체.filter((r) => r.g === g && r.s < k.시작 && r.e >= 더하기(k.시작, -60)).map((r) => r.보종));
      const 새보종 = 세기(신규.filter((r) => !과거보종.has(r.보종)), (r) => r.보종).순위.filter((x) => x.n >= 1);
      const 소구이번 = 세기(신규, (r) => r.소구), 소구이전 = 세기(전신규, (r) => r.소구);
      const 소구변화 = 신규.length >= 5 && 전신규.length >= 5
        ? 소구이번.순위.map((x) => ({ v: x.v, d: x.p - 소구이전.비중(x.v) })).sort((a, b) => b.d - a.d)[0]
        : undefined;
      const 태그 = 전신규.length === 0 && 신규.length >= 3 ? "신규 진입"
        : 전신규.length >= 5 && 신규.length >= 전신규.length * 1.3 ? "확대"
        : 전신규.length >= 5 && 신규.length <= 전신규.length * 0.7 ? "축소" : "유지";
      const 오퍼 = 게재.find((r) => 금액표기(r.labels?.보험료표기) || r.labels?.보장금액표기);
      return {
        g, 신규: 신규.length, 전신규: 전신규.length, 게재: 게재.length, 태그, 보종, 소구, 새보종, 소구변화,
        영상: 게재.length ? 게재.filter((r) => r.형식 === "VIDEO").length / 게재.length : 0,
        수명: 중앙(게재.map((r) => r.수명)),
        변형: 게재.length ? 게재.reduce((s, r) => s + r.변형, 0) / 게재.length : 0,
        전략: 전략유형[소구.순위[0]?.v ?? ""] ?? "혼합형",
        오퍼: 오퍼 ? [오퍼.보종, 금액표기(오퍼.labels.보험료표기) ? 오퍼.labels.보험료표기 : "", 오퍼.labels.보장금액표기].filter(Boolean).join(" ") : "",
        소재: 다른것먼저(게재.filter((r) => 쓸그림(r)).sort((a, b) => b.변형 - a.변형 || b.수명 - a.수명)),
      };
    })
    .sort((a, b) => b.신규 - a.신규 || b.게재 - a.게재);

  const 자사게재 = 자(이번게재);
  const 자사보종 = 세기(자사게재, (r) => r.보종);
  const 자사소구 = 세기(자사게재, (r) => r.소구);
  const 자사주력 = 자사보종.순위.slice(0, 3).map((x) => x.v);

  // ── 보종 ──
  const 경신규 = 세기(경(이번신규), (r) => r.보종), 경전신규 = 세기(경(이전신규), (r) => r.보종);
  const 경게재보종 = 세기(경(이번게재), (r) => r.보종);
  const 보종표 = 경게재보종.순위.slice(0, 12).map((x) => {
    const 운영사 = new Set(경(이번게재).filter((r) => r.보종 === x.v).map((r) => r.g));
    const 주도 = 경쟁사.map((c) => ({ g: c.g, n: c.보종.건(x.v) })).sort((a, b) => b.n - a.n)[0];
    return {
      v: x.v, 게재: x.n, 게재비중: x.p, 신규비중: 경신규.비중(x.v), 전신규비중: 경전신규.비중(x.v),
      변화: 경신규.비중(x.v) - 경전신규.비중(x.v), 운영사: 운영사.size, 주도: 주도?.g ?? "",
      자사: 자사보종.비중(x.v), 자사건: 자사보종.건(x.v),
    };
  });
  const 지도광고주 = 경쟁사.slice(0, 7).map((c) => c.g);
  const 지도 = 보종표.slice(0, 10).map((b) => ({
    v: b.v,
    칸: 지도광고주.map((g) => 이번게재.filter((r) => r.g === g && r.보종 === b.v).length),
    자사: b.자사건,
  }));

  // ── 보종별 메시지 ──
  const 메시지보종 = [...new Set([...자사주력.filter((v) => 경게재보종.건(v) > 0), ...보종표.map((b) => b.v)])].slice(0, 9);
  const 메시지 = 메시지보종.map((v) => ({ v })).map((b) => {
    const 경쟁 = 세기(경(이번게재).filter((r) => r.보종 === b.v), (r) => r.소구);
    const 우리 = 세기(자사게재.filter((r) => r.보종 === b.v), (r) => r.소구);
    const 덜쓰는 = 경쟁.순위.filter((x) => x.p < 0.15).map((x) => x.v);
    const 가격 = 경(이번게재).find((r) => r.보종 === b.v && 금액표기(r.labels?.보험료표기))?.labels.보험료표기 ?? "";
    return { v: b.v, 경쟁1: 경쟁.순위[0], 경쟁2: 경쟁.순위[1], 우리1: 우리.순위[0], 우리합: 우리.합, 덜쓰는, 가격 };
  });

  // ── 소구 ──
  const 경게재소구 = 세기(경(이번게재), (r) => r.소구), 경전게재소구 = 세기(경(이전게재), (r) => r.소구);
  const 소구표 = 경게재소구.순위.map((x) => ({
    v: x.v, 경쟁: x.p, 경쟁전: 경전게재소구.비중(x.v), 변화: x.p - 경전게재소구.비중(x.v), 자사: 자사소구.비중(x.v),
    주도: 경쟁사.map((c) => ({ g: c.g, p: c.소구.비중(x.v), n: c.소구.건(x.v) })).filter((c) => c.n >= 3).sort((a, b) => b.p - a.p)[0]?.g ?? "",
  }));

  // ── 크리에이티브 방식 ──
  const 형식이름: Record<string, string> = { IMAGE: "이미지", VIDEO: "영상", CAROUSEL: "캐러셀", DCO: "다이내믹", DPA: "카탈로그", MULTI_IMAGES: "다중 이미지" };
  const 축들: [string, (r: 행) => string | null | undefined][] = [
    ["형식", (r) => (r.형식 ? 형식이름[r.형식] ?? r.형식 : null)],
    ["제작방식", (r) => r.labels?.제작방식], ["인물노출", (r) => r.labels?.인물노출],
    ["비주얼스타일", (r) => r.labels?.비주얼스타일], ["퍼널단계", (r) => r.labels?.퍼널단계],
    ["오퍼", (r) => r.labels?.오퍼 ?? null], ["긴급성", (r) => r.labels?.긴급성 ?? null],
  ];
  const 방식 = 축들
    .map(([축, f]) => {
      const 경쟁 = 세기(경(이번게재), f), 우리 = 세기(자사게재, f);
      if (!경쟁.합) return null;
      const 값들 = [...new Set([...경쟁.순위, ...우리.순위].map((x) => x.v))];
      const 최대차 = 값들.map((v) => ({ v, d: 우리.비중(v) - 경쟁.비중(v) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
      return { 축, 경쟁1: 경쟁.순위[0], 자사같은값: 우리.비중(경쟁.순위[0].v), 자사1: 우리.순위[0], 최대차, 자사합: 우리.합 };
    })
    .filter(Boolean) as { 축: string; 경쟁1: { v: string; p: number }; 자사같은값: number; 자사1?: { v: string; p: number }; 최대차: { v: string; d: number }; 자사합: number }[];
  const 운영지표 = (xs: 행[]) => ({
    수명: 중앙(xs.map((r) => r.수명)),
    변형: xs.length ? xs.reduce((s, r) => s + r.변형, 0) / xs.length : 0,
    영상: xs.length ? xs.filter((r) => r.형식 === "VIDEO").length / xs.length : 0,
  });
  const 운영 = { 자사: 운영지표(자사게재), 경쟁: 운영지표(경(이번게재)) };

  // ── 소재 ──
  const 하나씩 = (xs: 행[], n: number) => {
    const 고른: 행[] = [];
    for (const 한바퀴 of [true, false])
      for (const x of xs) {
        if (고른.length >= n) break;
        if (고른.includes(x) || (한바퀴 && 고른.some((y) => y.g === x.g))) continue;
        고른.push(x);
      }
    return 고른;
  };
  const 장수 = 하나씩(경(이번게재).filter(쓸그림).sort((a, b) => b.수명 - a.수명), 8);
  const 주목신규 = 하나씩(경(이번신규).filter(쓸그림).sort((a, b) => b.변형 - a.변형 || b.수명 - a.수명), 8);
  const 장수보종 = 세기(장수, (r) => r.보종).순위[0];
  const 장수소구 = 세기(장수, (r) => r.소구).순위[0];

  // ── 가격 ──
  const 가격줄: { 보종: string; g: string; 보험료: string; 보장: string; 자사: boolean }[] = [];
  const 본 = new Set<string>();
  for (const r of 이번게재) {
    const 보험료 = 금액표기(r.labels?.보험료표기) ? r.labels.보험료표기 : "", 보장 = r.labels?.보장금액표기 ?? "";
    if (!r.보종 || (!보험료 && !보장)) continue;
    const 키 = `${r.보종}|${r.g}|${보험료}|${보장}`;
    if (본.has(키)) continue;
    본.add(키);
    가격줄.push({ 보종: r.보종, g: r.g, 보험료, 보장, 자사: r.자사 });
  }
  const 가격보종 = 세기(가격줄.map((x) => ({ 보종: x.보종 }) as 행), (r) => r.보종).순위.slice(0, 6).map((x) => x.v);
  const 가격표 = 가격보종.flatMap((v) => {
    const xs = 가격줄.filter((x) => x.보종 === v);
    return [...xs.filter((x) => x.자사).slice(0, 1), ...xs.filter((x) => !x.자사).slice(0, 3)];
  }).slice(0, 18);

  // ── 인사이트 ──
  const 인: 인사이트[] = [];
  for (const c of 경쟁사.filter((c) => c.태그 === "확대" || c.태그 === "신규 진입").slice(0, 3)) {
    const 주 = c.보종.순위[0];
    const 겹침 = 주 && 자사주력.includes(주.v);
    인.push({
      분류: 겹침 ? "위협" : "기회",
      제목: `${c.g}, 신규 소재 ${c.전신규}→${c.신규}건 ${c.태그 === "확대" ? "공세 확대" : "신규 진입"}`,
      근거: `주력 ${주 ? `'${주.v}' ${퍼(주.p)}` : "-"} · ${c.전략}${c.새보종[0] ? ` · 새 보종 '${c.새보종[0].v}'` : ""}`,
      시사점: 겹침 ? `자사 주력 '${주!.v}'과 정면 경쟁 → 해당 보종 소재·입찰 방어 점검` : `'${주?.v ?? "-"}' 경쟁 심화 신호 → 자사 진입 여부 판단 필요`,
      점수: 50 + Math.min(40, c.신규 - c.전신규),
    });
  }
  for (const b of 보종표.filter((b) => b.변화 >= 0.02 && b.게재 >= 5 && b.운영사 >= 2).sort((a, b) => b.변화 - a.변화).slice(0, 2)) {
    인.push({
      분류: b.자사건 ? "위협" : "기회",
      제목: `'${b.v}' 경쟁사 신규 비중 ${퍼(b.전신규비중)}→${퍼(b.신규비중)} (${포인트(b.변화)})`,
      근거: `${b.운영사}곳 운영 · 주도 ${b.주도} · 자사 ${b.자사건 ? `${b.자사건}건 운영` : "미운영"}`,
      시사점: b.자사건 ? `자사 운영 보종에 경쟁 유입 증가 → 차별 소구·오퍼 강화` : `수요 확대 보종, 자사 미운영 → 상품 운영 시 테스트 소재 우선 검토`,
      점수: 40 + b.변화 * 300,
    });
  }
  for (const b of 보종표.filter((b) => b.자사건 === 0 && b.게재비중 >= 0.08 && b.운영사 >= 2).slice(0, 2))
    if (!인.some((x) => x.제목.includes(`'${b.v}'`)))
      인.push({
        분류: "기회", 제목: `'${b.v}' 경쟁사 게재 ${퍼(b.게재비중)}, 자사는 미운영`,
        근거: `${b.운영사}곳 운영 · 주도 ${b.주도}`, 시사점: `자사 취급 상품이면 공백 시장 → 소재 테스트 후보`, 점수: 30 + b.게재비중 * 100,
      });
  for (const x of 소구표.filter((x) => x.자사 < 0.05 && x.경쟁 >= 0.12).slice(0, 2))
    인.push({
      분류: "기회", 제목: `소구 '${x.v}' 경쟁사 ${퍼(x.경쟁)} vs 자사 ${퍼(x.자사)}`,
      근거: `가장 많이 쓰는 곳 ${x.주도 || "-"} · 직전 대비 ${포인트(x.변화)}`,
      시사점: `자사 메시지 공백 → '${x.v}' 카피 A/B 테스트 제안`, 점수: 35 + x.경쟁 * 100,
    });
  for (const x of 소구표.filter((x) => x.변화 >= 0.04).sort((a, b) => b.변화 - a.변화).slice(0, 1))
    인.push({
      분류: "위협", 제목: `경쟁사 '${x.v}' 소구 확산 ${퍼(x.경쟁전)}→${퍼(x.경쟁)}`,
      근거: `주도 ${x.주도 || "-"} · 자사 ${퍼(x.자사)}`, 시사점: `시장 메시지가 '${x.v}'로 쏠리는 중 → 동조 or 차별 방향 결정 필요`, 점수: 30 + x.변화 * 300,
    });
  for (const v of 자사주력) {
    const b = 보종표.find((x) => x.v === v);
    if (!b || b.운영사 < 2) continue;
    const 주도사 = 경쟁사.find((c) => c.g === b.주도);
    const 주도소구 = 주도사 ? 세기(이번게재.filter((r) => r.g === 주도사.g && r.보종 === v), (r) => r.소구).순위[0] : undefined;
    인.push({
      분류: "위협",
      제목: `자사 주력 '${v}'에 경쟁사 ${b.운영사}곳 ${b.게재}건 게재`,
      근거: `경쟁 신규 비중 ${퍼(b.전신규비중)}→${퍼(b.신규비중)} · 주도 ${b.주도}${주도소구 ? ` ('${주도소구.v}' 소구)` : ""}`,
      시사점: b.변화 > 0 ? `경쟁 유입 증가 중 → ${b.주도} 소재·오퍼 대비 자사 메시지 점검` : `경쟁 유지 수준 → ${b.주도} 소재 동향 지속 모니터링`,
      점수: 38 + b.운영사 + Math.max(0, b.변화 * 200),
    });
  }
  for (const m of 메시지.filter((m) => 자사주력.includes(m.v) && m.경쟁1 && m.우리1)) {
    const 같음 = m.경쟁1!.v === m.우리1!.v;
    인.push({
      분류: "차별화",
      제목: `자사 주력 '${m.v}': 경쟁 '${m.경쟁1!.v}' ${퍼(m.경쟁1!.p)} / 자사 '${m.우리1!.v}' ${퍼(m.우리1!.p)}`,
      근거: 같음 ? "경쟁사와 같은 메시지로 경쟁 중" : "경쟁사와 다른 메시지로 차별화 중",
      시사점: !같음 ? `차별 메시지 유지, 성과 확인 후 확대` : m.덜쓰는[0] ? `메시지 동조 → 경쟁이 덜 쓰는 '${m.덜쓰는[0]}' 소구로 차별 테스트` : `메시지 동조, 소구는 고르게 경쟁 중 → 오퍼·가격 표기로 차별`,
      점수: 같음 ? 45 : 20,
    });
  }
  if (운영.경쟁.수명 && 운영.자사.수명 >= 운영.경쟁.수명 * 1.5)
    인.push({
      분류: "운영", 제목: `자사 소재 게재일 중앙 ${운영.자사.수명}일, 경쟁사 ${운영.경쟁.수명}일`,
      근거: "경쟁사보다 소재를 오래 유지", 시사점: "소재 피로도 점검 → 교체 주기 단축 검토", 점수: 25,
    });
  if (운영.경쟁.영상 - 운영.자사.영상 >= 0.1)
    인.push({
      분류: "운영", 제목: `영상 소재 비중 경쟁사 ${퍼(운영.경쟁.영상)} vs 자사 ${퍼(운영.자사.영상)}`,
      근거: "경쟁사가 영상 비중이 더 높음", 시사점: "검증 이미지 소재의 영상화 테스트 제안", 점수: 25,
    });
  if (장수보종 && 장수소구)
    인.push({
      분류: "차별화", 제목: `오래 살아남은 경쟁 소재: '${장수보종.v}'·'${장수소구.v}' 조합이 많음`,
      근거: `장수 소재 ${장수.length}건 중 보종 ${장수보종.n}건 · 소구 ${장수소구.n}건`,
      시사점: "효율 검증된 조합으로 추정 → 자사 소재 기획 시 참고", 점수: 22,
    });
  인.sort((a, b) => b.점수 - a.점수);

  // ── 일별 게재(경쟁사) ──
  const 일별 = (시작: string, 일수: number) =>
    Array.from({ length: 일수 }, (_, i) => {
      const d = 더하기(시작, i);
      return 경(전체).filter((r) => r.s <= d && r.e >= d).length;
    });

  const 합 = (xs: 행[]) => xs.length;
  return {
    k, 경쟁사, 보종표, 지도, 지도광고주, 메시지, 소구표, 방식, 운영, 장수, 주목신규, 가격표, 인사이트: 인, 자사주력,
    일별: { 이번: 일별(k.시작, k.일수), 이전: 일별(k.전시작, k.일수) },
    요약: {
      경쟁신규: 합(경(이번신규)), 경쟁전신규: 합(경(이전신규)), 자사신규: 합(자(이번신규)), 자사전신규: 합(자(이전신규)),
      경쟁게재: 합(경(이번게재)), 경쟁전게재: 합(경(이전게재)), 경쟁사수: 경쟁사.length,
      확대: 경쟁사.filter((c) => c.태그 === "확대" || c.태그 === "신규 진입").length,
    },
    증감률, 퍼, 포인트,
  };
}

/** 보종·소구 조합이 겹치지 않는 것을 앞으로. 같은 소재의 변형 두 장이 나란히 나오지 않게. */
function 다른것먼저(xs: 행[]) {
  const 본 = new Set<string>();
  const 앞: 행[] = [], 뒤: 행[] = [];
  for (const r of xs) {
    const 키 = `${r.보종}|${r.소구}`;
    (본.has(키) ? 뒤 : 앞).push(r);
    본.add(키);
  }
  return [...앞, ...뒤];
}

/** 메타 CDN 주소는 만료돼 깨진다(cards.tsx와 같은 기준). GCS로 옮긴 소재만 쓴다. */
function 쓸그림(r: 행) {
  return !!r.image_url && !r.image_url.includes("fbcdn.net");
}

export type 결과 = ReturnType<typeof 분석>;
