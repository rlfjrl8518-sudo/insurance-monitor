"""Cloud Run Job 진입점: 수집 → 분류 → 시트 동기화 → DB 적재를 차례로 돌린다.

예전엔 GitHub Actions가 단계를 돌리고 ads.csv를 git에 커밋했다. 이제 데이터 파일은 GCS 데이터
버킷(DATA_BUCKET, 버전 관리 켜짐)에 두고, 시작할 때 받고 단계마다 올린다. 앞 단계가 실패해도
뒤 단계는 돈다(예전 워크플로의 always()와 같다). 하나라도 실패하면 종료 코드 1.

실행 옵션 (환경변수 STEPS 또는 인자):
  python run_pipeline.py                      # 전부
  python run_pipeline.py classify push        # 일부만
  CLASSIFY_ARGS=--all python run_pipeline.py classify push   # 전체 재분류
"""

import os
import subprocess
import sys

from src.gcp import 받기, 올리기

데이터_버킷 = os.environ.get("DATA_BUCKET", "insurance-monitor-playd-data")
데이터_파일 = ["data/ads.csv", "data/pages.json", "data/health.json", "data/id_map.json"]
단계들 = {
    "collect": ["main.py"],
    "classify": ["classify.py", *os.environ.get("CLASSIFY_ARGS", "").split()],
    "sheets": ["sync_sheets.py"],
    "push": ["push_to_postgres.py"],
}


def 데이터_받기():
    for 이름 in 데이터_파일:
        바이트 = 받기(데이터_버킷, 이름)
        if 바이트 is not None:
            os.makedirs(os.path.dirname(이름), exist_ok=True)
            with open(이름, "wb") as f:
                f.write(바이트)
            print(f"[데이터] 받음 {이름} ({len(바이트):,} bytes)")


def 데이터_올리기():
    for 이름 in 데이터_파일:
        if os.path.exists(이름):
            with open(이름, "rb") as f:
                올리기(데이터_버킷, 이름, f.read(), "text/csv" if 이름.endswith(".csv") else "application/json")
    print("[데이터] 올림")


def 실행(고른것):
    데이터_받기()
    실패 = []
    for 이름 in 고른것:
        print(f"\n{'=' * 20} {이름} {'=' * 20}", flush=True)
        코드 = subprocess.call([sys.executable, "-u", *단계들[이름]])
        if 코드:
            실패.append(f"{이름}({코드})")
        # 단계마다 올린다. 분류가 도중에 죽어도 수집 결과는 남게.
        if 이름 != "push":   # 시트 동기화도 드라이브 주소를 CSV에 채운다
            데이터_올리기()
    if 실패:
        print(f"\n[실패] {', '.join(실패)}")
        return 1
    print("\n모든 단계 완료")
    return 0


if __name__ == "__main__":
    고른것 = sys.argv[1:] or os.environ.get("STEPS", "").split() or list(단계들)
    알수없음 = [x for x in 고른것 if x not in 단계들]
    if 알수없음:
        sys.exit(f"알 수 없는 단계: {알수없음} (가능: {', '.join(단계들)})")
    sys.exit(실행(고른것))
