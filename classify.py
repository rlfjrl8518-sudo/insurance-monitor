"""한화손해보험 경쟁사 메타 광고 소재 모니터링 - 2단계: Gemini AI 분류.

CSV에 저장된 광고 중 아직 분류되지 않은(소재유형이 비어 있는) 광고에 대해
Gemini API로 이미지+텍스트를 분석하여 소재유형/보종/후킹/요약을 채운다.
"""

import os
import signal
import time

from google.api_core.exceptions import ResourceExhausted, TooManyRequests

from src.classifier import Gemini_모델_생성, 광고_분류
from src.config_loader import 경로_절대화, 설정_불러오기
from src.csv_store import CSV_쓰기, CSV_읽기
from src.sheets_sync import 설정_동적_적용

# Gemini API 호출 간 대기 시간(초) - 분당 호출 제한 대응
호출_간격_초 = 6.5

# 연속으로 이 횟수만큼 실패하면 API 자체에 문제가 있는 것으로 보고 나머지는 건너뜀
연속_실패_허용_횟수 = 3

# 한 건당 최대 대기 시간(초) - SDK의 request_options 타임아웃이 적용되지 않는
# 환경(예: CI)에서도 전체 실행이 멈추지 않도록 강제로 끊는다. (Windows에는 미적용)
# gemini-2.5-flash의 추론 시간을 고려해 request_options 타임아웃(60초)보다 넉넉하게 설정
호출_최대_대기_초 = 75


class _호출_시간초과(Exception):
    pass


def _시간초과_핸들러(signum, frame):
    raise _호출_시간초과()


def 실행():
    설정 = 설정_불러오기()
    서비스계정_경로 = 경로_절대화(설정["google_sheets"]["service_account_file"])
    설정 = 설정_동적_적용(설정, 서비스계정_경로)

    if "여기에_" in 설정["gemini"]["api_key"]:
        print("config.json의 gemini.api_key를 설정한 뒤 다시 실행해주세요.")
        return

    csv_경로 = 경로_절대화(설정["paths"]["csv_file"])
    이미지_폴더 = 경로_절대화(설정["paths"]["images_dir"])

    전체_데이터 = CSV_읽기(csv_경로)
    if not 전체_데이터:
        print("CSV에 데이터가 없습니다. 먼저 main.py로 광고를 수집해주세요.")
        return

    대상_목록 = [행 for 행 in 전체_데이터.values() if not 행.get("소재유형")]
    print("=" * 60)
    print(f"Gemini AI 분류 시작 - 분류 대상: {len(대상_목록)}건 / 전체: {len(전체_데이터)}건")
    print("=" * 60)

    if not 대상_목록:
        print("분류가 필요한 광고가 없습니다.")
        return

    model = Gemini_모델_생성(설정)

    성공_개수 = 0
    실패_개수 = 0
    연속_실패_횟수 = 0

    for i, 행 in enumerate(대상_목록, start=1):
        이미지_경로 = os.path.join(이미지_폴더, 행["이미지파일명"])
        if not os.path.exists(이미지_경로):
            print(f"[{i}/{len(대상_목록)}] {행['ad_id']} - 이미지 파일 없음, 건너뜀")
            실패_개수 += 1
            continue

        try:
            if hasattr(signal, "SIGALRM"):
                signal.signal(signal.SIGALRM, _시간초과_핸들러)
                signal.alarm(호출_최대_대기_초)

            결과 = 광고_분류(model, 이미지_경로, 행["광고주"], 행["광고텍스트"], 설정)
            행["소재유형"] = 결과["소재유형"]
            행["보종"] = 결과["보종"]
            행["후킹"] = 결과["후킹"]
            행["요약"] = 결과["요약"]
            성공_개수 += 1
            연속_실패_횟수 = 0
            print(f"[{i}/{len(대상_목록)}] {행['광고주']} / {행['ad_id']} "
                  f"-> 소재유형:{결과['소재유형']}, 보종:{결과['보종']}, 후킹:{결과['후킹']}")
        except (ResourceExhausted, TooManyRequests) as e:
            print(f"[{i}/{len(대상_목록)}] {행['ad_id']} - Gemini API 할당량 초과: {e}")
            print("할당량이 초과되어 남은 광고 분류를 건너뜁니다. (다음 실행에서 다시 시도합니다)")
            실패_개수 += len(대상_목록) - i + 1
            break
        except _호출_시간초과:
            print(f"[{i}/{len(대상_목록)}] {행['ad_id']} - Gemini API 응답 시간 초과({호출_최대_대기_초}초), 건너뜀")
            실패_개수 += 1
            연속_실패_횟수 += 1
            if 연속_실패_횟수 >= 연속_실패_허용_횟수:
                print(f"{연속_실패_허용_횟수}건 연속 실패하여 남은 광고 분류를 건너뜁니다. (다음 실행에서 다시 시도합니다)")
                실패_개수 += len(대상_목록) - i
                break
        except Exception as e:
            print(f"[{i}/{len(대상_목록)}] {행['ad_id']} - 분류 실패: {e}")
            실패_개수 += 1
            연속_실패_횟수 += 1
            if 연속_실패_횟수 >= 연속_실패_허용_횟수:
                print(f"{연속_실패_허용_횟수}건 연속 실패하여 남은 광고 분류를 건너뜁니다. (다음 실행에서 다시 시도합니다)")
                실패_개수 += len(대상_목록) - i
                break
        finally:
            if hasattr(signal, "SIGALRM"):
                signal.alarm(0)

        time.sleep(호출_간격_초)

    CSV_쓰기(csv_경로, 전체_데이터)
    print("\n" + "=" * 60)
    print(f"분류 완료: 성공 {성공_개수}건 / 실패 {실패_개수}건")
    print(f"저장 완료: {csv_경로}")


if __name__ == "__main__":
    실행()
