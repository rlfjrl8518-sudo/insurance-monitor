"""Neon → Cloud SQL 한 번 옮기기. migrate_to_gcp.yml이 실행한다(Neon 주소는 GitHub Secret에만 있다).

대상에 스키마를 먼저 만들고, 테이블마다 대상 컬럼 중 원본에도 있는 것만 COPY로 옮긴다.
여러 번 돌려도 된다(대상 테이블을 비우고 다시 채운다).

실행: SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... python copy_db.py
"""

import io
import os
import sys

import psycopg

# 참조 순서: boards가 ads를 참조하므로 ads가 먼저.
테이블 = ["ads", "settings", "advertiser_groups", "boards", "label_overrides", "ad_sightings", "collection_runs"]


def 컬럼(커서, 표):
    커서.execute("select column_name from information_schema.columns where table_name = %s order by ordinal_position", (표,))
    return [r[0] for r in 커서.fetchall()]


def 실행():
    원본 = psycopg.connect(os.environ["SOURCE_DATABASE_URL"])
    대상 = psycopg.connect(os.environ["TARGET_DATABASE_URL"])
    with 대상.cursor() as c:
        c.execute(io.open("web/db/schema.sql", encoding="utf-8").read())
        c.execute("truncate " + ", ".join(reversed(테이블)))
    대상.commit()

    for 표 in 테이블:
        with 원본.cursor() as s, 대상.cursor() as t:
            있는것 = set(컬럼(s, 표))
            if not 있는것:
                print(f"{표}: 원본에 없음, 건너뜀")
                continue
            열 = ", ".join(c for c in 컬럼(t, 표) if c in 있는것)
            with s.copy(f"copy (select {열} from {표}) to stdout") as 내보내기, \
                    t.copy(f"copy {표} ({열}) from stdin") as 들이기:
                for 덩어리 in 내보내기:
                    들이기.write(덩어리)
            t.execute(f"select count(*) from {표}")
            print(f"{표}: {t.fetchone()[0]:,}행")
        대상.commit()
    return 0


if __name__ == "__main__":
    sys.exit(실행())
