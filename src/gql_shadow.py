"""광고 라이브러리가 내부적으로 주고받는 GraphQL 응답을 곁에서 지켜보는 모듈 (1단계: 그림자 수집).

지금 수집은 화면에 그려진 DOM을 긁는 방식인데, 스크롤이 일찍 멈추면 광고를 놓쳐도
그 사실을 알 수가 없다. 반면 광고 목록은 원래 GraphQL 응답으로 내려오고, 거기에는
DOM에 그려지지 않는 값(게재 플랫폼, 캐러셀 전체 소재, 랜딩 URL 등)까지 들어 있다.

이 모듈은 수집 방식을 바꾸지 않는다. 브라우저가 이미 받은 응답을 읽어서
DOM 수집 결과와 대조한 뒤, 차이만 기록한다. 며칠 쌓아 실제 누락률을 확인한 다음에
주 수집원을 바꿀지 판단하기 위한 관측 장치다.

요청을 직접 만들어 보내지 않는다. 브라우저가 평소처럼 보낸 요청의 응답만 읽으므로
네트워크 트래픽은 그림자 수집을 켜기 전과 완전히 같다.
"""

import json
import os
from datetime import datetime

from src.csv_store import KST

# 페이지 스크립트보다 먼저 심어서 fetch/XHR을 감싼다.
#
# 응답 본문을 파이썬에서 나중에 읽는 방식(page.on("response") + .text())은 스트리밍과
# 경합이 나서 자주 비었고(실측 5회 중 3회 실패), 페이지 전역 변수에 쌓는 방식도
# 실패했다. 광고 라이브러리가 로드 직후 URL을 다시 쓰면서(sort_data 파라미터 추가)
# 문서를 새로 띄우는데, 그때 전역 변수가 초기화되면서 이미 잡은 응답이 날아간다.
# 그래서 잡는 즉시 파이썬으로 넘긴다. 문서가 바뀌어도 수집한 것은 파이썬에 남는다.
후킹_스크립트 = """
(() => {
  const 보관 = (t) => {
    if (!t || t.length <= 5000) return;
    try { window.__gqlPush(t); } catch (e) {}
  };
  const 원래fetch = window.fetch;
  window.fetch = async function(...인자) {
    const u = (typeof 인자[0] === 'string') ? 인자[0] : (인자[0] && 인자[0].url) || '';
    const 응답 = await 원래fetch.apply(this, 인자);
    if (u.indexOf('/api/graphql') !== -1) { try { 보관(await 응답.clone().text()); } catch (e) {} }
    return 응답;
  };
  const 원래open = XMLHttpRequest.prototype.open;
  const 원래send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, u, ...r) { this.__u = u; return 원래open.call(this, m, u, ...r); };
  XMLHttpRequest.prototype.send = function(...인자) {
    this.addEventListener('load', () => {
      try { if (String(this.__u).indexOf('/api/graphql') !== -1) 보관(this.responseText); } catch (e) {}
    });
    return 원래send.apply(this, 인자);
  };
})();
"""


def 켜기(page):
    """후킹을 심고, 잡힌 응답을 담을 보관함(list)을 돌려준다. goto 전에 호출해야 한다.

    보관함은 페이지 이동과 무관하게 유지되므로, 광고주별로 비우고 쓰면 된다.

    채널을 둘 다 건다. 메타가 상황에 따라 응답을 다른 경로로 내려주는 것으로 보여
    한쪽만으로는 실행마다 잡히기도 하고 안 잡히기도 했다. 둘 다 걸어두고 중복은
    나중에 광고 ID 기준으로 제거한다.
    """
    보관함 = []

    def 받기(본문):
        if 본문 and len(본문) > 5000 and len(보관함) < 60:
            보관함.append(본문)

    # 채널 1: 페이지 안에서 fetch/XHR을 감싸 잡는 즉시 넘겨받는다.
    page.expose_function("__gqlPush", 받기)
    page.add_init_script(후킹_스크립트)

    # 채널 2: Playwright가 보는 응답에서 직접 읽는다. 스트리밍과 경합이 나 실패할 때가
    # 있으므로 실패는 조용히 넘긴다(채널 1이 잡아줄 수 있다).
    def 응답_받기(응답):
        if "/api/graphql" not in 응답.url:
            return
        try:
            받기(응답.text())
        except Exception:
            pass

    page.on("response", 응답_받기)
    return 보관함


def _레코드_모으기(덩어리):
    """GraphQL 응답(JSON 라인들)에서 광고 레코드만 골라낸다."""
    레코드 = []

    def 훑기(값, 깊이=0):
        if 깊이 > 14:
            return
        if isinstance(값, dict):
            if "ad_archive_id" in 값:
                레코드.append(값)
                return
            for 하위 in 값.values():
                훑기(하위, 깊이 + 1)
        elif isinstance(값, list):
            for 하위 in 값:
                훑기(하위, 깊이 + 1)

    for 본문 in 덩어리:
        for 줄 in 본문.split("\n"):
            줄 = 줄.strip()
            if not 줄:
                continue
            try:
                훑기(json.loads(줄))
            except (json.JSONDecodeError, ValueError):
                continue
    return 레코드


def 광고레코드_읽기(보관함):
    """보관함에 쌓인 GraphQL 응답에서 광고 레코드 목록을 만든다."""
    return _레코드_모으기(보관함 or [])


def 대조_기록(보관함, 광고주명, 수집된_library_id, 기록_경로, 진행_콜백=print):
    """GraphQL 레코드와 DOM 수집 결과를 대조해 차이를 한 줄로 남긴다.

    수집 결과 자체는 건드리지 않는다. 판단 근거를 모으는 것이 목적이다.
    """
    레코드 = 광고레코드_읽기(보관함)
    api_id = {str(r.get("ad_archive_id")) for r in 레코드 if r.get("ad_archive_id")}
    dom_id = {str(i) for i in 수집된_library_id}

    if not api_id:
        # 응답을 못 잡은 경우와 정말 광고가 없는 경우를 구분해서 남긴다.
        진행_콜백(f"  [그림자] GraphQL 응답을 잡지 못함 (DOM {len(dom_id)}건) - 대조 생략")
    else:
        진행_콜백(f"  [그림자] GraphQL {len(api_id)}건 vs DOM {len(dom_id)}건 "
                f"(API에만 {len(api_id - dom_id)}건, DOM에만 {len(dom_id - api_id)}건)")

    항목 = {
        "시각": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S"),
        "광고주": 광고주명,
        "api건수": len(api_id),
        "dom건수": len(dom_id),
        "api에만": sorted(api_id - dom_id)[:20],
        "dom에만": sorted(dom_id - api_id)[:20],
        "캡처성공": bool(api_id),
    }
    try:
        os.makedirs(os.path.dirname(기록_경로), exist_ok=True)
        with open(기록_경로, "a", encoding="utf-8") as f:
            f.write(json.dumps(항목, ensure_ascii=False) + "\n")
    except OSError as e:
        진행_콜백(f"  [그림자] 기록 실패(무시하고 진행): {e}")
    return 항목
