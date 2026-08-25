/**
 * 한화손해보험 경쟁사 메타 광고 모니터링 - 대시보드
 *
 * "광고모니터링" 시트의 데이터를 카드 갤러리로 보여주고,
 * 소재유형/보종/소구포인트 분류를 수정하거나 "설정" 시트(광고주/분류 카테고리 목록)를 관리한다.
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
var 시트이름_광고주그룹 = "광고주그룹";
var 시트이름_수동추가 = "수동추가";
var 시트이름_AI설정 = "AI설정";

// "수동추가" 시트 컬럼 (src/sheets_sync.py와 동일한 순서 유지)
var 수동추가_컬럼 = ["요청URL", "library_id", "상태", "요청일시", "처리일시", "메모"];

// 광고 라이브러리 링크/ID에서 숫자로만 된 라이브러리 ID를 추출한다.
function 라이브러리ID_추출(입력) {
  var 문자열 = String(입력 || "").trim();
  var m = 문자열.match(/[?&]id=(\d+)/);
  if (m) return m[1];
  if (/^\d+$/.test(문자열)) return 문자열;
  return null;
}

// "설정" 시트에서 고정된 의미를 갖는 컬럼 (나머지 컬럼은 모두 광고주 카테고리로 취급)
var 고정_분류_컬럼 = ["소재유형", "보종", "소구포인트", "자사"];

function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("[보험업종 DA소재 모니터링]")
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

/** "설정" 시트에서 카테고리별 광고주/소재유형/보종/소구포인트 목록을 읽어온다.
 *
 * "소재유형"/"보종"/"소구포인트"를 제외한 모든 컬럼은 광고주 카테고리로 취급하며,
 * 결과의 카테고리 항목에 { 카테고리명: [광고주, ...] } 형태로 담긴다.
 */
function 설정값_가져오기() {
  var 결과 = { 카테고리: {}, 소재유형: [], 보종: [], 소구포인트: [], 자사: [], 광고주그룹: {} };

  var sheet = 시트_가져오기(시트이름_설정);
  if (sheet) {
    var 값 = sheet.getDataRange().getValues();

    if (값.length >= 2) {
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
    }
  }

  결과.광고주그룹 = 광고주그룹_가져오기();

  return 결과;
}

/** "광고주그룹" 시트에서 그룹명별 광고주 목록을 읽어온다.
 *
 * 각 컬럼의 헤더를 그룹명으로, 그 아래 셀들을 해당 그룹에 속한 광고주명 목록으로 취급한다.
 */
function 광고주그룹_가져오기() {
  var 결과 = {};

  var sheet = 시트_가져오기(시트이름_광고주그룹);
  if (!sheet) return 결과;

  var 값 = sheet.getDataRange().getValues();
  if (값.length < 1) return 결과;

  var 헤더 = 값[0];

  for (var col = 0; col < 헤더.length; col++) {
    var 그룹명 = String(헤더[col] || "").trim();
    if (!그룹명) continue;

    var 목록 = [];
    for (var i = 1; i < 값.length; i++) {
      var v = 값[i][col];
      if (v !== "" && v !== null && v !== undefined) {
        목록.push(String(v));
      }
    }

    결과[그룹명] = 목록;
  }

  return 결과;
}

/** ad_id로 행을 찾아 소재유형/보종/소구포인트 컬럼을 수정한다. */
function 광고_수정(ad_id, 소재유형, 보종, 소구포인트) {
  var sheet = 시트_가져오기(시트이름_데이터);
  if (!sheet) return { success: false, error: "시트를 찾을 수 없습니다: " + 시트이름_데이터 };

  var 값 = sheet.getDataRange().getValues();
  var 헤더 = 값[0];

  var ad_id_열 = 헤더.indexOf("ad_id");
  var 소재유형_열 = 헤더.indexOf("소재유형");
  var 보종_열 = 헤더.indexOf("보종");
  var 소구포인트_열 = 헤더.indexOf("소구포인트");

  for (var i = 1; i < 값.length; i++) {
    if (String(값[i][ad_id_열]) === String(ad_id)) {
      if (소재유형_열 >= 0) sheet.getRange(i + 1, 소재유형_열 + 1).setValue(소재유형);
      if (보종_열 >= 0) sheet.getRange(i + 1, 보종_열 + 1).setValue(보종);
      if (소구포인트_열 >= 0) sheet.getRange(i + 1, 소구포인트_열 + 1).setValue(소구포인트);
      return { success: true };
    }
  }

  return { success: false, error: "ad_id를 찾을 수 없습니다: " + ad_id };
}

/** 설정 화면에서 입력한 카테고리별 광고주/소재유형/보종/소구포인트 목록으로 "설정" 시트를 다시 작성한다.
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

  광고주그룹_저장(설정.광고주그룹 || {});

  return { success: true };
}

/** 설정 화면에서 입력한 그룹명별 광고주 목록으로 "광고주그룹" 시트를 다시 작성한다.
 *
 * 각 그룹명을 컬럼 헤더로, 그 그룹에 속한 광고주명들을 아래 행에 나열한다.
 * 그룹이 하나도 없으면 시트 내용만 비운다.
 */
function 광고주그룹_저장(광고주그룹) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(시트이름_광고주그룹);

  if (!sheet) {
    sheet = ss.insertSheet(시트이름_광고주그룹);
  } else {
    sheet.clear();
  }

  var 그룹명목록 = Object.keys(광고주그룹);
  if (그룹명목록.length === 0) return;

  var 목록들 = 그룹명목록.map(function (이름) {
    return 광고주그룹[이름] || [];
  });

  var 최대길이 = 0;
  목록들.forEach(function (목록) {
    최대길이 = Math.max(최대길이, 목록.length);
  });

  var 데이터 = [그룹명목록];
  for (var i = 0; i < 최대길이; i++) {
    var 행 = [];
    목록들.forEach(function (목록) {
      행.push(i < 목록.length ? 목록[i] : "");
    });
    데이터.push(행);
  }

  sheet.getRange(1, 1, 데이터.length, 그룹명목록.length).setValues(데이터);
}

/** "AI설정" 시트에서 AI 프로바이더/API키/모델 설정을 읽어온다. */
function AI설정_가져오기() {
  var 기본값 = {
    ai_provider: "gemini",
    gemini_api_key: "",
    gemini_model: "gemini-2.5-flash",
    openai_api_key: "",
    openai_model: "gpt-4o"
  };

  var sheet = 시트_가져오기(시트이름_AI설정);
  if (!sheet) return 기본값;

  var 값 = sheet.getDataRange().getValues();
  var 시트값 = {};
  for (var i = 1; i < 값.length; i++) {  // 첫 행은 헤더
    if (값[i][0]) 시트값[String(값[i][0])] = String(값[i][1] || "");
  }

  return {
    ai_provider: 시트값.ai_provider || 기본값.ai_provider,
    gemini_api_key: 시트값.gemini_api_key || 기본값.gemini_api_key,
    gemini_model: 시트값.gemini_model || 기본값.gemini_model,
    openai_api_key: 시트값.openai_api_key || 기본값.openai_api_key,
    openai_model: 시트값.openai_model || 기본값.openai_model
  };
}

/** "AI설정" 시트에 AI 프로바이더/API키/모델 설정을 저장한다. */
function AI설정_저장(설정) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(시트이름_AI설정);

  if (!sheet) {
    sheet = ss.insertSheet(시트이름_AI설정);
  } else {
    sheet.clear();
  }

  var 데이터 = [
    ["키", "값"],
    ["ai_provider", 설정.ai_provider || "gemini"],
    ["gemini_api_key", 설정.gemini_api_key || ""],
    ["gemini_model", 설정.gemini_model || "gemini-2.5-flash"],
    ["openai_api_key", 설정.openai_api_key || ""],
    ["openai_model", 설정.openai_model || "gpt-4o"]
  ];

  sheet.getRange(1, 1, 데이터.length, 2).setValues(데이터);
  return { success: true };
}

/** "수동추가" 시트를 가져오거나, 없으면 헤더와 함께 새로 만든다. */
function 수동추가_시트_가져오기() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(시트이름_수동추가);

  if (!sheet) {
    sheet = ss.insertSheet(시트이름_수동추가);
    sheet.appendRow(수동추가_컬럼);
    // library_id(B열)를 텍스트 형식으로 설정 - 큰 숫자가 지수 표기법으로 변환되는 것 방지
    sheet.getRange("B:B").setNumberFormat("@");
  }

  return sheet;
}

/** 입력한 광고 라이브러리 링크/ID를 "수동추가" 시트에 "대기" 상태로 등록한다.
 *
 * main.py가 다음 수집 실행 시 "대기" 상태인 행을 읽어 해당 광고 상세 페이지를
 * 조회하고, 결과를 ads.csv에 추가한 뒤 이 시트의 상태를 갱신한다.
 */
function 수동추가_등록(입력) {
  var library_id = 라이브러리ID_추출(입력);
  if (!library_id) {
    return { success: false, error: "광고 링크 또는 라이브러리 ID를 확인할 수 없습니다." };
  }

  var sheet = 수동추가_시트_가져오기();
  // appendRow 전에 B열을 텍스트 형식으로 설정해야 새 행도 텍스트로 저장됨
  sheet.getRange("B:B").setNumberFormat("@");
  var 지금 = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd HH:mm");
  sheet.appendRow([입력, library_id, "대기", 지금, "", ""]);

  return { success: true };
}

/** HTTP POST 요청을 처리한다 (Python에서 수동추가 상태 갱신 시 사용).
 *
 * 요청 형식: {"action": "update_manual_status", "row": 행번호, "status": "완료|실패", "memo": "..."}
 * Apps Script가 스프레드시트 소유자 권한으로 실행되므로 서비스 계정 권한 문제를 우회한다.
 */
function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);

    if (params.action === "update_manual_status") {
      var 행번호 = parseInt(params.row);
      var 상태 = String(params.status || "");
      var 메모 = String(params.memo || "").substring(0, 100);

      var sheet = 수동추가_시트_가져오기();
      var 헤더 = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var 지금 = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd HH:mm");

      var 상태_열 = 헤더.indexOf("상태") + 1;
      var 처리일시_열 = 헤더.indexOf("처리일시") + 1;
      var 메모_열 = 헤더.indexOf("메모") + 1;

      if (상태_열 > 0) sheet.getRange(행번호, 상태_열).setValue(상태);
      if (처리일시_열 > 0) sheet.getRange(행번호, 처리일시_열).setValue(지금);
      if (메모_열 > 0 && 메모) sheet.getRange(행번호, 메모_열).setValue(메모);

      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (params.action === "batch_write") {
      var 시트이름 = String(params.sheetName || "");
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(시트이름);
      if (!sheet) {
        return ContentService.createTextOutput(JSON.stringify({ error: "시트 없음: " + 시트이름 }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      // 1. 셀 값 갱신 [{range: "A1", values: [[v]]}]
      var updates = params.updates || [];
      for (var i = 0; i < updates.length; i++) {
        var u = updates[i];
        if (u.range && u.values) {
          sheet.getRange(u.range).setValues(u.values);
        }
      }

      // 2. 행 삭제 (내림차순 행번호 배열)
      var deleteRows = params.deleteRows || [];
      for (var i = 0; i < deleteRows.length; i++) {
        sheet.deleteRow(deleteRows[i]);
      }

      // 3. 행 추가
      var appendRows = params.appendRows || [];
      for (var i = 0; i < appendRows.length; i++) {
        sheet.appendRow(appendRows[i]);
      }

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        updated: updates.length,
        deleted: deleteRows.length,
        appended: appendRows.length
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ error: "알 수 없는 action: " + params.action }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/** 분석 탭에서 계산한 요약 통계(요약)를 근거로 AI 인사이트/운영 제안 텍스트를 생성한다.
 *
 * "AI설정" 시트에 이미 등록된 Gemini/OpenAI 키를 그대로 재사용한다(분류용 키와 동일).
 * AI가 새 수치를 지어내지 않도록, 통계 계산은 클라이언트(분석 탭)에서 이미 끝낸 뒤
 * 결과 숫자만 프롬프트에 담아 보낸다.
 */
function 분석인사이트_생성(요약) {
  var ai = AI설정_가져오기();
  var provider = ai.ai_provider || "gemini";
  var apiKey = provider === "openai" ? ai.openai_api_key : ai.gemini_api_key;

  if (!apiKey) {
    return {
      success: false,
      error: "설정 > AI 분류 설정에서 " + (provider === "openai" ? "OpenAI" : "Gemini") + " API 키를 먼저 등록해주세요."
    };
  }

  var prompt = 인사이트_프롬프트_생성(요약);

  try {
    var text = provider === "openai"
      ? OpenAI_인사이트_호출(apiKey, ai.openai_model || "gpt-4o", prompt)
      : Gemini_인사이트_호출(apiKey, ai.gemini_model || "gemini-2.5-flash", prompt);
    return { success: true, text: text };
  } catch (err) {
    return { success: false, error: 권한오류_메시지변환(err) };
  }
}

/** UrlFetchApp 관련 권한 오류(외부 요청 스코프 미승인)를 사용자가 바로 조치할 수 있는 안내문으로 바꾼다.
 *
 * 이 스크립트에 UrlFetchApp.fetch(외부 API 호출)를 처음 추가하면, 기존에 배포된 웹앱은
 * 새 권한(script.external_request)을 아직 승인받지 못한 상태로 남아있을 수 있다.
 * 이 경우 소유자가 Apps Script 편집기에서 함수를 한 번 직접 실행해 권한 승인 화면을 띄우고,
 * 승인 후 웹앱을 새 버전으로 재배포해야 웹앱에서도 반영된다.
 */
function 권한오류_메시지변환(err) {
  var 원문 = err && err.toString ? err.toString() : String(err);
  if (원문.indexOf("external_request") !== -1 || 원문.indexOf("권한이 없습니다") !== -1 || /authorization/i.test(원문)) {
    return "Apps Script 권한 재승인이 필요합니다. 스크립트 편집기 상단 함수 선택 목록에서 " +
      "'분석인사이트_권한요청'을 선택해 한 번 실행 → 권한 승인 화면에서 허용 → " +
      "완료 후 '배포 > 배포 관리'에서 새 버전으로 재배포하면 해결됩니다. (원본 오류: " + 원문 + ")";
  }
  return 원문;
}

/** 외부 API 호출(script.external_request) 권한을 최초 1회 승인받기 위한 트리거용 함수.
 *
 * Apps Script 편집기에서 이 함수를 직접 선택해 실행하면 권한 승인 화면이 뜬다.
 * 승인 후에는 웹앱을 새 버전으로 재배포해야 배포된 웹앱에도 승인 내용이 반영된다.
 */
function 분석인사이트_권한요청() {
  UrlFetchApp.fetch("https://www.google.com", { muteHttpExceptions: true });
  Logger.log("권한 승인 완료 - 이제 웹앱을 새 버전으로 재배포해주세요.");
}

/** 인사이트 생성 프롬프트를 만든다. 출력 형식을 고정해 클라이언트에서 파싱하기 쉽게 한다. */
function 인사이트_프롬프트_생성(요약) {
  return [
    "당신은 보험업종 디지털 마케팅 팀의 경쟁사 광고 소재 분석가입니다.",
    "아래는 경쟁사 디스플레이 광고(DA) 모니터링 대시보드에서 이미 계산된 요약 통계(JSON)입니다.",
    "이 수치만 근거로, 자사 담당자가 바로 참고할 핵심 인사이트와 광고 운영 제안을 작성하세요.",
    "",
    "규칙:",
    "- 반드시 한국어로만 작성한다.",
    "- 주어진 JSON에 없는 수치나 사실을 지어내지 않는다.",
    "- 마크다운 굵게(**) 등 서식 문자를 쓰지 않고 평문으로 작성한다.",
    "- 아래 출력 형식을 정확히 지킨다(대괄호 제목 + 하이픈 불릿).",
    "- [핵심 인사이트]에는 데이터에서 두드러지는 자사-경쟁 차이나 추세를 3~4개, 각 1~2문장, 반드시 수치를 인용해 작성.",
    "- [자사 광고 운영 제안]에는 위 인사이트에 대응하는 구체적 실행 제안을 2~3개, 각 1~2문장으로 작성.",
    "",
    "출력 형식 예시:",
    "[핵심 인사이트]",
    "- ...",
    "[자사 광고 운영 제안]",
    "- ...",
    "",
    "데이터:",
    JSON.stringify(요약)
  ].join("\n");
}

/** Gemini generateContent REST API를 호출해 생성된 텍스트를 반환한다. 실패 시 예외를 던진다. */
function Gemini_인사이트_호출(apiKey, model, prompt) {
  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) +
    ":generateContent?key=" + encodeURIComponent(apiKey);
  var payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1024 }
  };

  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = JSON.parse(res.getContentText() || "{}");
  if (code < 200 || code >= 300) {
    throw new Error((body.error && body.error.message) || ("Gemini 호출 실패 (HTTP " + code + ")"));
  }

  var candidate = body.candidates && body.candidates[0];
  var parts = candidate && candidate.content && candidate.content.parts;
  var text = parts ? parts.map(function (p) { return p.text || ""; }).join("") : "";
  if (!text) throw new Error("Gemini 응답에서 텍스트를 찾을 수 없습니다.");
  return text.trim();
}

/** OpenAI chat/completions REST API를 호출해 생성된 텍스트를 반환한다. 실패 시 예외를 던진다. */
function OpenAI_인사이트_호출(apiKey, model, prompt) {
  var url = "https://api.openai.com/v1/chat/completions";
  var payload = {
    model: model,
    messages: [
      { role: "system", content: "당신은 보험업종 디지털 마케팅 광고 소재 분석가입니다." },
      { role: "user", content: prompt }
    ],
    temperature: 0.4,
    max_tokens: 1024
  };

  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = JSON.parse(res.getContentText() || "{}");
  if (code < 200 || code >= 300) {
    throw new Error((body.error && body.error.message) || ("OpenAI 호출 실패 (HTTP " + code + ")"));
  }

  var text = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  if (!text) throw new Error("OpenAI 응답에서 텍스트를 찾을 수 없습니다.");
  return text.trim();
}

/** "수동추가" 시트의 최근 요청 내역(최대 20건, 최신순)을 반환한다. */
function 수동추가_목록_가져오기() {
  var sheet = 수동추가_시트_가져오기();
  var 값 = sheet.getDataRange().getValues();
  if (값.length < 2) return [];

  var 헤더 = 값[0];
  var 결과 = [];

  for (var i = 값.length - 1; i >= 1; i--) {
    var 행 = {};
    for (var j = 0; j < 헤더.length; j++) {
      행[헤더[j]] = 셀값_변환(값[i][j]);
    }
    결과.push(행);
    if (결과.length >= 20) break;
  }

  return 결과;
}
