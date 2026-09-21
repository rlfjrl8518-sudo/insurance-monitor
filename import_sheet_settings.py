"""구글시트 '설정' 탭의 내용을 웹 대시보드 설정(settings 테이블)으로 가져온다.

웹 대시보드에 설정 화면을 만들어 뒀지만, 처음에는 비어 있다. 비어 있는 항목은
시트 값을 그대로 쓰도록 되어 있어서 동작에는 문제가 없지만, 화면에서 지금 무엇이
등록돼 있는지 볼 수가 없다. 시트를 열어봐야만 알 수 있다.

이 스크립트로 한 번 가져오면 그 뒤로는 대시보드에서 보고 고칠 수 있다.
(웹 값이 시트 값을 이기므로, 가져온 뒤에는 대시보드가 실질적인 설정 화면이 된다.)

시트 자격 증명이 GitHub Secrets에만 있어서 워크플로로 돌린다.

    python import_sheet_settings.py            # 무엇이 들어갈지만 보여준다
    python import_sheet_settings.py --적용     # 실제로 settings 테이블에 쓴다
"""

import json
import os
import sys

from src.config_loader import 경로_절대화, 설정_불러오기
from src.sheets_sync import 구글_인증, 설정_시트_읽기


def 실행():
    적용 = "--적용" in sys.argv
    설정 = 설정_불러오기()
    서비스계정_경로 = 경로_절대화(설정["google_sheets"]["service_account_file"])

    if "여기에_" in 설정["google_sheets"]["spreadsheet_id"] or not os.path.exists(서비스계정_경로):
        print("구글시트 자격 증명이 없습니다. GitHub Actions에서 실행하세요.")
        return 1

    접속 = os.environ.get("DATABASE_URL")
    if not 접속:
        print("DATABASE_URL이 없습니다.")
        return 1

    gc = 구글_인증(서비스계정_경로)
    시트설정 = 설정_시트_읽기(gc, 설정)

    카테고리 = 시트설정.get("카테고리") or {}
    분류 = {
        축: 시트설정.get(축) or []
        for 축 in ("소재유형", "보종", "소구포인트")
    }

    if not 카테고리:
        print("시트에서 광고주 카테고리를 찾지 못했습니다. 중단합니다.")
        return 1

    print("[광고주 카테고리]")
    for 이름, 목록 in 카테고리.items():
        print(f"  {이름} ({len(목록)}곳): {', '.join(목록)}")
    print("\n[분류 선택지]")
    for 축, 목록 in 분류.items():
        print(f"  {축} ({len(목록)}개): {', '.join(목록)}")

    if not 적용:
        print("\n미리보기입니다. 실제로 쓰려면 --적용 을 붙이세요.")
        return 0

    import psycopg

    쓸것 = [("advertiser_categories", 카테고리)]
    # 비어 있는 축까지 저장하면 "웹 값이 이긴다" 규칙 때문에 선택지가 사라진다.
    if any(분류.values()):
        쓸것.append(("classification", {k: v for k, v in 분류.items() if v}))

    with psycopg.connect(접속) as 연결:
        with 연결.cursor() as 커서:
            커서.executemany(
                """
                insert into settings (key, value, updated_at)
                values (%s, %s::jsonb, now())
                on conflict (key) do update
                   set value = excluded.value, updated_at = now()
                """,
                [(키, json.dumps(값, ensure_ascii=False)) for 키, 값 in 쓸것],
            )
        연결.commit()

    print(f"\nsettings 테이블에 기록했습니다: {', '.join(키 for 키, _ in 쓸것)}")
    print("이제 대시보드 설정 화면에서 보고 고칠 수 있습니다.")
    return 0


if __name__ == "__main__":
    sys.exit(실행())
