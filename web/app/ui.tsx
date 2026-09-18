import Link from "next/link";

/** 현재 조건에서 키 하나만 바꾼 링크를 만든다. 칩을 누르면 그 값으로 필터가 걸린다. */
export function 조건링크(조건: Record<string, string | undefined>, 키: string, 값: string) {
  const 다음 = { ...조건, [키]: 값 };
  const q = Object.entries(다음)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join("&");
  return q ? `/?${q}` : "/";
}

/** 칩 하나. 선택된 것은 파랑으로 채우고, 나머지는 테두리만 둔다. */
export function 칩({
  라벨,
  개수,
  선택됨,
  href,
}: {
  라벨: string;
  개수?: number;
  선택됨: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[12px] transition ${
        선택됨
          ? "border-[#334fff] bg-[#334fff] font-semibold text-white"
          : "border-[#e4e6eb] bg-white text-[#5c626d] hover:border-[#c3cbe4] hover:text-[#334fff]"
      }`}
    >
      {라벨}
      {개수 !== undefined && 개수 > 0 && (
        <span className={선택됨 ? "text-white/70" : "text-[#a7adb8]"}>{개수}</span>
      )}
    </Link>
  );
}

/** 칩 한 줄. 라벨 + "전체" + 값들. */
export function 칩줄({
  제목,
  키,
  현재값,
  목록,
  조건,
}: {
  제목: string;
  키: string;
  현재값: string;
  목록: { v: string; n: number }[];
  조건: Record<string, string | undefined>;
}) {
  if (!목록.length) return null;
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="w-[64px] shrink-0 pt-2 text-[12px] font-medium text-[#8a8f98]">
        {제목}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <칩 라벨="전체" 선택됨={!현재값} href={조건링크(조건, 키, "")} />
        {목록.map((x) => (
          <칩
            key={x.v}
            라벨={x.v}
            개수={x.n}
            선택됨={현재값 === x.v}
            href={조건링크(조건, 키, x.v)}
          />
        ))}
      </div>
    </div>
  );
}

/** 상단 숫자 카드. REFHUB처럼 큰 숫자로 현황을 먼저 보여준다. */
export function 지표({ 값, 단위, 설명 }: { 값: number | string; 단위?: string; 설명: string }) {
  return (
    <div className="rounded-xl border border-[#e9eaee] bg-white px-5 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="text-[26px] font-bold leading-none tracking-tight">
        {typeof 값 === "number" ? 값.toLocaleString() : 값}
        {단위 && <span className="ml-1 text-[13px] font-medium text-[#8a8f98]">{단위}</span>}
      </div>
      <div className="mt-2 text-[12px] text-[#8a8f98]">{설명}</div>
    </div>
  );
}

/** 분류 태그. 미분류는 붉게 드러내서 채워 넣어야 할 것이 보이게 한다. */
export function 태그({ 값, 강조 }: { 값: string | null; 강조?: boolean }) {
  if (!값)
    return (
      <span className="rounded-full bg-[#fff1f0] px-2 py-0.5 text-[11px] font-medium text-[#c23934]">
        미분류
      </span>
    );
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        강조 ? "bg-[#ebf1fd] text-[#334fff]" : "bg-[#f2f3f5] text-[#5c626d]"
      }`}
    >
      {값}
    </span>
  );
}

/** 브랜드 머리글자 원형 아바타. REFHUB의 브랜드 카드에서 가져온 표현. */
export function 아바타({ 이름 }: { 이름: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ebf1fd] text-[12px] font-bold text-[#334fff]">
      {이름.slice(0, 1)}
    </span>
  );
}

/** 날짜 표시. neon 드라이버가 date 컬럼을 Date 객체로 주기도 하고 문자열로 주기도 해서
    양쪽을 모두 받는다. 값이 없으면 "-". */
export function 날짜(값: unknown) {
  if (!값) return "-";
  if (값 instanceof Date) return 값.toISOString().slice(0, 10);
  return String(값).slice(0, 10);
}
