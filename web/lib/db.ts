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
  status: string | null;
  running_days: number;
};

/** 화면에 쓸 광고주 표시명. 그룹이 있으면 그룹명, 없으면 페이지명 자체를 쓴다. */
export function 표시광고주(행: Pick<광고, "advertiser" | "advertiser_group">) {
  return 행.advertiser_group || 행.advertiser;
}
