"""주식노트 v2.0 회귀·기능 검증 (로컬 서버 + Playwright/Chromium).

v2.0에서 새로 넣은 것과, 깨지면 안 되는 기존 기능을 한 번에 확인합니다.
  · 산 이유/판 이유 태그 분리 · + 직접 입력 · 옛 태그 보존
  · "안 팔고 그대로 뒀다면?" 매도 복기 뱃지와 요약 카드
  · 종목 복기 상세(타임라인 · 현재 수익 · 고수 매칭)
  · 라이트/다크 레이아웃, 콘솔 에러 0
  · 기존 보유(초기보유) 추가 · 태그 필터 · PWA 매니페스트·서비스 워커

    STOCKNOTE_SHOTS=downloads/stock-note-v2 python3 test/v2_check.py
"""
import asyncio
import functools
import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("STOCKNOTE_PORT", "8793"))
OUT = os.environ.get("STOCKNOTE_SHOTS") or os.path.join(ROOT, "_shots", "v2")
os.makedirs(OUT, exist_ok=True)

RESULTS = []


def check(name, cond, extra=""):
    RESULTS.append((name, bool(cond), extra))
    print(("  ok   " if cond else "  FAIL ") + name + (("  " + str(extra)) if extra and not cond else ""))


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def handle_error(self, request, client_address):
        pass


def serve():
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()


BASE = f"http://127.0.0.1:{PORT}/index.html"


async def main():
    serve()
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        errs = []
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1000}, color_scheme="light")
        pg = await ctx.new_page()
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errs.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
        await pg.goto(BASE + "?demo=1", wait_until="networkidle")
        await pg.evaluate("localStorage.clear()")
        await pg.goto(BASE + "?demo=1", wait_until="networkidle")
        await pg.wait_for_timeout(500)

        # ---------- 홈
        hero = await pg.inner_text("#heroProfit")
        check("홈 진짜 수익 계산", hero.startswith("+") or hero.startswith("−"), hero)
        check("홈 보유 종목에 종목명 버튼", await pg.eval_on_selector_all("#holdingsList [data-review]", "e=>e.length") >= 4)
        check("기존 보유 추가 버튼 유지", await pg.is_visible("#btnAddHolding"))
        check("위기 신호등 3개", await pg.eval_on_selector_all("#signalList .sig", "e=>e.length") == 3)
        await pg.screenshot(path=os.path.join(OUT, "01-홈-라이트.png"))

        # ---------- 매매 기록 · 매도 복기
        await pg.click('#pillTabs button[data-view="trades"]')
        await pg.wait_for_timeout(400)
        check("매도 복기 요약 카드", await pg.is_visible("#sellReviewCard"))
        rev_txt = await pg.inner_text("#sellReview")
        check("복기 요약에 방어/기회비용", "잘 판 매도" in rev_txt and "아쉬운 매도" in rev_txt)
        check("복기 요약 막대 2개", await pg.eval_on_selector_all("#sellReview .rvrow .rvtrack i", "e=>e.length") == 2)
        badges = await pg.eval_on_selector_all(".vbadge", "e=>e.map(x=>x.textContent)")
        check("매도 뱃지 4개", len(badges) == 4, len(badges))
        check("'잘 팔았다!' 뱃지", any("잘 팔았다" in b and "손실 방어" in b for b in badges), badges)
        check("'안 팔았으면' 뱃지", any("안 팔았으면" in b and "더 (" in b for b in badges), badges)
        tags_txt = await pg.inner_text("#tagStats")
        check("산 이유 성적표", "산 이유" in tags_txt and "승률" in tags_txt)
        check("옛 태그도 성적표에", "옛 태그" in tags_txt and "저평가" in tags_txt)
        check("판 이유 복기 카드", "방어 − 기회비용" in await pg.inner_text("#sellReasonStats"))
        check("분위기 성적표", "승률" in await pg.inner_text("#moodStats"))
        await pg.screenshot(path=os.path.join(OUT, "02-매매기록-복기.png"), full_page=False)

        opts = await pg.eval_on_selector_all("#tagFilter option", "e=>e.map(x=>x.value)")
        check("태그 필터에 옛 태그", "저평가" in opts and "리밸런싱" in opts, opts)
        check("태그 필터에 새 태그", "목표수익 도달" in opts, opts)

        # ---------- 매매 입력 모달: 이유 분리 + 직접 입력
        await pg.click("#btnAddTrade")
        await pg.wait_for_timeout(400)
        buy = await pg.eval_on_selector_all("#pickReasons button", "e=>e.map(x=>x.textContent)")
        check("산 이유 10개", len(buy) == 10 and "저평가(PER·PBR)" in buy and "불안·조급(FOMO)" in buy, buy)
        check("모달 제목 '산 이유'", "산 이유" in await pg.inner_text("#reasonLabel"))
        await pg.screenshot(path=os.path.join(OUT, "03-매매입력-산이유.png"))

        await pg.click('#segSide button[data-side="sell"]')
        await pg.wait_for_timeout(250)
        sell = await pg.eval_on_selector_all("#pickReasons button", "e=>e.map(x=>x.textContent)")
        check("판 이유 7개", len(sell) == 7 and "목표수익 도달" in sell and "원칙 손절" in sell, sell)
        check("모달 제목 '판 이유'", "판 이유" in await pg.inner_text("#reasonLabel"))
        await pg.screenshot(path=os.path.join(OUT, "04-매매입력-판이유.png"))

        await pg.click('#segSide button[data-side="div"]')
        await pg.wait_for_timeout(200)
        div = await pg.eval_on_selector_all("#pickReasons button", "e=>e.map(x=>x.textContent)")
        check("배당 태그", len(div) == 3 and "정기 배당" in div, div)

        await pg.click('#segSide button[data-side="buy"]')
        await pg.wait_for_timeout(200)
        await pg.click("#btnAddReason")
        await pg.fill("#newReason", "자사주 매입")
        await pg.click("#btnReasonOk")
        await pg.wait_for_timeout(300)
        chips = await pg.eval_on_selector_all("#pickReasons button", "e=>e.map(x=>x.textContent+(x.classList.contains('on')?'*':''))")
        check("직접 입력 태그 추가·선택", "자사주 매입*" in chips, chips)
        await pg.screenshot(path=os.path.join(OUT, "05-매매입력-직접입력.png"))

        await pg.fill("#fName", "현대차")
        await pg.fill("#fQty", "5")
        await pg.fill("#fPrice", "210000")
        await pg.click("#btnSaveTrade")
        await pg.wait_for_timeout(800)
        check("직접 입력 태그가 기록에 저장", "자사주 매입" in await pg.inner_text("#timeline"))
        custom = await pg.evaluate("JSON.parse(localStorage.getItem('stocknote.data.v1')).customReasons")
        check("직접 입력 태그 기억", custom.get("buy") == ["자사주 매입"], custom)

        # ---------- 종목 복기 상세
        await pg.click('#timeline [data-review="삼성전자"]')
        await pg.wait_for_timeout(500)
        check("복기 시트 열림", "삼성전자" in await pg.inner_text("#sheetTitle"))
        body = await pg.inner_text("#sheetBody")
        check("복기: 안 샀으면 현금 대비", "안 샀으면 현금 그대로였습니다" in body)
        check("복기: 타임라인 태그·메모", "저평가(PER·PBR)" in body and "매도 조건" in body)
        check("복기: 고수 생각 매칭", "관련 고수 생각" in body)
        await pg.screenshot(path=os.path.join(OUT, "06-종목복기.png"))
        await pg.click("#btnReviewClose")
        await pg.wait_for_timeout(250)

        await pg.click('#pillTabs button[data-view="home"]')
        await pg.wait_for_timeout(250)
        await pg.click('#holdingsList [data-review="KB금융"]')
        await pg.wait_for_timeout(450)
        check("홈에서도 종목 복기", "KB금융" in await pg.inner_text("#sheetTitle"))
        await pg.click("#btnReviewClose")
        await pg.wait_for_timeout(200)

        # ---------- 기존 보유(초기보유) 회귀
        await pg.click("#btnAddHolding")
        await pg.wait_for_timeout(350)
        await pg.fill("#hName", "기아")
        await pg.fill("#hQty", "10")
        await pg.fill("#hAvg", "90000")
        await pg.click("#btnSaveHolding")
        await pg.wait_for_timeout(700)
        check("기존 보유 추가 → 홈 목록", "기아" in await pg.inner_text("#holdingsList"))
        await pg.click('#pillTabs button[data-view="trades"]')
        await pg.wait_for_timeout(300)
        check("초기보유 카드 유지", "기존 보유" in await pg.inner_text("#timeline"))

        # ---------- 배당 · 고수 (기존 화면 회귀)
        await pg.click('#pillTabs button[data-view="dividends"]')
        await pg.wait_for_timeout(400)
        check("배당 월별 막대", await pg.eval_on_selector_all("#divBars .b", "e=>e.length") == 12)
        check("배당 공시 변경 알림", await pg.eval_on_selector_all("#divAlerts .alert", "e=>e.length") >= 2)
        await pg.screenshot(path=os.path.join(OUT, "07-배당.png"))
        await pg.click('#pillTabs button[data-view="gurus"]')
        await pg.wait_for_timeout(400)
        check("고수 카드 3개", await pg.eval_on_selector_all("#guruCards .gcard", "e=>e.length") == 3)
        await pg.screenshot(path=os.path.join(OUT, "08-고수매칭.png"))

        # ---------- 다크 모드
        await pg.evaluate("localStorage.setItem('stocknote.theme','dark')")
        await pg.goto(BASE + "?demo=1", wait_until="networkidle")
        await pg.wait_for_timeout(500)
        check("다크 모드 적용", await pg.evaluate("document.documentElement.dataset.theme") == "dark")
        await pg.screenshot(path=os.path.join(OUT, "09-홈-다크.png"))
        await pg.click('#pillTabs button[data-view="trades"]')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=os.path.join(OUT, "10-매매기록-다크.png"))
        layout = await pg.evaluate("""(() => {
          const bad = [];
          document.querySelectorAll('#view-trades .card, #view-trades .tcard, #view-trades .srow').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) bad.push(el.className);
          });
          return { bad, scrollW: document.documentElement.scrollWidth, winW: window.innerWidth };
        })()""")
        check("다크 모드 가로 넘침 없음", not layout["bad"] and layout["scrollW"] <= layout["winW"] + 1, layout)

        # ---------- 모바일
        await pg.evaluate("localStorage.setItem('stocknote.theme','light')")
        mob = await browser.new_context(viewport={"width": 390, "height": 844}, color_scheme="light", is_mobile=True, has_touch=True)
        mp = await mob.new_page()
        mp.on("pageerror", lambda e: errs.append("mobile pageerror: " + str(e)))
        await mp.goto(BASE + "?demo=1", wait_until="networkidle")
        await mp.wait_for_timeout(500)
        await mp.screenshot(path=os.path.join(OUT, "11-모바일-홈.png"))
        await mp.tap('#tabbar button[data-view="trades"]')
        await mp.wait_for_timeout(400)
        await mp.screenshot(path=os.path.join(OUT, "12-모바일-매매기록.png"))
        m = await mp.evaluate("({w: document.documentElement.scrollWidth, vw: innerWidth})")
        check("모바일 가로 넘침 없음", m["w"] <= m["vw"] + 1, m)
        await mob.close()

        # ---------- PWA · 시세 자동
        check("매니페스트 링크", await pg.eval_on_selector("link[rel=manifest]", "e=>e.getAttribute('href')") == "./manifest.webmanifest")
        sw = await pg.evaluate("(async()=>{const r=await fetch('./sw.js');const t=await r.text();return t.match(/CACHE = '([^']+)'/)[1];})()")
        check("서비스 워커 캐시 v4 이상", sw.replace("stock-note-v", "") >= "4" or "v4" in sw, sw)
        ver = await pg.inner_text(".brand .ver")
        check("버전 표시 v2.0", ver.strip() == "v2.0", ver)

        check("콘솔 에러 0", not errs, errs)
        await browser.close()

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    print(f"\nv2_check: {passed}/{len(RESULTS)} 통과 · 스크린샷 {OUT}")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
