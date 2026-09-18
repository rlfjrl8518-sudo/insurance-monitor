"""한화손해보험 경쟁사 메타 광고 소재 모니터링 - 2단계: AI 분류.

CSV에 저장된 광고 중 아직 분류되지 않은(소재유형이 비어 있는) 광고에 대해
NVIDIA NIM API로 이미지+텍스트를 분석하여 소재유형/보종/소구포인트/요약을 채운다.
"""

import os
import threading
from concurrent.futures import ThreadPoolExecutor

from src.classifier import 모델_생성, 광고_분류, 광고_분류_텍스트전용
from src.config_loader import 경로_절대화, 설정_불러오기
from src.csv_store import CSV_쓰기, CSV_읽기
from src.sheets_sync import 설정_동적_적용

# 한 건당 타임아웃은 설정(nvidia.timeout)에서 SDK에 직접 넘긴다.
# 예전에는 SIGALRM으로 한 번 더 끊었으나, 병렬 처리에서는 메인 스레드에만 걸려
# 의미가 없어 제거했다.


# 레이트리밋이 이 횟수를 넘으면 할당량이 실제로 바닥난 것으로 보고 남은 건을 포기한다.
# 무료 티어는 순간 혼잡으로도 레이트리밋이 나므로 한두 건으로 중단하면 안 된다.
할당량_실패_허용_횟수 = 10


def _할당량_초과_예외인가(e):
    """더 던져봐야 소용없는 할당량/레이트리밋 예외인지 확인한다."""
    return type(e).__name__ in ("RateLimitError", "ResourceExhausted", "TooManyRequests")


def 실행():
    설정 = 설정_불러오기()
    서비스계정_경로 = 경로_절대화(설정["google_sheets"]["service_account_file"])
    설정 = 설정_동적_적용(설정, 서비스계정_경로)

    nvidia_키 = 설정.get("nvidia", {}).get("api_key", "")
    if not nvidia_키 or "여기에_" in nvidia_키:
        # 여기서 조용히 0으로 끝내면 워크플로가 초록불이 된다. 실제로 그렇게
        # 며칠치가 분류되지 않은 채 "성공"으로 지나갔다. 키가 없으면 빨간불로 세운다.
        print("NVIDIA API 키가 없습니다. GitHub Secrets의 NVIDIA_API_KEY를 확인하세요.")
        raise SystemExit(1)

    csv_경로 = 경로_절대화(설정["paths"]["csv_file"])
    이미지_폴더 = 경로_절대화(설정["paths"]["images_dir"])

    전체_데이터 = CSV_읽기(csv_경로)
    if not 전체_데이터:
        print("CSV에 데이터가 없습니다. 먼저 main.py로 광고를 수집해주세요.")
        return

    def _이미지_경로(행):
        """로컬에 실제로 내려받아진 이미지 경로. 없으면 None."""
        파일명 = 행.get("이미지파일명")
        if not 파일명:
            return None
        경로 = os.path.join(이미지_폴더, 파일명)
        return 경로 if os.path.exists(경로) else None

    # 이미지가 없어도 광고텍스트만으로 분류한다. 예전에는 이미지가 있는 건만 골라서
    # 돌렸는데, 종료된 광고는 이미지를 내려받지 못해 매일 실행해도 영영 미분류로
    # 남았다. 텍스트 전용 분류가 어차피 더 빠르므로 건너뛸 이유가 없다.
    대상_목록 = [행 for 행 in 전체_데이터.values()
              if not 행.get("소재유형") and (행.get("광고텍스트") or "").strip()]
    이미지없음_건수 = sum(1 for 행 in 대상_목록 if _이미지_경로(행) is None)

    동시_요청수 = 설정["nvidia"].get("동시_요청수", 6)
    print("=" * 60)
    print(f"AI 분류 시작 [{설정['nvidia']['model']}] - 대상: {len(대상_목록)}건 / 전체: {len(전체_데이터)}건")
    print(f"동시 요청 {동시_요청수}개")
    if 이미지없음_건수:
        print(f"(이미지 없이 텍스트만으로 분류: {이미지없음_건수}건 - 종료된 광고 등)")
    print("=" * 60)

    if not 대상_목록:
        print("분류가 필요한 광고가 없습니다.")
        return

    client = 모델_생성(설정)
    # 할당량이 정말 바닥났으면 남은 건을 던져봐야 전부 실패하므로 접는다.
    # 다만 무료 티어는 순간 혼잡으로도 레이트리밋을 뱉으므로 한 건으로는 판단하지
    # 않는다 (SDK가 이미 nvidia.max_retries만큼 재시도한 뒤 올라온 실패다).
    중단 = threading.Event()
    할당량_실패 = 0
    실패_잠금 = threading.Lock()

    def 한건(행):
        nonlocal 할당량_실패
        if 중단.is_set():
            return 행, None, "중단"
        이미지_경로 = _이미지_경로(행)
        try:
            if 이미지_경로:
                결과 = 광고_분류(client, 이미지_경로, 행["광고주"], 행["광고텍스트"], 설정)
            else:
                결과 = 광고_분류_텍스트전용(client, 행["광고주"], 행["광고텍스트"], 설정)
            return 행, 결과, None
        except Exception as e:
            if _할당량_초과_예외인가(e):
                with 실패_잠금:
                    할당량_실패 += 1
                    if 할당량_실패 >= 할당량_실패_허용_횟수:
                        중단.set()
            return 행, None, e

    성공_개수 = 실패_개수 = 0
    with ThreadPoolExecutor(max_workers=동시_요청수) as 풀:
        for i, (행, 결과, 오류) in enumerate(풀.map(한건, 대상_목록), start=1):
            if 결과:
                # 확장 축이 켜져 있으면 결과에 축이 더 들어오므로 통째로 반영한다.
                # CSV_컬럼에 없는 키는 저장 시 무시되니 여기서 걸러낼 필요가 없다.
                행.update(결과)
                성공_개수 += 1
                print(f"[{i}/{len(대상_목록)}] {행['광고주']} / {행['ad_id']} "
                      f"-> 소재유형:{결과['소재유형']}, 보종:{결과['보종']}, "
                      f"소구포인트:{결과['소구포인트']}")
            else:
                실패_개수 += 1
                if 오류 != "중단":
                    print(f"[{i}/{len(대상_목록)}] {행['ad_id']} - 분류 실패: {오류}")

    if 중단.is_set():
        print("할당량이 초과되어 남은 광고는 건너뛰었습니다. (다음 실행에서 다시 시도합니다)")

    CSV_쓰기(csv_경로, 전체_데이터)
    print("\n" + "=" * 60)
    print(f"분류 완료: 성공 {성공_개수}건 / 실패 {실패_개수}건")
    print(f"저장 완료: {csv_경로}")


if __name__ == "__main__":
    실행()
