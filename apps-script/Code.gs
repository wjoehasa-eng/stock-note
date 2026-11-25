/**
 * 주식노트 — 구글 시트 백엔드 (Google Apps Script) v1.2.0
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
 *                구분 = 매수 / 매도 / 배당 / 초기보유,  재원 = 현금 / 담보대출,  이유태그 = `,` 로 연결
 *                · 초기보유 = 앱 「+ 기존 보유 추가」로 넣은 "예전부터 들고 있던 종목".
 *                  수량·평단·평가액에는 합산되고, 예수금·이유태그·분위기 통계에는 쓰이지 않습니다.
 *                  ID 열이 i1-로 시작하면 '매수 총액을 순수 원금에 포함', i0-이면 미포함입니다.
 *                    (이 접두어는 앱이 원금 포함 여부를 되살리려고 붙이는 표식이고, 일반 매매 ID에는 없습니다.)
 *  · 배당공시  : 종목명 | 월 | 주당예상 | 주당확정 | 수량 | 배당기준일 | 지급일 | 메모 | ID
 *                주당확정이 비어 있으면 '아직 공시 전'으로 보고 예상치를 씁니다.
 *  · 고수매칭  : 저자 | 제목 | 태그 | 핵심요지 | 출처 | ID
 *                태그 = `,` 로 연결,  핵심요지 = ` / ` 로 구분(앱에서 줄바꿈 목록으로 표시)
 *  · 자산추이  : 날짜 | 총자산 | 순수원금 | 메모
 *  · 설정      : 항목 | 값 | 비고
 *  · 시세      : 종목명 | 종목코드 | 현재가 | 갱신시각      (선택 · GOOGLEFINANCE 용)
 *
 * ── 시세 자동화 (v1.2.0 부터 기본) ─────────────────────────────
 *  저장(save)과 시세 조회(prices) 요청마다 아래 순서로 움직입니다.
 *   ① 매매기록에 있는 종목 중 시세 탭에 없는 종목을 시세 탭에 추가
 *   ② 종목코드가 빈 종목은 네이버 금융 검색(ac.stock.naver.com)으로 6자리 종목코드를 찾아 채움
 *   ③ 코드가 있는 종목의 현재가를 네이버 금융(m.stock.naver.com/api/stock/{code}/basic)에서 받아
 *      시세 탭 C열의 숫자를 갱신 (60초 캐시 · 하루 호출 한도 보호)
 *  · C열에 GOOGLEFINANCE 수식이 들어 있는 칸은 수식을 지우지 않고 그대로 둡니다.
 *  · 네이버가 응답하지 못한 종목은 시세 탭에 남아 있던 숫자를 그대로 돌려 줍니다(폴백).
 *  · 시세는 지연 시세이고 휴장일에는 전일 종가가 남습니다. 기록의 원본은 앱·시트이고 시세는 참고값입니다.
 *
 *  ※ 예전 방식(GOOGLEFINANCE)도 그대로 살아 있습니다.
 *      =IF(B2="","",GOOGLEFINANCE("KRX:" & B2))
 *    종목코드를 직접 넣어 두면 그 코드를 그대로 씁니다(네이버 검색 생략).
 *    예) 삼성전자 005930, SK텔레콤 017670, KB금융 105560, 맥쿼리인프라 088980
 *
 * API (브라우저는 JSONP GET 또는 text/plain POST 를 씁니다)
 *  ?action=ping                     연결 확인
 *  ?action=load                     전체 읽기 { ok, app, version, savedAt, data:{settings,prices,trades,dividends,gurus,curve} }
 *  ?action=prices                   네이버 금융에서 현재가를 받아 시세 탭을 갱신하고 반환
 *                                   { ok, prices:{종목명:현재가}, codes:{종목명:종목코드}, updated, refreshed }
 *  ?action=save  (POST, JSON)       화면 상태 전체를 시트에 한 번에 저장 → 저장 뒤 시세도 같이 갱신
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

var BACKEND_VERSION = '1.2.0';

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

var SIDE_TO_KR = { buy: '매수', sell: '매도', div: '배당', init: '초기보유' };
var KR_TO_SIDE = { '매수': 'buy', '매도': 'sell', '배당': 'div', '초기보유': 'init', '기존보유': 'init' };
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
    sectors: (settings && settings._sectorsJson && typeof settings._sectorsJson === 'object') ? settings._sectorsJson : {},
    customReasons: (settings && settings._customReasonsJson && typeof settings._customReasonsJson === 'object') ? settings._customReasonsJson : {},
    trades: readTrades_(ss),
    dividends: readDividends_(ss),
    gurus: readGurus_(ss),
    curve: readCurve_(ss)
  };
  delete data.settings._pricesJson;
  delete data.settings._sectorsJson;
  delete data.settings._customReasonsJson;
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
  if (byKr['종목섹터']) {
    try { out._sectorsJson = JSON.parse(String(byKr['종목섹터'])); } catch (e) {}
  }
  if (byKr['이유태그']) {
    try { out._customReasonsJson = JSON.parse(String(byKr['이유태그'])); } catch (e) {}
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
      /* 기존 보유의 '원금에 더하기' 여부는 ID 접두어(i1-/i0-)로 되살립니다. */
      prin: /^i1-/.test(String(r[12] || '')),
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

/* ------------------------------------------------------------------ 시세 (네이버 금융) */

var NAVER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15';
var PRICE_CACHE_SEC = 60;

/**
 * 시세 조회 = 네이버 금융에서 받아 시세 탭을 갱신하고 앱에 돌려 줍니다.
 * 실패한 종목은 시세 탭에 있던 숫자를 그대로 돌려 줍니다.
 */
function readPrices_() {
  var ss = ss_();
  var fresh = null;
  try { fresh = refreshPrices_(ss); } catch (e) { fresh = null; }
  if (fresh && fresh.ok && Object.keys(fresh.prices || {}).length) return fresh;

  /* 폴백: 시트 숫자 그대로 (GOOGLEFINANCE 수식 결과 포함) */
  var sh = ss.getSheetByName(TABS.prices);
  if (!sh) {
    return { ok: false, error: '시세 탭이 없습니다. 시트를 한 번 저장(앱에서 매매 기록)하면 자동으로 만들어집니다.' };
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
  return { ok: true, prices: prices, codes: {}, updated: updated, refreshed: 0, fallback: true };
}

/** 매매기록 탭에 나오는 종목명 목록(중복 제거) */
function tradeNames_(ss) {
  var out = [], seen = {};
  var sh = ss.getSheetByName(TABS.trades);
  if (!sh || sh.getLastRow() < 2) return out;
  var rows = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues();
  rows.forEach(function(r){
    var n = String(r[0] || '').trim();
    if (n && !seen[n]) { seen[n] = 1; out.push(n); }
  });
  return out;
}

/** 종목명 → 6자리 종목코드 (네이버 금융 검색). 실패하면 '' */
function naverCode_(name) {
  name = String(name || '').trim();
  if (!name) return '';
  if (/^\d{6}$/.test(name)) return name;          /* 종목명 칸에 코드를 직접 넣은 경우 */
  var cache = CacheService.getScriptCache();
  var key = 'code:' + name;
  var hit = cache.get(key);
  if (hit) return hit === '-' ? '' : hit;
  var code = '';
  try {
    var url = 'https://ac.stock.naver.com/ac?q=' + encodeURIComponent(name) + '&target=stock';
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': NAVER_UA } });
    if (res.getResponseCode() === 200) {
      var j = JSON.parse(res.getContentText());
      var items = (j && j.items) || [];
      var dom = items.filter(function(it){ return it && String(it.nationCode || 'KOR') === 'KOR'; });
      var flat = String(name).replace(/\s+/g, '');
      var exact = dom.filter(function(it){ return String(it.name || '').replace(/\s+/g, '') === flat; })[0];
      var pick = exact || dom[0] || items[0];
      if (pick && /^[0-9A-Z]{6}$/.test(String(pick.code || ''))) code = String(pick.code);
    }
  } catch (e) { code = ''; }
  try { cache.put(key, code || '-', code ? 21600 : 600); } catch (e) {}
  return code;
}

/** 종목코드 → 현재가 (네이버 금융 모바일 API). 실패하면 0 */
function naverPrice_(code) {
  code = String(code || '').trim();
  if (!code) return 0;
  try {
    var url = 'https://m.stock.naver.com/api/stock/' + encodeURIComponent(code) + '/basic';
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': NAVER_UA } });
    if (res.getResponseCode() !== 200) return 0;
    var j = JSON.parse(res.getContentText());
    var p = num_(j && j.closePrice);
    if (p > 0) return p;
    p = num_(j && j.lastClosePrice);
    return p > 0 ? p : 0;
  } catch (e) { return 0; }
}

/**
 * 시세 탭을 최신으로:
 *  · 매매기록에 있는데 시세 탭에 없는 종목 → 줄 추가
 *  · 코드가 빈 종목 → 네이버 검색으로 코드 채움
 *  · 코드가 있는 종목 → 네이버 현재가로 C열 갱신(수식이 있는 칸은 건드리지 않음)
 */
function refreshPrices_(ss) {
  ss = ss || ss_();
  var sh = ensureHeader_(tab_(ss, TABS.prices, HEADERS.prices), HEADERS.prices);
  var last = sh.getLastRow();
  var values = last > 1 ? sh.getRange(2, 1, last - 1, 4).getValues() : [];
  /* C열 수식은 한 번에 읽습니다(줄마다 부르면 느림) */
  var formulas = last > 1 ? sh.getRange(2, 3, last - 1, 1).getFormulas() : [];
  var entries = [], byName = {};
  values.forEach(function(r, i){
    var name = String(r[0] || '').trim();
    if (!name) return;
    var e = {
      row: i + 2, name: name, code: String(r[1] || '').trim(),
      value: num_(r[2]), formula: String((formulas[i] || [''])[0] || '')
    };
    entries.push(e); byName[name] = e;
  });

  /* ① 매매기록 종목 중 빠진 줄 추가 */
  var added = 0;
  tradeNames_(ss).forEach(function(n){
    if (byName[n] || entries.length >= 80) return;
    var row = sh.getLastRow() + 1;
    sh.getRange(row, 1, 1, 4).setValues([[n, '', '', '']]);
    var e = { row: row, name: n, code: '', value: 0, formula: '' };
    entries.push(e); byName[n] = e; added += 1;
  });

  /* ② 종목코드 채우기 */
  var codes = {}, coded = 0;
  entries.forEach(function(e){
    if (!e.code) {
      var c = naverCode_(e.name);
      if (c) { e.code = c; sh.getRange(e.row, 2).setValue(c); coded += 1; }
    }
    if (e.code) codes[e.name] = e.code;
  });

  /* ③ 현재가 (60초 캐시) */
  var cached = cacheGet_('prices');
  var prices = {}, got = 0, failed = 0;
  entries.forEach(function(e){
    if (!e.code) {
      /* 코드를 못 찾았어도 시세 탭에 숫자가 있으면 그 값을 그대로 전달합니다. */
      if (e.value > 0) prices[e.name] = e.value;
      return;
    }
    var p = num_(cached[e.name]);
    if (!(p > 0)) p = naverPrice_(e.code);
    if (p > 0) {
      prices[e.name] = p; got += 1;
      if (!e.formula) sh.getRange(e.row, 3).setValue(p);    /* GOOGLEFINANCE 수식은 보존 */
    } else {
      failed += 1;
      if (e.value > 0) prices[e.name] = e.value;            /* 실패 시 기존 숫자 폴백 */
    }
  });
  if (got) cachePut_('prices', prices);

  var now = new Date();
  if (entries.length) sh.getRange(2, 4).setValue(now);
  return {
    ok: true, prices: prices, codes: codes,
    updated: now.toISOString(), refreshed: got, added: added, coded: coded, failed: failed,
    source: 'naver'
  };
}

function cacheGet_(k) {
  try {
    var v = CacheService.getScriptCache().get('sn:' + k);
    return v ? JSON.parse(v) : {};
  } catch (e) { return {}; }
}
function cachePut_(k, o) {
  try { CacheService.getScriptCache().put('sn:' + k, JSON.stringify(o), PRICE_CACHE_SEC); } catch (e) {}
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
    writeSettings_(ss, settings, data.prices || {}, data.sectors || {}, data.customReasons || {});
    writePrices_(ss, data.prices || {});

    /* v1.2.0 — 저장 직후 시세도 같이 맞춰 둡니다. 실패해도 저장 결과는 그대로 돌려 줍니다. */
    var fresh = null;
    try { fresh = refreshPrices_(ss); } catch (e) { fresh = null; }
    var out = { ok: true, app: 'stocknote', version: BACKEND_VERSION, savedAt: new Date().toISOString() };
    if (fresh && fresh.ok) {
      out.prices = fresh.prices;
      out.codes = fresh.codes;
      out.updated = fresh.updated;
      out.refreshed = fresh.refreshed;
    }
    return out;
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

function writeSettings_(ss, s, prices, sectors, customReasons) {
  var sh = ensureHeader_(tab_(ss, TABS.settings, HEADERS.settings), HEADERS.settings);
  clearBody_(sh, HEADERS.settings.length);
  var rows = SETTING_KEYS.map(function(pair){ return [pair[1], num_(s[pair[0]]), pair[2]]; });
  rows.push(['종목시세', JSON.stringify(prices || {}), '앱이 저장한 현재가(JSON)']);
  rows.push(['종목섹터', JSON.stringify(sectors || {}), '앱에서 직접 고른 종목별 섹터(JSON)']);
  rows.push(['이유태그', JSON.stringify(customReasons || {}), '앱에서 +직접 입력으로 넣은 이유 태그(JSON)']);
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
