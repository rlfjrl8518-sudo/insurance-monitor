"""GCP 인증과 GCS 읽기·쓰기. 새 의존성 없이 google-auth(이미 설치됨)의 세션으로 REST를 부른다.

인증 순서: 서비스계정 키 파일(로컬·옛 Actions) → 기본 자격증명(Cloud Run에서는 잡의 서비스계정).
Cloud Run에서는 키 파일이 없어도 된다. 키를 어디에도 두지 않는 게 이전의 목적 중 하나다.
"""

import os
import threading
from urllib.parse import quote

_범위 = ["https://www.googleapis.com/auth/cloud-platform"]
_잠금 = threading.Lock()
_캐시 = {}


def 자격증명(키파일=None):
    """(credentials, project_id). 키 파일이 있으면 그걸, 없으면 기본 자격증명."""
    import google.auth
    from google.oauth2 import service_account

    키파일 = 키파일 or os.environ.get("GCP_SERVICE_ACCOUNT_FILE")
    if 키파일 and os.path.exists(키파일):
        c = service_account.Credentials.from_service_account_file(키파일, scopes=_범위)
        return c, c.project_id
    return google.auth.default(scopes=_범위)


def 세션():
    from google.auth.transport.requests import AuthorizedSession

    with _잠금:
        if "세션" not in _캐시:
            _캐시["세션"] = AuthorizedSession(자격증명()[0])
        return _캐시["세션"]


def 올리기(버킷, 이름, 바이트, 종류="application/octet-stream"):
    """버킷/이름에 덮어써서 올리고 공개 주소를 돌려준다(공개 여부는 버킷 권한이 정한다)."""
    r = 세션().post(
        f"https://storage.googleapis.com/upload/storage/v1/b/{버킷}/o",
        params={"uploadType": "media", "name": 이름},
        data=바이트, headers={"Content-Type": 종류}, timeout=60)
    r.raise_for_status()
    return f"https://storage.googleapis.com/{버킷}/{quote(이름)}"


def 받기(버킷, 이름):
    """없으면 None."""
    r = 세션().get(f"https://storage.googleapis.com/storage/v1/b/{버킷}/o/{quote(이름, safe='')}",
                 params={"alt": "media"}, timeout=60)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.content
