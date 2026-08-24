"""분류 기준 전면 개편(소재유형/보종/소구포인트) 반영 - 누적 데이터 전체 재분류.

기존 classify.py는 "소재유형이 비어 있고 로컬 이미지가 있는" 행만 대상으로 하지만,
이 스크립트는 CSV에 있는 모든 행(운영중/종료 불문)을 대상으로 소재유형/보종/
소구포인트/요약을 처음부터 다시 채운다.

이미지 소스 우선순위 (최대한 이미지 기반으로 분류하기 위해):
1. 로컬 파일 (data/images/ - 현재 실행 중 수집된 운영중 소재)
2. 구글 시트에 이미 기록된 구글 드라이브 영구 링크 (과거에 정상 동기화된 적 있는 소재)
3. 위 둘 다 없으면 광고텍스트만으로 분류 (텍스트전용)

각 행이 어떤 방식으로 분류됐는지 콘솔에 남겨 누락/오차를 추적할 수 있게 한다.
완료 후 sheets_sync.시트_동기화를 강제_분류_덮어쓰기=True로 호출해 시트에 반영한다.
"""

import os
import signal
import tempfile
import time
import urllib.request

from src.classifier import 모델_생성, 광고_분류, 광고_분류_텍스트전용
from src.config_loader import 경로_절대화, 설정_불러오기
from src.csv_store import CSV_쓰기, CSV_읽기
from src.sheets_sync import (
    구글_인증, 설정_시트_초기화, 워크시트_가져오기, 시트_동기화, 설정_동적_적용,
)

# API 호출 간 대기 시간(초). OpenAI 유료 키 기준으로 Gemini 무료티어보다 훨씬 여유있게 잡되,
# 예기치 못한 레이트리밋을 피하기 위해 약간의 간격은 둔다.
호출_간격_초 = 1.5

# 연속으로 이 횟수만큼 실패하면 API 자체에 문제가 있는 것으로 보고 중단한다.
연속_실패_허용_횟수 = 5

# 한 건당 최대 대기 시간(초)
호출_최대_대기_초 = 75

# 몇 건마다 CSV에 중간 저장할지 (중간에 끊겨도 여기까지는 보존)
체크포인트_간격 = 25


class _호출_시간초과(Exception):
    pass


def _시간초과_핸들러(signum, frame):
    raise _호출_시간초과()


def _시트_이미지URL_맵_읽기(gc, 설정):
    """구글 시트에 이미 기록된 ad_id -> 이미지URL(드라이브 영구 링크) 매핑을 읽는다."""
    worksheet = 워크시트_가져오기(gc, 설정)
    값 = worksheet.get_all_values()
    if not 값:
        return {}
    헤더 = 값[0]
    if "ad_id" not in 헤더 or "이미지URL" not in 헤더:
        return {}
    ad_id_열 = 헤더.index("ad_id")
    이미지url_열 = 헤더.index("이미지URL")
    맵 = {}
    for 행 in 값[1:]:
        if len(행) > max(ad_id_열, 이미지url_열) and 행[ad_id_열] and 행[이미지url_열]:
            맵[행[ad_id_열]] = 행[이미지url_열]
    return 맵


def _드라이브_이미지_다운로드(url, 저장_폴더):
    """구글 드라이브 영구 링크(lh3.googleusercontent.com)에서 이미지를 받아 임시 파일로 저장한다.

    실패하면 None을 반환한다 (호출 측에서 텍스트전용으로 폴백).
    """
    try:
        요청 = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(요청, timeout=30) as 응답:
            content_type = 응답.headers.get("Content-Type", "image/jpeg")
            데이터 = 응답.read()
    except Exception:
        return None

    확장자 = ".png" if "png" in content_type else ".webp" if "webp" in content_type else ".jpg"
    fd, 임시경로 = tempfile.mkstemp(suffix=확장자, dir=저장_폴더)
    with os.fdopen(fd, "wb") as f:
        f.write(데이터)
    return 임시경로


def _이미지_경로_결정(행, ad_id, 이미지_폴더, 드라이브_맵, 임시_파일_목록):
    """(이미지_경로 또는 None, 사용한_방법) 튜플을 반환한다. 사용한_방법: 로컬/드라이브/텍스트전용."""
    로컬_경로 = os.path.join(이미지_폴더, 행["이미지파일명"]) if 행.get("이미지파일명") else None
    if 로컬_경로 and os.path.exists(로컬_경로):
        return 로컬_경로, "로컬"

    드라이브_url = 드라이브_맵.get(ad_id, "")
    if 드라이브_url.startswith("https://lh3.googleusercontent.com"):
        다운로드_경로 = _드라이브_이미지_다운로드(드라이브_url, 이미지_폴더)
        if 다운로드_경로:
            임시_파일_목록.append(다운로드_경로)
            return 다운로드_경로, "드라이브"

    return None, "텍스트전용"


def 실행():
    설정 = 설정_불러오기()
    서비스계정_경로 = 경로_절대화(설정["google_sheets"]["service_account_file"])
    설정 = 설정_동적_적용(설정, 서비스계정_경로)

    csv_경로 = 경로_절대화(설정["paths"]["csv_file"])
    이미지_폴더 = 경로_절대화(설정["paths"]["images_dir"])
    os.makedirs(이미지_폴더, exist_ok=True)

    전체_데이터 = CSV_읽기(csv_경로)
    if not 전체_데이터:
        print("CSV에 데이터가 없습니다.")
        return

    gc = 구글_인증(서비스계정_경로)
    설정_시트_초기화(gc, 설정)
    드라이브_맵 = _시트_이미지URL_맵_읽기(gc, 설정)

    대상_목록 = sorted(전체_데이터.keys())

    print("=" * 60)
    print(f"전체 재분류 시작 [{설정.get('ai_provider')}] - 대상: {len(대상_목록)}건")
    print(f"(시트에 기록된 드라이브 이미지 링크: {len(드라이브_맵)}건 확인)")
    print("=" * 60)

    model = 모델_생성(설정)

    방법별_건수 = {"로컬": 0, "드라이브": 0, "텍스트전용": 0}
    실패_목록 = []
    임시_파일_목록 = []
    성공_개수 = 0
    연속_실패_횟수 = 0

    try:
        for i, ad_id in enumerate(대상_목록, start=1):
            행 = 전체_데이터[ad_id]
            이미지_경로, 방법 = _이미지_경로_결정(행, ad_id, 이미지_폴더, 드라이브_맵, 임시_파일_목록)
            방법별_건수[방법] += 1

            try:
                if hasattr(signal, "SIGALRM"):
                    signal.signal(signal.SIGALRM, _시간초과_핸들러)
                    signal.alarm(호출_최대_대기_초)

                if 이미지_경로:
                    결과 = 광고_분류(model, 이미지_경로, 행["광고주"], 행["광고텍스트"], 설정)
                else:
                    결과 = 광고_분류_텍스트전용(model, 행["광고주"], 행["광고텍스트"], 설정)

                행["소재유형"] = 결과["소재유형"]
                행["보종"] = 결과["보종"]
                행["소구포인트"] = 결과["소구포인트"]
                행["요약"] = 결과["요약"]
                성공_개수 += 1
                연속_실패_횟수 = 0
                print(f"[{i}/{len(대상_목록)}] ({방법}) {행['광고주']} / {ad_id} "
                      f"-> {결과['소재유형']}/{결과['보종']}/{결과['소구포인트']}")
            except _호출_시간초과:
                print(f"[{i}/{len(대상_목록)}] {ad_id} - 시간 초과, 건너뜀")
                실패_목록.append((ad_id, "시간초과"))
                연속_실패_횟수 += 1
            except Exception as e:
                print(f"[{i}/{len(대상_목록)}] {ad_id} - 실패: {e}")
                실패_목록.append((ad_id, str(e)))
                연속_실패_횟수 += 1
            finally:
                if hasattr(signal, "SIGALRM"):
                    signal.alarm(0)

            if 연속_실패_횟수 >= 연속_실패_허용_횟수:
                print(f"\n{연속_실패_허용_횟수}건 연속 실패 - API에 문제가 있는 것으로 보고 중단합니다.")
                print("(지금까지 처리된 내용은 CSV에 저장됩니다. 원인 확인 후 다시 실행하면 이어서 진행됩니다.)")
                break

            if i % 체크포인트_간격 == 0:
                CSV_쓰기(csv_경로, 전체_데이터)
                print(f"  [체크포인트] {i}건까지 CSV 저장 완료")

            time.sleep(호출_간격_초)
    finally:
        CSV_쓰기(csv_경로, 전체_데이터)
        for 경로 in 임시_파일_목록:
            try:
                os.remove(경로)
            except OSError:
                pass

    print("\n" + "=" * 60)
    print(f"재분류 완료: 성공 {성공_개수}건 / 실패 {len(실패_목록)}건")
    print(f"  방법별: 로컬이미지 {방법별_건수['로컬']}건 / 드라이브이미지 {방법별_건수['드라이브']}건 / "
          f"텍스트전용 {방법별_건수['텍스트전용']}건")
    if 실패_목록:
        print("  실패 목록 (ad_id, 사유):")
        for ad_id, 사유 in 실패_목록:
            print(f"    - {ad_id}: {사유}")
    print(f"저장 완료: {csv_경로}")

    if 성공_개수 == 0:
        print("성공한 건이 없어 시트 동기화를 건너뜁니다.")
        return

    print("\n구글 시트에 강제 반영 중 (기존 값도 새 분류 결과로 덮어씁니다)...")
    신규, 갱신, 삭제 = 시트_동기화(설정, csv_경로, 이미지_폴더, 서비스계정_경로, 강제_분류_덮어쓰기=True)
    print(f"시트 반영 완료: 신규 {신규}건 / 갱신 {갱신}건 / 삭제 {삭제}건")


if __name__ == "__main__":
    실행()
