"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";

const 축컬럼 = { 소재유형: "creative_type", 보종: "insurance_type", 소구포인트: "appeal_point" } as const;

/** 사람이 분류를 고친다. ads를 바로 고치고 label_overrides에도 남긴다.
 *
 *  label_overrides는 두 가지로 쓰인다. 다음 적재(push_to_postgres)가 AI 값으로 덮어쓰지 않게
 *  다시 덮는 근거이고, eval_labels.py가 AI 정확도를 재는 정답지다. ai_value는 처음 고칠 때의
 *  AI 값만 남긴다(두 번 고쳐도 비교 대상은 AI가 낸 원래 값이어야 한다). */
export async function 라벨_수정(formData: FormData) {
  const ad_id = String(formData.get("ad_id") ?? "").trim();
  if (!ad_id) return;
  for (const [이름, 컬럼] of Object.entries(축컬럼)) {
    const 값 = String(formData.get(이름) ?? "").trim();
    if (!값) continue;
    const 현재 = (await sql`select ${sql.unsafe(컬럼)} v from ads where ad_id = ${ad_id}`) as unknown as { v: string | null }[];
    if (!현재.length || 현재[0].v === 값) continue;
    await sql`
      insert into label_overrides (ad_id, axis, value, ai_value)
      values (${ad_id}, ${컬럼}, ${값}, ${현재[0].v})
      on conflict (ad_id, axis) do update set value = excluded.value, updated_at = now()
    `;
    await sql`update ads set ${sql.unsafe(컬럼)} = ${값}, confidence = 1 where ad_id = ${ad_id}`;
  }
  revalidatePath("/", "layout");
}
