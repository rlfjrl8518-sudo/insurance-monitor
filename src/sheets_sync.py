"""수집한 광고 데이터를 Google Sheets에 동기화하는 모듈.

- 신규 광고: 이미지를 Apps Script 업로드 웹앱을 통해 구글 드라이브에 저장한 뒤 시트에 새 행 추가
- 기존 광고: 수집일/상태/운영일수/종료일 등 자동 갱신 컬럼만 업데이트
  (소재유형/보종/후킹/요약은 대시보드에서 수동 편집하는 값이므로 덮어쓰지 않음)

서비스 계정은 자체 드라이브 저장 용량이 0이라 파일을 직접 생성할 수 없으므로,
이미지 업로드는 사용자 계정으로 배포한 Apps Script 웹앱(apps_script/이미지업로드.gs)에
base64로 전송하여 처리한다.
"""

import base64
import json
import os
import urllib.request

import gspread
from google.oauth2.service_account import Credentials

from src.config_loader import 광고주_목록_생성
from src.csv_store import KST, CSV_쓰기, CSV_읽기
from src.text_utils import 외국어_소재인가

from datetime import datetime

# 구글 시트 API 접근 권한 범위
인증_범위 = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# 이미지 확장자별 MIME 타입
확장자별_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

# 구글 시트 컬럼 순서
시트_컬럼 = [
    "ad_id", "광고주", "구분", "수집일", "최초발견일", "이미지URL",
    "소재유형", "보종", "후킹", "요약", "광고텍스트",
    "광고시작일", "광고종료일", "광고상세URL", "상태", "운영일수",
]

# 기존 행을 다시 만났을 때 자동으로 갱신할 컬럼 (수동 편집 컬럼은 제외)
갱신_대상_컬럼 = ["수집일", "상태", "운영일수", "광고종료일", "광고텍스트", "광고시작일", "최초발견일", "광고상세URL", "구분"]

# AI 분류 결과 컬럼: 대시보드에서 수동으로 값을 채운 적이 없을 때(시트 셀이 비어 있을 때)만 채운다
분류_컬럼 = ["소재유형", "보종", "후킹", "요약"]

# 대시보드 설정 화면(광고주/분류 카테고리)을 저장하는 워크시트 이름
설정_시트이름 = "설정"

# 설정 시트에서 고정된 의미를 갖는 컬럼 (나머지 컬럼은 모두 광고주 카테고리로 취급)
고정_분류_컬럼 = ["소재유형", "보종", "후킹", "자사"]


def 구글_인증(서비스계정_경로):
    """서비스 계정 키 파일로 gspread 클라이언트를 생성한다."""
    credentials = Credentials.from_service_account_file(서비스계정_경로, scopes=인증_범위)
    return gspread.authorize(credentials)


def 워크시트_가져오기(gc, 설정):
    """설정된 스프레드시트에서 워크시트를 가져오거나, 없으면 생성하고 헤더를 추가한다."""
    스프레드시트 = gc.open_by_key(설정["google_sheets"]["spreadsheet_id"])
    시트이름 = 설정["google_sheets"]["worksheet_name"]

    try:
        worksheet = 스프레드시트.worksheet(시트이름)
    except gspread.WorksheetNotFound:
        worksheet = 스프레드시트.add_worksheet(title=시트이름, rows=1000, cols=len(시트_컬럼))

    기존_헤더 = worksheet.row_values(1)
    if not 기존_헤더:
        worksheet.append_row(시트_컬럼)
    else:
        # 이전에 만들어진 시트에 새로 추가된 컬럼(예: 광고상세URL)이 없으면 끝에 추가
        누락_컬럼 = [컬럼 for 컬럼 in 시트_컬럼 if 컬럼 not in 기존_헤더]
        if 누락_컬럼:
            worksheet.update([기존_헤더 + 누락_컬럼], "A1")

    return worksheet


def 설정_시트_초기화(gc, 설정):
    """'설정' 워크시트가 없으면 config.json의 카테고리별 광고주/분류 카테고리로 새로 만든다.

    카테고리 컬럼(예: 손해보험/생명보험/GA)은 advertiser_categories의 키를 그대로 사용하므로,
    시트에 새 컬럼을 추가하거나 컬럼을 지우는 방식으로 카테고리를 동적으로 추가/삭제할 수 있다.

    이미 존재하면 대시보드에서 관리하는 값을 건드리지 않고 그대로 둔다.
    """
    스프레드시트 = gc.open_by_key(설정["google_sheets"]["spreadsheet_id"])

    try:
        스프레드시트.worksheet(설정_시트이름)
        return
    except gspread.WorksheetNotFound:
        pass

    카테고리_이름들 = list(설정["advertiser_categories"].keys())
    헤더 = 카테고리_이름들 + 고정_분류_컬럼
    목록들 = [설정["advertiser_categories"][이름] for 이름 in 카테고리_이름들] + [
        설정["classification"].get(컬럼명, []) for 컬럼명 in 고정_분류_컬럼
    ]
    최대길이 = max(len(목록) for 목록 in 목록들)

    데이터 = [헤더]
    for i in range(최대길이):
        데이터.append([목록[i] if i < len(목록) else "" for 목록 in 목록들])

    워크시트 = 스프레드시트.add_worksheet(
        title=설정_시트이름, rows=max(최대길이 + 1, 10), cols=len(헤더)
    )
    워크시트.update(데이터, "A1")


def 설정_시트_읽기(gc, 설정):
    """'설정' 워크시트에서 카테고리별 광고주/소재유형/보종/후킹/자사 목록을 읽어온다.

    고정_분류_컬럼(소재유형/보종/후킹/자사)을 제외한 모든 컬럼은 광고주 카테고리로 취급하며,
    결과의 "카테고리" 항목에 {카테고리명: [광고주, ...]} 형태로 담긴다.
    "자사"는 대시보드에서 자사로 선택한 광고주명/그룹명 목록이며, 수집/분류 로직에는
    사용하지 않고 카테고리로 잘못 분류되지 않도록 하기 위해 읽어둔다.

    시트가 없거나 비어 있으면 모든 항목이 빈 값인 딕셔너리를 반환한다.
    """
    결과 = {"카테고리": {}, "소재유형": [], "보종": [], "후킹": [], "자사": []}

    스프레드시트 = gc.open_by_key(설정["google_sheets"]["spreadsheet_id"])
    try:
        워크시트 = 스프레드시트.worksheet(설정_시트이름)
    except gspread.WorksheetNotFound:
        return 결과

    값 = 워크시트.get_all_values()
    if len(값) < 2:
        return 결과

    헤더 = 값[0]
    for 열번호, 컬럼명 in enumerate(헤더):
        if not 컬럼명:
            continue
        목록 = [행[열번호] for 행 in 값[1:] if 열번호 < len(행) and 행[열번호]]
        if 컬럼명 in 고정_분류_컬럼:
            결과[컬럼명] = 목록
        else:
            결과["카테고리"][컬럼명] = 목록

    return 결과


def AI설정_시트_읽기(gc, 설정):
    """'AI설정' 워크시트에서 AI 프로바이더/API키/모델 설정을 읽어온다.

    시트가 없거나 읽기 실패 시 빈 딕셔너리를 반환한다.
    """
    try:
        스프레드시트 = gc.open_by_key(설정["google_sheets"]["spreadsheet_id"])
        워크시트 = 스프레드시트.worksheet("AI설정")
        값 = 워크시트.get_all_values()

        ai설정 = {}
        for 행 in 값[1:]:  # 첫 행은 헤더(키/값)
            if len(행) >= 2 and 행[0]:
                ai설정[행[0]] = 행[1]
        return ai설정
    except gspread.WorksheetNotFound:
        return {}
    except Exception as e:
        print(f"'AI설정' 시트를 읽지 못했습니다: {e}")
        return {}


def 설정_동적_적용(설정, 서비스계정_경로):
    """'설정' 시트에 입력된 광고주 카테고리/소재유형/후킹 목록이 있으면 설정값을 덮어쓴다.

    대시보드 "설정" 화면에서 이 값들을 바꾸면 다음 수집/분류부터 바로 반영되도록 한다.
    보종은 분류 규칙(src/classifier.py)이 카테고리별 키워드/우선순위를 코드로
    정의하고 있어 시트 값으로 덮어쓰지 않는다 (검증용 목록은 config.json 값 유지).

    수집 대상 광고주 목록(advertisers)은 own_company + advertiser_categories를 합쳐 계산한다.
    시트 접근에 실패하면 config.json 값을 그대로 사용한다.
    """
    설정["advertisers"] = 광고주_목록_생성(설정)

    if "여기에_" in 설정["google_sheets"]["spreadsheet_id"]:
        return 설정
    if not os.path.exists(서비스계정_경로):
        return 설정

    try:
        gc = 구글_인증(서비스계정_경로)
        설정_시트_초기화(gc, 설정)
        시트설정 = 설정_시트_읽기(gc, 설정)
    except Exception as e:
        print(f"'설정' 시트를 읽지 못해 config.json 기본값을 사용합니다: {e}")
        return 설정

    if 시트설정["카테고리"]:
        설정["advertiser_categories"] = 시트설정["카테고리"]
        설정["advertisers"] = 광고주_목록_생성(설정)
    if 시트설정["소재유형"]:
        설정["classification"]["소재유형"] = 시트설정["소재유형"]
    if 시트설정["후킹"]:
        설정["classification"]["후킹"] = 시트설정["후킹"]

    # 'AI설정' 시트에서 AI 프로바이더/API키 적용 (환경 변수가 있으면 환경 변수 우선)
    ai설정 = AI설정_시트_읽기(gc, 설정)
    if ai설정.get("ai_provider") and not os.environ.get("AI_PROVIDER"):
        설정["ai_provider"] = ai설정["ai_provider"]
    if ai설정.get("gemini_api_key") and not os.environ.get("GEMINI_API_KEY"):
        설정["gemini"]["api_key"] = ai설정["gemini_api_key"]
    if ai설정.get("gemini_model"):
        설정["gemini"]["model"] = ai설정["gemini_model"]
    if ai설정.get("openai_api_key") and not os.environ.get("OPENAI_API_KEY"):
        설정.setdefault("openai", {})["api_key"] = ai설정["openai_api_key"]
    if ai설정.get("openai_model"):
        설정.setdefault("openai", {})["model"] = ai설정["openai_model"]

    return 설정


def 이미지_업로드(설정, 이미지_경로, 파일명, 광고주, 수집일, 소재유형):
    """Apps Script 웹앱에 이미지를 base64로 전송하여 구글 드라이브에 저장하고 공개 보기 링크를 반환한다.

    드라이브에는 {광고주}/{수집일}/{소재유형 또는 미분류} 폴더 구조로 저장된다.
    """
    확장자 = "." + 파일명.rsplit(".", 1)[-1].lower()
    mime_type = 확장자별_MIME.get(확장자, "image/jpeg")

    with open(이미지_경로, "rb") as f:
        base64_데이터 = base64.b64encode(f.read()).decode("ascii")

    요청_본문 = json.dumps({
        "secret": 설정["google_sheets"]["drive_upload_secret"],
        "folderId": 설정["google_sheets"]["drive_folder_id"],
        "fileName": 파일명,
        "mimeType": mime_type,
        "base64": base64_데이터,
        "광고주": 광고주,
        "수집일": 수집일,
        "소재유형": 소재유형,
    }).encode("utf-8")

    요청 = urllib.request.Request(
        설정["google_sheets"]["drive_upload_webapp_url"],
        data=요청_본문,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(요청) as 응답:
        결과 = json.loads(응답.read().decode("utf-8"))

    if "error" in 결과:
        raise RuntimeError(f"이미지 업로드 실패({파일명}): {결과['error']}")

    return 결과["url"]


def _이미지_업로드_시도(설정, 이미지_폴더, 행, ad_id):
    """행의 이미지 파일이 로컬에 있으면 드라이브에 업로드해 URL을 반환한다.

    파일이 없거나 업로드에 실패하면 빈 문자열을 반환한다 (호출 측의 동기화를 막지 않음).
    """
    이미지_경로 = os.path.join(이미지_폴더, 행.get("이미지파일명", ""))
    if not 행.get("이미지파일명") or not os.path.exists(이미지_경로):
        return ""

    try:
        return 이미지_업로드(
            설정, 이미지_경로, 행["이미지파일명"],
            행["광고주"], 행["수집일"], 행.get("소재유형", ""),
        )
    except Exception as e:
        print(f"이미지 업로드 실패: {ad_id} - {e}")
        return ""


def 시트_동기화(설정, csv_경로, 이미지_폴더, 서비스계정_경로):
    """CSV의 광고 데이터를 구글 시트에 동기화한다.

    - 이미지URL(드라이브 업로드 URL)을 끝내 채울 수 없는 행은 시트에 추가하지 않고,
      이미 시트에 있던 행은 삭제한다.
    - 광고 텍스트에 한글이 전혀 없는(외국어) 행은 시트에 추가하지 않고, 이미 시트에
      있던 행은 삭제하며, CSV에서도 함께 제거한다 (필터 적용 전에 수집된 잔여 데이터 정리).

    반환값: (신규_추가_개수, 갱신_개수, 삭제_개수)
    """
    전체_데이터 = CSV_읽기(csv_경로)

    gc = 구글_인증(서비스계정_경로)
    worksheet = 워크시트_가져오기(gc, 설정)

    기존_행들 = worksheet.get_all_values()
    헤더 = 기존_행들[0] if 기존_행들 else 시트_컬럼

    ad_id_열 = 헤더.index("ad_id")
    이미지url_열 = 헤더.index("이미지URL") if "이미지URL" in 헤더 else -1
    기존_위치 = {
        row[ad_id_열]: 행번호
        for 행번호, row in enumerate(기존_행들[1:], start=2)
        if len(row) > ad_id_열 and row[ad_id_열]
    }

    새_행_목록 = []
    갱신_요청 = []
    삭제대상_행번호 = []
    외국어_제거_ad_id_목록 = []
    신규_개수 = 0
    갱신_개수 = 0
    삭제_개수 = 0

    for ad_id, 행 in 전체_데이터.items():
        외국어_소재 = 외국어_소재인가(행.get("광고텍스트"))
        if 외국어_소재:
            외국어_제거_ad_id_목록.append(ad_id)

        if ad_id in 기존_위치:
            행번호 = 기존_위치[ad_id]
            기존_행 = 기존_행들[행번호 - 1]

            # 이전 동기화 때 이미지가 없어 비어 있던 이미지URL(드라이브)을,
            # 로컬에 이미지가 생긴 경우 업로드해서 채운다
            현재_이미지url = ""
            if 이미지url_열 >= 0 and 이미지url_열 < len(기존_행):
                현재_이미지url = 기존_행[이미지url_열]

            최종_이미지url = 현재_이미지url
            if not 최종_이미지url:
                최종_이미지url = _이미지_업로드_시도(설정, 이미지_폴더, 행, ad_id)

            if 외국어_소재 or not 최종_이미지url:
                삭제대상_행번호.append(행번호)
                삭제_개수 += 1
                continue

            for 컬럼명 in 갱신_대상_컬럼:
                if 컬럼명 not in 헤더:
                    continue
                열번호 = 헤더.index(컬럼명)
                셀주소 = gspread.utils.rowcol_to_a1(행번호, 열번호 + 1)
                갱신_요청.append({"range": 셀주소, "values": [[행.get(컬럼명, "")]]})

            for 컬럼명 in 분류_컬럼:
                if 컬럼명 not in 헤더:
                    continue
                열번호 = 헤더.index(컬럼명)
                현재값 = 기존_행[열번호] if 열번호 < len(기존_행) else ""
                새값 = 행.get(컬럼명, "")
                if not 현재값 and 새값:
                    셀주소 = gspread.utils.rowcol_to_a1(행번호, 열번호 + 1)
                    갱신_요청.append({"range": 셀주소, "values": [[새값]]})

            if 최종_이미지url != 현재_이미지url and 이미지url_열 >= 0:
                셀주소 = gspread.utils.rowcol_to_a1(행번호, 이미지url_열 + 1)
                갱신_요청.append({"range": 셀주소, "values": [[최종_이미지url]]})

            갱신_개수 += 1
        else:
            if 외국어_소재:
                continue

            이미지URL = _이미지_업로드_시도(설정, 이미지_폴더, 행, ad_id)
            if not 이미지URL:
                continue

            새_행_목록.append([
                이미지URL if 컬럼 == "이미지URL" else 행.get(컬럼, "")
                for 컬럼 in 헤더
            ])
            신규_개수 += 1

    웹앱_url = 설정.get("google_sheets", {}).get("dashboard_webapp_url", "")
    if 웹앱_url and "여기에_" not in 웹앱_url:
        # 서비스 계정 403 우회: Apps Script 웹앱(소유자 권한)으로 모든 쓰기 위임
        if 갱신_요청 or 삭제대상_행번호 or 새_행_목록:
            요청_본문 = json.dumps({
                "action": "batch_write",
                "sheetName": worksheet.title,
                "updates": 갱신_요청,
                "deleteRows": sorted(삭제대상_행번호, reverse=True),
                "appendRows": 새_행_목록,
            }, ensure_ascii=False).encode("utf-8")
            요청 = urllib.request.Request(
                웹앱_url,
                data=요청_본문,
                headers={"Content-Type": "application/json; charset=utf-8"},
                method="POST",
            )
            with urllib.request.urlopen(요청, timeout=120) as 응답:
                결과 = json.loads(응답.read().decode("utf-8"))
            if "error" in 결과:
                raise RuntimeError(f"웹앱 배치 쓰기 실패: {결과['error']}")
            print(f"  시트 쓰기 완료 (웹앱): 갱신 {결과.get('updated', 0)}건 / 삭제 {결과.get('deleted', 0)}건 / 추가 {결과.get('appended', 0)}건")
    else:
        if 갱신_요청:
            worksheet.batch_update(갱신_요청)

        if 삭제대상_행번호:
            삭제_요청 = [
                {
                    "deleteDimension": {
                        "range": {
                            "sheetId": worksheet.id,
                            "dimension": "ROWS",
                            "startIndex": 행번호 - 1,
                            "endIndex": 행번호,
                        }
                    }
                }
                for 행번호 in sorted(삭제대상_행번호, reverse=True)
            ]
            worksheet.spreadsheet.batch_update({"requests": 삭제_요청})

        if 새_행_목록:
            worksheet.append_rows(새_행_목록, value_input_option="USER_ENTERED")

    if 외국어_제거_ad_id_목록:
        for ad_id in 외국어_제거_ad_id_목록:
            del 전체_데이터[ad_id]
        CSV_쓰기(csv_경로, 전체_데이터)

    return 신규_개수, 갱신_개수, 삭제_개수


# 대시보드에서 "광고 직접 추가"로 등록한 요청을 관리하는 워크시트 이름/컬럼
수동추가_시트이름 = "수동추가"
수동추가_컬럼 = ["요청URL", "library_id", "상태", "요청일시", "처리일시", "메모"]


def 수동추가_시트_가져오기(gc, 설정):
    """'수동추가' 워크시트를 가져오거나, 없으면 헤더와 함께 새로 만든다."""
    스프레드시트 = gc.open_by_key(설정["google_sheets"]["spreadsheet_id"])
    try:
        return 스프레드시트.worksheet(수동추가_시트이름)
    except gspread.WorksheetNotFound:
        워크시트 = 스프레드시트.add_worksheet(title=수동추가_시트이름, rows=100, cols=len(수동추가_컬럼))
        워크시트.append_row(수동추가_컬럼)
        return 워크시트


def 수동추가_대기목록_가져오기(gc, 설정):
    """'수동추가' 시트에서 상태가 "대기"인 행을 (워크시트, [(행번호, library_id), ...]) 형태로 반환한다."""
    워크시트 = 수동추가_시트_가져오기(gc, 설정)
    값 = 워크시트.get_all_values()
    if len(값) < 2:
        return 워크시트, []

    헤더 = 값[0]
    library_id_열 = 헤더.index("library_id")
    상태_열 = 헤더.index("상태")

    대기목록 = []
    for 행번호, 행 in enumerate(값[1:], start=2):
        if len(행) > 상태_열 and 행[상태_열] == "대기":
            library_id = str(행[library_id_열]).strip() if len(행) > library_id_열 else ""
            if library_id:
                # Google Sheets가 큰 숫자를 지수 표기법(1.52097E+15)으로 자동 변환한 경우 처리
                if "E" in library_id.upper() or ("." in library_id and not library_id.isdigit()):
                    try:
                        library_id = str(int(float(library_id)))
                        print(f"  [경고] 행 {행번호}: library_id가 지수 표기법으로 저장됨 → {library_id}로 복원 (정밀도 손실 가능)")
                    except (ValueError, OverflowError):
                        pass
                대기목록.append((행번호, library_id))

    return 워크시트, 대기목록


def 수동추가_상태_갱신(워크시트, 행번호, 상태, 메모="", 설정=None):
    """'수동추가' 시트의 한 행의 상태/처리일시/메모를 갱신한다.

    dashboard_webapp_url이 설정된 경우 Apps Script 웹앱 POST로 갱신한다.
    (서비스 계정 403 권한 오류를 우회하기 위해 스프레드시트 소유자 권한으로 실행)
    미설정이거나 POST가 실패하면 gspread API를 직접 사용한다.
    """
    웹앱_url = ""
    if 설정:
        웹앱_url = 설정.get("google_sheets", {}).get("dashboard_webapp_url", "")

    if 웹앱_url and "여기에_" not in 웹앱_url:
        try:
            요청_본문 = json.dumps({
                "action": "update_manual_status",
                "row": 행번호,
                "status": 상태,
                "memo": 메모[:100] if 메모 else "",
            }).encode("utf-8")
            요청 = urllib.request.Request(
                웹앱_url,
                data=요청_본문,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(요청, timeout=30) as 응답:
                결과 = json.loads(응답.read().decode("utf-8"))
            if "error" not in 결과:
                return
            print(f"  [경고] 웹앱 상태 갱신 실패: {결과.get('error')} - gspread로 재시도")
        except Exception as e:
            print(f"  [경고] 웹앱 상태 갱신 실패: {e} - gspread로 재시도")

    try:
        헤더 = 워크시트.row_values(1)
        처리일시 = datetime.now(KST).strftime("%Y-%m-%d %H:%M")

        갱신 = [
            {"range": gspread.utils.rowcol_to_a1(행번호, 헤더.index("상태") + 1), "values": [[상태]]},
            {"range": gspread.utils.rowcol_to_a1(행번호, 헤더.index("처리일시") + 1), "values": [[처리일시]]},
        ]
        if 메모:
            갱신.append({"range": gspread.utils.rowcol_to_a1(행번호, 헤더.index("메모") + 1), "values": [[메모[:100]]]})

        워크시트.batch_update(갱신)
    except Exception as e:
        print(f"  [경고] 수동추가 상태 갱신 실패 (행 {행번호}, 상태={상태}): {e}")
