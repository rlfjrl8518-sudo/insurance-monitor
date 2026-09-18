"""웹 대시보드에서 저장한 설정을 Postgres에서 읽어온다.

지금까지 수집 대상 광고주와 분류 값 목록은 구글시트 "설정" 탭에만 있었다.
새 대시보드(insurance-monitor.vercel.app)에서도 같은 걸 고칠 수 있어야 해서
settings 테이블을 두고, 여기 값이 있으면 시트 값 위에 덮어쓴다.

시트를 당장 끊지는 않는다. 두 곳 다 살아 있는 동안에는 "웹에서 고친 게 이긴다"는
규칙 하나만 지키면 되고, 나중에 시트를 떼어낼 때 이 파일만 남으면 된다.

DATABASE_URL이 없거나 접속에 실패하면 빈 딕셔너리를 돌려준다. 설정을 못 읽었다고
수집이 멈추면 안 되기 때문이다.
"""

import json
import os


def 설정_읽기():
    """settings 테이블 전체를 {키: 값} 으로 돌려준다. 실패하면 빈 딕셔너리."""
    접속 = os.environ.get("DATABASE_URL")
    if not 접속:
        return {}

    try:
        import psycopg

        with psycopg.connect(접속) as 연결:
            with 연결.cursor() as 커서:
                커서.execute("select key, value from settings")
                행들 = 커서.fetchall()
    except Exception as e:
        print(f"설정 테이블을 읽지 못해 시트/기본값을 사용합니다: {type(e).__name__}: {e}")
        return {}

    결과 = {}
    for 키, 값 in 행들:
        # psycopg는 jsonb를 이미 파이썬 값으로 돌려주지만, 드라이버 설정에 따라
        # 문자열로 올 수도 있어 양쪽 다 받아둔다.
        결과[키] = json.loads(값) if isinstance(값, str) else 값
    return 결과


def 설정_덮어쓰기(설정, 저장된):
    """웹에서 저장한 값으로 설정을 덮어쓴다. 비어 있는 키는 건드리지 않는다.

    "빈 값은 무시"가 중요하다. 웹에서 아직 손대지 않은 항목까지 빈 목록으로
    덮어버리면 수집 대상이 통째로 사라진다.
    """
    if not 저장된:
        return 설정

    카테고리 = 저장된.get("advertiser_categories")
    if 카테고리:
        설정["advertiser_categories"] = 카테고리

    분류 = 저장된.get("classification") or {}
    for 축 in ("소재유형", "보종", "소구포인트"):
        if 분류.get(축):
            설정["classification"][축] = 분류[축]

    규칙 = 저장된.get("classification_rules")
    if 규칙:
        설정["classification_rules"] = {**설정.get("classification_rules", {}), **규칙}

    모델 = 저장된.get("nvidia_models") or {}
    설정.setdefault("nvidia", {})
    # API 키는 여기서 다루지 않는다. 키는 GitHub Secrets에만 두고, 웹 설정에는
    # 모델 이름만 둔다. 환경 변수가 있으면 언제나 환경 변수가 이긴다.
    if 모델.get("model") and not os.environ.get("NVIDIA_MODEL"):
        설정["nvidia"]["model"] = 모델["model"]
    if 모델.get("vision_model") and not os.environ.get("NVIDIA_VISION_MODEL"):
        설정["nvidia"]["vision_model"] = 모델["vision_model"]

    return 설정


if __name__ == "__main__":
    # 자체 점검: 빈 값이 기존 설정을 지우지 않는지, 있는 값은 제대로 덮는지.
    기준 = {
        "own_company": "한화손보",
        "advertiser_categories": {"손해보험": ["삼성화재"]},
        "classification": {"소재유형": ["가입유도"], "보종": ["암보험"], "소구포인트": ["가격"]},
    }

    그대로 = 설정_덮어쓰기(dict(기준), {})
    assert 그대로["advertiser_categories"] == {"손해보험": ["삼성화재"]}

    빈값 = 설정_덮어쓰기(json.loads(json.dumps(기준)), {
        "advertiser_categories": {},
        "classification": {"소재유형": []},
    })
    assert 빈값["advertiser_categories"] == {"손해보험": ["삼성화재"]}, 빈값
    assert 빈값["classification"]["소재유형"] == ["가입유도"], 빈값

    덮음 = 설정_덮어쓰기(json.loads(json.dumps(기준)), {
        "advertiser_categories": {"생명보험": ["AIA생명>AIA"]},
        "classification": {"보종": ["암보험", "치아보험"]},
        "nvidia_models": {"model": "테스트모델"},
    })
    assert 덮음["advertiser_categories"] == {"생명보험": ["AIA생명>AIA"]}, 덮음
    assert 덮음["classification"]["보종"] == ["암보험", "치아보험"], 덮음
    assert 덮음["classification"]["소재유형"] == ["가입유도"], 덮음
    assert 덮음["nvidia"]["model"] == "테스트모델", 덮음

    print("자체 점검 통과")
