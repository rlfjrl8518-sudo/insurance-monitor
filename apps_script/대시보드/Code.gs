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

// "설정" 시트에서 고정된 의미를 갖는 컬럼 (나머지 컬럼은 모두 광고주 카테고리로 취급)
var 고정_분류_컬럼 = ["소재유형", "보종", "후킹"];

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

/** "설정" 시트에서 카테고리별 광고주/소재유형/보종/후킹 목록을 읽어온다.
 *
 * "소재유형"/"보종"/"후킹"을 제외한 모든 컬럼은 광고주 카테고리로 취급하며,
 * 결과의 카테고리 항목에 { 카테고리명: [광고주, ...] } 형태로 담긴다.
 */
function 설정값_가져오기() {
  var 결과 = { 카테고리: {}, 소재유형: [], 보종: [], 후킹: [] };

  var sheet = 시트_가져오기(시트이름_설정);
  if (!sheet) return 결과;

  var 값 = sheet.getDataRange().getValues();
  if (값.length < 2) return 결과;

  var 헤더 = 값[0];

  for (var col = 0; col < 헤더.length; col++) {
    var 키 = String(헤더[col] || "").trim();
    if (!키) continue;

    var 목록 = [];
    for (var i = 1; i < 값.length; i++) {
      var v = 값[i][col];
      if (v !== "" && v !== null && v !== undefined) {
        목록.push(String(v));
      }
    }

    if (고정_분류_컬럼.indexOf(키) >= 0) {
      결과[키] = 목록;
    } else {
      결과.카테고리[키] = 목록;
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

/** 설정 화면에서 입력한 카테고리별 광고주/소재유형/보종/후킹 목록으로 "설정" 시트를 다시 작성한다.
 *
 * 카테고리는 설정.카테고리의 키를 그대로 컬럼으로 사용하므로, 카테고리를 추가/삭제하면
 * 시트의 컬럼도 그에 맞춰 동적으로 늘어나거나 줄어든다.
 */
function 설정_저장(설정) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(시트이름_설정);

  if (!sheet) {
    sheet = ss.insertSheet(시트이름_설정);
  } else {
    sheet.clear();
  }

  var 카테고리목록 = Object.keys(설정.카테고리 || {});
  var 헤더 = 카테고리목록.concat(고정_분류_컬럼);

  var 목록들 = 카테고리목록.map(function (이름) {
    return 설정.카테고리[이름] || [];
  }).concat(고정_분류_컬럼.map(function (키) {
    return 설정[키] || [];
  }));

  var 최대길이 = 0;
  목록들.forEach(function (목록) {
    최대길이 = Math.max(최대길이, 목록.length);
  });

  var 데이터 = [헤더];
  for (var i = 0; i < 최대길이; i++) {
    var 행 = [];
    목록들.forEach(function (목록) {
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

/** 분석탭 차트 결과(헤더+행)를 "분석_{제목}" 시트에 덮어쓴다.
 *
 * 시트명에 쓸 수 없는 문자([]*?/\:)는 공백으로 바꾸고, 시트명 길이 제한(100자)에 맞춘다.
 */
function 분석결과_내보내기(제목, 헤더, 행들) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var 시트명 = ("분석_" + 제목).replace(/[\[\]\*\?\/\\:]/g, " ").trim().slice(0, 100);

  var sheet = ss.getSheetByName(시트명);
  if (!sheet) {
    sheet = ss.insertSheet(시트명);
  } else {
    sheet.clear();
  }

  var 데이터 = [헤더].concat(행들);
  sheet.getRange(1, 1, 데이터.length, 헤더.length).setValues(데이터);

  return { success: true, 시트명: 시트명 };
}
