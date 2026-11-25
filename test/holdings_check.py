"""v1.2 기존 보유(초기보유) 기능 검증 — 로컬 서버 + Playwright/Chromium
    python3 work/stock-note/test/holdings_check.py
    스크린샷: downloads/stock-note-v1/hold-*.png
"""
import asyncio, threading, functools, re, json
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.async_api import async_playwright

ROOT = "/workspace/work/stock-note"
PORT = 8805
OUT = "/workspace/downloads/stock-note-v1"


class Q(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def serve():
    h = functools.partial(Q, directory=ROOT)
    threading.Thread(target=lambda: ThreadingHTTPServer(("127.0.0.1", PORT), h).serve_forever(), daemon=True).start()


def cash_of(txt):
    m = re.search(r"예수금\s*([\d,]+)원", txt)
    return int(m.group(1).replace(",", "")) if m else None


async def main():
    serve()
    base = f"http://127.0.0.1:{PORT}/index.html"
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1280, "height": 1000}, device_scale_factor=2, color_scheme="light")
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
        await pg.goto(base + "?demo=1", wait_until="networkidle")
        await pg.wait_for_timeout(400)

        before = {k: await pg.inner_text(s) for k, s in
                  [("mini", "#sumMini"), ("hero", "#heroSub"), ("assets", "#sumAssets")]}
        await pg.click('#pillTabs button[data-view="trades"]'); await pg.wait_for_timeout(250)
        before["tags"] = await pg.inner_text("#tagStats")
        before["moods"] = await pg.inner_text("#moodStats")
        await pg.click('#pillTabs button[data-view="home"]'); await pg.wait_for_timeout(250)
        cash0 = cash_of(before["mini"])
        await pg.screenshot(path=f"{OUT}/hold-00-home-before.png")

        await pg.click("#btnAddHolding")
        await pg.wait_for_timeout(300)
        print("sheet:", await pg.inner_text("#sheetTitle"))
        await pg.fill("#hName", "현대차"); await pg.fill("#hQty", "10"); await pg.fill("#hAvg", "200000")
        await pg.fill("#hCur", "220000"); await pg.wait_for_timeout(150)
        print("amount:", await pg.inner_text("#hAmt"), "| sector:", await pg.inner_text("#hSecHint"))
        await pg.screenshot(path=f"{OUT}/hold-02-sheet-filled.png")
        await pg.click("#btnSaveMore"); await pg.wait_for_timeout(400)
        print("stay open:", "on" in (await pg.get_attribute("#modal", "class") or ""),
              "| name cleared:", repr(await pg.input_value("#hName")))
        await pg.fill("#hName", "삼성전자"); await pg.fill("#hQty", "5"); await pg.fill("#hAvg", "70000")
        await pg.wait_for_timeout(200)
        print("dup:", await pg.inner_text("#hDup"))
        await pg.click("#btnSaveHolding"); await pg.wait_for_timeout(450)

        after = {k: await pg.inner_text(s) for k, s in
                 [("mini", "#sumMini"), ("hero", "#heroSub"), ("assets", "#sumAssets"),
                  ("holdings", "#holdingsList")]}
        print("cash unchanged:", cash_of(after["mini"]) == cash0, "|", before["assets"].replace("\n", " "), "→", after["assets"].replace("\n", " "))
        print("principal:", before["hero"], "→", after["hero"])
        print("holdings:\n" + after["holdings"])
        await pg.screenshot(path=f"{OUT}/hold-04-home-after.png")

        await pg.goto(base, wait_until="networkidle"); await pg.wait_for_timeout(400)
        print("after reload has 현대차:", "현대차" in (await pg.inner_text("#holdingsList")))

        await pg.click('#pillTabs button[data-view="trades"]'); await pg.wait_for_timeout(350)
        print("tag stats unchanged:", before["tags"] == await pg.inner_text("#tagStats"),
              "| mood unchanged:", before["moods"] == await pg.inner_text("#moodStats"))
        print("count:", await pg.inner_text("#tradeCount"))
        await pg.screenshot(path=f"{OUT}/hold-05-trades.png")
        await pg.click('#typeFilter [data-type="init"]'); await pg.wait_for_timeout(300)
        print("init filter cards:", await pg.eval_on_selector_all("#timeline .tcard", "e=>e.length"))
        await pg.screenshot(path=f"{OUT}/hold-06-trades-filter.png")

        await pg.click("#timeline .tcard"); await pg.wait_for_timeout(350)
        print("edit sheet:", await pg.inner_text("#sheetTitle"), "| qty:", await pg.input_value("#hQty"),
              "| sector:", repr(await pg.input_value("#hSector")), "| prin:", await pg.is_checked("#hPrin"))
        await pg.select_option("#hSector", "자동차")
        await pg.fill("#hQty", "12")
        await pg.click("#btnSaveHolding"); await pg.wait_for_timeout(400)
        await pg.click('#pillTabs button[data-view="home"]'); await pg.wait_for_timeout(300)
        print("edited 12주:", "12주" in (await pg.inner_text("#holdingsList")),
              "| sectors:", await pg.evaluate("()=>JSON.stringify(JSON.parse(localStorage.getItem('stocknote.data.v1')).sectors)"))

        await pg.click('#pillTabs button[data-view="trades"]'); await pg.wait_for_timeout(300)
        await pg.click("#timeline .tcard"); await pg.wait_for_timeout(300)
        await pg.click("#btnDelHolding"); await pg.wait_for_timeout(120)
        await pg.click("#btnDelHolding"); await pg.wait_for_timeout(400)
        print("init left:", await pg.evaluate("()=>JSON.parse(localStorage.getItem('stocknote.data.v1')).trades.filter(t=>t.side==='init').length"))

        # 기존 보유만 있는 종목을 매도하면 평단 기준으로 실현손익, 태그·분위기 통계는 그대로
        tags0 = await pg.inner_text("#tagStats")
        moods0 = await pg.inner_text("#moodStats")
        await pg.evaluate("""() => {
          const d = JSON.parse(localStorage.getItem('stocknote.data.v1'));
          d.trades.push({id:'i1-legacy', date:'2026-11-01', name:'기아', side:'init', qty:7, price:100000,
                         funding:'cash', prin:false, reasons:[], mood:'', horizon:'장기', rule:'', memo:''});
          d.trades.push({id:'s-legacy', date:'2026-11-20', name:'기아', side:'sell', qty:5, price:110000,
                         funding:'cash', reasons:['차트·수급'], mood:'과열', horizon:'단기', rule:'', memo:''});
          d.prices['기아'] = 110000;
          localStorage.setItem('stocknote.data.v1', JSON.stringify(d));
        }""")
        await pg.goto(base, wait_until="networkidle"); await pg.wait_for_timeout(450)
        await pg.click('#pillTabs button[data-view="trades"]'); await pg.wait_for_timeout(300)
        mini = await pg.inner_text("#sumMini")
        print("realized:", (re.search(r"매도 실현\s*([+\-−\d,]+원)", mini) or ["", mini])[1],
              "| holdings 2주:", "2주" in (await pg.inner_text("#holdingsList")),
              "| tag stats unchanged:", tags0 == (await pg.inner_text("#tagStats")),
              "| mood unchanged:", moods0 == (await pg.inner_text("#moodStats")))

        await pg.evaluate("""() => {   // 예전 백엔드가 '매수'로 되돌린 행도 복원되는지
          const d = JSON.parse(localStorage.getItem('stocknote.data.v1'));
          d.trades.push({id:'i1-old', date:'2026-11-01', name:'기아', side:'buy', qty:7, price:100000,
                         funding:'cash', reasons:[], mood:'보통', horizon:'장기', rule:'', memo:''});
          localStorage.setItem('stocknote.data.v1', JSON.stringify(d));
        }""")
        await pg.goto(base, wait_until="networkidle"); await pg.wait_for_timeout(450)
        print("legacy id recovery:", await pg.evaluate("""()=>{
          const t = JSON.parse(localStorage.getItem('stocknote.data.v1')).trades.find(x=>x.id==='i1-old');
          return !!t;
        }"""))
        print("errors:", errs)
        await b.close()

        # 모바일
        b = await p.chromium.launch()
        m = await b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
        pg = await m.new_page()
        errs2 = []
        pg.on("pageerror", lambda e: errs2.append(str(e)))
        await pg.goto(base + "?demo=1", wait_until="networkidle"); await pg.wait_for_timeout(400)
        print("m390 overflow:", await pg.evaluate("document.documentElement.scrollWidth - window.innerWidth"))
        await pg.click("#btnAddHolding"); await pg.wait_for_timeout(350)
        await pg.screenshot(path=f"{OUT}/hold-09-mobile-sheet.png")
        await pg.fill("#hName", "기아"); await pg.fill("#hQty", "3"); await pg.fill("#hAvg", "95000")
        await pg.wait_for_timeout(120)
        await pg.click("#btnSaveHolding"); await pg.wait_for_timeout(400)
        print("m390 has 기아:", "기아" in (await pg.inner_text("#holdingsList")),
              "| overflow:", await pg.evaluate("document.documentElement.scrollWidth - window.innerWidth"))
        await pg.screenshot(path=f"{OUT}/hold-10-mobile-after.png")
        print("m390 errors:", errs2)
        await b.close()


asyncio.run(main())
