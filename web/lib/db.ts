import { neon } from "@neondatabase/serverless";

// Vercel의 Neon 연동이 DATABASE_URL을 넣어준다.
// 로컬에서는 web/.env.local 에 같은 이름으로 넣어두면 된다.
const 접속문자열 = process.env.DATABASE_URL;

if (!접속문자열) {
  throw new Error(
    "DATABASE_URL이 없습니다. Vercel에 Neon을 연결했는지, 로컬이면 web/.env.local을 채웠는지 확인하세요.",
  );
}

export const sql = neon(접속문자열);

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

export function 신규인가(행: Pick<광고, "first_seen_on" | "status">) {
  if (!행.first_seen_on || 행.status === "종료") return false;
  const d = new Date(행.first_seen_on as unknown as string).getTime();
  return Date.now() - d <= 신규_일수 * 86400000;
}

export const 형식이름: Record<string, string> = {
  IMAGE: "이미지", VIDEO: "영상", CAROUSEL: "캐러셀", DCO: "다이내믹", DPA: "카탈로그", MULTI_IMAGES: "다중 이미지",
};

/** 화면에 쓸 광고주 표시명. 그룹이 있으면 그룹명, 없으면 페이지명 자체를 쓴다. */
export function 표시광고주(행: Pick<광고, "advertiser" | "advertiser_group">) {
  return 행.advertiser_group || 행.advertiser;
}
