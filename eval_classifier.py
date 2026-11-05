"""새 분류 기준을 사람이 고친 정답(label_overrides)에 대고 잰다. 저장은 안 한다.

- 고친 건: 예전 AI가 틀린 것들이라 예전 정확도는 0%다. 새 기준이 몇 %를 바로잡는지 본다.
  예시(교정 사례)에서 그 광고 자신은 빼고 돌린다(답을 보고 맞히지 않게).
- 안 고친 건 표본: 사람이 보고도 그냥 둔 값은 아니지만, 새 기준이 기존 값을 얼마나 바꾸는지(흔들림) 본다.

실행: Cloud Run Job에서 `python eval_classifier.py [표본수]` (DATABASE_URL·Vertex 권한 필요)
"""

import os
import random
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import psycopg

from classify import 교정사례_불러오기, 축이름
from src.classifier import 광고_분류, 모델_생성
from src.text_utils import 고지문_제거
from src.config_loader import 경로_절대화, 설정_불러오기
from src.sheets_sync import 설정_동적_적용


def 실행(표본수=60):
    설정 = 설정_불러오기()
    설정 = 설정_동적_적용(설정, 경로_절대화(설정["google_sheets"]["service_account_file"]))
    전체사례 = 교정사례_불러오기(최대=1000)
    with psycopg.connect(os.environ["DATABASE_URL"]) as 연결:
        고친 = 연결.execute(
            "select a.ad_id, a.advertiser, coalesce(a.ad_text,''), a.image_url, o.axis, o.ai_value, o.value "
            "from label_overrides o join ads a using (ad_id) "
            "where o.axis = any(%s) and o.ai_value is distinct from o.value", (list(축이름),)).fetchall()
        안고친 = 연결.execute(
            "select ad_id, advertiser, coalesce(ad_text,''), image_url, insurance_type, appeal_point from ads a "
            "where not exists (select 1 from label_overrides o where o.ad_id = a.ad_id) "
            "and coalesce(insurance_type,'') <> '' order by random() limit %s", (표본수,)).fetchall()
    print(f"고친 정답 {len(고친)}건, 안 고친 표본 {len(안고친)}건")
    client = 모델_생성(설정)

    def 분류(ad_id, 광고주, 본문, 이미지):
        나머지 = dict(설정, 교정사례=[c for c in 전체사례 if c[3] != 고지문_제거(본문)][:40])
        try:
            return 광고_분류(client, 이미지, 광고주, 본문, 나머지)
        except Exception as e:
            print(f"  실패 {ad_id}: {type(e).__name__}")
            return None

    맞음, 전체, 틀린예 = Counter(), Counter(), []
    with ThreadPoolExecutor(8) as 풀:
        결과들 = list(풀.map(lambda r: 분류(*r[:4]), 고친))
    for r, 결과 in zip(고친, 결과들):
        축 = 축이름[r[4]]
        if not 결과:
            continue
        전체[축] += 1
        if 결과.get(축) == r[6]:
            맞음[축] += 1
        else:
            틀린예.append((축, r[6], 결과.get(축), r[2][:60]))
    print("\n[고친 건] 새 기준이 사람 답과 같은 비율 (예전 AI는 이 건들에서 0%)")
    for 축 in 전체:
        print(f"  {축}: {맞음[축]}/{전체[축]} = {맞음[축] / 전체[축]:.0%}")
    print("\n  아직 틀리는 예 (축: 사람 / 새 AI / 본문)")
    for x in 틀린예[:15]:
        print("   ", x)

    with ThreadPoolExecutor(8) as 풀:
        결과들 = list(풀.map(lambda r: 분류(*r[:4]), 안고친))
    바뀜 = Counter()
    n = 0
    for r, 결과 in zip(안고친, 결과들):
        if not 결과:
            continue
        n += 1
        바뀜["보종"] += 결과.get("보종") != r[4]
        바뀜["소구포인트"] += 결과.get("소구포인트") != r[5]
    print(f"\n[안 고친 표본 {n}건] 새 기준에서 값이 바뀌는 비율: "
          + ", ".join(f"{k} {v / max(n, 1):.0%}" for k, v in 바뀜.items()))
    return 0


if __name__ == "__main__":
    random.seed(0)
    sys.exit(실행(int(sys.argv[1]) if len(sys.argv) > 1 else 60))
