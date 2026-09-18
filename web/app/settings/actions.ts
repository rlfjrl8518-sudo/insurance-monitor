"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";

/** 여러 줄 입력을 목록으로 바꾼다. 빈 줄과 앞뒤 공백은 버린다. */
function 줄목록(값: FormDataEntryValue | null): string[] {
  return String(값 ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function 저장(키: string, 값: unknown) {
  await sql`
    insert into settings (key, value, updated_at)
    values (${키}, ${JSON.stringify(값)}::jsonb, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
  revalidatePath("/settings");
}

/** 카테고리별 수집 대상 광고주.
 *
 *  한 줄에 한 광고주. 메타 페이지명이 검색어와 다르면 "검색어>실제페이지명"으로 적는다.
 *  (AIA생명이 그랬다. "AIA생명"으로 검색해야 광고가 나오는데 페이지명은 "AIA"다.) */
export async function 광고주_저장(formData: FormData) {
  const 카테고리: Record<string, string[]> = {};
  for (const [이름, 값] of formData.entries()) {
    if (!이름.startsWith("cat:")) continue;
    카테고리[이름.slice(4)] = 줄목록(값);
  }
  const 추가이름 = String(formData.get("새카테고리") ?? "").trim();
  if (추가이름 && !(추가이름 in 카테고리)) 카테고리[추가이름] = [];
  await 저장("advertiser_categories", 카테고리);
}

/** 분류 축별 선택지 목록 (소재유형 / 보종 / 소구포인트). */
export async function 분류값_저장(formData: FormData) {
  await 저장("classification", {
    소재유형: 줄목록(formData.get("소재유형")),
    보종: 줄목록(formData.get("보종")),
    소구포인트: 줄목록(formData.get("소구포인트")),
  });
}

/** 축별 판단 기준 텍스트. 그대로 분류 프롬프트에 들어간다. */
export async function 분류규칙_저장(formData: FormData) {
  const 규칙: Record<string, string> = {};
  for (const [이름, 값] of formData.entries()) {
    if (!이름.startsWith("rule:")) continue;
    const 본문 = String(값).trim();
    if (본문) 규칙[이름.slice(5)] = 본문;
  }
  await 저장("classification_rules", 규칙);
}

/** NVIDIA 모델명. API 키는 여기서 다루지 않는다 — 키는 GitHub Secrets에만 둔다. */
export async function 모델_저장(formData: FormData) {
  await 저장("nvidia_models", {
    model: String(formData.get("model") ?? "").trim(),
    vision_model: String(formData.get("vision_model") ?? "").trim(),
  });
}
