"""Meta 광고 라이브러리(facebook.com/ads/library)를 Playwright로 수집하는 모듈.

- 로그인 없이 공개 검색 페이지만 사용한다.
- 광고주명으로 검색한 뒤 자동 스크롤하며 노출되는 광고 카드를 수집한다.
- Meta 페이지의 CSS 클래스는 매번 난수로 생성되므로, 화면에 표시되는 한글 UI 텍스트
  ("라이브러리 ID:", "게재 시작함", "광고 상세 정보 보기", "광고" 등)와
  광고주 프로필 이미지의 고유 클래스(_8nqq)를 기준으로 카드를 식별한다.
"""

import json
import os
import re
import unicodedata
from collections import Counter
from urllib.parse import urlencode

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


공백_정규식 = re.compile(r"\s+")


def 페이지명_정규화(이름):
    """페이지명 비교용 정규화. 공백은 종류·개수뿐 아니라 유무까지 무시한다.

    Meta 라이브러리가 같은 페이지의 이름을 스크랩마다 다르게 렌더링한다. 공백 종류
    (일반 공백/NBSP)나 개수만 다른 경우는 이전부터 흡수했지만, 공백이 아예 있고
    없고가 갈리는 경우("DB손해보험" vs "DB 손해보험")는 걸러지지 못해 해당 광고주가
    통째로 0건이 되곤 했다. 그래서 비교할 때는 공백을 모두 제거한다.

    공백만 지우고 그 외에는 완전 일치를 요구한다. 접두어 일치나 부분 문자열 일치로
    넓히면 "DB손해보험"이 "DB생명 다이렉트"를, "한화손보"가 "한화손보 캐롯"(별개 법인)을
    끌어와 다른 회사 광고가 섞인다. 실제 수집 데이터로 확인한 위험이라 넓히지 않는다.
    접미어가 붙은 새 페이지명은 자동으로 포함하지 않고 _근접_후보로 사람에게 알린다.
    """
    return 공백_정규식.sub("", unicodedata.normalize("NFKC", 이름 or "")).strip()


def _근접_후보(광고주명, 불일치_집계, 최대=3):
    """제외된 페이지명 중 등록 광고주명을 통째로 포함하는 것을 골라낸다.

    'DB손해보험' 등록에 'DB손해보험 공식'이 잡히는 식으로 페이지명이 바뀐 경우를
    사람이 알아채게 하는 용도다. 수집 대상으로 삼지는 않는다 - 'DB손해보험'이
    'DB손해보험다이렉트'를 자동으로 끌어오면 채널이 뒤섞이고, 더 느슨하게 가면
    'DB생명' 같은 다른 회사까지 들어온다.
    """
    기준 = 페이지명_정규화(광고주명)
    if not 기준:
        return []
    후보 = [(이름, 횟수) for 이름, 횟수 in 불일치_집계.items()
          if 기준 in 페이지명_정규화(이름)]
    return sorted(후보, key=lambda x: -x[1])[:최대]


def 광고주_해석(항목):
    """설정 시트의 광고주 항목을 (검색어, 실제_페이지명)으로 나눈다.

    보통은 검색어와 메타 페이지명이 같지만 다를 때가 있다. AIA생명이 그랬다.
    "AIA생명"으로 검색해야 광고가 나오는데 페이지명은 "AIA"라서, 이름이
    일치하지 않는다는 이유로 석 달 동안 한 건도 수집되지 않았다.
    "AIA생명>AIA"처럼 적으면 검색은 왼쪽으로, 페이지명 대조는 오른쪽으로 한다.
    ">"가 없으면 종전대로 같은 값을 양쪽에 쓴다.
    """
    검색어, _, 페이지명 = (항목 or "").partition(">")
    검색어 = 검색어.strip()
    return 검색어, (페이지명.strip() or 검색어)


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


def 광고주_광고_수집(page, 광고주항목, 설정, 페이지캐시, 진행_콜백=print):
    """광고주 한 곳의 게재 중 광고를 모은다.

    결과: {"광고": [...], "표시건수": int|None, "수집률": float|None, "page_id": str|None,
          "후보": [(페이지명, page_id)], "상태": "정상"|"게재없음"|"페이지없음"|"읽기실패", "메시지": str}

    키워드 검색은 남의 페이지가 섞이고(“삼성화재” 검색 시 40여 개 페이지), 비로그인 상태에선
    다음 페이지 요청이 'Rate limit exceeded'로 막혀 첫 30건만 온다. 그래서 페이지 ID로
    그 광고주 광고만 조회한다. 30건을 넘으면 매체 유형(이미지/동영상/밈)으로 나눠 다시 읽는다.
    """
    검색어, 페이지명 = 광고주_해석(광고주항목)
    목표 = 페이지명_정규화(페이지명)
    후보 = []

    page_id = 페이지캐시.get(목표)
    if not page_id:
        page_id, 후보 = 페이지ID_찾기(page, 검색어, 페이지명, 설정, 진행_콜백)
        if page_id:
            페이지캐시[목표] = page_id
    if not page_id:
        return {"광고": [], "표시건수": None, "수집률": None, "page_id": None, "후보": 후보,
                "상태": "페이지없음",
                "메시지": f"'{검색어}' 검색 결과에서 페이지명 '{페이지명}'을 찾지 못함"}

    결과 = 결과_읽기(page, 페이지_URL(page_id, 설정), 설정)
    if 결과 is None:
        return {"광고": [], "표시건수": None, "수집률": None, "page_id": page_id, "후보": 후보,
                "상태": "읽기실패", "메시지": "광고 라이브러리 응답을 읽지 못함(차단·지연 가능)"}
    표시건수, 원본 = 결과

    광고들 = {}
    본_ID = set()   # 걸러내기 전 원본 기준. 수집률은 이걸로 잰다.
    def 담기(목록):
        for r in 목록:
            본_ID.add(str(r.get("ad_archive_id")))
            광고 = 결과_정리(r)
            if not 광고 or 광고["라이브러리ID"] in 광고들:
                continue
            if 페이지명_정규화(광고["페이지명"]) != 목표 and 광고["page_id"] != page_id:
                continue
            if 외국어_소재인가(광고["광고텍스트"]) or 채용_소재인가(광고["광고텍스트"]):
                continue
            광고들[광고["라이브러리ID"]] = 광고
    담기(원본)

    # 첫 화면은 최대 30건. 그보다 많으면 매체 유형별로 나눠 각각의 첫 화면을 더 읽는다.
    if 표시건수 and len(원본) < 표시건수:
        for 유형 in ("image", "video", "meme", "none"):
            추가 = 결과_읽기(page, 페이지_URL(page_id, 설정, 유형), 설정)
            if 추가:
                담기(추가[1])

    수집률 = 1.0 if not 표시건수 else min(1.0, len(본_ID) / 표시건수)
    상태 = "게재없음" if 표시건수 == 0 else "정상"
    진행_콜백(f"  page_id={page_id} 표시 {표시건수}건 / 수집 {len(광고들)}건 (수집률 {수집률:.0%})")
    return {"광고": list(광고들.values()), "표시건수": 표시건수, "수집률": 수집률,
            "page_id": page_id, "후보": 후보, "상태": 상태, "메시지": ""}


def 검색_URL_생성(검색어, 설정):
    쿼리 = {"active_status": 설정["scraping"]["active_status"], "ad_type": "all",
           "country": 설정["scraping"]["country"], "q": 검색어,
           "search_type": "keyword_unordered", "media_type": "all"}
    return 광고라이브러리_기본URL + "?" + urlencode(쿼리)


def 페이지_URL(page_id, 설정, 매체="all"):
    쿼리 = {"active_status": 설정["scraping"]["active_status"], "ad_type": "all",
           "country": 설정["scraping"]["country"], "view_all_page_id": page_id,
           "search_type": "page", "media_type": 매체}
    return 광고라이브러리_기본URL + "?" + urlencode(쿼리)


def SSR_결과_추출(html):
    """페이지 HTML에 함께 실려 오는 검색 결과 JSON을 꺼낸다. 없으면 None.

    반환: (표시건수, [collated_result, ...])
    """
    키 = '"search_results_connection":'
    i = html.find(키)
    if i < 0:
        return None
    try:
        연결, _ = json.JSONDecoder().raw_decode(html[i + len(키):])
    except ValueError:
        return None
    결과 = [r for e in 연결.get("edges") or [] for r in (e.get("node") or {}).get("collated_results") or []]
    return 연결.get("count"), 결과


def 결과_읽기(page, url, 설정):
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(int(설정["scraping"]["page_load_wait_seconds"] * 1000))
    return SSR_결과_추출(page.content())


def 페이지ID_찾기(page, 검색어, 페이지명, 설정, 진행_콜백=print):
    """키워드 검색 결과에서 페이지명이 정확히 같은 페이지의 ID를 찾는다.

    못 찾으면 등록명을 품은 다른 페이지명을 후보로 돌려준다(사람이 판단하도록).
    """
    결과 = 결과_읽기(page, 검색_URL_생성(검색어, 설정), 설정)
    if not 결과:
        return None, []
    목표 = 페이지명_정규화(페이지명)
    집계 = Counter()
    아이디 = {}
    for r in 결과[1]:
        이름 = (r.get("page_name") or "").strip()
        if 페이지명_정규화(이름) == 목표:
            return str(r.get("page_id")), []
        집계[이름] += 1
        아이디[이름] = str(r.get("page_id"))
    후보 = [(이름, 아이디[이름]) for 이름, _ in _근접_후보(페이지명, 집계)]
    if 후보:
        진행_콜백(f"  [확인 필요] '{페이지명}' 대신 보이는 페이지: {', '.join(n for n, _ in 후보)}")
    return None, 후보


def _KST_날짜(유닉스):
    if not 유닉스:
        return ""
    from datetime import datetime, timedelta, timezone
    return datetime.fromtimestamp(int(유닉스), timezone(timedelta(hours=9))).strftime("%Y-%m-%d")


def 결과_정리(r):
    """collated_result 하나를 수집 행으로 바꾼다. 대표 이미지가 없으면 None."""
    s = r.get("snapshot") or {}
    카드 = s.get("cards") or []
    이미지 = s.get("images") or []
    영상 = s.get("videos") or []
    대표 = None
    if 이미지:
        대표 = 이미지[0].get("original_image_url") or 이미지[0].get("resized_image_url")
    elif 영상:
        대표 = 영상[0].get("video_preview_image_url")
    elif 카드:
        c = 카드[0]
        대표 = c.get("original_image_url") or c.get("resized_image_url") or c.get("video_preview_image_url")
    if not 대표:
        return None

    본문 = ((s.get("body") or {}).get("text") or "").strip()
    if not 본문 and 카드:
        본문 = (카드[0].get("body") or "").strip()
    if "{{product." in 본문:   # 카탈로그 광고의 템플릿 자리표시자
        본문 = (카드[0].get("body") if 카드 else "") or 본문
    library_id = str(r.get("ad_archive_id"))
    return {
        "라이브러리ID": library_id,
        "page_id": str(r.get("page_id") or s.get("page_id") or ""),
        "페이지명": (r.get("page_name") or s.get("page_name") or "").strip(),
        "이미지URL": 대표,
        "광고텍스트": 본문,
        "광고시작일": _KST_날짜(r.get("start_date")),
        "광고상세URL": f"{광고라이브러리_기본URL}?id={library_id}",
        "게재형식": s.get("display_format") or "",
        "플랫폼": ",".join(r.get("publisher_platform") or []),
        "랜딩URL": s.get("link_url") or (카드[0].get("link_url") if 카드 else "") or "",
        "CTA": s.get("cta_text") or "",
        "제목": (s.get("title") or "").strip(),
        "변형수": str(r.get("collation_count") or 1),
        "묶음ID": str(r.get("collation_id") or ""),
        "영상URL": (영상[0].get("video_sd_url") or 영상[0].get("video_hd_url") or "") if 영상 else "",
    }
