"""구글시트에 남아 있는 드라이브 사본 주소를 Postgres로 끌어온다.

Blob 저장소가 업로드 한도를 넘겨 정지됐고(10/19 리셋), 그 사이 보관 주소가 전부
만료될 메타 주소로 덮어써졌다. 그래서 새 대시보드의 이미지가 전부 깨진 상태다.

다행히 파이프라인 3단계가 같은 이미지를 구글 드라이브에도 올려왔고, 그 공개
주소(lh3.googleusercontent.com)가 시트의 "이미지URL" 열에 남아 있다. Blob과
무관한 별개의 사본이라 지금 바로 쓸 수 있다.

Blob이 다시 열리면 restore_blob_urls.py로 되돌리면 된다. 그때까지 한 달을
빈 화면으로 보내지 않기 위한 임시 조치다.

CSV(data/ads.csv)는 건드리지 않는다. CSV의 이미지URL은 Blob 주소를 기억하는
자리이고, 여기서 덮어쓰면 복구할 근거를 잃는다. 웹 대시보드가 읽는 Postgres만 바꾼다.

    python pull_drive_urls.py            # 무엇이 바뀔지만 보여준다
    python pull_drive_urls.py --적용     # 실제로 Postgres에 쓴다
"""

import os
import sys

from src.config_loader import 경로_절대화, 설정_불러오기
from src.sheets_sync import 구글_인증

드라이브_호스트 = "lh3.googleusercontent.com"


def 시트에서_읽기(설정, 서비스계정_경로):
    """시트의 (ad_id, 이미지URL) 쌍 중 드라이브 주소인 것만 돌려준다."""
    gc = 구글_인증(서비스계정_경로)
    스프레드시트 = gc.open_by_key(설정["google_sheets"]["spreadsheet_id"])
    워크시트 = 스프레드시트.worksheet(설정["google_sheets"]["worksheet_name"])

    값 = 워크시트.get_all_values()
    if len(값) < 2:
        return {}

    헤더 = 값[0]
    try:
        id_열 = 헤더.index("ad_id")
        url_열 = 헤더.index("이미지URL")
    except ValueError:
        print("시트에서 ad_id / 이미지URL 열을 찾지 못했습니다.")
        return {}

    결과 = {}
    for 행 in 값[1:]:
        if len(행) <= max(id_열, url_열):
            continue
        ad_id, url = 행[id_열].strip(), 행[url_열].strip()
        if ad_id and 드라이브_호스트 in url:
            결과[ad_id] = url
    return 결과


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

    주소표 = 시트에서_읽기(설정, 서비스계정_경로)
    print(f"시트에서 찾은 드라이브 주소: {len(주소표):,}건")
    if not 주소표:
        return 1

    import psycopg

    with psycopg.connect(접속) as 연결:
        with 연결.cursor() as 커서:
            커서.execute(
                "select ad_id from ads where image_url like %s", ("%fbcdn.net%",)
            )
            깨진것 = {r[0] for r in 커서.fetchall()}
            고칠것 = {k: v for k, v in 주소표.items() if k in 깨진것}
            print(f"이미지가 깨진 행: {len(깨진것):,}건")
            print(f"그중 드라이브 사본이 있는 것: {len(고칠것):,}건")

            if not 적용:
                print("\n미리보기입니다. 실제로 쓰려면 --적용 을 붙이세요.")
                for k, v in list(고칠것.items())[:3]:
                    print(f"  {k} -> {v}")
                return 0

            커서.executemany(
                "update ads set image_url = %s where ad_id = %s",
                [(v, k) for k, v in 고칠것.items()],
            )
            바뀜 = len(고칠것)
        연결.commit()

    print(f"Postgres 갱신 완료: {바뀜:,}건")
    print("Blob이 다시 열리면 restore_blob_urls.py로 되돌리세요.")
    return 0


if __name__ == "__main__":
    sys.exit(실행())
