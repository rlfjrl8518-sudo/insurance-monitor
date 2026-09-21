"""보관해 둔 이미지 주소를 되돌린다. (Blob 저장소 재개 후 1회 실행)

Blob 저장소가 정지된 동안 업로드가 계속 실패했고, 실패하면 메타 CDN 주소를 그대로
쓰도록 되어 있어서 이미 보관해 둔 주소가 매 수집마다 덮어써졌다. 저장소의 파일들은
그대로 있고 경로가 ads/{이미지파일명}으로 고정이라, 파일명만 있으면 주소를 다시
만들 수 있다.

운영 중인 광고는 다음 수집에서 어차피 다시 업로드되지만, 종료된 광고는 다시 수집되지
않아 스스로 복구되지 않는다. 그래서 한 번 훑어준다.

실행 전에 저장소가 살아 있는지 먼저 확인한다. 정지된 상태에서 돌리면 멀쩡한(아직
만료되지 않은) 메타 주소를 403 나는 주소로 바꿔놓게 된다.

    python restore_blob_urls.py            # 무엇이 바뀔지만 보여준다
    python restore_blob_urls.py --적용     # 실제로 CSV와 Postgres에 쓴다
"""

import csv
import io
import os
import sys
import urllib.error
import urllib.request

from src.config_loader import 경로_절대화, 설정_불러오기
from src.csv_store import _임시_주소인가

BLOB_기본주소 = os.environ.get(
    "BLOB_BASE_URL", "https://tnrv9jhx86xbg2xa.public.blob.vercel-storage.com"
)


def 보관_주소(이미지파일명):
    return f"{BLOB_기본주소}/ads/{이미지파일명}"


def 저장소_살아있나(표본_주소):
    """정지된 저장소는 공개 주소도 403을 낸다. 한 장만 찔러보고 판단한다."""
    try:
        요청 = urllib.request.Request(표본_주소, method="HEAD")
        with urllib.request.urlopen(요청, timeout=10) as 응답:
            return 응답.status == 200
    except urllib.error.HTTPError as e:
        print(f"  저장소 응답: HTTP {e.code}")
        return False
    except Exception as e:
        print(f"  저장소 확인 실패: {type(e).__name__}: {e}")
        return False


def 실행():
    적용 = "--적용" in sys.argv
    설정 = 설정_불러오기()
    csv_경로 = 경로_절대화(설정["paths"]["csv_file"])

    with io.open(csv_경로, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        열 = reader.fieldnames
        행들 = list(reader)

    대상 = [
        r for r in 행들
        if r.get("이미지파일명") and _임시_주소인가(r.get("이미지URL"))
    ]
    if not 대상:
        print("되돌릴 행이 없습니다.")
        return 0

    print(f"되돌릴 대상: {len(대상):,}건 / 전체 {len(행들):,}건")
    print(f"저장소 확인: {보관_주소(대상[0]['이미지파일명'])}")
    if not 저장소_살아있나(보관_주소(대상[0]["이미지파일명"])):
        print("\n저장소가 아직 응답하지 않습니다. 재개된 뒤에 다시 실행하세요.")
        print("(지금 되돌리면 아직 살아 있는 메타 주소까지 403으로 바꿔놓게 됩니다)")
        return 1
    print("  저장소 정상")

    상태별 = {}
    for r in 대상:
        상태별[r.get("상태", "")] = 상태별.get(r.get("상태", ""), 0) + 1
    print("  상태별:", ", ".join(f"{k} {v}건" for k, v in sorted(상태별.items())))

    if not 적용:
        print("\n미리보기입니다. 실제로 쓰려면 --적용 을 붙이세요.")
        for r in 대상[:3]:
            print(f"  {r['ad_id']}: {r['이미지URL'][:55]}...\n    -> {보관_주소(r['이미지파일명'])}")
        return 0

    for r in 대상:
        r["이미지URL"] = 보관_주소(r["이미지파일명"])
    with io.open(csv_경로, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=열, restval="", extrasaction="ignore")
        w.writeheader()
        w.writerows(행들)
    print(f"CSV 갱신 완료: {csv_경로}")

    접속 = os.environ.get("DATABASE_URL")
    if not 접속:
        print("DATABASE_URL이 없어 Postgres는 건너뜁니다. push_to_postgres.py로 반영하세요.")
        return 0

    import psycopg

    with psycopg.connect(접속) as 연결:
        with 연결.cursor() as 커서:
            커서.execute(
                """
                update ads
                   set image_url = %s || '/ads/' || image_filename
                 where image_filename is not null and image_filename <> ''
                   and image_url like '%%fbcdn.net%%'
                """,
                (BLOB_기본주소,),
            )
            바뀜 = 커서.rowcount
        연결.commit()
    print(f"Postgres 갱신 완료: {바뀜:,}건")
    return 0


if __name__ == "__main__":
    sys.exit(실행())
