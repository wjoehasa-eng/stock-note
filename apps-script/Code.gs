/**
 * 주식노트 — 구글 시트 백엔드 (Google Apps Script) v1.3.0
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
 *                ID가 `auto-` 로 시작하는 행은 네이버 금융에서 자동으로 채운 행입니다
 *                (주당예상·월·수량 자동 관리). 직접 넣은 행은 ID가 auto- 로 시작하지 않습니다.
 *  · 고수매칭  : 저자 | 제목 | 태그 | 핵심요지 | 출처 | ID
 *                태그 = `,` 로 연결,  핵심요지 = ` / ` 로 구분(앱에서 줄바꿈 목록으로 표시)
 *  · 자산추이  : 날짜 | 총자산 | 순수원금 | 메모
 *  · 설정      : 항목 | 값 | 비고
 *  · 시세      : 종목명 | 종목코드 | 현재가 | 갱신시각      (선택 · GOOGLEFINANCE 용)
 *
 * ── 시세·배당 자동화 (v1.3.0 부터 기본) ────────────────────────
 *  저장(save)과 시세 조회(prices·refresh) 요청마다 아래 순서로 움직입니다.
 *   ① 매매기록에 있는 종목 중 시세 탭에 없는 종목을 시세 탭에 추가
 *   ② 종목코드가 빈 종목은 네이버 금융 검색(ac.stock.naver.com)으로 6자리 종목코드를 찾아 채움
 *   ③ 코드가 있는 종목의 현재가를 네이버 금융(m.stock.naver.com/api/stock/{code}/basic)에서 받아
 *      시세 탭 C열의 숫자를 갱신 (60초 캐시 · 하루 호출 한도 보호)
 *   ④ 지금 보유 중인 종목(매수+초기보유−매도 > 0)의 배당을 배당공시 탭에 자동으로 채움
 *      · 주당배당금(최근 결산 DPS) = m.stock.naver.com/api/stock/{code}/integration 의 dividend 값
 *      · 배당월 = 그 종목의 결산월(finance/summary 연간 손익 열 제목, 없으면 12월)
 *      · 수량 = 매매기록에서 계산한 보유 수량 (종목을 더 사고 팔면 자동으로 따라감)
 *      · 자동 행의 ID = `auto-{종목코드}-{월}` · 6시간 캐시(배당은 자주 바뀌지 않음)
 *  · 자동 행은 주당예상·수량만 관리합니다. 사용자가 직접 채운 주당확정·배당기준일·지급일·메모와
 *    직접 추가한 행(ID가 auto- 로 시작하지 않음)은 절대 덮어쓰거나 지우지 않습니다.
 *  · 보유 수량이 0이 된 종목의 자동 행은 정리합니다. 다만 사용자가 값을 채워 둔 행은 지우지 않고
 *    수량 0으로 남겨 기록을 보존합니다.
 *  · 같은 종목·같은 달을 사용자가 직접 넣었으면 자동 행을 만들지 않습니다(이중 계산 방지).
 *  · 무배당(주당배당금 0) 종목은 자동 행을 만들지 않습니다.
 *  · C열에 GOOGLEFINANCE 수식이 들어 있는 칸은 수식을 지우지 않고 그대로 둡니다.
 *  · 네이버가 응답하지 못한 종목은 시세 탭에 남아 있던 숫자, 배당공시 탭에 남아 있던 행을 그대로 돌려 줍니다(폴백).
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
 *  ?action=prices                   네이버 금융에서 현재가·배당을 받아 시세·배당공시 탭을 갱신하고 반환
 *                                   { ok, prices:{종목명:현재가}, codes:{종목명:종목코드}, updated, refreshed,
 *                                     dividends:[{id,name,month,expectedPer,confirmedPer,qty,exDate,payDate,note}],
 *                                     divAdded, divUpdated, divRemoved, divFailed }
 *  ?action=refresh                  action=prices 와 같습니다(이름만 다름)
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

var BACKEND_VERSION = '1.3.0';

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
    if (action === 'load') return out_(loadAll_({ refresh: String(p.refresh || '') === '1' }), callback);
    if (action === 'prices' || action === 'refresh') return out_(readPrices_(), callback);
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
    if (action === 'load') return out_(loadAll_({ refresh: !!req.refresh }));
    if (action === 'prices' || action === 'refresh') return out_(readPrices_());
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

function loadAll_(opts) {
  var ss = ss_();
  var settings = readSettings_(ss);
  /* 앱이 refresh=1 로 부르면 불러오면서 시세·배당도 한 번 맞춥니다(기본은 시트만 읽음 — 빠른 열기). */
  var fresh = null;
  if (opts && opts.refresh) { try { fresh = refreshMarket_(ss); } catch (e) { fresh = null; } }
  var live = !!(fresh && fresh.ok);
  var data = {
    settings: settings,
    prices: (live && fresh.prices && Object.keys(fresh.prices).length) ? fresh.prices : readPriceMap_(ss, settings),
    sectors: (settings && settings._sectorsJson && typeof settings._sectorsJson === 'object') ? settings._sectorsJson : {},
    customReasons: (settings && settings._customReasonsJson && typeof settings._customReasonsJson === 'object') ? settings._customReasonsJson : {},
    trades: readTrades_(ss),
    dividends: (live && fresh.dividends) ? fresh.dividends : readDividends_(ss),
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
  rows.forEach(function(r, i){
    var name = String(r[0] || '').trim();
    if (!name) return;
    var conf = r[3];
    out.push({
      /* ID가 없는 옛 행에도 새로고침(자동 행 병합)과 같은 고정 ID를 붙입니다. */
      id: String(r[8] || '').trim() || stableId_(name + '|' + (num_(r[1]) || 1) + '|' + i),
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
var DIV_CACHE_SEC = 21600;        /* 배당 정보는 하루 몇 번만 바뀝니다 — 6시간 캐시 */
var DIV_FAIL_CACHE_SEC = 600;     /* 실패는 10분만 기억해 다음 요청에서 다시 시도 */
var MAX_AUTO_DIV = 40;            /* 자동 배당 행 대상 종목 수 상한(실행 시간 30초 보호) */

/**
 * 시세·배당 조회 = 네이버 금융에서 받아 시트를 갱신하고 앱에 돌려 줍니다.
 * 실패한 종목은 시트에 있던 값을 그대로 돌려 줍니다.
 */
function readPrices_() {
  var ss = ss_();
  var fresh = null;
  try { fresh = refreshMarket_(ss); } catch (e) { fresh = null; }
  if (fresh && fresh.ok && (Object.keys(fresh.prices || {}).length || (fresh.dividends || []).length)) return fresh;

  /* 폴백: 시트 숫자 그대로 (GOOGLEFINANCE 수식 결과 포함) */
  var sh = ss.getSheetByName(TABS.prices);
  var prices = {};
  var updated = '';
  if (sh && sh.getLastRow() > 1){
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
    rows.forEach(function(r){
      var name = String(r[0] || '').trim();
      var v = num_(r[2]);
      if (name && v > 0) prices[name] = v;
      if (r[3]) updated = String(r[3]);
    });
  }
  var divs = [];
  try { divs = readDividends_(ss); } catch (e) { divs = []; }
  var base = { ok: true, prices: prices, codes: {}, dividends: divs, updated: updated, refreshed: 0, fallback: true };
  if (!sh) base.error = '시세 탭이 없습니다. 시트를 한 번 저장(앱에서 매매 기록)하면 자동으로 만들어집니다.';
  return base;
}

/**
 * 시세 + 배당을 한 번에 맞춥니다. (저장·조회·새로고침이 모두 이 함수를 씁니다)
 * 한쪽이 실패해도 다른 쪽 결과는 그대로 돌려 줍니다.
 */
function refreshMarket_(ss, opt) {
  ss = ss || ss_();
  opt = opt || {};
  /* Apps Script 실행 제한(30초) 보호 — 이 시점을 넘으면 네이버 호출을 멈추고 시트에 있던 값을 씁니다. */
  if (!opt.deadline) opt.deadline = Date.now() + (opt.budgetMs || 20000);
  var out = { ok: true, app: 'stocknote', version: BACKEND_VERSION, source: 'naver' };
  var mark = null;
  try { mark = refreshPrices_(ss, opt); } catch (e) { mark = null; }
  if (mark && mark.ok) {
    out.prices = mark.prices || {};
    out.codes = mark.codes || {};
    out.updated = mark.updated || '';
    out.refreshed = mark.refreshed || 0;
    out.added = mark.added || 0;
    out.coded = mark.coded || 0;
    out.failed = mark.failed || 0;
  }
  var div = null;
  try { div = refreshDividends_(ss, out.codes || {}, opt); } catch (e) { div = null; }
  if (div && div.ok) {
    out.dividends = div.dividends;
    out.divCount = div.rows;
    out.divAdded = div.added;
    out.divUpdated = div.updated;
    out.divRemoved = div.removed;
    out.divKept = div.kept;
    out.divFailed = div.failed;
    out.divSkipped = div.skipped;
    out.divItems = div.items;
  }
  if (mark && mark.partial) out.partial = true;
  if (div && div.partial) out.partial = true;
  if (!mark || !mark.ok) {
    out.ok = !!(div && div.ok);
    if (!out.prices) out.prices = {};
  }
  return out;
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

/* ------------------------------------------------------------------ 배당공시 (네이버 금융) */

/** 네이버 금융 JSON GET — 실패하면 null */
function naverJson_(url) {
  var ua = { 'User-Agent': NAVER_UA };
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: ua });
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText());
  } catch (e) { return null; }
}

/**
 * 종목코드 → 최근 주당배당금(DPS)·배당수익률.
 * m.stock.naver.com/api/stock/{code}/integration 의 totalInfos 안에서
 *   { code:'dividend', value:'5,913원' }        ← 최근 결산 주당배당금
 *   { code:'dividendYieldRatio', value:'3.45%' }
 * 를 읽습니다. 6시간 캐시(실패는 10분만 기억).
 */
function naverDividendInfo_(code) {
  code = String(code || '').trim();
  if (!code) return { ok: false, dps: 0, yieldRatio: 0 };
  var cache = CacheService.getScriptCache();
  var key = 'div:' + code;
  var hit = null;
  try { hit = cache.get(key); } catch (e) {}
  if (hit) {
    try { var c = JSON.parse(hit); if (c && typeof c.ok === 'boolean') return c; } catch (e) {}
  }
  var out = { ok: false, dps: 0, yieldRatio: 0 };
  var j = naverJson_('https://m.stock.naver.com/api/stock/' + encodeURIComponent(code) + '/integration');
  if (j) {
    out.ok = true;
    (j.totalInfos || []).forEach(function (it) {
      if (!it) return;
      if (it.code === 'dividend') out.dps = num_(it.value);
      else if (it.code === 'dividendYieldRatio') out.yieldRatio = num_(String(it.value).replace('%', ''));
    });
    out.at = new Date().toISOString();
  }
  try { cache.put(key, JSON.stringify(out), out.ok ? DIV_CACHE_SEC : DIV_FAIL_CACHE_SEC); } catch (e) {}
  return out;
}

/**
 * 종목코드 → 결산월(1~12). finance/summary 연간 손익의 마지막 열 제목('2025.12.')에서 읽습니다.
 * 모르면 12월(한국 상장사 대부분이 12월 결산)을 돌려 줍니다. 6시간 캐시.
 */
function naverFiscalMonth_(code) {
  code = String(code || '').trim();
  if (!code) return 12;
  var cache = CacheService.getScriptCache();
  var key = 'fmon:' + code;
  var hit = null;
  try { hit = cache.get(key); } catch (e) {}
  if (hit && /^\d{1,2}$/.test(hit)) return Number(hit);
  var month = 12;
  var j = naverJson_('https://m.stock.naver.com/api/stock/' + encodeURIComponent(code) + '/finance/summary');
  try {
    var ann = ((j || {}).chartIncomeStatement || {}).annual || {};
    var titles = ann.trTitleList || [];
    if (titles.length) {
      var t = String(titles[titles.length - 1].title || titles[titles.length - 1].key || '');
      var m = t.match(/(\d{1,2})\.?$/);
      if (m) {
        var v = Number(m[1]);
        if (v >= 1 && v <= 12) month = v;
      }
    }
  } catch (e) {}
  try { cache.put(key, String(month), DIV_CACHE_SEC); } catch (e) {}
  return month;
}

/** 매매 기록에서 지금 보유 중인 수량(매수 + 초기보유 − 매도). 배당 기록은 수량에 영향 없음. */
function holdingsQty_(ss) {
  var qty = {}, order = [];
  var sh = ss.getSheetByName(TABS.trades);
  if (!sh || sh.getLastRow() < 2) return { qty: qty, order: order };
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.trades.length).getValues();
  rows.forEach(function (r) {
    var name = String(r[1] || '').trim();
    if (!name) return;
    var side = KR_TO_SIDE[String(r[2] || '').trim()] || 'buy';
    if (side === 'div') return;
    var q = num_(r[3]);
    if (qty[name] === undefined) { qty[name] = 0; order.push(name); }
    qty[name] += (side === 'sell' ? -q : q);
  });
  order.forEach(function (n) { qty[n] = Math.round(qty[n] * 10000) / 10000; });
  return { qty: qty, order: order };
}

/**
 * 배당공시 탭을 지금 보유 종목에 맞춰 자동으로 채우고 고칩니다.
 *  · 보유 수량 > 0 인 종목마다 자동 행 1개(id = auto-{코드}-{월})를 유지
 *  · 주당예상 = 네이버 금융 최근 주당배당금, 월 = 결산월, 수량 = 보유 수량
 *  · 사용자 행(id가 auto- 아님)과 사용자가 채운 주당확정·배당기준일·지급일·메모는 보존
 *  · 보유 수량이 0이 된 자동 행은 지우되, 사용자가 값을 채운 행은 수량 0으로 남겨 보존
 */
function refreshDividends_(ss, codes, opt) {
  ss = ss || ss_();
  codes = codes || {};
  opt = opt || {};
  var deadline = opt.deadline || (Date.now() + 20000);
  var sh = ensureHeader_(tab_(ss, TABS.dividends, HEADERS.dividends), HEADERS.dividends);
  var last = sh.getLastRow();
  var raw = last > 1 ? sh.getRange(2, 1, last - 1, HEADERS.dividends.length).getValues() : [];
  var userRows = [], autoRows = [];
  raw.forEach(function (r, i) {
    var name = String(r[0] || '').trim();
    if (!name) return;
    var rec = {
      name: name, month: num_(r[1]) || 1, expectedPer: num_(r[2]),
      confirmedPer: nullNum_(r[3]), qty: num_(r[4]),
      exDate: dateStr_(r[5]), payDate: dateStr_(r[6]),
      note: String(r[7] || ''), id: String(r[8] || '').trim()
    };
    if (/^auto-/.test(rec.id)) autoRows.push(rec);
    else {
      if (!rec.id) rec.id = stableId_(rec.name + '|' + rec.month + '|' + i);   /* ID 없는 옛 행에도 고정 ID */
      userRows.push(rec);
    }
  });

  var hold = holdingsQty_(ss);
  var out = [], items = [];
  var added = 0, updated = 0, removed = 0, kept = 0, failed = 0, skipped = 0;
  var taken = {}, budget = MAX_AUTO_DIV;

  function userHas(name, month) {
    for (var i = 0; i < userRows.length; i++) {
      if (userRows[i].name === name && (num_(userRows[i].month) || 1) === month) return true;
    }
    return false;
  }
  function hasUserContent(rec) {
    return rec.confirmedPer !== null || !!rec.payDate || !!rec.exDate || !!rec.note;
  }
  function keepPrev(rec, qty, dropIfEmpty) {
    taken[rec.id] = 1;
    rec.qty = qty;
    if (dropIfEmpty && !hasUserContent(rec)) { removed += 1; return; }
    if (dropIfEmpty) kept += 1;
    out.push(rec);
  }

  hold.order.filter(function (n) { return hold.qty[n] > 0; }).forEach(function (name) {
    var qty = hold.qty[name];
    var prev = autoRows.filter(function (a) { return a.name === name; });
    if (budget <= 0 || Date.now() > deadline) { prev.forEach(function (p) { keepPrev(p, qty, false); }); skipped += 1; return; }
    budget -= 1;
    var code = String(codes[name] || '').trim() || naverCode_(name);
    var info = code ? naverDividendInfo_(code) : { ok: false, dps: 0 };

    if (!info.ok) {
      /* 네이버가 응답하지 못하면 기존 자동 행을 그대로 살려 두고 수량만 맞춥니다. */
      failed += 1;
      prev.forEach(function (p) { keepPrev(p, qty, false); });
      items.push({ name: name, code: code, ok: false, dps: prev.length ? prev[0].expectedPer : 0, month: prev.length ? prev[0].month : 0, qty: qty });
      return;
    }
    if (!(info.dps > 0)) {
      /* 무배당 — 행을 만들지 않습니다. 사용자가 값을 채운 행만 수량 0으로 보존. */
      prev.forEach(function (p) { keepPrev(p, 0, true); });
      items.push({ name: name, code: code, ok: true, dps: 0, month: 0, qty: qty });
      return;
    }
    var month = prev.length ? (num_(prev[0].month) || 1) : clampMonth_(naverFiscalMonth_(code));
    /* 같은 종목·같은 달을 사용자가 직접 넣었으면 자동 행은 만들지 않습니다(이중 계산 방지). */
    if (userHas(name, month)) {
      prev.forEach(function (p) {
        taken[p.id] = 1;
        if (hasUserContent(p)) { p.qty = 0; kept += 1; out.push(p); } else { removed += 1; }
      });
      items.push({ name: name, code: code, ok: true, dps: info.dps, month: month, qty: qty, user: true });
      return;
    }
    var carry = { confirmedPer: null, exDate: '', payDate: '', note: '' };
    prev.forEach(function (p) {
      taken[p.id] = 1;
      if (carry.confirmedPer === null && p.confirmedPer !== null) carry.confirmedPer = p.confirmedPer;
      if (!carry.exDate && p.exDate) carry.exDate = p.exDate;
      if (!carry.payDate && p.payDate) carry.payDate = p.payDate;
      if (!carry.note && p.note) carry.note = p.note;
    });
    var rec = {
      name: name, month: month, expectedPer: info.dps, confirmedPer: carry.confirmedPer,
      qty: qty, exDate: carry.exDate, payDate: carry.payDate, note: carry.note,
      id: 'auto-' + code + '-' + month
    };
    var old = prev.filter(function (p) { return p.id === rec.id; })[0];
    if (!old) added += 1;
    else if (old.expectedPer !== rec.expectedPer || old.qty !== rec.qty || old.month !== rec.month ||
             old.confirmedPer !== rec.confirmedPer || old.exDate !== rec.exDate ||
             old.payDate !== rec.payDate || old.note !== rec.note) updated += 1;
    out.push(rec);
    items.push({ name: name, code: code, ok: true, dps: info.dps, month: month, qty: qty });
  });

  /* 보유하지 않게 된 종목의 자동 행 — 사용자가 채운 값이 없으면 정리 */
  autoRows.forEach(function (p) {
    if (taken[p.id]) return;
    if (hasUserContent(p)) { p.qty = 0; kept += 1; out.push(p); }
    else removed += 1;
  });

  var rows = userRows.concat(out);
  var next = rows.map(function (x) {
    return [
      x.name, x.month, x.expectedPer,
      (x.confirmedPer === null || x.confirmedPer === '' || x.confirmedPer === undefined) ? '' : x.confirmedPer,
      x.qty, x.exDate || '', x.payDate || '', x.note || '', x.id || ''
    ];
  });
  var same = next.length === raw.length && JSON.stringify(next) === JSON.stringify(raw);
  if (!same) {
    clearBody_(sh, HEADERS.dividends.length);
    if (next.length) sh.getRange(2, 1, next.length, HEADERS.dividends.length).setValues(next);
  }
  return {
    ok: true, dividends: rows.map(divOut_), rows: rows.length,
    added: added, updated: updated, removed: removed, kept: kept, failed: failed, skipped: skipped,
    partial: skipped > 0, items: items, wrote: !same
  };
}

/** 배당 행 → 앱이 읽는 모양 */
function divOut_(x) {
  return {
    id: x.id || '', name: x.name, month: x.month, expectedPer: x.expectedPer,
    confirmedPer: (x.confirmedPer === null || x.confirmedPer === undefined || x.confirmedPer === '') ? null : x.confirmedPer,
    qty: x.qty, exDate: x.exDate || '', payDate: x.payDate || '', note: x.note || ''
  };
}

/** 빈칸이면 '', 아니면 숫자 (셀에 쓰는 값) */
function cellNum_(v) {
  if (v === null || v === undefined || v === '') return '';
  return num_(v);
}

/** 빈칸이면 null, 아니면 숫자 (주당확정 처럼 '아직 없음'과 0을 구분해야 하는 값) */
function nullNum_(v) {
  if (v === null || v === undefined || v === '') return null;
  return num_(v);
}

function clampMonth_(m) {
  m = Math.round(num_(m));
  if (!(m >= 1 && m <= 12)) m = 12;
  return m;
}

/** ID가 없던 옛 행에 붙일 고정 ID */
function stableId_(seed) {
  var s = String(seed), h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) & 0x7fffffff;
  return 'u' + h.toString(36);
}

/**
 * 시세 탭을 최신으로:
 *  · 매매기록에 있는데 시세 탭에 없는 종목 → 줄 추가
 *  · 코드가 빈 종목 → 네이버 검색으로 코드 채움
 *  · 코드가 있는 종목 → 네이버 현재가로 C열 갱신(수식이 있는 칸은 건드리지 않음)
 */
function refreshPrices_(ss, opt) {
  ss = ss || ss_();
  opt = opt || {};
  var deadline = opt.deadline || (Date.now() + 20000);
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
  var codes = {}, coded = 0, skipped = 0;
  entries.forEach(function(e){
    if (!e.code) {
      if (Date.now() > deadline) { skipped += 1; }
      else {
        var c = naverCode_(e.name);
        if (c) { e.code = c; sh.getRange(e.row, 2).setValue(c); coded += 1; }
      }
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
    if (!(p > 0)) {
      if (Date.now() > deadline) { skipped += 1; }
      else p = naverPrice_(e.code);
    }
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
    partial: skipped > 0, source: 'naver'
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

    /* v1.3.0 — 저장 직후 시세·배당도 같이 맞춰 둡니다. 실패해도 저장 결과는 그대로 돌려 줍니다. */
    var fresh = null;
    try { fresh = refreshMarket_(ss); } catch (e) { fresh = null; }
    var out = { ok: true, app: 'stocknote', version: BACKEND_VERSION, savedAt: new Date().toISOString() };
    if (fresh && fresh.ok) {
      out.prices = fresh.prices;
      out.codes = fresh.codes;
      out.dividends = fresh.dividends;
      out.updated = fresh.updated;
      out.refreshed = fresh.refreshed;
      out.divAdded = fresh.divAdded;
      out.divUpdated = fresh.divUpdated;
      out.divRemoved = fresh.divRemoved;
      out.divFailed = fresh.divFailed;
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
  var last = sh.getLastRow();
  var old = last > 1 ? sh.getRange(2, 1, last - 1, HEADERS.dividends.length).getValues() : [];
  var oldAuto = {};
  old.forEach(function(r){
    var id = String(r[8] || '').trim();
    if (/^auto-/.test(id)) oldAuto[id] = r;
  });
  var incomingIds = {};
  var rows = list.map(function(x){
    var id = String(x.id || '');
    if (id) incomingIds[id] = 1;
    var conf = cellNum_(x.confirmedPer), ex = x.exDate || '', pay = x.payDate || '', note = x.note || '';
    /* 자동 행은 서버가 관리하는 행 — 기기에 남은 예전 사본이 사용자가 채운 값을 지우지 않도록
       빈 칸은 시트에 있던 값으로 채워 씽니다. */
    if (/^auto-/.test(id) && oldAuto[id]) {
      var o = oldAuto[id];
      if (conf === '') conf = cellNum_(o[3]);
      if (!ex) ex = dateStr_(o[5]);
      if (!pay) pay = dateStr_(o[6]);
      if (!note) note = String(o[7] || '');
    }
    return [String(x.name || ''), num_(x.month) || 1, num_(x.expectedPer), conf, num_(x.qty), ex, pay, note, id];
  });
  /* 앱이 아직 모르는 자동 행(auto-)은 지우지 않고 뒤에 붙여 둡니다.
     예전 앱이 저장해도 네이버에서 채운 배당 행이 사라지지 않습니다. */
  old.forEach(function(r){
    var nm = String(r[0] || '').trim();
    var id = String(r[8] || '').trim();
    if (!nm || !/^auto-/.test(id) || incomingIds[id]) return;
    rows.push(r);
  });
  clearBody_(sh, HEADERS.dividends.length);
  if (!rows.length) return;
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
