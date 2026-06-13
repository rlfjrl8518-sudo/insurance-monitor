/**
 * 한화손해보험 경쟁사 메타 광고 모니터링 - 이미지 업로드 웹앱
 *
 * Python(sheets_sync.py)이 광고 이미지를 base64로 인코딩해서 이 웹앱에 POST하면,
 * 내 구글 드라이브의 지정 루트 폴더 아래
 *   {경쟁사명}/{수집날짜}/{소재유형 또는 미분류}/
 * 폴더 구조로 자동 분류하여 저장하고 공개 보기 URL을 반환한다.
 *
 * [배포 방법]
 * 1. script.google.com 에서 새 프로젝트 생성 후 이 파일 내용을 붙여넣기
 * 2. 아래 BIMIL_KEY 값을 원하는 비밀키로 변경 (Python config.json의
 *    google_sheets.drive_upload_secret 과 동일한 값이어야 함)
 * 3. 우측 상단 "배포 > 새 배포" > 유형: 웹 앱
 *    - 실행 계정: 나
 *    - 액세스 권한: 전체 허용 (익명 사용자도 URL을 알면 호출 가능. 비밀키로 보호함)
 * 4. 배포 후 발급되는 웹앱 URL을 config.json의
 *    google_sheets.drive_upload_webapp_url 에 입력
 */

// Python config.json의 google_sheets.drive_upload_secret 과 동일한 값으로 변경하세요.
var BIMIL_KEY = "026ac0d9230e4429bc12771c350113fd";

// 소재유형이 비어 있을 때(분류 전) 사용할 폴더명
var 미분류_폴더명 = "미분류";

function doPost(e) {
  var 결과;
  try {
    var 요청 = JSON.parse(e.postData.contents);

    if (요청.secret !== BIMIL_KEY) {
      결과 = { error: "인증 실패: 비밀키가 일치하지 않습니다." };
    } else {
      var 루트폴더 = DriveApp.getFolderById(요청.folderId);

      var 광고주_폴더 = 하위폴더_가져오기또는생성(루트폴더, 요청.광고주 || "기타");
      var 날짜_폴더 = 하위폴더_가져오기또는생성(광고주_폴더, 요청.수집일 || "날짜미정");
      var 소재유형_폴더 = 하위폴더_가져오기또는생성(날짜_폴더, 요청.소재유형 || 미분류_폴더명);

      var 기존파일들 = 소재유형_폴더.getFilesByName(요청.fileName);

      var 파일;
      if (기존파일들.hasNext()) {
        파일 = 기존파일들.next();
      } else {
        var 바이트 = Utilities.base64Decode(요청.base64);
        var blob = Utilities.newBlob(바이트, 요청.mimeType, 요청.fileName);
        파일 = 소재유형_폴더.createFile(blob);
        파일.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      }

      결과 = {
        fileId: 파일.getId(),
        url: "https://lh3.googleusercontent.com/d/" + 파일.getId(),
      };
    }
  } catch (오류) {
    결과 = { error: String(오류) };
  }

  return ContentService.createTextOutput(JSON.stringify(결과))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 부모 폴더 안에서 이름이 일치하는 하위 폴더를 찾거나, 없으면 새로 생성한다. */
function 하위폴더_가져오기또는생성(부모폴더, 이름) {
  var 폴더목록 = 부모폴더.getFoldersByName(이름);
  if (폴더목록.hasNext()) {
    return 폴더목록.next();
  }
  return 부모폴더.createFolder(이름);
}
