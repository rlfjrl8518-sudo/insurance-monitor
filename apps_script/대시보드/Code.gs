/**
 * 한화손해보험 경쟁사 메타 광고 모니터링 - 대시보드
 *
 * "광고모니터링" 시트의 데이터를 카드 갤러리로 보여주고,
 * 소재유형/보종/후킹 분류를 수정하거나 "설정" 시트(광고주/분류 카테고리 목록)를 관리한다.
 *
 * [배포 방법]
 * 1. 데이터가 있는 구글 시트를 열고 "확장 프로그램 > Apps Script" 클릭
 *    (이렇게 만든 스크립트는 이 시트에 바인딩되어 별도 ID 설정이 필요 없음)
 * 2. 기본 생성된 Code.gs 내용을 이 파일 내용으로 교체
 * 3. 파일 추가(+) > HTML > 이름을 정확히 "Index" 로 지정하고 Index.html 내용 붙여넣기
 * 4. 우측 상단 "배포 > 새 배포" > 유형: 웹 앱
 *    - 실행 계정: 나
 *    - 액세스 권한: 전체 허용 (또는 도메인 내 모든 사용자, 필요에 맞게 선택)
 * 5. 배포 후 발급되는 웹앱 URL로 접속하면 대시보드를 사용할 수 있음
 */

var 시트이름_데이터 = "광고모니터링";
var 시트이름_설정 = "설정";

// 대시보드에서 수동으로 교체한 이미지를 저장할 폴더 이름 (내 드라이브 루트 아래)
var 수동업로드_폴더명 = "광고모니터링_수동업로드";

function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("한화손해보험 경쟁사 광고 모니터링")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 시트 객체를 이름으로 가져온다. */
function 시트_가져오기(이름) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(이름);
}

/** 날짜 셀 값을 "yyyy-MM-dd" 문자열로 변환한다 (날짜가 아니면 그대로 반환). */
function 셀값_변환(값) {
  if (Object.prototype.toString.call(값) === "[object Date]") {
    return Utilities.formatDate(값, "GMT+9", "yyyy-MM-dd");
  }
  return 값;
}

/** "광고모니터링" 시트의 모든 행을 헤더 기준 객체 배열로 반환한다. */
function 광고데이터_가져오기() {
  var sheet = 시트_가져오기(시트이름_데이터);
  if (!sheet) return [];

  var 값 = sheet.getDataRange().getValues();
  if (값.length < 2) return [];

  var 헤더 = 값[0];
  var 결과 = [];

  for (var i = 1; i < 값.length; i++) {
    if (!값[i][0]) continue; // ad_id 없는 빈 행은 건너뜀

    var 행 = {};
    for (var j = 0; j < 헤더.length; j++) {
      행[헤더[j]] = 셀값_변환(값[i][j]);
    }
    행.__row = i + 1; // 시트 행 번호 (1부터 시작, 헤더 포함)
    결과.push(행);
  }

  return 결과;
}

/** "설정" 시트에서 광고주/소재유형/보종/후킹 목록을 읽어온다. */
function 설정값_가져오기() {
  var 결과 = { 광고주: [], 소재유형: [], 보종: [], 후킹: [] };

  var sheet = 시트_가져오기(시트이름_설정);
  if (!sheet) return 결과;

  var 값 = sheet.getDataRange().getValues();
  if (값.length < 2) return 결과;

  var 헤더 = 값[0];

  for (var col = 0; col < 헤더.length; col++) {
    var 키 = 헤더[col];
    if (!(키 in 결과)) continue;

    for (var i = 1; i < 값.length; i++) {
      var v = 값[i][col];
      if (v !== "" && v !== null && v !== undefined) {
        결과[키].push(String(v));
      }
    }
  }

  return 결과;
}

/** ad_id로 행을 찾아 소재유형/보종/후킹 컬럼을 수정한다. */
function 광고_수정(ad_id, 소재유형, 보종, 후킹) {
  var sheet = 시트_가져오기(시트이름_데이터);
  if (!sheet) return { success: false, error: "시트를 찾을 수 없습니다: " + 시트이름_데이터 };

  var 값 = sheet.getDataRange().getValues();
  var 헤더 = 값[0];

  var ad_id_열 = 헤더.indexOf("ad_id");
  var 소재유형_열 = 헤더.indexOf("소재유형");
  var 보종_열 = 헤더.indexOf("보종");
  var 후킹_열 = 헤더.indexOf("후킹");

  for (var i = 1; i < 값.length; i++) {
    if (String(값[i][ad_id_열]) === String(ad_id)) {
      if (소재유형_열 >= 0) sheet.getRange(i + 1, 소재유형_열 + 1).setValue(소재유형);
      if (보종_열 >= 0) sheet.getRange(i + 1, 보종_열 + 1).setValue(보종);
      if (후킹_열 >= 0) sheet.getRange(i + 1, 후킹_열 + 1).setValue(후킹);
      return { success: true };
    }
  }

  return { success: false, error: "ad_id를 찾을 수 없습니다: " + ad_id };
}

/** ad_id로 행을 찾아 업로드된 이미지를 내 드라이브에 저장하고 이미지URL/이미지파일명 컬럼을 갱신한다. */
function 이미지_수동업데이트(ad_id, base64Data, fileName, mimeType) {
  var sheet = 시트_가져오기(시트이름_데이터);
  if (!sheet) return { success: false, error: "시트를 찾을 수 없습니다: " + 시트이름_데이터 };

  var 값 = sheet.getDataRange().getValues();
  var 헤더 = 값[0];

  var ad_id_열 = 헤더.indexOf("ad_id");
  var 이미지URL_열 = 헤더.indexOf("이미지URL");
  var 이미지파일명_열 = 헤더.indexOf("이미지파일명");

  var 행번호 = -1;
  for (var i = 1; i < 값.length; i++) {
    if (String(값[i][ad_id_열]) === String(ad_id)) {
      행번호 = i + 1;
      break;
    }
  }
  if (행번호 === -1) return { success: false, error: "ad_id를 찾을 수 없습니다: " + ad_id };

  try {
    var 폴더목록 = DriveApp.getRootFolder().getFoldersByName(수동업로드_폴더명);
    var 폴더 = 폴더목록.hasNext() ? 폴더목록.next() : DriveApp.getRootFolder().createFolder(수동업로드_폴더명);

    var 바이트 = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(바이트, mimeType, fileName);
    var 파일 = 폴더.createFile(blob);
    파일.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var url = "https://lh3.googleusercontent.com/d/" + 파일.getId();

    if (이미지URL_열 >= 0) sheet.getRange(행번호, 이미지URL_열 + 1).setValue(url);
    if (이미지파일명_열 >= 0) sheet.getRange(행번호, 이미지파일명_열 + 1).setValue(fileName);

    return { success: true, url: url };
  } catch (오류) {
    return { success: false, error: String(오류) };
  }
}

/** 설정 화면에서 입력한 광고주/소재유형/보종/후킹 목록으로 "설정" 시트를 다시 작성한다. */
function 설정_저장(설정) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(시트이름_설정);

  if (!sheet) {
    sheet = ss.insertSheet(시트이름_설정);
  } else {
    sheet.clear();
  }

  var 헤더 = ["광고주", "소재유형", "보종", "후킹"];
  var 최대길이 = 0;
  헤더.forEach(function (키) {
    최대길이 = Math.max(최대길이, (설정[키] || []).length);
  });

  var 데이터 = [헤더];
  for (var i = 0; i < 최대길이; i++) {
    var 행 = [];
    헤더.forEach(function (키) {
      var 목록 = 설정[키] || [];
      행.push(i < 목록.length ? 목록[i] : "");
    });
    데이터.push(행);
  }

  if (데이터.length > 1) {
    sheet.getRange(1, 1, 데이터.length, 헤더.length).setValues(데이터);
  } else {
    sheet.getRange(1, 1, 1, 헤더.length).setValues([헤더]);
  }

  return { success: true };
}
