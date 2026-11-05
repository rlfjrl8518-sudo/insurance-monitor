import { Pool, types } from "pg";

// Cloud Run에서는 Cloud SQL 유닉스 소켓으로 붙는다:
//   postgresql://사용자:비밀번호@/monitor?host=/cloudsql/insurance-monitor-playd:asia-northeast3:monitor-db
// 로컬에서는 web/.env.local 에 DATABASE_URL을 넣고 Cloud SQL Auth Proxy로 붙는다.

// date 컬럼을 Date로 바꾸면 서버 시간대 기준 자정이 돼 UTC로 찍을 때 하루가 밀린다. 문자열 그대로 받는다.
types.setTypeParser(1082, (v) => v);

let 풀: Pool | null = null;
function 연결() {
  if (!풀) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL이 없습니다.");
    풀 = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  }
  return 풀;
}

/** 원문 SQL 조각(컬럼명·정렬식처럼 값이 아니라 구문인 것). 사용자 입력을 넣지 말 것. */
class 원문 {
  constructor(readonly 글: string) {}
}

/** sql`...` 한 덩어리. 다른 조각 안에 끼워 넣을 수도 있고, await 하면 실행된다.
 *  예전 Neon 드라이버와 같은 쓰임새(중첩 조각, sql.unsafe)를 유지해서 화면 코드는 그대로 둔다. */
class 조각 implements PromiseLike<Record<string, unknown>[]> {
  constructor(
    readonly 글들: readonly string[],
    readonly 값들: readonly unknown[],
  ) {}

  펼치기(값목록: unknown[]): string {
    let 결과 = this.글들[0];
    this.값들.forEach((v, i) => {
      if (v instanceof 조각) 결과 += v.펼치기(값목록);
      else if (v instanceof 원문) 결과 += v.글;
      else {
        값목록.push(v);
        결과 += `$${값목록.length}`;
      }
      결과 += this.글들[i + 1];
    });
    return 결과;
  }

  then<A = Record<string, unknown>[], B = never>(
    성공?: ((v: Record<string, unknown>[]) => A | PromiseLike<A>) | null,
    실패?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    const 값목록: unknown[] = [];
    const 글 = this.펼치기(값목록);
    return 연결()
      .query(글, 값목록)
      .then((r) => r.rows)
      .then(성공, 실패);
  }
}

function sqlFn(글들: TemplateStringsArray, ...값들: unknown[]) {
  return new 조각(글들, 값들);
}
export const sql = Object.assign(sqlFn, { unsafe: (글: string) => new 원문(글) });

/** 분류 축 이름. 컬럼으로 둔 세 축과 labels(jsonb)에 들어가는 확장 축을 구분한다. */
export const 고정축 = ["소재유형", "보종", "소구포인트"] as const;

export type 광고 = {
  ad_id: string;
  advertiser: string;
  advertiser_group: string | null;
  segment: string | null;
  image_url: string | null;
  detail_url: string | null;
  ad_text: string | null;
  summary: string | null;
  creative_type: string | null;
  insurance_type: string | null;
  appeal_point: string | null;
  labels: Record<string, string>;
  started_on: string | null;
  ended_on: string | null;
  first_seen_on: string | null;
  status: string | null;          // 게재중 / 종료
  running_days: number;
  category: string | null;        // 업권
  confidence: number | null;      // 분류 확신도 0~1
  title: string | null;
  cta: string | null;
  landing_url: string | null;
  display_format: string | null;
  platforms: string | null;
  variant_count: number | null;
  collation_id: string | null;
};

/** 화면 목록·상세에서 쓰는 컬럼. 쿼리마다 다시 적지 않게 한 곳에 둔다. */
export const 광고컬럼 = sql.unsafe(`ad_id, advertiser, advertiser_group, segment, image_url, detail_url,
  ad_text, summary, creative_type, insurance_type, appeal_point, labels, started_on, ended_on,
  first_seen_on, status, running_days, category, confidence, title, cta, landing_url,
  display_format, platforms, variant_count, collation_id`);

/** '신규'는 상태가 아니라 표시다. 최근 이 일수 안에 처음 발견된 게재중 소재. */
export const 신규_일수 = 7;

/** NEW = 광고 시작일(메타 기준)이 최근 며칠 안. 예전엔 '처음 발견일'이라 수집 방식을 바꾼 날
 *  몇 달 된 소재 120건이 한꺼번에 NEW가 됐다(2026-11-05). 시작일이 없을 때만 발견일을 쓴다. */
export function 신규인가(행: Pick<광고, "first_seen_on" | "started_on" | "status">) {
  const 기준 = 행.started_on || 행.first_seen_on;
  if (!기준 || 행.status === "종료") return false;
  const d = new Date(기준 as unknown as string).getTime();
  return Date.now() - d <= 신규_일수 * 86400000;
}

export const 형식이름: Record<string, string> = {
  IMAGE: "이미지", VIDEO: "영상", CAROUSEL: "캐러셀", DCO: "다이내믹", DPA: "카탈로그", MULTI_IMAGES: "다중 이미지",
};

/** 화면에 쓸 광고주 표시명. 그룹이 있으면 그룹명, 없으면 페이지명 자체를 쓴다. */
export function 표시광고주(행: Pick<광고, "advertiser" | "advertiser_group">) {
  return 행.advertiser_group || 행.advertiser;
}
