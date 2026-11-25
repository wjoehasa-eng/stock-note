import asyncio, threading, functools, os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PORT = 8792
OUT = os.environ.get("STOCKNOTE_SHOTS") or os.path.join(ROOT, "_shots")
os.makedirs(OUT, exist_ok=True)

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
threading.Thread(target=lambda: ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=ROOT)).serve_forever(), daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}/index.html"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs = []
        ctx = await b.new_context(viewport={"width":1280,"height":1000}, device_scale_factor=2, color_scheme="light")
        pg = await ctx.new_page()
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errs.append(f"[{m.type}] {m.text}") if m.type == "error" else None)

        await pg.goto(BASE + "?demo=1", wait_until="networkidle")
        await pg.wait_for_timeout(500)
        # localStorage 비우고 새로 시작 (예시 상태 보장)
        await pg.evaluate("localStorage.clear()")
        await pg.goto(BASE + "?demo=1", wait_until="networkidle")
        await pg.wait_for_timeout(500)

        before = await pg.evaluate("document.getElementById('sumAssets').textContent")
        await pg.screenshot(path=f"{OUT}/01-홈-라이트.png")

        # 매매 기록 → 입력
        await pg.click('#pillTabs button[data-view="trades"]')
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=f"{OUT}/02-매매기록.png")
        await pg.click("#btnAddTrade")
        await pg.wait_for_timeout(450)
        await pg.fill("#fName", "현대차")
        await pg.fill("#fQty", "20")
        await pg.fill("#fPrice", "210000")
        await pg.click('#pickReasons button[data-reason="실적·수주"]')
        await pg.click('#pickReasons button[data-reason="저평가(PER·PBR)"]')
        await pg.click('#segMood button[data-mood="공포"]')
        await pg.click('#segHor button[data-hor="장기"]')
        await pg.fill("#fRule", "+15% 또는 수주 감소 시")
        await pg.fill("#fMemo", "3분기 수주 잔고 확인 후 분할 매수")
        await pg.wait_for_timeout(250)
        await pg.evaluate("document.getElementById('sheetBody').scrollTop = 0")
        await pg.wait_for_timeout(250)
        await pg.screenshot(path=f"{OUT}/03-매매-입력시트.png")
        await pg.click("#btnSaveTrade")
        await pg.wait_for_timeout(600)
        after = await pg.evaluate("document.getElementById('sumAssets').textContent")
        cnt = await pg.inner_text("#tradeCount")
        print("assets:", before, "->", after, "|", cnt)
        print("카카오/현대차 in timeline:", "현대차" in await pg.inner_text("#timeline"))
        print("tag stats:", (await pg.inner_text("#tagStats")).replace("\n", " | "))
        print("holdings has 현대차:", "현대차" in await pg.inner_text("#holdingsList"))
        await pg.screenshot(path=f"{OUT}/04-매매-반영후.png")
        await pg.wait_for_timeout(2600)   # 토스트가 사라진 뒤 다음 화면 캡처

        # 배당
        await pg.click('#pillTabs button[data-view="dividends"]')
        await pg.wait_for_timeout(400)
        await pg.click('#divBars .b[data-month="6"]')
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=f"{OUT}/05-배당.png")

        # 고수 매칭
        await pg.click('#pillTabs button[data-view="gurus"]')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=f"{OUT}/06-고수매칭.png")
        print("guru cards:", await pg.eval_on_selector_all("#guruCards .gcard h3", "els=>els.map(e=>e.textContent)"))
        await pg.click("#guruCards .gcard button")
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=f"{OUT}/07-고수-원문.png")
        await pg.click("#btnGuruClose")
        await pg.wait_for_timeout(200)

        # 다크
        await pg.click("#btnTheme"); await pg.click("#btnTheme")  # auto -> light -> dark
        await pg.wait_for_timeout(300)
        await pg.click('#pillTabs button[data-view="home"]')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=f"{OUT}/08-다크-홈.png")
        print("theme:", await pg.evaluate("document.documentElement.getAttribute('data-theme')"))

        # 모바일
        m = await b.new_context(viewport={"width":390,"height":844}, device_scale_factor=3,
                                color_scheme="light", is_mobile=True, has_touch=True)
        mp = await m.new_page()
        mp.on("pageerror", lambda e: errs.append("mobile: " + str(e)))
        await mp.goto(BASE + "?demo=1", wait_until="networkidle")
        await mp.wait_for_timeout(500)
        await mp.screenshot(path=f"{OUT}/09-모바일-홈.png", full_page=True)
        await mp.click('#tabbar button[data-view="dividends"]')
        await mp.wait_for_timeout(400)
        await mp.screenshot(path=f"{OUT}/10-모바일-배당.png", full_page=True)
        await mp.click('#tabbar button[data-view="trades"]')
        await mp.wait_for_timeout(300)
        await mp.click("#btnAddTrade")
        await mp.wait_for_timeout(450)
        await mp.screenshot(path=f"{OUT}/11-모바일-입력.png")

        print("--- errors ---")
        print("\n".join(errs) if errs else "none")
        await b.close()

asyncio.run(main())
