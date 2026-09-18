"""광고 이미지를 어디에 둘지 한 곳에서 정하는 모듈.

지금은 Vercel Blob을 쓰지만 나중에 GCS(구글 클라우드 스토리지)로 옮길 계획이라,
호출하는 쪽은 "올리고 URL을 받는다"만 알게 하고 실제 저장 방식은 여기서만 안다.
옮길 때는 _GCS_업로드를 채우고 IMAGE_STORE 환경변수를 gcs로 바꾸면 된다.

왜 옮기는가: 원래는 메타 CDN 주소(scontent-*.fbcdn.net)를 그대로 저장했는데
서명이 걸려 있어 시간이 지나면 만료되고 외부에서 불러오면 차단된다. 그래서
수집 시점에 우리 저장소로 복사해 두고, 그 주소를 쓴다.
"""

import os

기본_저장소 = os.environ.get("IMAGE_STORE", "blob")


class 업로드실패(Exception):
    pass


def _확장자별_MIME(파일명):
    확장자 = os.path.splitext(파일명)[1].lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(확장자, "image/jpeg")


def _Blob_업로드(바이트, 저장경로, 덮어쓰기):
    """Vercel Blob에 올리고 공개 URL을 반환한다.

    SDK 없이 REST로 직접 올린다. 파이썬 파이프라인에 노드 의존성을 들이지 않기 위함이다.
    """
    import urllib.request

    토큰 = os.environ.get("BLOB_READ_WRITE_TOKEN")
    if not 토큰:
        raise 업로드실패("BLOB_READ_WRITE_TOKEN이 없습니다.")

    요청 = urllib.request.Request(
        f"https://blob.vercel-storage.com/{저장경로}",
        data=바이트,
        method="PUT",
        headers={
            "authorization": f"Bearer {토큰}",
            "x-api-version": "7",
            "x-content-type": _확장자별_MIME(저장경로),
            # 같은 파일명을 다시 올릴 때 임의의 접미사가 붙지 않게 한다.
            # 접미사가 붙으면 같은 소재가 매번 새 URL을 갖게 돼 중복 저장된다.
            "x-add-random-suffix": "0",
            "x-allow-overwrite": "1" if 덮어쓰기 else "0",
        },
    )
    import json

    with urllib.request.urlopen(요청, timeout=60) as 응답:
        return json.loads(응답.read()).get("url")


def _GCS_업로드(바이트, 저장경로, 덮어쓰기):
    """구글 클라우드 스토리지. GCP로 옮길 때 여기를 채운다.

    google-cloud-storage 클라이언트로 버킷에 올리고 공개 URL을 반환하면 된다.
    호출하는 쪽은 바뀌지 않는다.
    """
    raise 업로드실패("GCS 업로드는 아직 구현하지 않았습니다. IMAGE_STORE=blob으로 두세요.")


def 이미지_올리기(바이트, 파일명, 덮어쓰기=False, 저장소=None):
    """이미지 바이트를 저장소에 올리고 공개 URL을 반환한다.

    파일명은 ad_id 기반이라 광고 하나당 경로가 하나로 정해진다.
    """
    저장소 = 저장소 or 기본_저장소
    저장경로 = f"ads/{파일명}"
    if 저장소 == "blob":
        return _Blob_업로드(바이트, 저장경로, 덮어쓰기)
    if 저장소 == "gcs":
        return _GCS_업로드(바이트, 저장경로, 덮어쓰기)
    raise 업로드실패(f"모르는 저장소: {저장소}")


def 파일_올리기(파일경로, 덮어쓰기=False, 저장소=None):
    with open(파일경로, "rb") as f:
        바이트 = f.read()
    return 이미지_올리기(바이트, os.path.basename(파일경로), 덮어쓰기, 저장소)
