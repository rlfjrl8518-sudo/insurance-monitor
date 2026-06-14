"""한화손해보험 경쟁사 메타 광고 소재 모니터링 - 1단계: 로컬 수집 + CSV 저장.

config.json에 등록된 광고주별로 Meta 광고 라이브러리를 검색하여
광고 카드를 수집하고, 이미지를 로컬에 저장하며, 결과를 CSV로 관리한다.
"""

from playwright.sync_api import sync_playwright

from src.config_loader import 경로_절대화, 설정_불러오기
from src.csv_store import CSV_쓰기, CSV_읽기, 광고ID_생성, 데이터_병합, 오늘_KST
from src.scraper import 광고주_광고_수집, 이미지_다운로드, 이미지_확장자_추출
from src.sheets_sync import 설정_동적_적용

import os


def 실행():
    설정 = 설정_불러오기()
    서비스계정_경로 = 경로_절대화(설정["google_sheets"]["service_account_file"])
    설정 = 설정_동적_적용(설정, 서비스계정_경로)

    csv_경로 = 경로_절대화(설정["paths"]["csv_file"])
    이미지_폴더 = 경로_절대화(설정["paths"]["images_dir"])
    os.makedirs(이미지_폴더, exist_ok=True)

    전체_데이터 = CSV_읽기(csv_경로)
    오늘 = 오늘_KST()

    print("=" * 60)
    print(f"한화손해보험 경쟁사 메타 광고 모니터링 - 수집 시작 ({오늘})")
    print(f"수집 대상 광고주: {', '.join(설정['advertisers'])}")
    print("=" * 60)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=설정["scraping"]["headless"])
        page = browser.new_page(locale="ko-KR")

        for 광고주명 in 설정["advertisers"]:
            구분 = "자사" if 광고주명 == 설정.get("own_company") else "경쟁사"
            print(f"\n[{광고주명}] ({구분}) 수집 중...")
            원본_목록 = 광고주_광고_수집(page, 광고주명, 설정)

            if not 원본_목록:
                # 카드가 0건 추출된 경우, 일시적인 차단/오류로 보고 이번 회차는 건너뛴다.
                # (실제로 0건으로 처리하면 기존 광고가 모두 '종료'로 잘못 표시됨)
                print("  -> 추출된 카드가 0건이라 이번 수집을 건너뜁니다. (기존 데이터 유지)")
                continue

            수집된_광고_목록 = []
            for 카드 in 원본_목록:
                ad_id = 광고ID_생성(카드["이미지URL"])
                확장자 = 이미지_확장자_추출(카드["이미지URL"])
                이미지파일명 = f"{ad_id}{확장자}"
                이미지_저장경로 = os.path.join(이미지_폴더, 이미지파일명)

                if not os.path.exists(이미지_저장경로):
                    성공 = 이미지_다운로드(page, 카드["이미지URL"], 이미지_저장경로)
                    if not 성공:
                        print(f"  - 이미지 다운로드 실패: {카드['이미지URL'][:80]}...")
                        continue

                수집된_광고_목록.append({
                    "ad_id": ad_id,
                    "이미지URL": 카드["이미지URL"],
                    "이미지파일명": 이미지파일명,
                    "광고텍스트": 카드["광고텍스트"],
                    "광고시작일": 카드["광고시작일"],
                    "광고상세URL": 카드["광고상세URL"],
                })

            신규, 운영중, 신규종료 = 데이터_병합(전체_데이터, 광고주명, 구분, 수집된_광고_목록, 오늘)
            print(f"  -> 신규 {신규}건 / 운영중 {운영중}건 / 신규 종료 {신규종료}건")

        browser.close()

    CSV_쓰기(csv_경로, 전체_데이터)
    print(f"\n저장 완료: {csv_경로}")
    print(f"전체 광고 수: {len(전체_데이터)}건")


if __name__ == "__main__":
    실행()
