"""ads.csv를 Postgres(Neon)로 적재한다.

수집·분류 파이프라인은 그대로 두고, 결과만 웹앱이 읽을 DB에 넣는다.
구글시트 동기화(push_csv_to_sheet.py)와 나란히 돌린다 - 새 웹앱이 자리를 잡을 때까지
기존 대시보드도 계속 쓰기 때문이다.

DATABASE_URL 환경변수(또는 .env)가 필요하다. Vercel의 Neon 연동이 만들어주는 값을
저장소 Secret으로 등록해두면 GitHub Actions에서도 그대로 쓸 수 있다.
"""

import csv
import io
import json
import os
import sys

from src.config_loader import 경로_절대화, 설정_불러오기

# CSV 컬럼 -> DB 컬럼
컬럼_대응 = {
    "ad_id": "ad_id",
    "광고주": "advertiser",
    "구분": "segment",
    "이미지파일명": "image_filename",
    "이미지URL": "image_url",
    "광고상세URL": "detail_url",
    "광고텍스트": "ad_text",
    "요약": "summary",
    "소재유형": "creative_type",
    "보종": "insurance_type",
    "소구포인트": "appeal_point",
    "광고시작일": "started_on",
    "광고종료일": "ended_on",
    "수집일": "collected_on",
    "최초발견일": "first_seen_on",
    "상태": "status",
}

# 위 대응에 없는 분류 축은 labels(jsonb)로 넣는다.
# 라벨 축을 늘릴 때 이 파일을 고치지 않아도 되도록 하기 위함이다.
고정_컬럼 = set(컬럼_대응) | {"운영일수"}


def _날짜(값):
    """빈 문자열은 NULL로. 날짜 형식이 아니면 그대로 두고 DB가 거르게 한다."""
    값 = (값 or "").strip()
    return 값 or None


def 행_변환(행):
    레코드 = {db: _날짜(행.get(csv_, "")) if db.endswith("_on") else (행.get(csv_) or None)
            for csv_, db in 컬럼_대응.items()}
    try:
        레코드["running_days"] = int(행.get("운영일수") or 0)
    except ValueError:
        레코드["running_days"] = 0

    # 확장 축: 값이 있는 것만 담는다. 빈 값을 넣으면 집계할 때 걸러내야 해서 번거롭다.
    확장 = {k: v for k, v in 행.items() if k not in 고정_컬럼 and (v or "").strip()}
    레코드["labels"] = json.dumps(확장, ensure_ascii=False)
    return 레코드


def 광고주그룹_읽기(설정):
    """구글시트 "광고주그룹" 탭에서 {광고주(페이지명): 그룹명}을 만든다.

    헤더가 그룹명, 그 아래 셀이 묶을 페이지명이다 (Apps Script 대시보드 설정 화면이 쓰는 형식).
    대시보드와 똑같이 페이지명 완전일치로 묶는다. 읽지 못하면 None.
    """
    서비스계정_경로 = 경로_절대화(설정["google_sheets"]["service_account_file"])
    if "여기에_" in 설정["google_sheets"]["spreadsheet_id"] or not os.path.exists(서비스계정_경로):
        return None
    try:
        from src.sheets_sync import 구글_인증
        값 = (구글_인증(서비스계정_경로)
             .open_by_key(설정["google_sheets"]["spreadsheet_id"])
             .worksheet("광고주그룹").get_all_values())
    except Exception as e:
        print(f"광고주그룹 시트를 읽지 못해 그룹명은 그대로 둡니다: {e}")
        return None
    if not 값:
        return None
    return {
        str(행[열]).strip(): 그룹명.strip()
        for 열, 그룹명 in enumerate(값[0]) if 그룹명.strip()
        for 행 in 값[1:] if 열 < len(행) and str(행[열]).strip()
    }


def 실행():
    접속 = os.environ.get("DATABASE_URL")
    if not 접속:
        print("DATABASE_URL이 없습니다. Vercel Neon 연동 후 Secret으로 등록해주세요.")
        return 1

    try:
        import psycopg
    except ImportError:
        print("psycopg가 필요합니다: pip install 'psycopg[binary]'")
        return 1

    설정 = 설정_불러오기()
    csv_경로 = 경로_절대화(설정["paths"]["csv_file"])
    with io.open(csv_경로, encoding="utf-8-sig") as f:
        행들 = [행_변환(r) for r in csv.DictReader(f)]

    if not 행들:
        print("CSV가 비어 있어 적재를 건너뜁니다.")
        return 0

    # 같은 회사의 여러 페이지(채널)를 그룹명 하나로 묶는다. 웹은 coalesce(advertiser_group, advertiser)로 보여준다.
    # 웹 설정 화면에서 저장한 그룹이 있으면 그게 전부다 ("웹이 이긴다", 그룹 삭제도 반영되게 통째로 쓴다).
    # 없으면 config.json "advertiser_groups" 기본 묶음 위에 시트 "광고주그룹" 탭을 덮는다.
    # ponytail: 시트 읽기가 실패한 회차엔 기본 묶음만 반영된다. 웹 설정으로 옮기면 사라지는 문제.
    from src.settings_store import 설정_읽기
    def 펼침(묶음):
        return {페이지: 그룹명 for 그룹명, 페이지들 in 묶음.items() for 페이지 in 페이지들}

    웹그룹 = 설정_읽기().get("advertiser_groups")
    if 웹그룹:
        그룹 = 펼침(웹그룹)
    else:
        그룹 = {**펼침(설정.get("advertiser_groups", {})), **(광고주그룹_읽기(설정) or {})}
    for r in 행들:
        r["advertiser_group"] = 그룹.get((r["advertiser"] or "").strip())
    print(f"광고주그룹 {len(set(그룹.values()))}개 반영 (페이지 {len(그룹)}개)")

    열 = list(행들[0].keys())
    자리 = ", ".join(f"%({c})s" for c in 열)
    갱신 = ", ".join(f"{c} = excluded.{c}" for c in 열 if c != "ad_id")
    쿼리 = (
        f"insert into ads ({', '.join(열)}) values ({자리}) "
        f"on conflict (ad_id) do update set {갱신}, updated_at = now()"
    )

    with psycopg.connect(접속) as 연결:
        with 연결.cursor() as 커서:
            # 스키마가 아직 없으면 만들어 둔다 (첫 실행 대비).
            스키마 = 경로_절대화("web/db/schema.sql")
            if os.path.exists(스키마):
                커서.execute(io.open(스키마, encoding="utf-8").read())
            커서.executemany(쿼리, 행들)
        연결.commit()

    print(f"적재 완료: {len(행들):,}건")
    return 0


if __name__ == "__main__":
    sys.exit(실행())
