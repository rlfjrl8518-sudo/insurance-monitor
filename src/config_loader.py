"""설정 파일(config.json)을 읽어오는 모듈.

config.json에는 민감 정보(API 키, 시트/드라이브 ID 등)를 깃에 올리지 않기 위해
플레이스홀더("여기에_..._입력")만 남겨두고, 실제 값은 다음 두 가지 방법으로 주입한다.
- 로컬 개발: 프로젝트 루트의 .env 파일 (git에 커밋되지 않음)
- GitHub Actions: 저장소 Secrets로 등록한 환경 변수

환경 변수(.env 포함)가 있으면 config.json 값보다 우선 적용한다.
"""

import json
import os

# config.json 기본 경로 (이 파일 기준 상위 폴더)
기본_설정_경로 = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config.json")


def _BOM_제거(값):
    """GitHub Secrets 등록 과정 등에서 값 앞에 섞여 들어올 수 있는 BOM(﻿) 문자를 제거한다."""
    return 값.replace("﻿", "").strip()


def _env_파일_불러오기(프로젝트_루트):
    """.env 파일이 있으면 KEY=VALUE 줄을 읽어 환경 변수로 설정한다 (이미 설정된 값은 덮어쓰지 않음)."""
    env_경로 = os.path.join(프로젝트_루트, ".env")
    if not os.path.exists(env_경로):
        return

    with open(env_경로, "r", encoding="utf-8-sig") as f:
        for 줄 in f:
            줄 = 줄.strip()
            if not 줄 or 줄.startswith("#") or "=" not in 줄:
                continue
            키, 값 = 줄.split("=", 1)
            os.environ.setdefault(키.strip(), _BOM_제거(값))


def 설정_불러오기(설정_경로=기본_설정_경로):
    """config.json을 읽고, .env/환경 변수로 민감 정보를 덮어쓴 뒤 설정 딕셔너리를 반환한다."""
    _env_파일_불러오기(os.path.dirname(os.path.abspath(설정_경로)))

    with open(설정_경로, "r", encoding="utf-8") as f:
        설정 = json.load(f)

    # Gemini API 키: 환경 변수(GEMINI_API_KEY)가 있으면 우선 사용
    gemini_키 = os.environ.get("GEMINI_API_KEY")
    if gemini_키:
        설정["gemini"]["api_key"] = _BOM_제거(gemini_키)

    # 구글 시트/드라이브 ID: 환경 변수가 있으면 우선 사용
    시트_id = os.environ.get("GOOGLE_SHEETS_ID")
    if 시트_id:
        설정["google_sheets"]["spreadsheet_id"] = _BOM_제거(시트_id)

    드라이브_폴더_id = os.environ.get("GOOGLE_DRIVE_FOLDER_ID")
    if 드라이브_폴더_id:
        설정["google_sheets"]["drive_folder_id"] = _BOM_제거(드라이브_폴더_id)

    업로드_웹앱_url = os.environ.get("DRIVE_UPLOAD_WEBAPP_URL")
    if 업로드_웹앱_url:
        설정["google_sheets"]["drive_upload_webapp_url"] = _BOM_제거(업로드_웹앱_url)

    업로드_비밀키 = os.environ.get("DRIVE_UPLOAD_SECRET")
    if 업로드_비밀키:
        설정["google_sheets"]["drive_upload_secret"] = _BOM_제거(업로드_비밀키)

    # 구글 서비스 계정 JSON: 환경 변수에 JSON 전체 내용이 들어있으면 파일로 저장
    서비스계정_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if 서비스계정_json:
        프로젝트_루트 = os.path.dirname(설정_경로)
        서비스계정_경로 = os.path.join(프로젝트_루트, 설정["google_sheets"]["service_account_file"])
        with open(서비스계정_경로, "w", encoding="utf-8") as f:
            f.write(서비스계정_json)

    return 설정


def 경로_절대화(상대경로, 설정_경로=기본_설정_경로):
    """config.json의 상대 경로(data/ads.csv 등)를 프로젝트 루트 기준 절대 경로로 변환한다."""
    프로젝트_루트 = os.path.dirname(os.path.abspath(설정_경로))
    return os.path.join(프로젝트_루트, 상대경로)
