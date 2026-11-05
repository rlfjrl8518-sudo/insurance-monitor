import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, 광고컬럼, 신규인가, 형식이름, type 광고 } from "@/lib/db";
import { 날짜, 아바타, 지표, 태그 } from "../../ui";

export const dynamic = "force-dynamic";

type 값개수 = { v: string; n: number };
type 수집기록 = {
  advertiser: string;
  status: string;
  shown: number | null;
  collected: number | null;
  coverage: number | null;
  run_at: string | Date;
  message: string | null;
};

const 색상 = ["#334fff", "#5b74ff", "#8496ff", "#a8b6ff", "#18794e", "#2fa06b", "#c23934", "#e0a33a"];

function 비중막대({ 목록 }: { 목록: 값개수[] }) {
  const 합 = Math.max(1, 목록.reduce((s, x) => s + x.n, 0));
  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded bg-[#f2f3f5]">
        {목록.slice(0, 8).map((x, i) => (
          <div key={x.v} title={`${x.v} ${x.n}건`} style={{ width: `${(x.n / 합) * 100}%`, background: 색상[i] }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#5c626d]">
        {목록.slice(0, 8).map((x, i) => (
          <span key={x.v} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: 색상[i] }} />
            {x.v} {Math.round((x.n / 합) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

/** 광고주(그룹) 한 곳의 상세. 지금 돌리는 소재, 주별 신규 투입, 분류 믹스, 랜딩, 수집 상태. */
export default async function 브랜드상세({ params }: { params: Promise<{ group: string }> }) {
  const 그룹 = decodeURIComponent((await params).group);
  const 그룹식 = sql`coalesce(advertiser_group, advertiser) = ${그룹}`;

  const [현황, 게재중, 주별, 소재유형, 보종, 소구, 랜딩, 수집] = (await Promise.all([
    sql`select count(*)::int 전체, count(*) filter (where status <> '종료')::int 게재중,
               count(*) filter (where status <> '종료' and coalesce(started_on, first_seen_on) >= current_date - 7)::int 신규,
               count(*) filter (where status = '종료' and ended_on >= current_date - 7)::int 이번주종료,
               coalesce(percentile_cont(0.5) within group (order by running_days)
                        filter (where status = '종료'), 0)::int 수명중앙,
               bool_or(segment = '자사') 자사, max(category) 업권,
               array_agg(distinct advertiser) 페이지들
        from ads where ${그룹식}`,
    sql`select ${광고컬럼} from ads where ${그룹식} and status <> '종료'
        order by coalesce(started_on, first_seen_on) desc nulls last, running_days desc limit 60`,
    sql`select to_char(date_trunc('week', coalesce(started_on, first_seen_on)), 'MM/DD') v, count(*)::int n
        from ads where ${그룹식} and coalesce(started_on, first_seen_on) >= current_date - interval '12 weeks'
        group by date_trunc('week', coalesce(started_on, first_seen_on)) order by date_trunc('week', coalesce(started_on, first_seen_on))`,
    sql`select creative_type v, count(*)::int n from ads where ${그룹식} and status <> '종료' and creative_type <> '' group by 1 order by 2 desc`,
    sql`select insurance_type v, count(*)::int n from ads where ${그룹식} and status <> '종료' and insurance_type <> '' group by 1 order by 2 desc`,
    sql`select appeal_point v, count(*)::int n from ads where ${그룹식} and status <> '종료' and appeal_point <> '' group by 1 order by 2 desc`,
    sql`select substring(landing_url from '^https?://([^/?#]+)') v, count(*)::int n from ads
        where ${그룹식} and status <> '종료' and landing_url <> '' group by 1 order by 2 desc limit 8`,
    sql`select distinct on (r.advertiser) r.advertiser, r.status, r.shown, r.collected, r.coverage, r.run_at, r.message
        from collection_runs r
        where r.advertiser in (select distinct advertiser from ads where ${그룹식})
        order by r.advertiser, r.run_at desc`,
  ])) as unknown as [
    { 전체: number; 게재중: number; 신규: number; 이번주종료: number; 수명중앙: number; 자사: boolean; 업권: string | null; 페이지들: string[] }[],
    광고[], 값개수[], 값개수[], 값개수[], 값개수[], 값개수[], 수집기록[],
  ];
  const h = 현황[0];
  if (!h || h.전체 === 0) notFound();
  const 최대주 = Math.max(1, ...주별.map((x) => x.n));

  return (
    <div className="px-7 py-6">
      <Link href="/brands" className="text-[12px] text-[#8a8f98] hover:text-[#334fff]">← 브랜드</Link>
      <div className="mt-2 mb-5 flex flex-wrap items-center gap-2">
        <아바타 이름={그룹} />
        <h1 className="text-[20px] font-bold tracking-tight">{그룹}</h1>
        {h.자사 && <span className="rounded-full bg-[#ebf1fd] px-2 py-0.5 text-[11px] font-semibold text-[#334fff]">자사</span>}
        {h.업권 && <span className="rounded-full bg-[#f2f3f5] px-2 py-0.5 text-[11px] text-[#5c626d]">{h.업권}</span>}
        <span className="text-[12px] text-[#a7adb8]">페이지 {h.페이지들.join(", ")}</span>
        <Link href={`/?그룹=${encodeURIComponent(그룹)}&상태=전체`} className="ml-auto rounded-full border border-[#e4e6eb] px-3 py-1 text-[12px] text-[#5c626d] hover:border-[#334fff] hover:text-[#334fff]">
          전체 소재 탐색
        </Link>
        <Link href={`/analysis?tab=crosstab&행=광고주&열=보종&광고주=${encodeURIComponent(그룹)}`} className="rounded-full border border-[#e4e6eb] px-3 py-1 text-[12px] text-[#5c626d] hover:border-[#334fff] hover:text-[#334fff]">
          분석에서 보기
        </Link>
      </div>

      <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <지표 값={h.게재중} 단위="건" 설명="게재 중" />
        <지표 값={h.신규} 단위="건" 설명="최근 7일 새로 시작" />
        <지표 값={h.이번주종료} 단위="건" 설명="최근 7일 종료" />
        <지표 값={h.수명중앙} 단위="일" 설명="종료 소재 수명 중앙값" />
        <지표 값={h.전체} 단위="건" 설명="누적 수집" />
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-[#e9eaee] bg-white p-5">
          <h2 className="mb-3 text-[13px] font-bold">주별 신규 투입 (12주)</h2>
          <div className="flex h-[120px] items-end gap-1.5">
            {주별.map((w) => (
              <div key={w.v} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px] font-semibold text-[#334fff]">{w.n}</span>
                <div className="w-full rounded-t bg-[#334fff]" style={{ height: `${Math.max(4, (w.n / 최대주) * 85)}%` }} />
                <span className="text-[9px] text-[#a7adb8]">{w.v}</span>
              </div>
            ))}
            {주별.length === 0 && <div className="w-full self-center text-center text-[12px] text-[#8a8f98]">기록 없음</div>}
          </div>
        </section>
        <section className="space-y-4 rounded-xl border border-[#e9eaee] bg-white p-5">
          <h2 className="text-[13px] font-bold">게재 중 소재 믹스</h2>
          {[["소재유형", 소재유형], ["보종", 보종], ["소구포인트", 소구]].map(([이름, 목록]) => (
            <div key={이름 as string}>
              <div className="mb-1 text-[11px] font-medium text-[#8a8f98]">{이름 as string}</div>
              <비중막대 목록={목록 as 값개수[]} />
            </div>
          ))}
        </section>
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-[#e9eaee] bg-white p-5">
          <h2 className="mb-2 text-[13px] font-bold">랜딩 도메인 (게재 중)</h2>
          {랜딩.length === 0 && <div className="text-[12px] text-[#8a8f98]">수집 개편 이후 소재부터 채워집니다.</div>}
          {랜딩.map((x) => (
            <div key={x.v} className="flex justify-between border-t border-[#f0f1f4] py-1.5 text-[12px] first:border-0">
              <span>{x.v}</span>
              <span className="text-[#8a8f98]">{x.n}건</span>
            </div>
          ))}
        </section>
        <section className="rounded-xl border border-[#e9eaee] bg-white p-5">
          <h2 className="mb-2 text-[13px] font-bold">수집 상태</h2>
          {수집.length === 0 && <div className="text-[12px] text-[#8a8f98]">아직 기록이 없습니다.</div>}
          {수집.map((r) => (
            <div key={r.advertiser} className="flex items-center gap-2 border-t border-[#f0f1f4] py-1.5 text-[12px] first:border-0">
              <span className="font-medium">{r.advertiser}</span>
              <span className={r.status === "정상" || r.status === "게재없음" ? "text-[#18794e]" : "font-semibold text-[#c23934]"}>{r.status}</span>
              <span className="ml-auto text-[#8a8f98]">
                {r.collected ?? 0}/{r.shown ?? "-"} ({r.coverage !== null ? Math.round(r.coverage * 100) : "-"}%) · {날짜(r.run_at)}
              </span>
            </div>
          ))}
        </section>
      </div>

      <h2 className="mb-3 text-[14px] font-bold">지금 게재 중인 소재 ({게재중.length}{h.게재중 > 게재중.length ? ` / ${h.게재중}` : ""})</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        {게재중.map((행) => (
          <Link key={행.ad_id} href={`/?소재=${행.ad_id}&그룹=${encodeURIComponent(그룹)}`} className="overflow-hidden rounded-xl border border-[#e9eaee] bg-white hover:border-[#c3cbe4]">
            <div className="relative aspect-square bg-[#f2f3f5]">
              {행.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={행.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
              )}
              {신규인가(행) && <span className="absolute left-2 top-2 rounded-full bg-[#18794e] px-2 py-0.5 text-[10px] font-bold text-white">NEW</span>}
              {행.display_format && 행.display_format !== "IMAGE" && (
                <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">
                  {형식이름[행.display_format] ?? 행.display_format}
                </span>
              )}
            </div>
            <div className="p-2.5">
              <div className="mb-1 flex flex-wrap gap-1">
                <태그 값={행.insurance_type} />
                <태그 값={행.appeal_point} />
              </div>
              <div className="text-[11px] text-[#a7adb8]">운영 {행.running_days}일</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
