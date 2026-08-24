"""CSV에 이미 채워진 분류 결과를 AI 호출 없이 구글 시트에 그대로 반영한다.

reclassify_all.py와 달리 AI 분류를 전혀 수행하지 않는다 (OpenAI/Gemini 비용 없음).
data/ads.csv의 소재유형/보종/소구포인트/요약 값을 그대로 시트에 강제
반영(강제_분류_덮어쓰기=True)한다 - 분류 기준 개편 후 수동/직접 채운 값을 밀어넣을 때 사용.
"""

from src.config_loader import 경로_절대화, 설정_불러오기
from src.sheets_sync import 구글_인증, 설정_시트_초기화, 시트_동기화, 설정_동적_적용


def 실행():
    설정 = 설정_불러오기()
    서비스계정_경로 = 경로_절대화(설정["google_sheets"]["service_account_file"])
    설정 = 설정_동적_적용(설정, 서비스계정_경로)

    csv_경로 = 경로_절대화(설정["paths"]["csv_file"])
    이미지_폴더 = 경로_절대화(설정["paths"]["images_dir"])

    gc = 구글_인증(서비스계정_경로)
    설정_시트_초기화(gc, 설정)

    print("=" * 60)
    print("CSV -> 구글 시트 강제 반영 시작 (AI 호출 없음)")
    print("=" * 60)

    신규, 갱신, 삭제 = 시트_동기화(설정, csv_경로, 이미지_폴더, 서비스계정_경로, 강제_분류_덮어쓰기=True)
    print(f"완료: 신규 {신규}건 / 갱신 {갱신}건 / 삭제 {삭제}건")


if __name__ == "__main__":
    실행()
