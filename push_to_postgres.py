"""ads.csv와 수집 상태를 Postgres(Neon)로 적재한다. 웹앱이 이 DB를 읽는다.

- ads: CSV 전체를 upsert하고, CSV에 없는 행은 지운다(CSV가 원본).
- boards: ID가 라이브러리 ID로 바뀐 소재를 data/id_map.json으로 옮긴다.
- label_overrides: 사람이 고친 분류를 AI 값 위에 다시 덮는다.
- ad_sightings: 오늘 게재 중으로 확인된 소재를 하루 한 줄씩 남긴다.
- collection_runs: data/health.json(이번 수집 회차의 광고주별 상태)을 쌓는다.
"""

import csv
import io
import json
import os
import sys

from src.config_loader import 경로_절대화, 설정_불러오기

컬럼_대응 = {
    "ad_id": "ad_id", "광고주": "advertiser", "이미지파일명": "image_filename",
    "이미지URL": "image_url", "광고상세URL": "detail_url", "광고텍스트": "ad_text",
    "요약": "summary", "소재유형": "creative_type", "보종": "insurance_type",
    "소구포인트": "appeal_point", "광고시작일": "started_on", "광고종료일": "ended_on",
    "수집일": "collected_on", "최초발견일": "first_seen_on", "상태": "status",
    "페이지ID": "page_id", "영상URL": "video_url", "제목": "title", "CTA": "cta",
    "랜딩URL": "landing_url", "게재형식": "display_format", "플랫폼": "platforms",
    "묶음ID": "collation_id",
}
숫자_컬럼 = {"운영일수": "running_days", "변형수": "variant_count", "미확인횟수": "miss_count"}
# 위에 없는 값(확장 축·추출 항목)은 labels(jsonb)로 간다.
고정_컬럼 = set(컬럼_대응) | set(숫자_컬럼) | {"구분", "확신도"}


def 행_변환(행, 분류):
    레코드 = {db: ((행.get(csv_) or "").strip() or None) for csv_, db in 컬럼_대응.items()}
    for csv_, db in 숫자_컬럼.items():
        try:
            레코드[db] = int(행.get(csv_) or 0)
        except ValueError:
            레코드[db] = 0
    try:
        레코드["confidence"] = float(행["확신도"]) if 행.get("확신도") else None
    except ValueError:
        레코드["confidence"] = None
    그룹, 업권, 자사 = 분류((행.get("광고주") or "").strip())
    레코드.update(advertiser_group=그룹, category=업권, segment="자사" if 자사 else "경쟁사")
    레코드["labels"] = json.dumps(
        {k: v for k, v in 행.items() if k not in 고정_컬럼 and (v or "").strip()}, ensure_ascii=False)
    return 레코드


def 광고주그룹_읽기(설정):
    """구글시트 "광고주그룹" 탭에서 {그룹명: [페이지명...]}을 만든다. 읽지 못하면 None."""
    서비스계정_경로 = 경로_절대화(설정["google_sheets"]["service_account_file"])
    if "여기에_" in 설정["google_sheets"]["spreadsheet_id"] or not os.path.exists(서비스계정_경로):
        return None
    try:
        from src.sheets_sync import 구글_인증
        값 = (구글_인증(서비스계정_경로)
             .open_by_key(설정["google_sheets"]["spreadsheet_id"])
             .worksheet("광고주그룹").get_all_values())
    except Exception as e:
        print(f"광고주그룹 시트를 읽지 못해 기본 묶음만 씁니다: {e}")
        return None
    if not 값:
        return None
    return {그룹명.strip(): [str(행[열]).strip() for 행 in 값[1:] if 열 < len(행) and str(행[열]).strip()]
            for 열, 그룹명 in enumerate(값[0]) if 그룹명.strip()}


def _JSON(경로, 기본):
    try:
        with io.open(경로, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return 기본


def 실행():
    접속 = os.environ.get("DATABASE_URL")
    if not 접속:
        print("DATABASE_URL이 없습니다. Vercel Neon 연동 후 Secret으로 등록해주세요.")
        return 1
    import psycopg

    from src.settings_store import 광고주_분류, 설정_읽기
    from src.sheets_sync import 설정_동적_적용

    설정 = 설정_불러오기()
    설정 = 설정_동적_적용(설정, 경로_절대화(설정["google_sheets"]["service_account_file"]))
    웹설정 = 설정_읽기()
    분류 = 광고주_분류(설정, 웹설정, None if 웹설정.get("advertiser_groups") else 광고주그룹_읽기(설정))

    with io.open(경로_절대화(설정["paths"]["csv_file"]), encoding="utf-8-sig") as f:
        행들 = [행_변환(r, 분류) for r in csv.DictReader(f)]
    if not 행들:
        print("CSV가 비어 있어 적재를 건너뜁니다.")
        return 0
    id_map = _JSON(경로_절대화("data/id_map.json"), {})
    건강 = _JSON(경로_절대화(설정["paths"].get("health_file", "data/health.json")), [])

    열 = list(행들[0].keys())
    upsert = (f"insert into ads ({', '.join(열)}) values ({', '.join(f'%({c})s' for c in 열)}) "
              f"on conflict (ad_id) do update set "
              + ", ".join(f"{c} = excluded.{c}" for c in 열 if c != "ad_id") + ", updated_at = now()")

    with psycopg.connect(접속) as 연결, 연결.cursor() as 커서:
        커서.execute(io.open(경로_절대화("web/db/schema.sql"), encoding="utf-8").read())
        커서.executemany(upsert, 행들)

        # 보드를 새 ID로 옮긴 뒤, CSV에 없는 옛 행을 지운다(보드가 cascade로 날아가지 않게 순서 중요).
        if id_map:
            커서.executemany(
                "insert into boards (board_name, ad_id, created_at) "
                "select board_name, %(new)s, created_at from boards where ad_id = %(old)s "
                "on conflict do nothing",
                [{"old": o, "new": n} for o, n in id_map.items()])
        커서.execute("delete from ads where not (ad_id = any(%s))", ([r["ad_id"] for r in 행들],))
        지움 = 커서.rowcount

        # 사람이 고친 분류는 AI 값보다 우선한다.
        for 축 in ("creative_type", "insurance_type", "appeal_point"):
            커서.execute(f"update ads a set {축} = o.value from label_overrides o "
                       f"where o.ad_id = a.ad_id and o.axis = %s", (축,))

        커서.execute("insert into ad_sightings (ad_id, seen_on) "
                   "select ad_id, collected_on from ads where status = '게재중' and collected_on is not null "
                   "on conflict do nothing")

        if 건강:
            커서.executemany(
                "insert into collection_runs (run_at, advertiser, page_id, status, shown, collected, coverage, "
                "new_count, ended_count, message, candidates) values (%(run_at)s, %(광고주)s, %(page_id)s, "
                "%(상태)s, %(표시건수)s, %(수집건수)s, %(수집률)s, %(신규)s, %(종료)s, %(메시지)s, %(후보)s) "
                "on conflict do nothing", 건강)
        연결.commit()

    print(f"적재 완료: {len(행들):,}건 (지운 옛 행 {지움}건, 수집 상태 {len(건강)}곳)")
    return 0


if __name__ == "__main__":
    sys.exit(실행())
