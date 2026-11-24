/**
 * 주식노트 — 구글 시트 백엔드 (Google Apps Script) v1.0.0
 * ==========================================================
 * 쓰는 법 (한 번만, 약 5분)
 *  1. 구글 드라이브에서 새 스프레드시트를 만듭니다. (예: 「내 주식노트 데이터」)
 *  2. 그 시트에서 확장 프로그램 → Apps Script 를 엽니다.
 *  3. 기본 Code.gs 내용을 모두 지우고 이 파일 내용을 그대로 붙여 넣고 저장합니다.
 *  4. 배포 → 새 배포 → 유형(⚙) = 웹 앱
 *       · 설명: 주식노트 백엔드
 *       · 다음 사용자로 실행: 나
 *       · 액세스 권한: 모든 사용자   ← 폰 브라우저에서 접속하려면 반드시 이 값
 *     → 배포 → 권한 검토/허용(내 계정) → 웹 앱 URL(.../exec) 복사
 *  5. 복사한 URL을 앱 ⚙ 설정 → '구글 시트 연결'에 붙여 넣고 [연결].
 *     연결되면 주소창이 `...index.html#s=<base64>` 형태로 바뀝니다.
 *     그 주소를 즐겨찾기/홈 화면에 넣으면 다음부터 바로 연결됩니다.
 *     (my-portal·wealth-plan 과 같은 방식입니다. `#s=` 뒤가 base64 로 감싼 .../exec 주소입니다.)
 *
 * 코드를 고친 뒤에는 반드시 배포 → 배포 관리 → 수정(연필) → 버전: 새 버전 → 배포.
 *
 * 시트 구성 (없으면 자동으로 만듭니다)
 *  · 매매기록  : 날짜 | 종목명 | 구분 | 수량 | 단가 | 금액 | 재원 | 이유태그 | 분위기 | 목표기간 | 매도조건 | 메모 | ID
 *                구분 = 매수 / 매도 / 배당,  재원 = 현금 / 담보대출,  이유태그 = `,` 로 연결
 *  · 배당공시  : 종목명 | 월 | 주당예상 | 주당확정 | 수량 | 배당기준일 | 지급일 | 메모 | ID
 *                주당확정이 비어 있으면 '아직 공시 전'으로 보고 예상치를 씁니다.
 *  · 고수매칭  : 저자 | 제목 | 태그 | 핵심요지 | 출처 | ID
 *                태그 = `,` 로 연결,  핵심요지 = ` / ` 로 구분(앱에서 줄바꿈 목록으로 표시)
 *  · 자산추이  : 날짜 | 총자산 | 순수원금 | 메모
 *  · 설정      : 항목 | 값 | 비고
 *  · 시세      : 종목명 | 종목코드 | 현재가 | 갱신시각      (선택 · GOOGLEFINANCE 용)
 *
 * ── 시세 자동화 (선택) ──────────────────────────────────────────
 *  시세 탭의 C열(현재가)에 아래처럼 구글 파이낸스 함수를 넣으면 20분 간격으로 갱신됩니다.
 *      =IF(B2="","",GOOGLEFINANCE("KRX:" & B2))
 *  B열(종목코드)에는 6자리 종목코드를 넣습니다. 예) 삼성전자 005930, SK텔레콤 017670,
 *  KB금융 105560, 맥쿼리인프라 088980.  (KRX 상장 종목만 지원)
 *  앱 ⚙ 설정 → '현재가 자동 불러오기'를 누르면 이 탭의 숫자를 읽어 평가액을 갱신합니다.
 *  ⚠ GOOGLEFINANCE 는 실시간이 아니라 지연 시세이고, 휴장일에는 전일 종가가 남습니다.
 *    배당·수량 같은 기록의 원본은 앱(또는 이 시트)이고, 시세는 참고값으로만 쓰세요.
 *
 * API (브라우저는 JSONP GET 또는 text/plain POST 를 씁니다)
 *  ?action=ping                     연결 확인
 *  ?action=load                     전체 읽기 { ok, app, version, savedAt, data:{settings,prices,trades,dividends,gurus,curve} }
 *  ?action=prices                   시세 탭의 현재 숫자만 읽기 { ok, prices:{종목명:현재가}, updated }
 *  ?action=save  (POST, JSON)       화면 상태 전체를 시트에 한 번에 저장
 *  ?callback=함수이름               JSONP 로 감싸서 응답
 *
 * 안전장치
 *  · 저장 요청이 비어 있으면(매매 0건 + 배당 0건 + 순수원금 0) 기존 시트를 지우지 않고 거부합니다.
 *    정말 전부 지울 때만 clear:true 를 함께 보냅니다.
 *  · 시트를 쓰는 동안 LockService 로 다른 기기의 동시 저장을 잠급니다.
 *
 * 개인정보: 이 스크립트는 사용자 본인의 스프레드시트만 읽고 쓰며, 다른 곳으로 보내지 않습니다.
 *           웹 앱 주소(.../exec)를 아는 사람은 이 시트를 읽고 쓸 수 있으니 주소는 비공개로 두세요.
 */

/** 스프레드시트 ID. 시트에 붙인(컨테이너 바인딩) 스크립트라면 비워 두세요. */
var SHEET_ID = '';

var BACKEND_VERSION = '1.0.0';

var TABS = {
  trades: '매매기록',
  dividends: '배당공시',
  gurus: '고수매칭',
  curve: '자산추이',
  settings: '설정',
  prices: '시세'
};

var HEADERS = {
  trades: ['날짜', '종목명', '구분', '수량', '단가', '금액', '재원', '이유태그', '분위기', '목표기간', '매도조건', '메모', 'ID'],
  dividends: ['종목명', '월', '주당예상', '주당확정', '수량', '배당기준일', '지급일', '메모', 'ID'],
  gurus: ['저자', '제목', '태그', '핵심요지', '출처', 'ID'],
  curve: ['날짜', '총자산', '순수원금', '메모'],
  settings: ['항목', '값', '비고'],
  prices: ['종목명', '종목코드', '현재가', '갱신시각']
};

/** 설정 시트의 한글 항목 ↔ 앱 키 */
var SETTING_KEYS = [
  ['principal', '순수원금', '내 돈으로 넣은 총액(재투입 제외)'],
  ['loanBase', '기존담보대출', '기록 전부터 있던 담보대출 잔액'],
  ['maintenanceRatio', '담보유지비율기준', '증권사 기준 % (보통 140)'],
  ['concWarn', '집중도주의', '상위 종목 비중 주의 %'],
  ['concDanger', '집중도위험', '상위 종목 비중 위험 %']
];

var SIDE_TO_KR = { buy: '매수', sell: '매도', div: '배당' };
var KR_TO_SIDE = { '매수': 'buy', '매도': 'sell', '배당': 'div' };
var FUND_TO_KR = { cash: '현금', loan: '담보대출' };
var KR_TO_FUND = { '현금': 'cash', '담보대출': 'loan' };

/* ------------------------------------------------------------------ 라우팅 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'status';
  var callback = p.callback || '';
  try {
    if (action === 'load') return out_(loadAll_(), callback);
    if (action === 'prices') return out_(readPrices_(), callback);
    if (action === 'ping') return out_({ ok: true, app: 'stocknote', version: BACKEND_VERSION, now: new Date().toISOString() }, callback);
    return out_(status_(), callback);
  } catch (err) {
    return out_({ ok: false, error: errText_(err) }, callback);
  }
}

function doPost(e) {
  var req = {};
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return out_({ ok: false, error: '요청 본문(JSON)을 읽지 못했습니다.' });
  }
  try {
    var action = req.action || 'ping';
    if (action === 'save') return out_(saveAll_(req));
    if (action === 'load') return out_(loadAll_());
    return out_(status_());
  } catch (err) {
    return out_({ ok: false, error: errText_(err) });
  }
}

/** callback이 있으면 JSONP(스크립트)로, 없으면 JSON으로 응답합니다. */
function out_(obj, callback) {
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(obj) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function errText_(err) {
  return String((err && err.message) || err || '알 수 없는 오류');
}

function ss_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive();
}

function tab_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sh;
}

/** 헤더가 비어 있는 기존 시트도 안전하게 쓰도록 1행을 채웁니다. */
function ensureHeader_(sh, headers) {
  var first = sh.getRange(1, 1, 1, Math.max(headers.length, 1)).getValues()[0];
  var empty = true;
  for (var i = 0; i < first.length; i++) if (String(first[i]).length) { empty = false; break; }
  if (empty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ------------------------------------------------------------------ 상태 */

function status_() {
  var ss = ss_();
  return {
    ok: true, app: 'stocknote', version: BACKEND_VERSION,
    title: ss.getName(), now: new Date().toISOString()
  };
}

/* ------------------------------------------------------------------ 읽기 */

function loadAll_() {
  var ss = ss_();
  var settings = readSettings_(ss);
  var data = {
    settings: settings,
    prices: readPriceMap_(ss, settings),
    trades: readTrades_(ss),
    dividends: readDividends_(ss),
    gurus: readGurus_(ss),
    curve: readCurve_(ss)
  };
  delete data.settings._pricesJson;
  return {
    ok: true, app: 'stocknote', version: BACKEND_VERSION,
    savedAt: data.settings.appConnectedAt || '',
    data: data
  };
}

function readSettings_(ss) {
  var sh = ss.getSheetByName(TABS.settings);
  var out = {};
  if (!sh) return out;
  var last = sh.getLastRow();
  if (last < 2) return out;
  var values = sh.getRange(2, 1, last - 1, 3).getValues();
  var byKr = {};
  values.forEach(function(row){
    var k = String(row[0] || '').trim();
    if (k) byKr[k] = row[1];
  });
  SETTING_KEYS.forEach(function(pair){
    if (byKr[pair[1]] !== undefined && byKr[pair[1]] !== '') out[pair[0]] = num_(byKr[pair[1]]);
  });
  if (byKr['앱연결시각']) out.appConnectedAt = String(byKr['앱연결시각']);
  if (byKr['종목시세']) {
    try { out._pricesJson = JSON.parse(String(byKr['종목시세'])); } catch (e) {}
  }
  return out;
}

function readPriceMap_(ss, settings) {
  var out = {};
  var s = settings || readSettings_(ss);
  if (s && s._pricesJson && typeof s._pricesJson === 'object'){
    Object.keys(s._pricesJson).forEach(function(k){ out[k] = num_(s._pricesJson[k]); });
  }
  /* 시세 탭 숫자가 있으면 우선합니다. */
  var p = ss.getSheetByName(TABS.prices);
  if (p && p.getLastRow() > 1){
    var rows = p.getRange(2, 1, p.getLastRow() - 1, 3).getValues();
    rows.forEach(function(r){
      var name = String(r[0] || '').trim();
      var v = num_(r[2]);
      if (name && v > 0) out[name] = v;
    });
  }
  return out;
}

function readTrades_(ss) {
  var sh = ss.getSheetByName(TABS.trades);
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.trades.length).getValues();
  var out = [];
  rows.forEach(function(r){
    var name = String(r[1] || '').trim();
    if (!name) return;
    out.push({
      id: String(r[12] || '') || ('r' + out.length + '-' + Math.random().toString(36).slice(2, 6)),
      date: dateStr_(r[0]),
      name: name,
      side: KR_TO_SIDE[String(r[2] || '').trim()] || 'buy',
      qty: num_(r[3]),
      price: num_(r[4]),
      funding: KR_TO_FUND[String(r[6] || '').trim()] || 'cash',
      reasons: splitList_(r[7]),
      mood: String(r[8] || '보통').trim() || '보통',
      horizon: String(r[9] || '중기').trim() || '중기',
      rule: String(r[10] || ''),
      memo: String(r[11] || '')
    });
  });
  return out;
}

function readDividends_(ss) {
  var sh = ss.getSheetByName(TABS.dividends);
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.dividends.length).getValues();
  var out = [];
  rows.forEach(function(r){
    var name = String(r[0] || '').trim();
    if (!name) return;
    var conf = r[3];
    out.push({
      id: String(r[8] || '') || ('d' + out.length + '-' + Math.random().toString(36).slice(2, 6)),
      name: name,
      month: num_(r[1]) || 1,
      expectedPer: num_(r[2]),
      confirmedPer: (conf === '' || conf === null || conf === undefined) ? null : num_(conf),
      qty: num_(r[4]),
      exDate: dateStr_(r[5]),
      payDate: dateStr_(r[6]),
      note: String(r[7] || '')
    });
  });
  return out;
}

function readGurus_(ss) {
  var sh = ss.getSheetByName(TABS.gurus);
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.gurus.length).getValues();
  var out = [];
  rows.forEach(function(r){
    var title = String(r[1] || '').trim();
    if (!title) return;
    out.push({
      id: String(r[5] || '') || ('g' + out.length),
      author: String(r[0] || '').trim() || '아카이브',
      title: title,
      tags: splitList_(r[2]),
      points: String(r[3] || '').split(' / ').map(function(s){ return s.trim(); }).filter(Boolean),
      src: String(r[4] || '')
    });
  });
  return out;
}

function readCurve_(ss) {
  var sh = ss.getSheetByName(TABS.curve);
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  var out = [];
  rows.forEach(function(r){
    var d = dateStr_(r[0]);
    if (!d) return;
    out.push({ date: d, total: num_(r[1]), principal: num_(r[2]) });
  });
  return out;
}

function readPrices_() {
  var ss = ss_();
  var sh = ss.getSheetByName(TABS.prices);
  if (!sh) {
    return { ok: false, error: '시세 탭이 없습니다. Code.gs를 다시 실행해 탭을 만들고, 종목코드를 채워 주세요.' };
  }
  var prices = {};
  var updated = '';
  if (sh.getLastRow() > 1){
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
    rows.forEach(function(r){
      var name = String(r[0] || '').trim();
      var v = num_(r[2]);
      if (name && v > 0) prices[name] = v;
      if (r[3]) updated = String(r[3]);
    });
  }
  return { ok: true, prices: prices, updated: updated };
}

/* ------------------------------------------------------------------ 쓰기 */

function saveAll_(req) {
  var data = (req && req.data) || {};
  var clear = !!(req && req.clear);
  var ss = ss_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return { ok: false, error: '다른 기기가 저장 중입니다. 잠시 뒤 다시 시도해 주세요.' };
  }
  try {
    var trades = Array.isArray(data.trades) ? data.trades : [];
    var divs = Array.isArray(data.dividends) ? data.dividends : [];
    var settings = data.settings || {};

    if (!clear && trades.length === 0 && divs.length === 0 && num_(settings.principal) <= 0) {
      return { ok: false, error: '빈 데이터라 기존 시트를 지우지 않았습니다. (정말 비울 때만 clear:true)' };
    }

    writeTrades_(ss, trades);
    writeDividends_(ss, divs);
    writeGurus_(ss, Array.isArray(data.gurus) ? data.gurus : []);
    writeCurve_(ss, Array.isArray(data.curve) ? data.curve : []);
    writeSettings_(ss, settings, data.prices || {});
    writePrices_(ss, data.prices || {});

    return { ok: true, app: 'stocknote', version: BACKEND_VERSION, savedAt: new Date().toISOString() };
  } finally {
    lock.releaseLock();
  }
}

function clearBody_(sh, width) {
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, width).clearContent();
}

function writeTrades_(ss, list) {
  var sh = ensureHeader_(tab_(ss, TABS.trades, HEADERS.trades), HEADERS.trades);
  clearBody_(sh, HEADERS.trades.length);
  if (!list.length) return;
  var rows = list.map(function(t){
    var qty = num_(t.qty), price = num_(t.price);
    return [
      t.date || '', String(t.name || ''), SIDE_TO_KR[t.side] || '매수',
      qty, price, qty * price,
      FUND_TO_KR[t.funding] || '현금',
      (t.reasons || []).join(', '),
      t.mood || '보통', t.horizon || '중기',
      t.rule || '', t.memo || '', t.id || ''
    ];
  });
  sh.getRange(2, 1, rows.length, HEADERS.trades.length).setValues(rows);
  sh.getRange(2, 1, rows.length, HEADERS.trades.length).setVerticalAlignment('middle');
}

function writeDividends_(ss, list) {
  var sh = ensureHeader_(tab_(ss, TABS.dividends, HEADERS.dividends), HEADERS.dividends);
  clearBody_(sh, HEADERS.dividends.length);
  if (!list.length) return;
  var rows = list.map(function(x){
    return [
      String(x.name || ''), num_(x.month) || 1, num_(x.expectedPer),
      (x.confirmedPer === null || x.confirmedPer === '' || x.confirmedPer === undefined) ? '' : num_(x.confirmedPer),
      num_(x.qty), x.exDate || '', x.payDate || '', x.note || '', x.id || ''
    ];
  });
  sh.getRange(2, 1, rows.length, HEADERS.dividends.length).setValues(rows);
}

function writeGurus_(ss, list) {
  var sh = ensureHeader_(tab_(ss, TABS.gurus, HEADERS.gurus), HEADERS.gurus);
  clearBody_(sh, HEADERS.gurus.length);
  if (!list.length) return;
  var rows = list.map(function(g){
    return [
      g.author || '', g.title || '', (g.tags || []).join(', '),
      (g.points || []).join(' / '), g.src || '', g.id || ''
    ];
  });
  sh.getRange(2, 1, rows.length, HEADERS.gurus.length).setValues(rows);
}

function writeCurve_(ss, list) {
  var sh = ensureHeader_(tab_(ss, TABS.curve, HEADERS.curve), HEADERS.curve);
  clearBody_(sh, HEADERS.curve.length);
  if (!list.length) return;
  var rows = list.map(function(p){ return [p.date || '', num_(p.total), num_(p.principal), p.memo || '']; });
  sh.getRange(2, 1, rows.length, HEADERS.curve.length).setValues(rows);
}

function writeSettings_(ss, s, prices) {
  var sh = ensureHeader_(tab_(ss, TABS.settings, HEADERS.settings), HEADERS.settings);
  clearBody_(sh, HEADERS.settings.length);
  var rows = SETTING_KEYS.map(function(pair){ return [pair[1], num_(s[pair[0]]), pair[2]]; });
  rows.push(['종목시세', JSON.stringify(prices || {}), '앱이 저장한 현재가(JSON)']);
  rows.push(['앱연결시각', new Date().toISOString(), '앱이 마지막으로 저장한 시각']);
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
}

/**
 * 시세 탭에 현재가를 숫자로 남깁니다.
 * 이미 GOOGLEFINANCE 수식이 들어 있는 C열 셀은 덮어쓰지 않습니다.
 */
function writePrices_(ss, prices) {
  var sh = tab_(ss, TABS.prices, HEADERS.prices);
  if (sh.getLastRow() === 1 && Object.keys(prices).length){
    sh.setColumnWidth(1, 140);
  }
  var names = Object.keys(prices || {});
  if (!names.length) return;
  var existing = {};
  if (sh.getLastRow() > 1){
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
    rows.forEach(function(r, i){
      var nm = String(r[0] || '').trim();
      if (nm) existing[nm] = { row: i + 2, code: r[1], formula: sh.getRange(i + 2, 3).getFormula() };
    });
  }
  var nextRow = sh.getLastRow() + 1;
  names.forEach(function(nm){
    var v = num_(prices[nm]);
    if (!(v > 0)) return;
    var e = existing[nm];
    if (e){
      if (!e.formula) sh.getRange(e.row, 3).setValue(v);   // 수식이 없을 때만 숫자로 갱신
    } else {
      sh.getRange(nextRow, 1, 1, 3).setValues([[nm, '', v]]);
      nextRow += 1;
    }
  });
  sh.getRange(1, 4).setValue('갱신시각');
  sh.getRange(2, 4).setValue(new Date());
}

/* ------------------------------------------------------------------ 작은 도구들 */

function num_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var n = Number(String(v).replace(/[,\s원₩]/g, ''));
  return isFinite(n) ? n : 0;
}

function splitList_(v) {
  return String(v || '').split(/[,，]/).map(function(s){ return s.trim(); }).filter(Boolean);
}

function dateStr_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  return s;
}

/* ------------------------------------------------------------------ 편의(수동 실행) */

/**
 * 편집기에서 한 번 실행하면 필요한 탭을 모두 만들고 시세 탭에 예시 종목 행을 넣습니다.
 * (앱을 연결하기 전에 시트 모양을 보고 싶을 때만 쓰세요. 기존 데이터는 건드리지 않습니다.)
 */
function setupSheets() {
  var ss = ss_();
  Object.keys(TABS).forEach(function(k){
    tab_(ss, TABS[k], HEADERS[k]);
  });
  var sh = ss.getSheetByName(TABS.prices);
  if (sh.getLastRow() === 1){
    sh.getRange(2, 1, 4, 2).setValues([
      ['삼성전자', '005930'],
      ['SK텔레콤', '017670'],
      ['KB금융', '105560'],
      ['맥쿼리인프라', '088980']
    ]);
    sh.getRange(2, 3, 4, 1).setFormula('=IF(B2="","",GOOGLEFINANCE("KRX:" & B2))');
    sh.getRange(2, 4, 4, 1).setValue(new Date());
    sh.setColumnWidth(1, 140);
    sh.setColumnWidth(2, 100);
    sh.setColumnWidth(3, 120);
  }
  return '탭 준비 완료: ' + Object.keys(TABS).map(function(k){ return TABS[k]; }).join(', ');
}
