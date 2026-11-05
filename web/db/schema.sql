-- 광고 소재 모니터링 스키마. push_to_postgres.py가 매 적재 전에 실행한다(여러 번 돌려도 안전).
--
-- 원본은 아직 data/ads.csv(Actions가 커밋)이고, 이 DB는 웹앱이 읽는 사본이다.
-- 웹에서만 생기는 데이터(보드, 수동 라벨 수정, 설정)는 여기에만 있다.

create extension if not exists pg_trgm;

create table if not exists ads (
  ad_id           text primary key,       -- 메타 라이브러리 ID
  advertiser      text not null,          -- 광고주(저장명)
  advertiser_group text,                  -- 같은 회사의 여러 페이지를 묶는 이름
  segment         text,                   -- 자사 / 경쟁사
  image_filename  text,
  image_url       text,
  detail_url      text,
  ad_text         text,
  summary         text,
  creative_type   text,                   -- 소재유형
  insurance_type  text,                   -- 보종
  appeal_point    text,                   -- 소구포인트
  labels          jsonb not null default '{}'::jsonb,   -- 확장 축·추출 항목
  started_on      date,
  ended_on        date,
  collected_on    date,                   -- 마지막으로 확인된 날
  first_seen_on   date,
  status          text,                   -- 게재중 / 종료
  running_days    integer default 0,
  updated_at      timestamptz not null default now()
);

alter table ads add column if not exists category      text;     -- 업권 (손해보험/생명보험/GA 등)
alter table ads add column if not exists page_id       text;
alter table ads add column if not exists video_url     text;
alter table ads add column if not exists confidence    real;     -- 분류 확신도 0~1
alter table ads add column if not exists title         text;
alter table ads add column if not exists cta           text;
alter table ads add column if not exists landing_url   text;
alter table ads add column if not exists display_format text;    -- IMAGE / VIDEO / DCO / CAROUSEL ...
alter table ads add column if not exists platforms     text;     -- FACEBOOK,INSTAGRAM,...
alter table ads add column if not exists variant_count integer default 1;
alter table ads add column if not exists collation_id  text;
alter table ads add column if not exists miss_count    integer default 0;

create index if not exists ads_advertiser_idx on ads (advertiser);
create index if not exists ads_group_idx      on ads (advertiser_group);
create index if not exists ads_category_idx   on ads (category);
create index if not exists ads_status_idx     on ads (status);
create index if not exists ads_started_idx    on ads (started_on desc);
create index if not exists ads_first_seen_idx on ads (first_seen_on desc);
create index if not exists ads_creative_idx   on ads (creative_type);
create index if not exists ads_insurance_idx  on ads (insurance_type);
create index if not exists ads_appeal_idx     on ads (appeal_point);
create index if not exists ads_labels_idx     on ads using gin (labels);
drop index if exists ads_text_idx;
-- 한국어는 형태소 분석기가 없어 부분 문자열 검색(ilike)을 trigram으로 받친다.
create index if not exists ads_text_trgm_idx  on ads using gin ((coalesce(ad_text, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(title, '')) gin_trgm_ops);

-- 하루 단위 게재 기록. 실제 게재 기간과 '그날 몇 건이 돌고 있었나' 추이를 여기서 계산한다.
create table if not exists ad_sightings (
  ad_id    text not null,
  seen_on  date not null,
  primary key (ad_id, seen_on)
);
create index if not exists ad_sightings_day_idx on ad_sightings (seen_on);

-- 수집 회차별 광고주 상태. 수집률이 떨어지거나 페이지를 못 찾으면 설정 화면에서 바로 보인다.
create table if not exists collection_runs (
  run_at       timestamptz not null,
  advertiser   text not null,
  page_id      text,
  status       text not null,            -- 정상 / 게재없음 / 페이지없음 / 읽기실패
  shown        integer,                  -- 라이브러리가 말하는 게재 건수
  collected    integer,
  coverage     real,
  new_count    integer,
  ended_count  integer,
  message      text,
  candidates   text[],
  primary key (run_at, advertiser)
);

-- 사람이 고친 분류. 적재 때마다 AI 값 위에 다시 덮고, 분류 정확도 측정의 정답으로도 쓴다.
create table if not exists label_overrides (
  ad_id       text not null,
  axis        text not null,              -- creative_type / insurance_type / appeal_point
  value       text not null,
  ai_value    text,                       -- 고칠 당시 AI가 낸 값
  updated_at  timestamptz not null default now(),
  primary key (ad_id, axis)
);

-- 광고주(페이지) → 그룹 매핑. (구 구조, 지금은 settings.advertiser_groups를 쓴다)
create table if not exists advertiser_groups (
  advertiser  text primary key,
  group_name  text not null,
  category    text,
  is_own      boolean not null default false
);

-- 보드(스크랩). 한 소재가 여러 보드에 들어갈 수 있다.
create table if not exists boards (
  board_name  text not null,
  ad_id       text not null references ads(ad_id) on delete cascade on update cascade,
  created_at  timestamptz not null default now(),
  primary key (board_name, ad_id)
);
create index if not exists boards_ad_idx on boards (ad_id);

-- 설정. 쓰는 키: advertiser_categories, advertiser_groups, classification, classification_rules, ai_model
create table if not exists settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
