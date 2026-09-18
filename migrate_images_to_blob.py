"""과거 광고 이미지를 구글 드라이브에서 우리 저장소(Vercel Blob)로 옮긴다.

수집 초기에는 메타 CDN 주소(scontent-*.fbcdn.net)를 그대로 저장했는데, 이 주소는
서명이 걸려 있어 지금은 전부 403이다. 그동안 파이프라인이 구글 드라이브에 사본을
올려뒀고 시트에 공개 링크(lh3.googleusercontent.com)가 남아 있어서, 그걸 받아
우리 저장소로 옮긴다. 드라이브 의존을 끊는 것이 목적이다.

입력: "ad_id앞12자 드라이브파일ID" 형태의 텍스트 파일 (시트에서 추출).
실행: DATABASE_URL, BLOB_READ_WRITE_TOKEN 환경변수 필요.

한 번만 돌리면 되는 성격이라 이미 옮긴 건은 건너뛴다. 중간에 끊겨도 다시 돌리면
남은 것만 처리한다.
"""

import io
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from src.image_store import 이미지_올리기

드라이브_주소 = "https://lh3.googleusercontent.com/d/{}"
동시_처리수 = 8


def _내려받기(파일ID):
    요청 = urllib.request.Request(
        드라이브_주소.format(파일ID),
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(요청, timeout=60) as 응답:
        return 응답.read()


def 실행(매핑_경로):
    접속 = os.environ.get("DATABASE_URL")
    if not 접속 or not os.environ.get("BLOB_READ_WRITE_TOKEN"):
        print("DATABASE_URL과 BLOB_READ_WRITE_TOKEN이 필요합니다.")
        return 1

    import psycopg

    매핑 = {}
    with io.open(매핑_경로, encoding="utf-8") as f:
        for 줄 in f:
            조각 = 줄.split()
            if len(조각) == 2:
                매핑[조각[0]] = 조각[1]
    print(f"매핑 {len(매핑):,}건")

    with psycopg.connect(접속) as 연결:
        with 연결.cursor() as 커서:
            # 아직 우리 저장소로 안 옮긴 것만 고른다.
            커서.execute(
                "select ad_id from ads "
                "where image_url is null or image_url not like '%blob.vercel-storage.com%'"
            )
            대상 = [r[0] for r in 커서.fetchall()]

    할일 = [(a, 매핑[a[:12]]) for a in 대상 if a[:12] in 매핑]
    print(f"이전 대상 {len(할일):,}건 (매핑 없는 {len(대상) - len(할일):,}건은 건너뜀)")
    if not 할일:
        return 0

    성공, 실패 = [], []

    def 한건(인자):
        ad_id, 파일ID = 인자
        try:
            바이트 = _내려받기(파일ID)
            url = 이미지_올리기(바이트, f"{ad_id}.jpg", 덮어쓰기=True)
            return ad_id, url, None
        except Exception as e:
            return ad_id, None, f"{type(e).__name__}: {str(e)[:60]}"

    시작 = time.time()
    with ThreadPoolExecutor(max_workers=동시_처리수) as 풀:
        for i, (ad_id, url, 오류) in enumerate(풀.map(한건, 할일), start=1):
            if url:
                성공.append((url, ad_id))
            else:
                실패.append((ad_id, 오류))
            if i % 100 == 0:
                print(f"  {i}/{len(할일)} ({time.time() - 시작:.0f}초)")

    if 성공:
        with psycopg.connect(접속) as 연결:
            with 연결.cursor() as 커서:
                커서.executemany("update ads set image_url = %s where ad_id = %s", 성공)
            연결.commit()

    print(f"\n완료: 성공 {len(성공):,}건 / 실패 {len(실패):,}건 ({time.time() - 시작:.0f}초)")
    for ad_id, 오류 in 실패[:5]:
        print(f"  실패 {ad_id}: {오류}")
    return 0


if __name__ == "__main__":
    경로 = sys.argv[1] if len(sys.argv) > 1 else "refhub_images.txt"
    sys.exit(실행(경로))
