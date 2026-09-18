"""NVIDIA NIM 분류 경로 자체검증. API 키 없이 돌아간다."""

import src.classifier as C
from src.classifier import (_호출옵션, _JSON_파싱, _이미지문구_합치기, 광고_분류,
                            _분류결과_검증, _축_안내, 시각축, 메시지축)


def test_호출옵션():
    # 추론을 끄면 건당 23.9초 -> 6.2초였다. 이 파라미터가 빠지면 조용히 4배 느려진다.
    옵션 = _호출옵션({"nvidia": {}})
    assert 옵션["extra_body"] == {"chat_template_kwargs": {"thinking": False}}
    assert 옵션["temperature"] == 0
    assert 옵션["max_tokens"] == 2000          # 800이면 JSON이 잘린 적이 있다
    assert 옵션["response_format"] == {"type": "json_object"}

    # 추론을 일부러 켜면 extra_body를 빼야 한다
    assert "extra_body" not in _호출옵션({"nvidia": {"thinking": True}})

    # 설정값이 기본값을 이긴다
    assert _호출옵션({"nvidia": {"max_tokens": 500, "timeout": 30}})["timeout"] == 30


def test_JSON_파싱():
    assert _JSON_파싱('{"보종": "암보험"}')["보종"] == "암보험"
    assert _JSON_파싱('```json\n{"보종": "암보험"}\n```')["보종"] == "암보험"
    assert _JSON_파싱('분류 결과:\n{"보종": "암보험"} 이상.')["보종"] == "암보험"


def test_이미지문구_합치기():
    assert "본문" in _이미지문구_합치기("본문", "읽은문구")
    assert _이미지문구_합치기("본문", "읽은문구").endswith("읽은문구")
    assert _이미지문구_합치기("본문", None) == "본문"


def test_OCR_실패해도_텍스트로_분류한다():
    """이미지 호출이 터져도 그 건을 버리지 않아야 한다 (무료 티어는 503이 잦다)."""
    설정 = {"nvidia": {"model": "m", "vision_model": "v"},
            "classification": {"소재유형": ["기타"], "보종": ["기타"], "소구포인트": ["상품신뢰"]}}
    받은텍스트 = {}

    def 가짜_텍스트분류(client, 광고주, 광고텍스트, 설정):
        받은텍스트["값"] = 광고텍스트
        return {"소재유형": "기타", "보종": "기타", "소구포인트": "상품신뢰", "요약": ""}

    원래 = C.광고_분류_텍스트전용
    C.광고_분류_텍스트전용 = 가짜_텍스트분류
    try:
        결과 = 광고_분류(object(), "없는파일.jpg", "한화손보", "광고본문", 설정)
    finally:
        C.광고_분류_텍스트전용 = 원래
    assert 결과["소재유형"] == "기타"
    assert 받은텍스트["값"] == "광고본문"


def test_확장축_허용값_밖은_버린다():
    """빈 값이나 엉뚱한 값이 섞이면 집계할 때마다 걸러내야 해서, 저장 전에 막는다."""
    설정 = {"classification": {"소재유형": ["비갱신"], "보종": ["암보험"], "소구포인트": ["가입유도"]}}
    결과 = _분류결과_검증({
        "소재유형": "비갱신", "보종": "암보험", "소구포인트": "가입유도",
        "레이아웃": "인물 중앙",     # 허용값 -> 남는다
        "퍼널단계": "그런거없음",     # 허용값 아님 -> 버린다
        "오퍼": "이벤트",
    }, 설정)
    assert 결과["레이아웃"] == "인물 중앙"
    assert 결과["오퍼"] == "이벤트"
    assert "퍼널단계" not in 결과


def test_축_안내문이_모든_값을_담는다():
    안내 = _축_안내(시각축)
    for 이름, 값들 in 시각축.items():
        assert 이름 in 안내
        for v in 값들:
            assert v in 안내
    # 시각 축과 메시지 축은 겹치면 안 된다 (같은 키를 두 번 판단하게 된다)
    assert not (set(시각축) & set(메시지축))


def test_설정파일_정합성():
    """config.json이 코드가 기대하는 nvidia 스키마와 맞는지."""
    import json, io
    설정 = json.load(io.open("config.json", encoding="utf-8"))
    assert "gemini" not in 설정 and "openai" not in 설정 and "ai_provider" not in 설정
    nv = 설정["nvidia"]
    for 키 in ("api_key", "base_url", "model", "vision_model", "동시_요청수"):
        assert 키 in nv, 키
    assert nv["base_url"].startswith("https://integrate.api.nvidia.com")


if __name__ == "__main__":
    for 이름, 함수 in sorted(globals().items()):
        if 이름.startswith("test_"):
            함수()
            print(f"  OK  {이름}")
    print("전부 통과")
