"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";

/** 소재를 보드에 담거나, 이미 담겨 있으면 뺀다.
 *  같은 소재가 여러 보드에 들어갈 수 있어 (보드명, ad_id) 한 쌍을 한 행으로 둔다. */
export async function 보드_토글(formData: FormData) {
  const 보드명 = String(formData.get("보드명") ?? "").trim();
  const ad_id = String(formData.get("ad_id") ?? "").trim();
  if (!보드명 || !ad_id) return;

  const 있음 = (await sql`
    select 1 from boards where board_name = ${보드명} and ad_id = ${ad_id} limit 1
  `) as unknown as unknown[];

  if (있음.length) {
    await sql`delete from boards where board_name = ${보드명} and ad_id = ${ad_id}`;
  } else {
    await sql`
      insert into boards (board_name, ad_id) values (${보드명}, ${ad_id})
      on conflict do nothing
    `;
  }
  revalidatePath("/boards");
  revalidatePath("/");
}

/** 보드를 통째로 비운다. 보드 자체는 행이 없어지면 사라진다. */
export async function 보드_삭제(formData: FormData) {
  const 보드명 = String(formData.get("보드명") ?? "").trim();
  if (!보드명) return;
  await sql`delete from boards where board_name = ${보드명}`;
  revalidatePath("/boards");
}
