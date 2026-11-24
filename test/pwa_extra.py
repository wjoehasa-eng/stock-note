import asyncio, threading, functools, os, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PORT = 8794
OUT = os.environ.get("STOCKNOTE_SHOTS") or os.path.join(ROOT, "_shots")
os.makedirs(OUT, exist_ok=True)

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
threading.Thread(target=lambda: ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=ROOT)).serve_forever(), daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}/"

async def main():
    fails = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 360, "height": 780}, device_scale_factor=2, color_scheme="light")
        pg = await ctx.new_page()
        await pg.goto(BASE + "?demo=1", wait_until="load")
        await pg.wait_for_timeout(900)

        # 설치 버튼이 보일 때의 좁은 화면 상단바 (beforeinstallprompt 를 흉내내 UI 자리 확인)
        await pg.evaluate("""() => {
          const e = new Event('beforeinstallprompt'); window.dispatchEvent(e);
        }""")
        await pg.wait_for_timeout(300)
        vis = await pg.evaluate("""() => {
          const b = document.getElementById('btnInstallTop');
          return {hidden: b.classList.contains('hidden'), box: b.getBoundingClientRect().width};
        }""")
        print("top install btn:", vis)
        if vis['hidden']: fails.append("install button did not appear")
        await pg.screenshot(path=f"{OUT}/pwa-03-모바일-상단바.png")

        # 오프라인: 캐시된 껍데기로 열리는지
        await ctx.set_offline(True)
        try:
            await pg.reload(wait_until="load", timeout=15000)
            await pg.wait_for_timeout(600)
            txt = await pg.evaluate("document.body.innerText.slice(0,60)")
            ok = "위기 신호등" in await pg.evaluate("document.body.innerText")
            print("offline render:", ok, "|", txt.replace("\n", " ")[:50])
            if not ok: fails.append("offline shell did not render")
            await pg.screenshot(path=f"{OUT}/pwa-04-오프라인.png")
        except Exception as ex:
            fails.append(f"offline reload failed: {ex}")
        await ctx.set_offline(False)
        await b.close()

    print("\n=== RESULT:", "PASS" if not fails else "FAIL")
    for f in fails: print(" -", f)
    sys.exit(1 if fails else 0)

asyncio.run(main())
