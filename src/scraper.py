"""Meta 광고 라이브러리(facebook.com/ads/library)를 Playwright로 수집하는 모듈.

- 로그인 없이 공개 검색 페이지만 사용한다.
- 광고주명으로 검색한 뒤 자동 스크롤하며 노출되는 광고 카드를 수집한다.
- Meta 페이지의 CSS 클래스는 매번 난수로 생성되므로, 화면에 표시되는 한글 UI 텍스트
  ("라이브러리 ID:", "게재 시작함", "광고 상세 정보 보기", "광고" 등)와
  광고주 프로필 이미지의 고유 클래스(_8nqq)를 기준으로 카드를 식별한다.
"""

import os
import re
import unicodedata
from collections import Counter
from urllib.parse import urlencode

from playwright.sync_api import TimeoutError as Playwright_타임아웃
from playwright.sync_api import sync_playwright

from src.text_utils import 외국어_소재인가, 채용_소재인가

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
        // 같은 광고에 여러 크리에이티브 버전이 있는 카드("요약 세부 사항 보기")는
        // 그룹 래퍼가 한 겹 더 있어 조상 탐색 깊이가 더 필요할 수 있으므로 여유를 둔다
        // (게재량이 많은 광고주일수록 이런 그룹 카드 비중이 높아 12단계에서는 놓치기 쉬웠음).
        for (let i = 0; i < 20; i++) {
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

        // 페이지ID 추출 시도(best-effort). 카드 내부에 view_all_page_id로 연결되는
        // 링크가 있으면 다음 실행부터 이름 검색 대신 이 ID로 정확히 그 페이지의
        // 광고만 조회할 수 있다. 링크가 없는 카드/지역이면 null이 되고, 이 경우
        // 기존 이름 검색 방식이 그대로 쓰이므로 실패해도 안전하다.
        let pageId = null;
        for (const a of cardEl.querySelectorAll('a[href]')) {
            const m = a.href.match(/[?&]view_all_page_id=(\\d+)/);
            if (m) { pageId = m[1]; break; }
        }

        cards.push({
            pageName: img.alt || '',
            text: cardEl.innerText,
            imageUrl: creativeSrc,
            pageId: pageId,
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


공백_정규식 = re.compile(r"\s+")


def 페이지명_정규화(이름):
    """페이지명 비교용으로 공백 종류(일반 공백/줄바꿈/NBSP 등)와 개수 차이를 무시하도록 정규화한다.

    Meta 라이브러리가 같은 페이지의 이름을 스크랩마다 일반 공백/NBSP 등으로 다르게
    렌더링하는 경우가 있어, 설정에 등록한 광고주명과 실제 페이지명이 눈으로는 같아
    보여도 순수 문자열 비교(==)에서는 계속 불일치로 빠지는 문제가 있었다.
    """
    return 공백_정규식.sub(" ", unicodedata.normalize("NFKC", 이름 or "")).strip()


def 검색_URL_생성(광고주명, 설정, 페이지ID=None):
    """Meta 광고 라이브러리 검색 URL을 생성한다.

    페이지ID가 있으면 view_all_page_id로 그 페이지의 광고만 정확히 조회한다
    (이름 매칭이 필요 없고, 무관한 페이지가 검색 결과에 섞이지 않는다).
    없으면 기존 방식대로 광고주명 키워드 검색을 사용한다 - Meta의 키워드
    검색은 관련도 기반 근사 검색이라 페이지명이 정확히 일치하는 카드만
    사후에 걸러내야 한다(광고주_광고_수집의 페이지명 필터 참고).
    """
    if 페이지ID:
        쿼리 = {
            "active_status": 설정["scraping"]["active_status"],
            "ad_type": 설정["scraping"]["ad_type"],
            "country": 설정["scraping"]["country"],
            "view_all_page_id": 페이지ID,
            "search_type": "page",
            "media_type": "all",
        }
    else:
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


def 라이브러리ID_추출(url_또는_id):
    """Meta 광고 라이브러리 링크 또는 라이브러리 ID 문자열에서 ID(숫자)를 추출한다.

    `?id=`/`&id=` 형태의 URL이거나 숫자로만 된 문자열이 아니면 None을 반환한다.
    """
    문자열 = url_또는_id.strip()
    m = re.search(r"[?&]id=(\d+)", 문자열)
    if m:
        return m.group(1)
    if 문자열.isdigit():
        return 문자열
    return None


def 광고_상세_조회(page, library_id, 설정, 진행_콜백=print):
    """라이브러리 ID로 광고 상세 페이지(`?id=`)를 열어 해당 카드 정보를 조회한다.

    상세 페이지에는 같은 페이지(광고주)의 다른 광고들도 함께 노출되므로,
    JS_카드_추출 결과 중 library_id가 일치하는 카드를 찾아 반환한다.
    찾지 못하면 None을 반환한다.
    """
    url = f"{광고라이브러리_기본URL}?id={library_id}&country={설정['scraping']['country']}"
    진행_콜백(f"  상세 페이지 이동: {url}")
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(int(설정["scraping"]["page_load_wait_seconds"] * 1000))

    for 카드 in page.evaluate(JS_카드_추출):
        if not 카드.get("imageUrl"):
            continue

        해당_id, 시작일, 광고텍스트 = 카드_텍스트_파싱(카드["text"], 카드["pageName"])
        if 해당_id != library_id:
            continue

        return {
            "라이브러리ID": library_id,
            "광고주": 카드["pageName"].strip(),
            "이미지URL": 카드["imageUrl"],
            "광고텍스트": 광고텍스트,
            "광고시작일": 시작일 or "",
            "광고상세URL": f"{광고라이브러리_기본URL}?id={library_id}",
        }

    return None


def 이미지_다운로드(page, 이미지_url, 저장_경로):
    """Playwright의 요청 컨텍스트로 이미지를 내려받아 저장한다."""
    응답 = page.context.request.get(이미지_url)
    if not 응답.ok:
        return False
    with open(저장_경로, "wb") as f:
        f.write(응답.body())
    return True


def 광고주_광고_수집(page, 광고주명, 설정, 진행_콜백=print, 알려진_페이지ID=None, _키워드_재시도중=False):
    """한 광고주에 대해 검색 -> 스크롤 -> 카드 추출을 수행하고 (결과 목록, 학습된 페이지ID)를 반환한다.

    알려진_페이지ID가 있으면 view_all_page_id로 그 페이지의 광고만 정확히 조회하므로
    이름 불일치로 인한 누락/오염이 원천적으로 없다. 없으면 기존처럼 이름으로 검색한 뒤
    페이지명이 정확히 일치하는 카드만 남기고, 그 과정에서 카드에서 페이지ID를 찾으면
    다음 실행부터 쓸 수 있도록 "학습된 페이지ID"로 반환한다(호출 측이 config에 저장).
    """
    url = 검색_URL_생성(광고주명, 설정, 페이지ID=알려진_페이지ID)
    진행_콜백(f"  검색 페이지 이동: {url}" + ("  (저장된 페이지ID로 직접 조회)" if 알려진_페이지ID else ""))
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(int(설정["scraping"]["page_load_wait_seconds"] * 1000))

    최대_스크롤_횟수 = 설정["scraping"]["scroll_count"]
    최대_대기_ms = int(설정["scraping"]["scroll_wait_seconds"] * 1000)
    무변화_허용_횟수 = 설정["scraping"]["scroll_stable_count"]
    목표_페이지명 = 페이지명_정규화(광고주명)

    결과 = []
    수집된_library_id = set()
    페이지명_불일치_수 = 0
    불일치_페이지명_집계 = Counter()
    총_원본_카드_수 = 0
    학습된_페이지ID = None

    def 카드_배치_처리(카드_목록):
        # 스크롤 단계마다 즉시 파싱/필터링해 "타겟 광고가 실제로 늘고 있는지"를
        # 매 단계 알 수 있게 한다 - 예전에는 스크롤이 다 끝난 뒤에야 한 번에
        # 걸러서, 화면 전체 카드 수(노이즈 포함)로만 정지를 판단해야 했다.
        nonlocal 페이지명_불일치_수, 총_원본_카드_수, 학습된_페이지ID
        총_원본_카드_수 += len(카드_목록)
        for 카드 in 카드_목록:
            if not 카드.get("imageUrl"):
                continue

            if not 알려진_페이지ID:
                # 이름 검색은 관련도 기반 근사 검색이라, 페이지명이 정확히
                # 일치하는 카드만 남긴다(예: "삼성화재" 검색 시 "삼성화재
                # 다이렉트" 등 다른/자매 페이지는 제외). 공백 종류/개수 차이는
                # 페이지명_정규화로 무시한다.
                실제_페이지명 = 카드.get("pageName", "").strip()
                if 페이지명_정규화(실제_페이지명) != 목표_페이지명:
                    페이지명_불일치_수 += 1
                    if 실제_페이지명:
                        불일치_페이지명_집계[실제_페이지명] += 1
                    continue

            library_id, 시작일, 광고텍스트 = 카드_텍스트_파싱(카드["text"], 카드.get("pageName", ""))
            if not library_id or library_id in 수집된_library_id:
                continue
            if 외국어_소재인가(광고텍스트) or 채용_소재인가(광고텍스트):
                continue

            수집된_library_id.add(library_id)
            결과.append({
                "라이브러리ID": library_id,
                "이미지URL": 카드["imageUrl"],
                "광고텍스트": 광고텍스트,
                "광고시작일": 시작일 or "",
                "광고상세URL": f"{광고라이브러리_기본URL}?id={library_id}",
            })

            if not 알려진_페이지ID and not 학습된_페이지ID and 카드.get("pageId"):
                학습된_페이지ID = 카드["pageId"]

    카드_배치_처리(page.evaluate(JS_카드_추출))

    # 정지 판단 기준을 화면 전체 프로필 이미지 수(노이즈 포함)가 아니라 "실제로
    # 매칭된 타겟 광고 수"와 "문서 스크롤 높이"로 바꾼다. 둘 다 그대로일 때만
    # 무변화로 친다 - 무관한 페이지 광고가 계속 로드되는 동안 타겟이 멈췄는데도
    # 계속 도는 낭비를 줄이고, 반대로 타겟이 계속 느리게 들어오는 중에 화면
    # 전체 카드 수만 보고 조기 종료하는 오판도 함께 막는다.
    이전_타겟_수 = len(수집된_library_id)
    이전_높이 = page.evaluate("() => document.body.scrollHeight")
    무변화_횟수 = 0
    실제_스크롤_횟수 = 0
    정지_사유 = "최대 스크롤 횟수 도달"
    for i in range(최대_스크롤_횟수):
        실제_스크롤_횟수 = i + 1
        # 마우스 휠 스크롤(기존 방식)에 더해, 문서 자체가 스크롤 컨테이너인
        # 경우까지 커버하도록 "그 시점의 문서 맨 아래"로도 스크롤한다.
        page.mouse.wheel(0, 4000)
        page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")

        # 고정 시간만 기다리면 네트워크가 느린 날 지연 로딩이 끝나기 전에 세어
        # 버려 누락이 생긴다. 요청이 시작될 최소 시간(0.5초)만 먼저 기다린 뒤,
        # 남은 예산 안에서 네트워크가 실제로 잠잠해질 때까지 기다린다(끝나지
        # 않으면 예산 소진 후 그냥 진행 - 무한 대기는 아님).
        page.wait_for_timeout(500)
        try:
            page.wait_for_load_state("networkidle", timeout=max(최대_대기_ms - 500, 1000))
        except Playwright_타임아웃:
            pass

        카드_배치_처리(page.evaluate(JS_카드_추출))

        현재_타겟_수 = len(수집된_library_id)
        현재_높이 = page.evaluate("() => document.body.scrollHeight")
        if 현재_타겟_수 <= 이전_타겟_수 and 현재_높이 <= 이전_높이:
            무변화_횟수 += 1
            if 무변화_횟수 >= 무변화_허용_횟수:
                정지_사유 = f"타겟 광고 수/문서 높이 안정({무변화_횟수}회 연속 무변화)"
                break
        else:
            무변화_횟수 = 0
        이전_타겟_수 = 현재_타겟_수
        이전_높이 = 현재_높이

    진행_콜백(f"  스크롤 {실제_스크롤_횟수}/{최대_스크롤_횟수}회 후 정지 - {정지_사유} (수집된 타겟 광고 수: {이전_타겟_수}, 원본 카드 누적: {총_원본_카드_수})")

    if 페이지명_불일치_수:
        진행_콜백(f"  페이지명 불일치로 제외된 카드 수: {페이지명_불일치_수}")
        # 실제로 어떤 페이지명이 제외됐는지 남겨서, 검색어를 잘못 등록해 광고주의
        # 진짜 페이지명이 계속 누락되는 경우를 다음 로그에서 바로 찾을 수 있게 한다.
        상위_불일치 = 불일치_페이지명_집계.most_common(5)
        if 상위_불일치:
            요약 = ", ".join(f"'{이름}'({횟수}건)" for 이름, 횟수 in 상위_불일치)
            진행_콜백(f"  제외된 페이지명 상위: {요약}")

    if 학습된_페이지ID:
        진행_콜백(f"  [학습] 페이지ID 확인됨: {학습된_페이지ID} (다음 실행부터 정확 조회로 전환 예정)")

    # 저장된 페이지ID가 stale(페이지 개편/ID 변경 등)해져 0건이 나온 경우, 한
    # 번은 기존 이름 검색으로 폴백해 수집이 완전히 끊기지 않게 한다. 재시도에서
    # 새 페이지ID가 학습되면 호출 측이 자동으로 최신 값으로 갱신한다.
    if not 결과 and 알려진_페이지ID and not _키워드_재시도중:
        진행_콜백(f"  [경고] 저장된 페이지ID({알려진_페이지ID})로 0건 수집 - 이름 검색으로 재시도")
        return 광고주_광고_수집(
            page, 광고주명, 설정, 진행_콜백=진행_콜백, 알려진_페이지ID=None, _키워드_재시도중=True,
        )

    return 결과, 학습된_페이지ID
