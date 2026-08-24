"""일회성 정리 스크립트: 소구포인트/후킹방식 컬럼을 시트_컬럼 순서상 올바른 위치로 옮긴다.

과거 마이그레이션 로직이 새 컬럼을 항상 맨 끝에 추가하던 버그 때문에, 이미 만들어진
"소구포인트"/"후킹방식" 컬럼이 "운영일수" 뒤(시트 맨 끝)에 가 있다. 기능상 문제는 없지만
(코드가 컬럼명으로 찾아 씀) 보기 불편해서, 데이터를 보존한 채 "보종" 바로 뒤로 옮긴다.
"""

from src.config_loader import 경로_절대화, 설정_불러오기
from src.sheets_sync import 구글_인증, 워크시트_가져오기, 설정_동적_적용, 시트_컬럼


def _컬럼_이동(worksheet, 컬럼명):
    헤더 = worksheet.row_values(1)
    if 컬럼명 not in 헤더:
        print(f"{컬럼명}: 시트에 없음, 건너뜀")
        return

    idx = 시트_컬럼.index(컬럼명)
    목표_위치 = 1
    for 이전 in reversed(시트_컬럼[:idx]):
        if 이전 in 헤더:
            목표_위치 = 헤더.index(이전) + 2
            break

    현재_위치 = 헤더.index(컬럼명) + 1
    if 현재_위치 == 목표_위치:
        print(f"{컬럼명}: 이미 올바른 위치({현재_위치})")
        return

    전체값 = worksheet.get_all_values()
    컬럼_데이터 = [row[현재_위치 - 1] if len(row) >= 현재_위치 else "" for row in 전체값]

    worksheet.delete_columns(현재_위치)

    # 삭제로 인덱스가 밀렸을 수 있으니 목표 위치를 다시 계산한다
    헤더 = worksheet.row_values(1)
    idx2 = 시트_컬럼.index(컬럼명)
    목표_위치2 = 1
    for 이전 in reversed(시트_컬럼[:idx2]):
        if 이전 in 헤더:
            목표_위치2 = 헤더.index(이전) + 2
            break

    worksheet.insert_cols([컬럼_데이터], 목표_위치2)
    print(f"{컬럼명}: {현재_위치} -> {목표_위치2} 로 이동 완료 ({len(컬럼_데이터)}개 값 보존)")


def 실행():
    설정 = 설정_불러오기()
    서비스계정_경로 = 경로_절대화(설정["google_sheets"]["service_account_file"])
    설정 = 설정_동적_적용(설정, 서비스계정_경로)

    gc = 구글_인증(서비스계정_경로)
    worksheet = 워크시트_가져오기(gc, 설정)

    print("=" * 60)
    print("컬럼 순서 정리 시작")
    print("=" * 60)

    # 시트_컬럼에 등장하는 순서대로(앞쪽부터) 옮겨야 뒤 컬럼 위치 계산이 꼬이지 않는다
    for 컬럼명 in 시트_컬럼:
        if 컬럼명 in ("소구포인트", "후킹방식"):
            _컬럼_이동(worksheet, 컬럼명)

    print("완료")
    print("최종 헤더:", worksheet.row_values(1))


if __name__ == "__main__":
    실행()
