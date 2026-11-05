"""광고 이미지를 GCS 공개 버킷에 보관한다.

메타 CDN 주소(scontent-*.fbcdn.net)는 서명이 걸려 있어 시간이 지나면 만료되므로 수집 시점에
복사해 둔다. 예전엔 Vercel Blob을 썼는데 월 업로드 한도(2천 회)를 넘겨 저장소가 정지된 적이
있어 GCS로 옮겼다. GCS는 이 규모에서 한도를 걱정할 일이 없다.

버킷은 IMAGE_BUCKET 환경변수(기본 insurance-monitor-playd-images).
"""

import os

from src.gcp import 올리기

버킷 = os.environ.get("IMAGE_BUCKET", "insurance-monitor-playd-images")


def _MIME(파일명):
    return {".png": "image/png", ".webp": "image/webp"}.get(os.path.splitext(파일명)[1].lower(), "image/jpeg")


def 이미지_올리기(바이트, 파일명, 덮어쓰기=True):
    return 올리기(버킷, f"ads/{파일명}", 바이트, _MIME(파일명))


def 파일_올리기(경로, 덮어쓰기=True):
    with open(경로, "rb") as f:
        return 이미지_올리기(f.read(), os.path.basename(경로), 덮어쓰기)
