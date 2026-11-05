"""ads.csv를 v2 구조로 한 번 옮긴다. 여러 번 돌려도 결과가 같다.

1. ad_id: 이미지 경로 해시 -> 메타 라이브러리 ID. 같은 광고가 이미지 주소만 바뀌어 여러 행으로
   쪼개지던 문제를 없앤다. 겹치면 최근에 확인된 행을 남기고 빈 분류는 다른 행에서 채운다.
2. 상태: 신규/운영중 -> 게재중 (CSV_읽기가 처리).
3. 운영일수: 종료된 광고는 종료일에서 멈추게 다시 계산.
4. data/id_map.json: 옛 ID -> 새 ID. Postgres 적재 때 보드(스크랩)를 새 ID로 옮기는 데 쓴다.
"""

import json
import re

from src.config_loader import 경로_절대화, 설정_불러오기
from src.csv_store import CSV_쓰기, CSV_읽기, 운영일수_계산, 오늘_KST

분류_컬럼 = ["소재유형", "보종", "소구포인트", "요약"]


def 옮기기(전체):
    새것, 대응 = {}, {}
    for 옛id, 행 in sorted(전체.items(), key=lambda kv: kv[1].get("수집일") or ""):
        m = re.search(r"[?&]id=(\d+)", 행.get("광고상세URL") or "")
        새id = m.group(1) if m else 옛id
        if 새id != 옛id:
            대응[옛id] = 새id
        행["ad_id"] = 새id
        기존 = 새것.get(새id)
        if 기존:   # 수집일 오름차순이라 지금 행이 더 최근이다
            for 컬럼 in 분류_컬럼:
                행[컬럼] = 행.get(컬럼) or 기존.get(컬럼, "")
            행["최초발견일"] = min(filter(None, [기존.get("최초발견일"), 행.get("최초발견일")]), default="")
        새것[새id] = 행
    오늘 = 오늘_KST()
    for 행 in 새것.values():
        행["운영일수"] = str(운영일수_계산(행, 오늘))
        행.setdefault("미확인횟수", "0")
    return 새것, 대응


if __name__ == "__main__":
    설정 = 설정_불러오기()
    csv_경로 = 경로_절대화(설정["paths"]["csv_file"])
    전체 = CSV_읽기(csv_경로)
    새것, 대응 = 옮기기(전체)
    CSV_쓰기(csv_경로, 새것)
    지도_경로 = 경로_절대화("data/id_map.json")
    try:
        옛지도 = json.load(open(지도_경로, encoding="utf-8"))
    except OSError:
        옛지도 = {}
    json.dump({**옛지도, **대응}, open(지도_경로, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"{len(전체)}행 -> {len(새것)}행, ID 변경 {len(대응)}건")
