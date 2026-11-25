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

  const api = new Function(src + '\nreturn {refreshPrices_:typeof refreshPrices_!=="undefined"?refreshPrices_:null,readPrices_:readPrices_,saveAll_:saveAll_,loadAll_:loadAll_,naverCode_:naverCode_,naverPrice_:naverPrice_,TABS:TABS,BACKEND_VERSION:BACKEND_VERSION};')();
  out.version = api.BACKEND_VERSION;
  ok('버전이 1.2.0', api.BACKEND_VERSION === '1.2.0', api.BACKEND_VERSION);
  ['refreshPrices_', 'readPrices_', 'saveAll_', 'loadAll_', 'naverCode_', 'naverPrice_'].forEach(fn => {
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

  return out;
})()
