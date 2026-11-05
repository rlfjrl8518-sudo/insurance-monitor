"""한화손해보험 경쟁사 메타 광고 소재 모니터링 - 1단계: 로컬 수집 + CSV 저장.

config.json에 등록된 광고주별로 Meta 광고 라이브러리를 검색하여
광고 카드를 수집하고, 이미지를 로컬에 저장하며, 결과를 CSV로 관리한다.
"""

import json

from playwright.sync_api import sync_playwright

from src.config_loader import 경로_절대화, 설정_불러오기
from src.csv_store import (CSV_쓰기, CSV_읽기, 데이터_병합, 운영일수_계산,
                           단일_광고_추가_또는_갱신, 오늘_KST, 상태_종료, _임시_주소인가)
from src.scraper import (광고_상세_조회, 광고주_광고_수집, 광고주_해석, 새_페이지_찾기, 이미지_다운로드,
                         이미지_확장자_추출, 페이지명_정규화)
from src.settings_store import 광고주_분류, 설정_읽기
from src.sheets_sync import 구글_인증, 설정_동적_적용, 수동추가_대기목록_가져오기, 수동추가_상태_갱신

import os
import sys
from datetime import date, datetime

# 카드 0건이 이 일수 넘게 이어지면 일시 오류가 아니라 진짜 중단으로 본다.
방치_한계_일수 = 14

# 업로드가 이만큼 연속 실패하면 이번 수집에서는 보관을 포기한다.
보관_연속실패_한계 = 5

# 한 번의 수집에서 올릴 최대 장수. GCS는 한도 걱정이 없지만, 무언가 잘못돼 전량 재업로드가
# 시작되는 상황(예전 Blob 정지 사고)에서 제동을 거는 안전장치로 남긴다. 평소 신규는 회당 수십 장.
보관_회당_한계 = 300

_보관_실패_연속 = [0]
_보관_올린_수 = [0]
_보관_중단 = [False]


def 마지막_수집일(전체_데이터, 광고주명):
    """이 광고주의 광고가 마지막으로 수집된 날짜 문자열. 한 건도 없으면 None."""
    날짜들 = [행.get("수집일") for 행 in 전체_데이터.values()
            if 행.get("광고주") == 광고주명 and 행.get("수집일")]
    return max(날짜들) if 날짜들 else None


def 방치_정리(전체_데이터, 수집_대상, 오늘):
    """설정 시트에서 빠진 광고주의 옛 데이터를 종료로 정리한다.

    수집 루프는 등록된 광고주만 돌기 때문에, 시트에서 이름을 빼면 그 광고들은
    아무도 건드리지 않아 마지막 상태 그대로 굳는다. 실제로 '보험탈출구'가 석
    달째 '운영중'으로 남아 있었다. 등록이 풀린 지 방치_한계_일수가 지나면 아직
    운영 중이라고 말할 근거가 없으므로 종료로 내린다.
    """
    끊긴_광고주 = set()
    for 행 in 전체_데이터.values():
        이름 = 행.get("광고주")
        if 이름 in 수집_대상 or 행.get("상태") == 상태_종료:
            continue
        수집일 = 행.get("수집일")
        if not 수집일:
            continue
        if (오늘 - date.fromisoformat(수집일)).days >= 방치_한계_일수:
            _종료로(행, 오늘)
            끊긴_광고주.add(이름)
    if 끊긴_광고주:
        print(f"\n수집 대상에서 빠진 지 오래된 광고주 정리: {', '.join(sorted(끊긴_광고주))}")


def _종료로(행, 오늘):
    """종료일은 오늘이 아니라 마지막으로 실제 확인된 날로 둔다."""
    행["상태"] = 상태_종료
    행["광고종료일"] = 행.get("수집일") or 오늘.isoformat()
    행["운영일수"] = str(운영일수_계산(행, 오늘))


def 광고주_목록_보정(목록, 보정):
    """config의 advertiser_overrides로 잘못 등록된 항목을 고친다. 빈 값이면 수집에서 뺀다.

    설정 시트·웹 설정에 '한화손보'처럼 실제 페이지명('한화손해보험')과 다른 이름이 남아
    142일째 0건이었다. 등록처를 고치기 전까지도 수집은 맞게 돌도록 여기서 덮는다.
    """
    결과 = []
    for 항목 in 목록:
        검색어 = 광고주_해석(항목)[0]
        새것 = 보정.get(항목, 보정.get(검색어, 항목))
        if 새것 and 새것 not in 결과:
            결과.append(새것)
    return 결과


def 이미_보관됨(보관_주소):
    """이미 우리 저장소에 있는 소재인지. 있으면 다시 받지도, 다시 올리지도 않는다.

    소재 이미지는 한번 보관하면 바뀌지 않는데도 수집될 때마다 전부 다시 올리고
    있었다. 그래서 한 달 업로드가 2만 회를 넘었고, 저장소의 월 2천 회 한도를
    열 배로 넘겨 스토어가 정지됐다. 보관본이 있으면 건너뛴다.
    """
    return bool(보관_주소) and not _임시_주소인가(보관_주소)


def 보관용_이미지주소(이미지_저장경로, 원본_URL):
    """이미지를 우리 저장소에 올리고 그 주소를 돌려준다. 실패하면 원본 주소를 그대로 쓴다.

    메타 CDN 주소(scontent-*.fbcdn.net)는 서명이 걸려 있어 얼마 지나면 403이 된다.
    실제로 초기 수집분 1,500여 건이 그렇게 전부 깨져서, 드라이브 사본을 찾아
    옮겨야 했다. 같은 일이 반복되지 않도록 수집 시점에 복사해 둔다.

    업로드가 실패해도 수집 자체를 멈추지는 않는다. 이미지는 나중에 다시 채울 수
    있지만 그날의 게재 현황은 다시 못 구하기 때문이다.
    """
    if not os.environ.get("IMAGE_BUCKET"):
        return 원본_URL
    if _보관_중단[0]:
        return 원본_URL
    if _보관_올린_수[0] >= 보관_회당_한계:
        if not _보관_중단[0]:
            _보관_중단[0] = True
            print(f"  - 이번 수집 업로드 상한({보관_회당_한계}장)에 도달해 나머지는 다음 회차로 미룹니다.")
        return 원본_URL

    try:
        from src.image_store import 파일_올리기
        주소 = 파일_올리기(이미지_저장경로, 덮어쓰기=True) or 원본_URL
        _보관_실패_연속[0] = 0
        _보관_올린_수[0] += 1
        return 주소
    except Exception as e:
        print(f"  - 이미지 보관 실패(원본 주소 사용): {type(e).__name__}: {str(e)[:60]}")
        _보관_실패_연속[0] += 1
        if _보관_실패_연속[0] >= 보관_연속실패_한계:
            # 저장소가 통째로 막힌 상황(한도 초과·정지 등)에서 남은 수백 건을 계속
            # 두드려봐야 다 실패한다. 업로드 횟수 자체가 한도라서 헛발질이 곧 비용이다.
            _보관_중단[0] = True
            print(f"  - 업로드가 {보관_연속실패_한계}번 연속 실패해 이번 수집에서는 보관을 멈춥니다.")
        return 원본_URL


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
        대시보드_url = 설정.get("google_sheets", {}).get("dashboard_webapp_url", "(없음)")
        print(f"  [수동추가] 대시보드 웹앱 URL: {대시보드_url[:60]}..." if len(대시보드_url) > 60 else f"  [수동추가] 대시보드 웹앱 URL: {대시보드_url}")

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
                수동추가_상태_갱신(워크시트, 행번호, "실패", "광고를 찾을 수 없음", 설정=설정)
                continue

            ad_id = str(library_id)
            확장자 = 이미지_확장자_추출(카드["이미지URL"])
            이미지파일명 = f"{ad_id}{확장자}"
            이미지_저장경로 = os.path.join(이미지_폴더, 이미지파일명)

            if not os.path.exists(이미지_저장경로):
                성공 = 이미지_다운로드(page, 카드["이미지URL"], 이미지_저장경로)
                if not 성공:
                    print(f"  - {library_id}: 이미지 다운로드 실패")
                    수동추가_상태_갱신(워크시트, 행번호, "실패", "이미지 다운로드 실패", 설정=설정)
                    continue

            구분 = "자사" if 설정["_분류"](카드["광고주"])[2] else "경쟁사"
            단일_광고_추가_또는_갱신(전체_데이터, 카드["광고주"], 구분, {
                "ad_id": ad_id,
                "이미지URL": 보관용_이미지주소(이미지_저장경로, 카드["이미지URL"]),
                "이미지파일명": 이미지파일명,
                "광고텍스트": 카드["광고텍스트"],
                "광고시작일": 카드["광고시작일"],
                "광고상세URL": 카드["광고상세URL"],
            }, 오늘)

            print(f"  - {library_id}: {카드['광고주']} ({구분}) 추가 완료")
            수동추가_상태_갱신(워크시트, 행번호, "완료", 카드["광고주"], 설정=설정)
        except Exception as e:
            print(f"  - {library_id}: 처리 중 오류 발생 - {e}")
            수동추가_상태_갱신(워크시트, 행번호, "실패", str(e)[:100], 설정=설정)


def _JSON_읽기(경로, 기본):
    try:
        with open(경로, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return 기본


def _JSON_쓰기(경로, 값):
    with open(경로, "w", encoding="utf-8") as f:
        json.dump(값, f, ensure_ascii=False, indent=1, sort_keys=True)


def 실행():
    설정 = 설정_불러오기()
    서비스계정_경로 = 경로_절대화(설정["google_sheets"]["service_account_file"])
    설정 = 설정_동적_적용(설정, 서비스계정_경로)
    설정["advertisers"] = 광고주_목록_보정(설정["advertisers"], 설정.get("advertiser_overrides", {}))

    try:
        from push_to_postgres import 광고주그룹_읽기
        시트그룹 = 광고주그룹_읽기(설정)
    except Exception:
        시트그룹 = None
    분류 = 광고주_분류(설정, 설정_읽기(), 시트그룹)
    설정["_분류"] = 분류

    csv_경로 = 경로_절대화(설정["paths"]["csv_file"])
    이미지_폴더 = 경로_절대화(설정["paths"]["images_dir"])
    페이지캐시_경로 = 경로_절대화(설정["paths"].get("page_cache", "data/pages.json"))
    상태_경로 = 경로_절대화(설정["paths"].get("health_file", "data/health.json"))
    os.makedirs(이미지_폴더, exist_ok=True)

    전체_데이터 = CSV_읽기(csv_경로)
    페이지캐시 = _JSON_읽기(페이지캐시_경로, {})
    오늘 = 오늘_KST()
    시각 = datetime.now().astimezone().isoformat(timespec="seconds")
    건강 = []

    print("=" * 60)
    print(f"경쟁사 메타 광고 모니터링 - 수집 시작 ({오늘})")
    print(f"수집 대상 광고주: {', '.join(설정['advertisers'])}")
    print("=" * 60)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=설정["scraping"]["headless"])
        page = browser.new_page(locale="ko-KR")

        for 광고주항목 in 설정["advertisers"]:
            광고주명, _ = 광고주_해석(광고주항목)
            구분 = "자사" if 분류(광고주명)[2] else "경쟁사"
            print(f"\n[{광고주항목}] ({구분}) 수집 중...")
            try:
                결과 = 광고주_광고_수집(page, 광고주항목, 설정, 페이지캐시)
            except Exception as e:
                결과 = {"광고": [], "표시건수": None, "수집률": None, "page_id": None, "후보": [],
                      "상태": "읽기실패", "메시지": f"{type(e).__name__}: {str(e)[:120]}"}
            기록 = {"run_at": 시각, "광고주": 광고주명, "page_id": 결과["page_id"], "상태": 결과["상태"],
                  "표시건수": 결과["표시건수"], "수집건수": len(결과["광고"]), "수집률": 결과["수집률"],
                  "신규": 0, "종료": 0, "메시지": 결과["메시지"],
                  "후보": [f"{n} ({i})" for n, i in 결과["후보"]]}
            건강.append(기록)

            if 결과["상태"] in ("페이지없음", "읽기실패"):
                # 읽지 못한 회차는 '안 보였다'는 근거가 아니다. 다만 너무 오래 못 읽으면
                # 그 광고주 데이터가 영원히 게재중으로 남으니 방치 한계를 넘기면 내린다.
                마지막 = 마지막_수집일(전체_데이터, 광고주명)
                밀린_일수 = (오늘 - date.fromisoformat(마지막)).days if 마지막 else 0
                print(f"  -> {결과['상태']}: {결과['메시지']} (마지막 확인 {마지막 or '-'})")
                if 밀린_일수 >= 방치_한계_일수:
                    for 행 in 전체_데이터.values():
                        if 행.get("광고주") == 광고주명 and 행.get("상태") != 상태_종료:
                            _종료로(행, 오늘)
                            기록["종료"] += 1
                continue

            수집된_광고_목록 = []
            for 카드 in 결과["광고"]:
                ad_id = 카드["라이브러리ID"]
                기존 = 전체_데이터.get(ad_id) or {}
                보관됨 = 기존.get("이미지URL", "")
                이미지파일명 = 기존.get("이미지파일명") or f"{ad_id}{이미지_확장자_추출(카드['이미지URL'])}"
                이미지_저장경로 = os.path.join(이미지_폴더, 이미지파일명)

                # 이미 보관본이 있으면 받지도 올리지도 않는다. 새 소재만 받아서
                # 분류(이미지 판독)와 드라이브·Blob 사본에 쓴다.
                if 이미_보관됨(보관됨):
                    이미지주소 = 보관됨
                else:
                    if not os.path.exists(이미지_저장경로) and not 이미지_다운로드(page, 카드["이미지URL"], 이미지_저장경로):
                        print(f"  - 이미지 다운로드 실패: {ad_id}")
                        continue
                    이미지주소 = 보관용_이미지주소(이미지_저장경로, 카드["이미지URL"])

                수집된_광고_목록.append({**카드, "ad_id": ad_id, "페이지ID": 카드["page_id"],
                                    "이미지URL": 이미지주소, "이미지파일명": 이미지파일명})

            완전수집 = (결과["수집률"] or 0) >= 0.999
            신규, 유지, 신규종료 = 데이터_병합(전체_데이터, 광고주명, 구분, 수집된_광고_목록, 오늘, 완전수집)
            기록.update(신규=신규, 종료=신규종료)
            print(f"  -> 신규 {신규}건 / 유지 {유지}건 / 종료 {신규종료}건"
                  + ("" if 완전수집 else " (일부만 읽혀 종료 판정 보류)"))

        # 주 1회: 주요 보험사 이름으로 검색해 광고를 내는데 수집 대상에 없는 페이지(새 채널·이름 바뀐 페이지)를 찾는다.
        마지막점검 = 페이지캐시.get("_페이지점검일", "")
        if os.environ.get("PAGE_CHECK") == "1" or not 마지막점검 or (오늘 - date.fromisoformat(마지막점검)).days >= 7:
            print("\n[페이지 점검] 주요 보험사 페이지 확인 중...")
            검색어들 = list(dict.fromkeys(
                [광고주_해석(x)[0] for x in 설정["advertisers"]] + 설정["scraping"].get("page_check_keywords", [])))
            등록된 = {페이지명_정규화(광고주_해석(x)[1]) for x in 설정["advertisers"]} | {k for k in 페이지캐시 if not k.startswith("_")}
            for x in 새_페이지_찾기(page, 검색어들, 등록된, 설정):
                건강.append({"run_at": 시각, "광고주": f"새 페이지 · {x['이름']}", "page_id": x["page_id"],
                           "상태": "새 페이지", "표시건수": None, "수집건수": x["광고"], "수집률": None,
                           "신규": 0, "종료": 0, "후보": [f"{x['이름']} ({x['page_id']})"],
                           "메시지": f"'{x['검색어']}' 검색에서 광고를 내는 페이지인데 수집 대상에 없음. "
                                    f"같은 회사 채널이면 수집 대상에 페이지명을 추가하세요."})
            페이지캐시["_페이지점검일"] = 오늘.isoformat()

        방치_정리(전체_데이터, {광고주_해석(x)[0] for x in 설정["advertisers"]}, 오늘)
        수동추가_처리(page, 설정, 서비스계정_경로, 전체_데이터, 이미지_폴더, 오늘)
        browser.close()

    CSV_쓰기(csv_경로, 전체_데이터)
    _JSON_쓰기(페이지캐시_경로, 페이지캐시)
    _JSON_쓰기(상태_경로, 건강)
    print(f"\n저장 완료: {csv_경로} (전체 {len(전체_데이터)}건)")

    실패 = [h["광고주"] for h in 건강 if h["상태"] == "읽기실패"]
    if 건강 and len(실패) / len(건강) > 0.3:
        # 데이터는 저장해 두고 빨간불을 켠다. 조용히 초록불로 지나가면 몇 주씩 모른다.
        print(f"[실패] 광고주 {len(실패)}/{len(건강)}곳을 읽지 못했습니다: {', '.join(실패)}")
        sys.exit(1)


if __name__ == "__main__":
    실행()
