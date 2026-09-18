-- 광고 소재 모니터링 스키마
--
-- 지금은 구글시트/CSV에 쌓고 있는데, 분류 축을 늘리고 연관규칙·교차분석 같은 걸
-- 하려면 계산을 감당할 저장소가 필요해서 Postgres로 옮긴다. 데이터 자체는 작다
-- (1,700건 남짓, 2MB). 크기가 아니라 질의 능력 때문에 옮기는 것이다.

create table if not exists ads (
  ad_id           text primary key,
  advertiser      text not null,          -- 광고주(메타 페이지명) - 수집 시점 원본
  advertiser_group text,                  -- 같은 회사의 여러 페이지를 묶는 이름
  segment         text,                   -- 자사 / 경쟁사

  image_filename  text,
  image_url       text,
  detail_url      text,
  ad_text         text,
  summary         text,

  -- 분류 축.
  -- 지금 쓰는 세 축은 필터·집계에 늘 쓰이므로 컬럼으로 둔다.
  creative_type   text,                   -- 소재유형 (비갱신/특약/브랜딩/기타)
  insurance_type  text,                   -- 보종
  appeal_point    text,                   -- 소구포인트

  -- 앞으로 늘어날 축(레이아웃, 비주얼스타일, 제작방식, 텍스트밀도, 오퍼, 긴급성 등)은
  -- 여기에 담는다. 축을 추가할 때마다 마이그레이션을 하지 않기 위해서다.
  -- 연관규칙·교차분석은 이 jsonb를 펼쳐서 계산한다.
  labels          jsonb not null default '{}'::jsonb,

  started_on      date,
  ended_on        date,
  collected_on    date,
  first_seen_on   date,
  status          text,                   -- 신규 / 운영중 / 종료
  running_days    integer default 0,

  updated_at      timestamptz not null default now()
);

create index if not exists ads_advertiser_idx    on ads (advertiser);
create index if not exists ads_group_idx         on ads (advertiser_group);
create index if not exists ads_status_idx        on ads (status);
create index if not exists ads_started_idx       on ads (started_on desc);
create index if not exists ads_creative_idx      on ads (creative_type);
create index if not exists ads_insurance_idx     on ads (insurance_type);
create index if not exists ads_appeal_idx        on ads (appeal_point);
-- jsonb 안의 축으로도 걸러낼 수 있어야 한다 (labels @> '{"레이아웃":"인물 중앙"}')
create index if not exists ads_labels_idx        on ads using gin (labels);
-- 광고 텍스트 검색. 한국어는 형태소 분석이 없어 simple로 두고, 부족하면 trigram을 얹는다.
create index if not exists ads_text_idx          on ads using gin (to_tsvector('simple', coalesce(ad_text, '')));

-- 광고주(페이지) → 그룹 매핑. 구글시트 "광고주그룹" 탭이 하던 역할.
create table if not exists advertiser_groups (
  advertiser  text primary key,
  group_name  text not null,
  category    text,                       -- 손해보험 / 생명보험 / GA 등
  is_own      boolean not null default false
);

-- 보드(스크랩). 한 소재가 여러 보드에 들어갈 수 있다.
create table if not exists boards (
  board_name  text not null,
  ad_id       text not null references ads(ad_id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (board_name, ad_id)
);

create index if not exists boards_ad_idx on boards (ad_id);

-- 수집·분류 설정. 구글시트 "설정"/"분류규칙"/"AI설정" 탭이 하던 역할을 웹 대시보드로
-- 옮기기 위한 자리다. 키 하나에 값 한 덩어리(jsonb)를 넣고, 파이프라인은 여기 있는
-- 키만 시트 값 위에 덮어쓴다. 비어 있으면 종전대로 시트를 그대로 쓴다.
-- 쓰는 키: advertiser_categories, classification, classification_rules, nvidia_models
create table if not exists settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
