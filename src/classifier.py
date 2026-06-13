"""Gemini API로 광고 이미지+텍스트를 분석해 소재유형/보종/후킹/요약으로 분류하는 모듈."""

import json

import google.generativeai as genai

분류_결과_키 = ["소재유형", "보종", "후킹", "요약"]

확장자별_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def Gemini_모델_생성(설정):
    """config.json의 Gemini 설정으로 GenerativeModel 인스턴스를 생성한다.

    gRPC 전송 시 API 키 자격증명 플러그인이 "Illegal header value" 오류와 함께
    응답 없이 재시도를 반복하는 경우가 있어, REST 전송을 사용해 이를 회피한다.
    """
    genai.configure(api_key=설정["gemini"]["api_key"], transport="rest")
    return genai.GenerativeModel(설정["gemini"]["model"])


def 분류_프롬프트_생성(광고주, 광고텍스트, 설정):
    """config.json의 분류 기준을 반영한 Gemini 프롬프트를 생성한다."""
    분류기준 = 설정["classification"]
    소재유형_목록 = ", ".join(분류기준["소재유형"])
    보종_목록 = ", ".join(분류기준["보종"])
    후킹_목록 = ", ".join(분류기준["후킹"])

    return f"""당신은 손해보험사 메타(Facebook/Instagram) 광고 소재를 분석하는 마케팅 분석가입니다.
아래 광고 이미지와 광고 텍스트를 보고 광고를 분류해주세요.

[광고주] {광고주}
[광고 텍스트]
{광고텍스트}

다음 기준에 따라 분류하고, 반드시 아래 JSON 형식으로만 응답하세요.
다른 설명이나 마크다운 코드블록 없이 순수 JSON 객체만 출력하세요.

- 소재유형: 다음 중 하나를 선택 ({소재유형_목록})
  - 비갱신: 비갱신형 상품 또는 갱신 없음을 강조하는 소재
  - 특약: 특정 특약/보장 항목을 강조하는 소재
  - 브랜딩: 회사 이미지, 브랜드 인지도 제고 목적의 소재
- 보종: 다음 중 하나를 선택 ({보종_목록})
- 후킹: 다음 중 광고에서 가장 강조하는 후킹 포인트 하나를 선택 ({후킹_목록})
  - 가격: 보험료, 가격 혜택 강조
  - 보장: 보장 범위, 보장 내용 강조
  - 긴급성: 한정 기간, 마감 임박 등 긴급성 강조
  - 가입편의: 간편 가입, 빠른 가입 절차 강조
  - 감성: 감성적 스토리, 가족/사랑 등 정서적 호소
- 요약: 광고 이미지와 텍스트를 종합한 핵심 내용 2~3문장 요약

응답 형식 예시:
{{"소재유형": "특약", "보종": "운전자보험", "후킹": "보장", "요약": "..."}}
"""


def 광고_분류(model, 이미지_경로, 광고주, 광고텍스트, 설정):
    """이미지 파일과 광고 텍스트를 Gemini에 전달하여 분류 결과(dict)를 반환한다.

    실패 시 None을 반환한다.
    """
    확장자 = "." + 이미지_경로.rsplit(".", 1)[-1].lower()
    mime_type = 확장자별_MIME.get(확장자, "image/jpeg")

    with open(이미지_경로, "rb") as f:
        이미지_바이트 = f.read()

    프롬프트 = 분류_프롬프트_생성(광고주, 광고텍스트, 설정)

    응답 = model.generate_content(
        [
            {"mime_type": mime_type, "data": 이미지_바이트},
            프롬프트,
        ],
        generation_config={"response_mime_type": "application/json"},
        # 할당량 초과(429) 등 오류 시 SDK가 긴 시간 동안 재시도하는 것을 막기 위해 호출당 최대 대기 시간을 짧게 제한
        request_options={"timeout": 10},
    )

    결과 = json.loads(응답.text)

    분류기준 = 설정["classification"]
    if 결과.get("소재유형") not in 분류기준["소재유형"]:
        결과["소재유형"] = 분류기준["소재유형"][-1]
    if 결과.get("보종") not in 분류기준["보종"]:
        결과["보종"] = "기타" if "기타" in 분류기준["보종"] else 분류기준["보종"][-1]
    if 결과.get("후킹") not in 분류기준["후킹"]:
        결과["후킹"] = 분류기준["후킹"][-1]
    결과["요약"] = 결과.get("요약", "")

    return 결과
