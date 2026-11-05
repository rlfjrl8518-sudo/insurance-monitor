"""분류 경로 자체검증. API 키 없이 돌아간다. 실행: python test_classifier_endpoint.py"""

import json
import io

from src.classifier import (_JSON_파싱, _MIME, _분류결과_검증, _축_안내, 분류_요청문,
                            메시지축, 시각축, 추출항목)
from src.scraper import SSR_결과_추출, 결과_정리

설정 = {"ai": {"extended_labels": True},
       "classification": {"소재유형": ["비갱신", "기타"], "보종": ["암보험", "기타"], "소구포인트": ["가입유도", "상품신뢰"]}}


def test_JSON_파싱():
    assert _JSON_파싱('{"보종": "암보험"}')["보종"] == "암보험"
    assert _JSON_파싱('```json\n{"보종": "암보험"}\n```')["보종"] == "암보험"


def test_허용값_밖은_정리한다():
    결과 = _분류결과_검증({
        "소재유형": "엉뚱함", "보종": "암보험", "소구포인트": "없는값", "확신도": "1.7",
        "레이아웃": "인물 중앙", "퍼널단계": "그런거없음", "보험료표기": " 월 9,900원 ", "보장금액표기": "",
    }, 설정)
    assert 결과["소재유형"] == "기타"
    assert 결과["소구포인트"] == ""          # 목록에 '기타'가 없으면 비운다
    assert 결과["확신도"] == "1.00"
    assert 결과["레이아웃"] == "인물 중앙" and "퍼널단계" not in 결과
    assert 결과["보험료표기"] == "월 9,900원" and "보장금액표기" not in 결과


def test_요청문에_축이_다_들어간다():
    글 = 분류_요청문("A", "본문", 설정, True)
    for 축 in {**시각축, **메시지축, **추출항목}:
        assert 축 in 글, 축
    # 이미지가 없으면 시각 축은 묻지 않는다
    assert "레이아웃" not in 분류_요청문("A", "본문", 설정, False)
    assert not (set(시각축) & set(메시지축))
    assert all(v in _축_안내(시각축) for 값들 in 시각축.values() for v in 값들)


def test_MIME():
    assert _MIME(b"\x89PNG\r\n\x1a\n....") == "image/png"
    assert _MIME(b"RIFF1234WEBPxxxx") == "image/webp"
    assert _MIME(b"\xff\xd8\xff") == "image/jpeg"


def test_SSR_결과_파싱():
    연결 = {"count": 2, "edges": [{"node": {"collated_results": [{
        "ad_archive_id": "11", "page_id": "9", "page_name": "한화손해보험", "start_date": 1787814000,
        "collation_count": 3, "collation_id": "c1", "publisher_platform": ["INSTAGRAM"],
        "snapshot": {"body": {"text": "본문"}, "images": [], "cards": [], "display_format": "VIDEO",
                     "videos": [{"video_preview_image_url": "https://x/p.jpg", "video_sd_url": "https://x/v.mp4"}],
                     "link_url": "https://m.hwgi.kr/a", "cta_text": "더 알아보기", "title": ""}}]}}]}
    html = 'xx"search_results_connection":' + json.dumps(연결) + ',"other":1}'
    표시, 결과 = SSR_결과_추출(html)
    assert 표시 == 2 and len(결과) == 1
    광고 = 결과_정리(결과[0])
    assert 광고["라이브러리ID"] == "11" and 광고["이미지URL"] == "https://x/p.jpg"
    assert 광고["광고시작일"] == "2026-08-27" and 광고["변형수"] == "3"
    assert 광고["랜딩URL"].startswith("https://m.hwgi.kr") and 광고["게재형식"] == "VIDEO"
    assert SSR_결과_추출("<html>막힘</html>") is None


def test_설정파일_정합성():
    c = json.load(io.open("config.json", encoding="utf-8"))
    assert "nvidia" not in c
    assert c["ai"]["models"] and c["ai"]["provider"] == "vertex"


if __name__ == "__main__":
    for 이름, 함수 in sorted(globals().items()):
        if 이름.startswith("test_"):
            함수()
            print(f"  OK  {이름}")
    print("전부 통과")
