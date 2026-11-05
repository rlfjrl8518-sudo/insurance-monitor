"""경쟁사 메타 광고 소재 모니터링 - 2단계: AI 분류 (Vertex AI Gemini).

CSV에서 아직 분류되지 않은(소재유형이 빈) 광고를 이미지+텍스트로 한 번에 분류한다.
로컬 이미지가 없으면 보관 주소(Blob·드라이브)에서 받아 쓰고, 그것도 없으면 텍스트만 쓴다.

성공률이 절반 아래면 실패(exit 1)로 끝낸다. 예전엔 652건이 전부 실패해도 초록불이라
6주 동안 아무도 몰랐다.
"""

from src.text_utils import 고지문_제거
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

from src.classifier import 모델_생성, 광고_분류
from src.config_loader import 경로_절대화, 설정_불러오기
from src.csv_store import CSV_쓰기, CSV_읽기
from src.sheets_sync import 설정_동적_적용

# 레이트리밋이 이 횟수를 넘으면 할당량이 바닥난 것으로 보고 남은 건을 다음 회차로 미룬다.
할당량_실패_허용_횟수 = 10
# 이만큼마다 중간 저장한다. 백필처럼 큰 회차가 중간에 끊겨도 여기까지는 남는다.
체크포인트_간격 = 50


def _할당량_초과_예외인가(e):
    return type(e).__name__ in ("RateLimitError", "ResourceExhausted", "TooManyRequests")


축이름 = {"creative_type": "소재유형", "insurance_type": "보종", "appeal_point": "소구포인트"}


def 교정사례_불러오기(최대=40):
    """웹 '분류 고치기'로 사람이 고친 최근 사례. DB가 없거나(로컬) 실패하면 빈 목록 — 분류는 그대로 돈다."""
    주소 = os.environ.get("DATABASE_URL")
    if not 주소:
        return []
    try:
        import psycopg

        with psycopg.connect(주소, connect_timeout=10) as 연결:
            행들 = 연결.execute(
                "select o.axis, o.ai_value, o.value, coalesce(a.ad_text, '') from label_overrides o "
                "join ads a on a.ad_id = o.ad_id "
                "where o.axis = any(%s) and o.ai_value is distinct from o.value "
                "order by o.updated_at desc nulls last limit %s",
                (list(축이름), 최대),
            ).fetchall()
    except Exception as e:
        print(f"교정 사례를 못 읽어 예시 없이 분류합니다: {e}")
        return []
    return [(축이름[축], ai, 사람, 고지문_제거(본문)) for 축, ai, 사람, 본문 in 행들]


def 실행(전체_재분류=False):
    설정 = 설정_불러오기()
    서비스계정_경로 = 경로_절대화(설정["google_sheets"]["service_account_file"])
    설정 = 설정_동적_적용(설정, 서비스계정_경로)
    설정["교정사례"] = 교정사례_불러오기()
    print(f"교정 사례 {len(설정['교정사례'])}건을 프롬프트에 붙입니다.")

    csv_경로 = 경로_절대화(설정["paths"]["csv_file"])
    이미지_폴더 = 경로_절대화(설정["paths"]["images_dir"])
    전체_데이터 = CSV_읽기(csv_경로)

    def _이미지(행):
        파일명 = 행.get("이미지파일명")
        경로 = os.path.join(이미지_폴더, 파일명) if 파일명 else ""
        return 경로 if 경로 and os.path.exists(경로) else 행.get("이미지URL")

    대상_목록 = [행 for 행 in 전체_데이터.values()
              if (전체_재분류 or not 행.get("소재유형"))
              and ((행.get("광고텍스트") or "").strip() or 행.get("이미지URL"))]
    print("=" * 60)
    print(f"AI 분류 - 대상 {len(대상_목록)}건 / 전체 {len(전체_데이터)}건")
    print("=" * 60)
    if not 대상_목록:
        print("분류가 필요한 광고가 없습니다.")
        return 0

    client = 모델_생성(설정)
    중단 = threading.Event()
    잠금 = threading.Lock()
    할당량_실패 = 0

    def 한건(행):
        nonlocal 할당량_실패
        if 중단.is_set():
            return 행, None, "중단"
        try:
            return 행, 광고_분류(client, _이미지(행), 행["광고주"], 행.get("광고텍스트") or "", 설정), None
        except Exception as e:
            if _할당량_초과_예외인가(e):
                with 잠금:
                    할당량_실패 += 1
                    if 할당량_실패 >= 할당량_실패_허용_횟수:
                        중단.set()
            return 행, None, e

    성공 = 실패 = 0
    with ThreadPoolExecutor(max_workers=설정["ai"].get("동시_요청수", 8)) as 풀:
        for i, (행, 결과, 오류) in enumerate(풀.map(한건, 대상_목록), start=1):
            if 결과:
                행.update(결과)
                성공 += 1
                print(f"[{i}/{len(대상_목록)}] {행['광고주']} / {행['ad_id']} -> "
                      f"{결과['소재유형']} · {결과['보종']} · {결과['소구포인트']} ({결과.get('확신도') or '-'})")
            else:
                실패 += 1
                if 오류 != "중단":
                    print(f"[{i}/{len(대상_목록)}] {행['ad_id']} - 분류 실패: {type(오류).__name__}: {str(오류)[:120]}")
            if i % 체크포인트_간격 == 0:
                CSV_쓰기(csv_경로, 전체_데이터)

    CSV_쓰기(csv_경로, 전체_데이터)
    print(f"\n분류 완료: 성공 {성공}건 / 실패 {실패}건 [{client.모델}]")
    if 중단.is_set():
        print("할당량 초과로 남은 건은 다음 실행에서 이어서 합니다.")
    if 성공 < (성공 + 실패) / 2:
        print("[실패] 성공률이 50% 미만입니다. 모델·권한·할당량을 확인하세요.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(실행(전체_재분류="--all" in sys.argv))
