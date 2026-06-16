"""한화손해보험 경쟁사 메타 광고 소재 모니터링 - 1단계: 로컬 수집 + CSV 저장.

config.json에 등록된 광고주별로 Meta 광고 라이브러리를 검색하여
광고 카드를 수집하고, 이미지를 로컬에 저장하며, 결과를 CSV로 관리한다.
"""

import json

from playwright.sync_api import sync_playwright

from src.config_loader import 경로_절대화, 설정_불러오기
from src.csv_store import CSV_쓰기, CSV_읽기, 광고ID_생성, 데이터_병합, 단일_광고_추가_또는_갱신, 오늘_KST
from src.scraper import 광고_상세_조회, 광고주_광고_수집, 이미지_다운로드, 이미지_확장자_추출
from src.sheets_sync import 구글_인증, 설정_동적_적용, 수동추가_대기목록_가져오기, 수동추가_상태_갱신

import os


def 수동추가_처리(page, 설정, 서비스계정_경로, 전체_데이터, 이미지_폴더, 오늘):
    """대시보드 "광고 직접 추가"로 등록된 "수동추가" 시트의 대기 항목을 처리한다.

    각 항목의 라이브러리 ID로 광고 상세 페이지를 조회해 광고주/텍스트/이미지를
    얻고, 이미지를 다운로드한 뒤 ads.csv에 1건만 추가/갱신한다.
    """
    if "여기에_" in 설정["google_sheets"]["spreadsheet_id"]:
        return
    if not os.path.exists(서비스계정_경로):
        return

    try:
        with open(서비스계정_경로, encoding="utf-8") as _f:
            _sa = json.load(_f)
        print(f"\n  [수동추가] 서비스 계정: {_sa.get('client_email', '알 수 없음')}")

        gc = 구글_인증(서비스계정_경로)
        워크시트, 대기목록 = 수동추가_대기목록_가져오기(gc, 설정)
    except Exception as e:
        print(f"\n'수동추가' 시트를 읽지 못했습니다: {e}")
        return

    if not 대기목록:
        return

    print(f"\n수동 추가 요청 {len(대기목록)}건 처리 중...")
    for 행번호, library_id in 대기목록:
        try:
            카드 = 광고_상세_조회(page, library_id, 설정)
            if not 카드:
                print(f"  - {library_id}: 광고를 찾을 수 없어 건너뜁니다.")
                수동추가_상태_갱신(워크시트, 행번호, "실패", "광고를 찾을 수 없음")
                continue

            ad_id = 광고ID_생성(카드["이미지URL"])
            확장자 = 이미지_확장자_추출(카드["이미지URL"])
            이미지파일명 = f"{ad_id}{확장자}"
            이미지_저장경로 = os.path.join(이미지_폴더, 이미지파일명)

            if not os.path.exists(이미지_저장경로):
                성공 = 이미지_다운로드(page, 카드["이미지URL"], 이미지_저장경로)
                if not 성공:
                    print(f"  - {library_id}: 이미지 다운로드 실패")
                    수동추가_상태_갱신(워크시트, 행번호, "실패", "이미지 다운로드 실패")
                    continue

            구분 = "자사" if 카드["광고주"] == 설정.get("own_company") else "경쟁사"
            단일_광고_추가_또는_갱신(전체_데이터, 카드["광고주"], 구분, {
                "ad_id": ad_id,
                "이미지URL": 카드["이미지URL"],
                "이미지파일명": 이미지파일명,
                "광고텍스트": 카드["광고텍스트"],
                "광고시작일": 카드["광고시작일"],
                "광고상세URL": 카드["광고상세URL"],
            }, 오늘)

            print(f"  - {library_id}: {카드['광고주']} ({구분}) 추가 완료")
            수동추가_상태_갱신(워크시트, 행번호, "완료", 카드["광고주"])
        except Exception as e:
            print(f"  - {library_id}: 처리 중 오류 발생 - {e}")
            수동추가_상태_갱신(워크시트, 행번호, "실패", str(e)[:100])


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

        수동추가_처리(page, 설정, 서비스계정_경로, 전체_데이터, 이미지_폴더, 오늘)

        browser.close()

    CSV_쓰기(csv_경로, 전체_데이터)
    print(f"\n저장 완료: {csv_경로}")
    print(f"전체 광고 수: {len(전체_데이터)}건")


if __name__ == "__main__":
    실행()
