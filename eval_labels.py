"""AI 분류가 자주 틀리는 패턴을 본다. 정답지는 웹 상세 화면의 '분류 고치기'로 사람이 고친 값(label_overrides)이다.

주의: 고친 건만 쌓이므로 이 숫자는 '전체 정확도'가 아니라 '틀린 것들의 패턴'이다. 어떤 값을 어떤
값으로 자주 헷갈리는지 보고 분류 규칙(설정 > 분류 판단 기준)을 고치는 데 쓴다.

실행: DATABASE_URL=... python eval_labels.py
"""

import os
import sys
from collections import Counter


def 실행():
    import psycopg

    with psycopg.connect(os.environ["DATABASE_URL"]) as 연결:
        행들 = 연결.execute("select axis, value, ai_value from label_overrides").fetchall()
    if not 행들:
        print("아직 사람이 고친 분류가 없습니다.")
        return 0
    전체, 혼동 = Counter(), Counter()
    for 축, 정답, ai in 행들:
        전체[축] += 1
        if 정답 != ai:
            혼동[(축, ai, 정답)] += 1
    for 축 in sorted(전체):
        print(f"{축}: 고친 {전체[축]}건")
    print("\n자주 틀리는 조합 (축: AI 값 -> 사람 값)")
    for (축, ai, 정답), n in 혼동.most_common(10):
        print(f"  {축}: {ai} -> {정답} ({n}건)")
    return 0


if __name__ == "__main__":
    sys.exit(실행())
