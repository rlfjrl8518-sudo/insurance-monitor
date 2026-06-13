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

from src.csv_store import CSV_읽기

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

# 설정 시트의 컬럼과 config.json 항목 매핑
설정_시트_컬럼 = ["광고주", "소재유형", "보종", "후킹"]


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
    """'설정' 워크시트가 없으면 config.json의 광고주/분류 카테고리로 새로 만든다.

    이미 존재하면 대시보드에서 관리하는 값을 건드리지 않고 그대로 둔다.
    """
    스프레드시트 = gc.open_by_key(설정["google_sheets"]["spreadsheet_id"])

    try:
        스프레드시트.worksheet(설정_시트이름)
        return
    except gspread.WorksheetNotFound:
        pass

    목록들 = [
        설정["advertisers"],
        설정["classification"]["소재유형"],
        설정["classification"]["보종"],
        설정["classification"]["후킹"],
    ]
    최대길이 = max(len(목록) for 목록 in 목록들)

    데이터 = [설정_시트_컬럼]
    for i in range(최대길이):
        데이터.append([목록[i] if i < len(목록) else "" for 목록 in 목록들])

    워크시트 = 스프레드시트.add_worksheet(
        title=설정_시트이름, rows=max(최대길이 + 1, 10), cols=len(설정_시트_컬럼)
    )
    워크시트.update(데이터, "A1")


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

    반환값: (신규_추가_개수, 갱신_개수)
    """
    전체_데이터 = CSV_읽기(csv_경로)

    gc = 구글_인증(서비스계정_경로)
    worksheet = 워크시트_가져오기(gc, 설정)

    기존_행들 = worksheet.get_all_values()
    헤더 = 기존_행들[0] if 기존_행들 else 시트_컬럼

    ad_id_열 = 헤더.index("ad_id")
    기존_위치 = {
        row[ad_id_열]: 행번호
        for 행번호, row in enumerate(기존_행들[1:], start=2)
        if len(row) > ad_id_열 and row[ad_id_열]
    }

    새_행_목록 = []
    갱신_요청 = []
    신규_개수 = 0
    갱신_개수 = 0

    for ad_id, 행 in 전체_데이터.items():
        if ad_id in 기존_위치:
            행번호 = 기존_위치[ad_id]
            for 컬럼명 in 갱신_대상_컬럼:
                if 컬럼명 not in 헤더:
                    continue
                열번호 = 헤더.index(컬럼명)
                셀주소 = gspread.utils.rowcol_to_a1(행번호, 열번호 + 1)
                갱신_요청.append({"range": 셀주소, "values": [[행.get(컬럼명, "")]]})

            기존_행 = 기존_행들[행번호 - 1]
            for 컬럼명 in 분류_컬럼:
                if 컬럼명 not in 헤더:
                    continue
                열번호 = 헤더.index(컬럼명)
                현재값 = 기존_행[열번호] if 열번호 < len(기존_행) else ""
                새값 = 행.get(컬럼명, "")
                if not 현재값 and 새값:
                    셀주소 = gspread.utils.rowcol_to_a1(행번호, 열번호 + 1)
                    갱신_요청.append({"range": 셀주소, "values": [[새값]]})

            # 이전 동기화 때 이미지가 없어 비어 있던 이미지URL(드라이브)을,
            # 로컬에 이미지가 생긴 경우 업로드해서 채운다
            if "이미지URL" in 헤더:
                이미지url_열 = 헤더.index("이미지URL")
                현재_이미지url = 기존_행[이미지url_열] if 이미지url_열 < len(기존_행) else ""
                if not 현재_이미지url:
                    새_이미지url = _이미지_업로드_시도(설정, 이미지_폴더, 행, ad_id)
                    if 새_이미지url:
                        셀주소 = gspread.utils.rowcol_to_a1(행번호, 이미지url_열 + 1)
                        갱신_요청.append({"range": 셀주소, "values": [[새_이미지url]]})
            갱신_개수 += 1
        else:
            이미지URL = _이미지_업로드_시도(설정, 이미지_폴더, 행, ad_id)

            새_행_목록.append([
                이미지URL if 컬럼 == "이미지URL" else 행.get(컬럼, "")
                for 컬럼 in 헤더
            ])
            신규_개수 += 1

    if 갱신_요청:
        worksheet.batch_update(갱신_요청)

    if 새_행_목록:
        worksheet.append_rows(새_행_목록, value_input_option="USER_ENTERED")

    return 신규_개수, 갱신_개수
