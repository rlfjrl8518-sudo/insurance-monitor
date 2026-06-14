"""한화손해보험 경쟁사 메타 광고 소재 모니터링 - 3단계: Google Sheets 동기화.

CSV에 저장된 광고 데이터를 구글 시트에 동기화한다.
- 신규 광고는 이미지를 구글 드라이브에 업로드한 뒤 새 행으로 추가
- 기존 광고는 상태/운영일수/수집일 등을 갱신
"""

import os

from src.config_loader import 경로_절대화, 설정_불러오기
from src.sheets_sync import 구글_인증, 설정_시트_초기화, 시트_동기화


def 실행():
    설정 = 설정_불러오기()

    if "여기에_" in 설정["google_sheets"]["spreadsheet_id"]:
        print("config.json의 google_sheets.spreadsheet_id를 설정한 뒤 다시 실행해주세요.")
        return

    if "여기에_" in 설정["google_sheets"]["drive_folder_id"]:
        print("config.json의 google_sheets.drive_folder_id를 설정한 뒤 다시 실행해주세요.")
        return

    서비스계정_경로 = 경로_절대화(설정["google_sheets"]["service_account_file"])
    if not os.path.exists(서비스계정_경로):
        print(f"서비스 계정 키 파일이 없습니다: {서비스계정_경로}")
        print("구글 서비스 계정 JSON 키 파일을 위 경로에 저장한 뒤 다시 실행해주세요.")
        return

    csv_경로 = 경로_절대화(설정["paths"]["csv_file"])
    이미지_폴더 = 경로_절대화(설정["paths"]["images_dir"])

    print("=" * 60)
    print("Google Sheets 동기화 시작")
    print("=" * 60)

    gc = 구글_인증(서비스계정_경로)
    설정_시트_초기화(gc, 설정)

    신규, 갱신, 삭제 = 시트_동기화(설정, csv_경로, 이미지_폴더, 서비스계정_경로)

    print(f"신규 추가: {신규}건 / 기존 갱신: {갱신}건 / 삭제(이미지없음·외국어): {삭제}건")
    print("동기화 완료")


if __name__ == "__main__":
    실행()
