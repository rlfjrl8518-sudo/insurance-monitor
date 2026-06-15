"""Meta 광고 라이브러리(facebook.com/ads/library)를 Playwright로 수집하는 모듈.

- 로그인 없이 공개 검색 페이지만 사용한다.
- 광고주명으로 검색한 뒤 자동 스크롤하며 노출되는 광고 카드를 수집한다.
- Meta 페이지의 CSS 클래스는 매번 난수로 생성되므로, 화면에 표시되는 한글 UI 텍스트
  ("라이브러리 ID:", "게재 시작함", "광고 상세 정보 보기", "광고" 등)와
  광고주 프로필 이미지의 고유 클래스(_8nqq)를 기준으로 카드를 식별한다.
"""

import os
import re
from urllib.parse import urlencode

from playwright.sync_api import sync_playwright

from src.text_utils import 외국어_소재인가

광고라이브러리_기본URL = "https://www.facebook.com/ads/library/"

# 광고 카드 컨테이너를 찾고, 카드별 정보를 추출하는 JS 스크립트.
# - 프로필 이미지(class="_8nqq")를 기준점으로 삼아, '라이브러리 ID:' 텍스트를 포함하는
#   가장 가까운 조상 엘리먼트를 카드 컨테이너로 사용한다.
JS_카드_추출 = """
() => {
    const cards = [];
    const profileImgs = Array.from(document.querySelectorAll('img._8nqq'));
    for (const img of profileImgs) {
        let el = img;
        let cardEl = null;
        for (let i = 0; i < 12; i++) {
            el = el.parentElement;
            if (!el) break;
            if (el.innerText && el.innerText.includes('라이브러리 ID:')) {
                cardEl = el;
                break;
            }
        }
        if (!cardEl) continue;

        // 크리에이티브 이미지 찾기 (프로필 이미지 제외, scontent CDN 이미지)
        let creativeSrc = null;
        for (const im of cardEl.querySelectorAll('img')) {
            if (im === img) continue;
            if (im.src && im.src.includes('scontent')) {
                creativeSrc = im.src;
                break;
            }
        }

        // 이미지가 없으면 동영상 광고일 수 있으므로 video poster 사용
        if (!creativeSrc) {
            const video = cardEl.querySelector('video');
            if (video && video.poster) {
                creativeSrc = video.poster;
            }
        }

        cards.push({
            pageName: img.alt || '',
            text: cardEl.innerText,
            imageUrl: creativeSrc,
        });
    }
    return cards;
}
"""

# 광고 카드 텍스트에서 라이브러리 ID와 게재 시작일을 추출하는 정규식
라이브러리ID_정규식 = re.compile(r"라이브러리 ID:\s*(\d+)")
시작일_정규식 = re.compile(r"^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.에 게재 시작함$")
영상길이_정규식 = re.compile(r"^\d{1,2}:\d{2}\s*/\s*\d{1,2}:\d{2}$")
도메인_정규식 = re.compile(r"^[A-Z0-9][A-Z0-9.\-]*\.[A-Z]{2,}(/.*)?$")

# 카드 본문 끝에 반복적으로 붙는 행동유도(CTA) 버튼 문구
CTA_버튼_문구 = {
    "Learn More", "더 알아보기", "자세히 보기", "지금 신청하기", "Apply Now",
    "See Details", "Shop Now", "Sign Up", "메시지 보내기", "전화하기", "견적 받기",
    "Get Quote", "Download", "다운로드", "예약하기", "문의하기", "지금 구매하기",
    "Send Message", "Get Offer", "Watch More", "더보기", "양식 보기",
}


def 검색_URL_생성(광고주명, 설정):
    """광고주명으로 Meta 광고 라이브러리 검색 URL을 생성한다."""
    쿼리 = {
        "active_status": 설정["scraping"]["active_status"],
        "ad_type": 설정["scraping"]["ad_type"],
        "country": 설정["scraping"]["country"],
        "q": 광고주명,
        "search_type": "keyword_unordered",
        "media_type": "all",
    }
    return 광고라이브러리_기본URL + "?" + urlencode(쿼리)


def 카드_텍스트_파싱(raw_text, 페이지명):
    """광고 카드의 innerText에서 라이브러리 ID, 게재 시작일, 광고 텍스트를 분리한다.

    Meta 광고 라이브러리 카드는 항상
    "...(광고 상세 정보 보기|요약 세부 사항 보기) -> (페이지/후원 이름) -> 광고 -> (실제 광고 본문)"
    순서로 구성되므로, 이 고정 패턴을 기준으로 헤더와 본문을 구분한다.
    ("요약 세부 사항 보기"는 같은 광고에 여러 크리에이티브 버전이 있는 카드에서 나타난다.)
    """
    lines = [line.strip() for line in raw_text.split("\n")]

    library_id = None
    start_date = None
    body_lines = []
    state = "header"  # header -> sponsor -> ad_label -> body

    for line in lines:
        if state == "header":
            if library_id is None:
                m = 라이브러리ID_정규식.search(line)
                if m:
                    library_id = m.group(1)
                    continue
            if start_date is None:
                m = 시작일_정규식.match(line)
                if m:
                    년, 월, 일 = m.groups()
                    start_date = f"{년}-{int(월):02d}-{int(일):02d}"
                    continue
            if line in ("광고 상세 정보 보기", "요약 세부 사항 보기"):
                state = "sponsor"
            continue
        elif state == "sponsor":
            # 페이지/후원 이름 줄 (예: "삼성화재 다이렉트" 또는 "A 페이지는 B과(와) 함께합니다")
            state = "ad_label"
            continue
        elif state == "ad_label":
            # "광고" 라벨 줄
            state = "body"
            continue
        else:
            if 영상길이_정규식.match(line):
                continue
            body_lines.append(line)

    # 본문 끝부분의 도메인/CTA버튼/페이지명/빈줄 등 광고 본문이 아닌 영역 제거
    while body_lines:
        마지막줄 = body_lines[-1]
        if (
            마지막줄 == ""
            or 마지막줄 == 페이지명
            or 마지막줄 in CTA_버튼_문구
            or 도메인_정규식.match(마지막줄)
        ):
            body_lines.pop()
        else:
            break

    광고텍스트 = "\n".join(body_lines).strip()
    return library_id, start_date, 광고텍스트


def 이미지_확장자_추출(이미지_url):
    """이미지 URL에서 파일 확장자를 추출한다. 알 수 없으면 jpg를 사용한다."""
    경로 = 이미지_url.split("?")[0]
    _, 확장자 = os.path.splitext(경로)
    확장자 = 확장자.lower()
    if 확장자 in (".jpg", ".jpeg", ".png", ".webp"):
        return 확장자
    return ".jpg"


def 이미지_다운로드(page, 이미지_url, 저장_경로):
    """Playwright의 요청 컨텍스트로 이미지를 내려받아 저장한다."""
    응답 = page.context.request.get(이미지_url)
    if not 응답.ok:
        return False
    with open(저장_경로, "wb") as f:
        f.write(응답.body())
    return True


def 광고주_광고_수집(page, 광고주명, 설정, 진행_콜백=print):
    """한 광고주에 대해 검색 -> 스크롤 -> 카드 추출을 수행하고 결과 목록을 반환한다."""
    url = 검색_URL_생성(광고주명, 설정)
    진행_콜백(f"  검색 페이지 이동: {url}")
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(int(설정["scraping"]["page_load_wait_seconds"] * 1000))

    최대_스크롤_횟수 = 설정["scraping"]["scroll_count"]
    스크롤_대기 = int(설정["scraping"]["scroll_wait_seconds"] * 1000)
    무변화_허용_횟수 = 설정["scraping"]["scroll_stable_count"]

    # 화면 밖으로 벗어난 카드는 이미지가 지연 로딩 해제되어 imageUrl을 잃어버릴 수
    # 있으므로, 스크롤이 끝난 뒤 한 번만 추출하지 않고 스크롤마다 누적 추출한다
    # (library_id 기준 중복 제거는 아래에서 처리).
    # 또한 새로 로드되는 프로필 이미지(_8nqq) 개수가 더 이상 늘지 않으면 스크롤을
    # 멈춘다 (최대_스크롤_횟수는 무한 스크롤에 빠지지 않도록 하는 안전장치).
    원본_카드_목록 = list(page.evaluate(JS_카드_추출))
    이전_카드_수 = page.evaluate("() => document.querySelectorAll('img._8nqq').length")
    무변화_횟수 = 0
    for i in range(최대_스크롤_횟수):
        page.mouse.wheel(0, 4000)
        page.wait_for_timeout(스크롤_대기)
        원본_카드_목록.extend(page.evaluate(JS_카드_추출))

        현재_카드_수 = page.evaluate("() => document.querySelectorAll('img._8nqq').length")
        if 현재_카드_수 <= 이전_카드_수:
            무변화_횟수 += 1
            if 무변화_횟수 >= 무변화_허용_횟수:
                break
        else:
            무변화_횟수 = 0
        이전_카드_수 = 현재_카드_수

    진행_콜백(f"  추출된 원본 카드 수: {len(원본_카드_목록)} (스크롤 단계별 누적, 중복 포함)")

    결과 = []
    수집된_library_id = set()
    페이지명_불일치_수 = 0
    for 카드 in 원본_카드_목록:
        if not 카드.get("imageUrl"):
            continue

        # 설정 시트 검색어(광고주명)와 실제 페이지명이 정확히 일치하지 않으면 제외
        # (예: "삼성화재" 검색 시 "삼성화재다이렉트", "삼성화재생명" 등은 수집하지 않음)
        if 카드.get("pageName", "").strip() != 광고주명:
            페이지명_불일치_수 += 1
            continue

        library_id, 시작일, 광고텍스트 = 카드_텍스트_파싱(카드["text"], 카드["pageName"])
        if not library_id:
            continue
        if library_id in 수집된_library_id:
            continue
        if 외국어_소재인가(광고텍스트):
            continue
        수집된_library_id.add(library_id)

        결과.append({
            "라이브러리ID": library_id,
            "이미지URL": 카드["imageUrl"],
            "광고텍스트": 광고텍스트,
            "광고시작일": 시작일 or "",
            "광고상세URL": f"{광고라이브러리_기본URL}?id={library_id}",
        })

    if 페이지명_불일치_수:
        진행_콜백(f"  페이지명 불일치로 제외된 카드 수: {페이지명_불일치_수}")

    return 결과
