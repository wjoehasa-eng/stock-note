(async () => {
  const out = { steps: [], fails: [], syntaxError: null };
  const ok = (name, cond, extra) => {
    out.steps.push({ name, pass: !!cond, extra: extra === undefined ? '' : extra });
    if (!cond) out.fails.push(name + (extra ? ' :: ' + extra : ''));
  };

  const src = await (await fetch('./apps-script/Code.gs')).text();
  try { new Function(src); } catch (e) { out.syntaxError = String(e); return out; }

  /* ---------------------------------------------------------------- 스프레드시트 목업 */
  class Range {
    constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr || 1; this.nc = nc || 1; }
    getValues() {
      const rows = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) row.push(this.sh._get(this.r + i, this.c + j));
        rows.push(row);
      }
      return rows;
    }
    setValues(vals) {
      vals.forEach((row, i) => row.forEach((v, j) => this.sh._set(this.r + i, this.c + j, v)));
      return this;
    }
    setValue(v) {
      for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh._set(this.r + i, this.c + j, v);
      return this;
    }
    getValue() { return this.sh._get(this.r, this.c); }
    getFormula() {
      const v = this.sh._get(this.r, this.c);
      return (typeof v === 'string' && v.charAt(0) === '=') ? v : '';
    }
    getFormulas() {
      const rows = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) {
          const v = this.sh._get(this.r + i, this.c + j);
          row.push(typeof v === 'string' && v.charAt(0) === '=' ? v : '');
        }
        rows.push(row);
      }
      return rows;
    }
    setFormula(f) { return this.setValue(f); }
    clearContent() {
      for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh._set(this.r + i, this.c + j, '');
      return this;
    }
    setFontWeight() { return this; }
    setVerticalAlignment() { return this; }
    setNumberFormat() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; }
    _get(r, c) { const row = this.rows[r - 1]; if (!row) return ''; const v = row[c - 1]; return v === undefined ? '' : v; }
    _set(r, c, v) {
      while (this.rows.length < r) this.rows.push([]);
      const row = this.rows[r - 1];
      while (row.length < c) row.push('');
      row[c - 1] = v;
    }
    getLastRow() {
      let last = 0;
      this.rows.forEach((row, i) => { if (row.some(v => v !== '' && v !== null && v !== undefined)) last = i + 1; });
      return last;
    }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
    getName() { return this.name; }
    setFrozenRows() { return this; }
    setColumnWidth() { return this; }
  }
  class SS {
    constructor() { this.sheets = {}; }
    getSheetByName(n) { return this.sheets[n] || null; }
    insertSheet(n) { const s = new Sheet(n); this.sheets[n] = s; return s; }
    getName() { return 'sim-spreadsheet'; }
  }

  /* ---------------------------------------------------------------- 외부 서비스 목업 */
  const RC = { KOSPI: 'KOSPI' };
  const CODES = {
    '삼성전자': '005930', 'SK텔레콤': '017670', 'KB금융': '105560',
    '맥쿼리인프라': '088980', '현대차': '005380'
  };
  const PRICES = { '005930': '171,900', '017670': '56,200', '105560': '88,500', '088980': '12,450', '005380': '210,000' };
  const NAMES = { '005930': '삼성전자', '017670': 'SK텔레콤', '105560': 'KB금융', '088980': '맥쿼리인프라', '005380': '현대차' };
  /* 배당 목업 — 주당배당금(원)·결산월. 현대차는 무배당(0)으로 둡니다. */
  const DIVS = {
    '005930': { dps: 361, yld: 2.1, month: 12 },
    '017670': { dps: 500, yld: 3.4, month: 12 },
    '105560': { dps: 850, yld: 4.1, month: 12 },
    '088980': { dps: 220, yld: 6.2, month: 3 },
    '005380': { dps: 0, yld: 0, month: 12 }
  };
  const calls = { fetch: [], cachePut: [] };

  window.UrlFetchApp = {
    fetch(url, opt) {
      calls.fetch.push(url);
      const mk = (code, body) => ({ getResponseCode: () => code, getContentText: () => body });
      if (url.indexOf('ac.stock.naver.com/ac') >= 0) {
        const q = decodeURIComponent((url.match(/[?&]q=([^&]*)/) || [])[1] || '');
        const code = CODES[q];
        const items = code
          ? [{ code, name: q, nationCode: 'KOR', typeCode: RC.KOSPI }, { code: 'X', name: q + ' ADR', nationCode: 'USA' }]
          : [];
        return mk(200, JSON.stringify({ query: q, items }));
      }
      /* 배당: m.stock.naver.com/api/stock/{code}/integration */
      if (url.indexOf('/integration') >= 0) {
        const code = decodeURIComponent((url.match(/api\/stock\/([^/]+)\/integration/) || [])[1] || '');
        const d = DIVS[code];
        const infos = d ? [
          { code: 'per', key: 'PER', value: '10.00배' },
          { code: 'dividendYieldRatio', key: '배당수익률', value: d.yld + '%' },
          { code: 'dividend', key: '주당배당금', value: d.dps.toLocaleString('en-US') + '원' }
        ] : [];
        return mk(200, JSON.stringify({ itemCode: code, stockName: NAMES[code] || '', totalInfos: infos }));
      }
      /* 배당월: m.stock.naver.com/api/stock/{code}/finance/summary */
      if (url.indexOf('/finance/summary') >= 0) {
        const code = decodeURIComponent((url.match(/api\/stock\/([^/]+)\/finance\/summary/) || [])[1] || '');
        const m = String((DIVS[code] && DIVS[code].month) || 12).padStart(2, '0');
        return mk(200, JSON.stringify({ itemCode: code, chartIncomeStatement: { annual: {
          trTitleList: [{ title: '2024.' + m + '.' }, { title: '2025.' + m + '.' }] } } }));
      }
      if (url.indexOf('m.stock.naver.com/api/stock/') >= 0) {
        const code = decodeURIComponent((url.match(/api\/stock\/([^/]+)\/basic/) || [])[1] || '');
        if (PRICES[code] === undefined) return mk(500, '{}');
        return mk(200, JSON.stringify({ itemCode: code, closePrice: PRICES[code] }));
      }
      return mk(404, '{}');
    }
  };
  const cacheStore = {};
  window.CacheService = {
    getScriptCache() {
      return {
        get(k) { return cacheStore[k] === undefined ? null : cacheStore[k]; },
        put(k, v) { cacheStore[k] = String(v); calls.cachePut.push(k); return this; }
      };
    }
  };
  window.LockService = { getScriptLock() { return { tryLock() { return true; }, releaseLock() {} }; } };
  window.ContentService = {
    MimeType: { JAVASCRIPT: 'js', JSON: 'json' },
    createTextOutput(s) { return { setMimeType() { return { getContent: () => s }; }, getContent: () => s }; }
  };
  window.Utilities = { formatDate: (d) => d.toISOString().slice(0, 10) };
  window.Session = { getScriptTimeZone: () => 'Asia/Seoul' };

  let ss = new SS();
  window.SpreadsheetApp = { getActive: () => ss, openById: () => ss, flush() {} };

  const api = new Function(src + '\nreturn {refreshPrices_:typeof refreshPrices_!=="undefined"?refreshPrices_:null,refreshDividends_:typeof refreshDividends_!=="undefined"?refreshDividends_:null,refreshMarket_:typeof refreshMarket_!=="undefined"?refreshMarket_:null,readPrices_:readPrices_,saveAll_:saveAll_,loadAll_:loadAll_,naverCode_:naverCode_,naverPrice_:naverPrice_,naverDividendInfo_:typeof naverDividendInfo_!=="undefined"?naverDividendInfo_:null,holdingsQty_:typeof holdingsQty_!=="undefined"?holdingsQty_:null,TABS:TABS,BACKEND_VERSION:BACKEND_VERSION};')();
  out.version = api.BACKEND_VERSION;
  ok('버전이 1.3.0', api.BACKEND_VERSION === '1.3.0', api.BACKEND_VERSION);
  ['refreshPrices_', 'refreshDividends_', 'refreshMarket_', 'readPrices_', 'saveAll_', 'loadAll_', 'naverCode_', 'naverPrice_', 'naverDividendInfo_', 'holdingsQty_'].forEach(fn => {
    ok('함수 존재: ' + fn, typeof api[fn] === 'function');
  });

  /* ---------------------------------------------------------------- 1) 코드·시세 조회 단위 */
  ok('종목코드 조회 삼성전자', api.naverCode_('삼성전자') === '005930', api.naverCode_('삼성전자'));
  ok('종목코드 조회 없는 종목', api.naverCode_('없는종목') === '', '[' + api.naverCode_('없는종목') + ']');
  ok('현재가 콤마 파싱', api.naverPrice_('005930') === 171900, api.naverPrice_('005930'));
  ok('현재가 실패는 0', api.naverPrice_('999999') === 0, api.naverPrice_('999999'));

  /* ---------------------------------------------------------------- 2) 시트 세팅: v1.1 형식(옛 데이터) */
  const T = api.TABS;
  ss.insertSheet(T.trades).setValues ? null : null;
  const shT = ss.insertSheet(T.trades);
  shT.getRange(1, 1, 1, 13).setValues([['날짜', '종목명', '구분', '수량', '단가', '금액', '재원', '이유태그', '분위기', '목표기간', '매도조건', '메모', 'ID']]);
  shT.getRange(2, 1, 5, 13).setValues([
    ['2026-05-12', '삼성전자', '매수', 20, 68000, 1360000, '현금', '저평가, 차트·수급', '보통', '중기', '+12%', '옛 태그 기록', 't01'],
    ['2026-06-18', '맥쿼리인프라', '매수', 100, 12300, 1230000, '담보대출', '배당', '보통', '장기', '', '', 't03'],
    ['2026-09-09', '맥쿼리인프라', '매도', 30, 12900, 387000, '현금', '리밸런싱', '과열', '단기', '', '', 't07'],
    ['2026-06-02', 'SK텔레콤', '매수', 30, 52000, 1560000, '현금', '배당, 저평가', '공포', '장기', '', '', 't02'],
    ['2026-11-01', '현대차', '초기보유', 10, 180000, 1800000, '현금', '', '', '장기', '', '', 'i1-abc']
  ]);
  const shP = ss.insertSheet(T.prices);
  shP.getRange(1, 1, 1, 4).setValues([['종목명', '종목코드', '현재가', '갱신시각']]);
  shP.getRange(2, 1, 2, 4).setValues([
    ['삼성전자', '005930', '=IF(B2="","",GOOGLEFINANCE("KRX:" & B2))', ''],
    ['오래된종목', '', 5000, '']
  ]);

  /* ---------------------------------------------------------------- 3) refreshPrices_ */
  const r1 = await Promise.resolve(api.refreshPrices_(ss));
  ok('refresh 결과 ok', r1 && r1.ok === true);
  ok('refresh 버전/소스', r1.source === 'naver', r1.source);
  ok('가격 4종목 이상', Object.keys(r1.prices).length >= 4, JSON.stringify(r1.prices));
  ok('삼성전자 현재가', r1.prices['삼성전자'] === 171900, r1.prices['삼성전자']);
  ok('맥쿼리인프라 현재가', r1.prices['맥쿼리인프라'] === 12450, r1.prices['맥쿼리인프라']);
  ok('코드 자동 채움', r1.codes['맥쿼리인프라'] === '088980' && r1.codes['현대차'] === '005380', JSON.stringify(r1.codes));
  ok('오래된종목(코드 없음)은 기존 숫자 유지', r1.prices['오래된종목'] === 5000, r1.prices['오래된종목']);
  const rowOf = (sh, name) => {
    const last = sh.getLastRow();
    if (last < 2) return -1;
    const vals = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < vals.length; i++) if (String(vals[i][0]).trim() === name) return i + 2;
    return -1;
  };
  const mqRow = rowOf(shP, '맥쿼리인프라');
  ok('시세 탭에 매쿼리인프라 줄 추가', mqRow > 0, 'row=' + mqRow);
  ok('시세 탭 코드 셀 기록', String(shP._get(mqRow, 2)) === '088980', shP._get(mqRow, 2));
  ok('GOOGLEFINANCE 수식 보존', String(shP._get(2, 3)).indexOf('GOOGLEFINANCE') >= 0, shP._get(2, 3));
  ok('숫자 칸은 현재가로 갱신', Number(shP._get(mqRow, 3)) === 12450, shP._get(mqRow, 3));

  /* 60초 캐시: 두 번째 호출은 네이버를 다시 부르지 않아야 함 */
  const before = calls.fetch.filter(u => u.indexOf('m.stock.naver.com') >= 0).length;
  const r2 = await Promise.resolve(api.refreshPrices_(ss));
  const after = calls.fetch.filter(u => u.indexOf('m.stock.naver.com') >= 0).length;
  ok('60초 캐시로 재호출 없음', after === before, before + ' -> ' + after);
  ok('캐시에서도 값 유지', r2.prices['삼성전자'] === 171900, r2.prices['삼성전자']);

  /* ---------------------------------------------------------------- 4) readPrices_ 응답 형태 */
  const rp = await Promise.resolve(api.readPrices_());
  ok('readPrices_ ok/prices', rp.ok === true && rp.prices['맥쿼리인프라'] === 12450, JSON.stringify(rp.prices));
  ok('readPrices_ updated 있음', !!rp.updated, rp.updated);

  /* ---------------------------------------------------------------- 5) saveAll_ → 저장 + 시세 */
  ss = new SS(); // 빈 시트에서 시작 (탭 자동 생성 경로)
  window.SpreadsheetApp = { getActive: () => ss, openById: () => ss, flush() {} };
  Object.keys(cacheStore).forEach(k => delete cacheStore[k]);

  const body = {
    action: 'save',
    data: {
      settings: { principal: 12000000, loanBase: 0, maintenanceRatio: 140, concWarn: 30, concDanger: 45 },
      prices: { '삼성전자': 76000 },
      sectors: { '삼성전자': '반도체' },
      customReasons: { buy: ['자사주 매입'], sell: [], div: [] },
      trades: [
        { id: 'a1', date: '2026-05-12', name: '삼성전자', side: 'buy', qty: 20, price: 68000, funding: 'cash', reasons: ['저평가(PER·PBR)', '자사주 매입'], mood: '보통', horizon: '중기', rule: '+12%', memo: '메모' },
        { id: 'a2', date: '2026-09-09', name: '삼성전자', side: 'sell', qty: 5, price: 79000, funding: 'cash', reasons: ['목표수익 도달'], mood: '과열', horizon: '단기', rule: '', memo: '' },
        { id: 'i1-x1', date: '2026-11-01', name: '현대차', side: 'init', qty: 10, price: 180000, funding: 'cash', prin: true, reasons: [], mood: '', horizon: '장기', rule: '', memo: '' }
      ],
      dividends: [{ id: 'd1', name: '삼성전자', month: 4, expectedPer: 361, confirmedPer: 361, qty: 20, exDate: '2026-03-31', payDate: '2026-04-20', note: '' }],
      gurus: [{ id: 'g1', author: '김봉수', title: '배당은 현금흐름', tags: ['배당'], points: ['요지1', '요지2'], src: '아카이브' }],
      curve: [{ date: '2026-05-31', total: 12010000, principal: 12000000 }]
    }
  };
  const sv = await Promise.resolve(api.saveAll_(body));
  ok('saveAll_ ok', sv && sv.ok === true);
  ok('saveAll_ 시세 함께 반환', sv.prices && sv.prices['삼성전자'] === 171900, JSON.stringify(sv.prices));
  ok('saveAll_ codes 반환', sv.codes && sv.codes['현대차'] === '005380', JSON.stringify(sv.codes));
  ok('매매기록 탭 생성', !!ss.getSheetByName(T.trades));
  ok('설정 탭에 이유태그 행', (() => {
    const sh = ss.getSheetByName(T.settings);
    const vals = sh.getRange(1, 1, sh.getLastRow(), 3).getValues();
    const row = vals.filter(r => String(r[0]) === '이유태그')[0];
    return !!row && String(row[1]).indexOf('자사주 매입') >= 0;
  })(), '이유태그 행 없음');

  /* 다시 읽어 오기 (v1.2 왕복) */
  const ld = await Promise.resolve(api.loadAll_());
  ok('loadAll_ trades 3건', ld.data.trades.length === 3, ld.data.trades.length);
  const sellBack = ld.data.trades.filter(t => t.side === 'sell')[0];
  ok('판 이유 보존', sellBack && sellBack.reasons[0] === '목표수익 도달', JSON.stringify(sellBack && sellBack.reasons));
  const buyBack = ld.data.trades.filter(t => t.id === 'a1')[0];
  ok('직접 입력 태그 보존', buyBack && buyBack.reasons.indexOf('자사주 매입') >= 0, JSON.stringify(buyBack && buyBack.reasons));
  const initBack = ld.data.trades.filter(t => t.side === 'init')[0];
  ok('초기보유 구분 보존 + 원금 포함', !!initBack && initBack.prin === true, JSON.stringify(initBack && initBack.prin));
  ok('customReasons 왕복', ld.data.customReasons && ld.data.customReasons.buy && ld.data.customReasons.buy[0] === '자사주 매입', JSON.stringify(ld.data.customReasons));
  ok('섹터 왕복', ld.data.sectors['삼성전자'] === '반도체', JSON.stringify(ld.data.sectors));
  ok('설정 숫자 왕복', Number(ld.data.settings.principal) === 12000000, ld.data.settings.principal);

  /* ---------------------------------------------------------------- 6) 빈 저장 거부 안전장치 */
  const rej = await Promise.resolve(api.saveAll_({ data: { settings: { principal: 0 }, trades: [], dividends: [] } }));
  ok('빈 저장은 거부', rej.ok === false, JSON.stringify(rej));

  /* ---------------------------------------------------------------- 7) 배당 자동 (v1.3.0) */
  ss = new SS();
  window.SpreadsheetApp = { getActive: () => ss, openById: () => ss, flush() {} };
  Object.keys(cacheStore).forEach(k => delete cacheStore[k]);

  const HDR = ['날짜', '종목명', '구분', '수량', '단가', '금액', '재원', '이유태그', '분위기', '목표기간', '매도조건', '메모', 'ID'];
  const tr = (date, name, side, qty, id) => [date, name, side, qty, 0, 0, '현금', '', '보통', '중기', '', '', id];
  const shT2 = ss.insertSheet(T.trades);
  shT2.getRange(1, 1, 1, 13).setValues([HDR]);
  shT2.getRange(2, 1, 5, 13).setValues([
    tr('2026-05-12', '삼성전자', '매수', 20, 't1'),
    tr('2026-08-12', '삼성전자', '매도', 5, 't2'),
    tr('2026-06-02', '맥쿼리인프라', '매수', 100, 't3'),
    tr('2026-09-09', '맥쿼리인프라', '매도', 100, 't4'),
    tr('2026-11-01', '현대차', '초기보유', 10, 'i1-x')
  ]);

  const hv = api.holdingsQty_(ss);
  ok('보유 수량 계산', hv.qty['삼성전자'] === 15 && hv.qty['맥쿼리인프라'] === 0 && hv.qty['현대차'] === 10, JSON.stringify(hv.qty));

  const divRows = () => {
    const sh = ss.getSheetByName(T.dividends);
    if (!sh || sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues().filter(r => String(r[0]).trim());
  };
  const rowByName = (nm) => divRows().filter(r => String(r[0]).trim() === nm)[0];

  /* 첫 refresh — 코드는 네이버 검색(목업)으로 채움 */
  const d1 = api.refreshDividends_(ss, {});
  ok('배당 refresh ok', d1 && d1.ok === true, JSON.stringify(d1 && d1.error));
  ok('자동 행 1개 추가', d1.added === 1 && d1.rows === 1, 'added=' + d1.added + ' rows=' + d1.rows);
  let r0 = rowByName('삼성전자');
  ok('자동 행 ID 규칙 auto-{코드}-{월}', !!r0 && String(r0[8]) === 'auto-005930-12', r0 && r0[8]);
  ok('주당예상 = 네이버 DPS', !!r0 && Number(r0[2]) === 361, r0 && r0[2]);
  ok('월 = 결산월', !!r0 && Number(r0[1]) === 12, r0 && r0[1]);
  ok('수량 = 보유 15주', !!r0 && Number(r0[4]) === 15, r0 && r0[4]);
  ok('매도 끝·무배당 종목은 행 없음', !rowByName('맥쿼리인프라') && !rowByName('현대차'), JSON.stringify(divRows().map(r => r[0])));
  ok('응답 dividends 모양', d1.dividends.length === 1 && d1.dividends[0].expectedPer === 361 && d1.dividends[0].qty === 15, JSON.stringify(d1.dividends));
  const items = d1.items || [];
  ok('응답 items: 종목별 결과', items.length === 2 && items.filter(x => x.name === '현대차')[0].dps === 0, JSON.stringify(items));

  /* 6시간 캐시 — 두 번째에는 integration 을 다시 부르지 않음 */
  const beforeInt = calls.fetch.filter(u => u.indexOf('/integration') >= 0).length;
  api.refreshDividends_(ss, {});
  const afterInt = calls.fetch.filter(u => u.indexOf('/integration') >= 0).length;
  ok('배당 6시간 캐시로 재호출 없음', afterInt === beforeInt, beforeInt + ' -> ' + afterInt);

  /* 사용자가 채운 주당확정·지급일·메모는 지우지 않음 */
  const shD = ss.getSheetByName(T.dividends);
  shD.getRange(2, 4).setValue(400);
  shD.getRange(2, 7).setValue('2026-04-20');
  shD.getRange(2, 8).setValue('공시 확정');
  api.refreshDividends_(ss, {});
  r0 = rowByName('삼성전자');
  ok('사용자 확정·지급일·메모 보존', Number(r0[3]) === 400 && String(r0[6]) === '2026-04-20' && String(r0[7]) === '공시 확정', JSON.stringify(r0));

  /* 더 사면 수량이 따라감 */
  shT2.getRange(shT2.getLastRow() + 1, 1, 1, 13).setValues([tr('2026-11-20', '삼성전자', '매수', 10, 't5')]);
  api.refreshDividends_(ss, {});
  r0 = rowByName('삼성전자');
  ok('수량 자동 업데이트(25주)', Number(r0[4]) === 25, r0[4]);
  ok('보존 필드는 그대로', Number(r0[3]) === 400 && String(r0[7]) === '공시 확정', JSON.stringify(r0));

  /* 네이버 DPS 가 바뀌면 주당예상만 갱신 */
  DIVS['005930'].dps = 380;
  Object.keys(cacheStore).forEach(k => delete cacheStore[k]);
  api.refreshDividends_(ss, {});
  r0 = rowByName('삼성전자');
  ok('DPS 바뀌면 주당예상 갱신(380)', Number(r0[2]) === 380, r0[2]);
  ok('확정값은 그대로(400)', Number(r0[3]) === 400, r0[3]);

  /* 전량 매도 — 사용자가 채운 값이 있으면 행을 지우지 않고 수량 0으로 보존 */
  shT2.getRange(shT2.getLastRow() + 1, 1, 1, 13).setValues([tr('2026-11-25', '삼성전자', '매도', 25, 't6')]);
  api.refreshDividends_(ss, {});
  r0 = rowByName('삼성전자');
  ok('전량 매도 후 값 있는 자동 행은 수량 0으로 보존', !!r0 && Number(r0[4]) === 0, JSON.stringify(divRows()));

  /* 사용자가 안 채운 자동 행은 보유 0 이 되면 정리 */
  shT2.getRange(shT2.getLastRow() + 1, 1, 1, 13).setValues([tr('2026-11-26', 'SK텔레콤', '매수', 30, 't7')]);
  const d6 = api.refreshDividends_(ss, {});
  ok('새 종목 자동 행 추가(SK텔레콤)', !!rowByName('SK텔레콤') && String(rowByName('SK텔레콤')[8]) === 'auto-017670-12', JSON.stringify(rowByName('SK텔레콤')));
  shT2.getRange(shT2.getLastRow() + 1, 1, 1, 13).setValues([tr('2026-11-27', 'SK텔레콤', '매도', 30, 't8')]);
  api.refreshDividends_(ss, {});
  ok('값 없는 자동 행은 매도 후 삭제', !rowByName('SK텔레콤'), JSON.stringify(divRows().map(r => r[0])));

  /* 사용자가 직접 넣은 행이 있으면 같은 달 자동 행을 만들지 않음 */
  const shD2 = ss.getSheetByName(T.dividends);
  shD2.getRange(shD2.getLastRow() + 1, 1, 1, 9).setValues([['삼성전자', 12, 380, '', 10, '', '', '내가 직접 넣은 행', 'u-manual']]);
  shT2.getRange(shT2.getLastRow() + 1, 1, 1, 13).setValues([tr('2026-11-28', '삼성전자', '매수', 10, 't9')]);
  api.refreshDividends_(ss, {});
  const sam = divRows().filter(r => String(r[0]).trim() === '삼성전자');
  const samAutoLive = sam.filter(r => /^auto-/.test(String(r[8])) && Number(r[4]) > 0);
  ok('직접 넣은 행과 이중 계산 안 함', samAutoLive.length === 0, JSON.stringify(sam));
  ok('직접 넣은 행은 그대로', !!sam.filter(r => String(r[8]) === 'u-manual' && String(r[7]) === '내가 직접 넣은 행')[0], JSON.stringify(sam));

  /* saveAll_ 왕복 — 앱이 auto 행을 모르고 저장해도 시트에서 지우지 않음 */
  const sv2 = api.saveAll_({ data: {
    settings: { principal: 3000000 },
    prices: {},
    trades: [tr('2026-11-29', 'KB금융', '매수', 10, 'a1')].map(r => ({ id: r[12], date: r[0], name: r[1], side: 'buy', qty: r[3], price: 88000, funding: 'cash', reasons: ['배당 매력'], mood: '보통', horizon: '장기', rule: '', memo: '' })),
    dividends: []
  } });
  ok('saveAll_ 배당까지 반환', sv2.ok === true && Array.isArray(sv2.dividends), JSON.stringify(Object.keys(sv2 || {})));
  ok('저장 뒤 보유 종목 자동 배당 행 생성', (() => {
    const r = rowByName('KB금융');
    return !!r && String(r[8]) === 'auto-105560-12' && Number(r[2]) === 850 && Number(r[4]) === 10;
  })(), JSON.stringify(divRows().map(r => [r[0], r[8]])));
  ok('앱이 모르고 저장해도 auto 행 보존', (() => {
    const r = divRows().filter(x => String(x[8]) === 'auto-005930-12')[0];
    return !!r && Number(r[4]) === 0;
  })(), JSON.stringify(divRows().map(r => [r[0], r[8]])));

  /* 앱이 사용자 행을 함께 보내면 그 행도 그대로 남습니다 */
  const sv3 = api.saveAll_({ data: {
    settings: { principal: 3000000 },
    prices: {},
    trades: [tr('2026-11-29', 'KB금융', '매수', 10, 'a1')].map(r => ({ id: r[12], date: r[0], name: r[1], side: 'buy', qty: r[3], price: 88000, funding: 'cash', reasons: [], mood: '보통', horizon: '장기', rule: '', memo: '' })),
    dividends: [{ id: 'u-manual', name: '삼성전자', month: 12, expectedPer: 380, confirmedPer: null, qty: 10, exDate: '', payDate: '', note: '내가 직접 넣은 행' }]
  } });
  ok('사용자 배당 행 보존', (() => {
    const r = divRows().filter(x => String(x[8]) === 'u-manual')[0];
    return !!r && String(r[7]) === '내가 직접 넣은 행';
  })(), JSON.stringify(divRows().map(r => [r[0], r[8]])));
  ok('사용자 행이 있는 종목·달은 auto 행 미생성', !divRows().filter(x => String(x[8]) === 'auto-005930-12' && Number(x[4]) > 0)[0], JSON.stringify(divRows().map(r => [r[0], r[8], r[4]])));

  /* 다른 기기에서 채운 확정값을 기기의 예전 사본이 지우지 않아야 함 */
  const kbAll = divRows();
  const kbIdx = kbAll.findIndex(x => String(x[8]) === 'auto-105560-12') + 2;
  ss.getSheetByName(T.dividends).getRange(kbIdx, 4).setValue(900);
  ss.getSheetByName(T.dividends).getRange(kbIdx, 8).setValue('다른 기기에서 적은 메모');
  api.saveAll_({ data: {
    settings: { principal: 3000000 },
    prices: {},
    trades: [tr('2026-11-29', 'KB금융', '매수', 10, 'a1')].map(r => ({ id: r[12], date: r[0], name: r[1], side: 'buy', qty: r[3], price: 88000, funding: 'cash', reasons: [], mood: '보통', horizon: '장기', rule: '', memo: '' })),
    dividends: [{ id: 'auto-105560-12', name: 'KB금융', month: 12, expectedPer: 0, confirmedPer: null, qty: 10, exDate: '', payDate: '', note: '' }]
  } });
  const kbAfter = divRows().filter(x => String(x[8]) === 'auto-105560-12')[0];
  ok('기기 사본이 다른 기기의 확정·메모를 지우지 않음', !!kbAfter && Number(kbAfter[3]) === 900 && String(kbAfter[7]) === '다른 기기에서 적은 메모', JSON.stringify(kbAfter));
  ok('기기 사본 저장 뒤에도 주당예상은 네이버 값', !!kbAfter && Number(kbAfter[2]) === 850, JSON.stringify(kbAfter));

  /* loadAll_(refresh) — 앱을 열 때 한 번에 최신화 */
  const ld2 = api.loadAll_({ refresh: true });
  ok('loadAll_(refresh) 에 배당 포함', Array.isArray(ld2.data.dividends) && ld2.data.dividends.length >= 2, JSON.stringify((ld2.data.dividends || []).map(x => x.name)));
  ok('loadAll_(refresh) 현재가 포함', !!ld2.data.prices['KB금융'], JSON.stringify(ld2.data.prices));

  /* ID 없는 옛 배당 행 — 불러오기와 새로고침이 같은 고정 ID를 써서 중복이 생기지 않는다 */
  const shD3 = ss.getSheetByName(T.dividends);
  shD3.getRange(shD3.getLastRow() + 1, 1, 1, 9).setValues([['LG유플러스', 6, 300, '', 5, '', '', '옛 행', '']]);
  const ldOld = api.loadAll_().data.dividends.filter(x => x.name === 'LG유플러스')[0];
  const rfOld = api.refreshDividends_(ss, {}).dividends.filter(x => x.name === 'LG유플러스')[0];
  ok('ID 없는 옛 행: 불러오기·새로고침 ID 일치', !!ldOld && !!rfOld && ldOld.id === rfOld.id, [ldOld && ldOld.id, rfOld && rfOld.id]);
  ok('고정 ID가 시트에 기록됨', String(divRows().filter(r => String(r[0]) === 'LG유플러스')[0][8]) === String(ldOld.id), divRows().map(r => [r[0], r[8]]));

  /* 실행 시간 보호 — 마감을 넘기면 네이버를 더 부르지 않고 시트 값을 그대로 씁니다 */
  Object.keys(cacheStore).forEach(k => delete cacheStore[k]);
  const beforeFetch = calls.fetch.length;
  const limP = api.refreshPrices_(ss, { deadline: Date.now() - 1000 });
  ok('마감 지나면 현재가 호출 생략', calls.fetch.length === beforeFetch, calls.fetch.length - beforeFetch);
  ok('생략해도 partial 표시', limP.partial === true && limP.ok === true, JSON.stringify(limP));
  const limD = api.refreshDividends_(ss, {}, { deadline: Date.now() - 1000 });
  ok('마감 지나면 배당 호출 생략', calls.fetch.length === beforeFetch, calls.fetch.length - beforeFetch);
  ok('배당 skip 집계', limD.skipped >= 1 && limD.partial === true, JSON.stringify({ skipped: limD.skipped }));

  return out;
})()
