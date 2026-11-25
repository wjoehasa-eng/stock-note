"""앱을 열 때 현재가 자동 갱신(action=prices) 경로 검증 — 로컬 서버 + Playwright.

구글 시트 주소 대신 가짜 스크립트 응답을 돌려주어, 앱이 열리자마자
  · action=load 를 먼저 부르고
  · 이어서 action=prices 를 한 번 불러 현재가를 조용히 반영하는지
를 확인합니다. 실패(응답 없음)일 때 기존 숫자가 유지되는지도 봅니다.

    python3 test/price_auto_check.py
"""
import asyncio
import functools
import json
import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("STOCKNOTE_PORT", "8799"))
# 가짜 배포 주소 — 실제 주소가 저장소에 들어가지 않도록 조각으로 만듭니다.
FAKE = "https://script.google.com/" + "macros/s/" + "FAKE_DEPLOYMENT_FOR_TEST" + "/exec"
RESULTS = []


def check(name, cond, extra=""):
    RESULTS.append((name, bool(cond)))
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
PRICES = {"삼성전자": 80100, "SK텔레콤": 57000, "맥쿼리인프라": 12100, "KB금융": 90000}
calls = []


def make_handler(fail=False):
    async def handler(route):
        q = parse_qs(urlparse(route.request.url).query)
        action = (q.get("action") or [""])[0]
        cb = (q.get("callback") or [""])[0]
        calls.append(action)
        if not cb:
            await route.fulfill(status=200, body="{}", content_type="application/json")
            return
        if action == "prices":
            if fail:
                await route.abort()
                return
            body = {"ok": True, "prices": PRICES, "codes": {"삼성전자": "005930"}, "updated": "2026-11-25T03:00:00.000Z", "refreshed": 4}
        elif action == "load":
            body = {"ok": True, "app": "stocknote", "version": "1.2.0", "hasData": False, "data": {}}
        else:
            body = {"ok": True, "app": "stocknote", "version": "1.2.0"}
        await route.fulfill(status=200, body=f"{cb}({json.dumps(body, ensure_ascii=False)});",
                            content_type="application/javascript")

    return handler


async def main():
    serve()
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        errs = []

        # 1) 정상 응답 — 열자마자 현재가 반영
        ctx = await browser.new_context(viewport={"width": 1100, "height": 800})
        pg = await ctx.new_page()
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        await pg.route("https://script.google.com/**", make_handler(False))
        await pg.goto(BASE, wait_until="networkidle")
        await pg.evaluate("localStorage.clear()")
        await pg.goto(BASE, wait_until="networkidle")   # 저장된 기록이 없어 예시로 시작
        await pg.wait_for_timeout(400)
        await pg.click("#btnStartMine")  # 예시 → 빈 기록(demo=false)
        await pg.wait_for_timeout(300)
        await pg.evaluate(f"localStorage.setItem('stocknote.url','{FAKE}')")
        await pg.goto(BASE, wait_until="networkidle")   # ?demo=1 없이 다시 열기
        await pg.wait_for_timeout(1500)

        stored = await pg.evaluate("JSON.parse(localStorage.getItem('stocknote.data.v1')).prices")
        check("load 다음 prices 호출", "load" in calls and "prices" in calls, calls)
        check("현재가가 기기에 반영", stored.get("삼성전자") == 80100 and stored.get("KB금융") == 90000, stored)
        dot = await pg.eval_on_selector("#syncDot", "e=>({cls:e.className, title:e.title})")
        check("연결 점 초록 + 갱신 표시", "on" in dot["cls"] and "현재가" in dot["title"], dot)
        await ctx.close()

        # 2) 응답 실패 — 기존 숫자 유지, 콘솔 에러 없음
        calls.clear()
        ctx2 = await browser.new_context(viewport={"width": 1100, "height": 800})
        pg2 = await ctx2.new_page()
        pg2.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        await pg2.route("https://script.google.com/**", make_handler(True))
        await pg2.goto(BASE, wait_until="networkidle")
        await pg2.evaluate("localStorage.clear()")
        await pg2.goto(BASE, wait_until="networkidle")
        await pg2.wait_for_timeout(400)
        await pg2.click("#btnStartMine")
        await pg2.wait_for_timeout(300)
        before = await pg2.evaluate("JSON.parse(localStorage.getItem('stocknote.data.v1')).prices")
        await pg2.evaluate(f"localStorage.setItem('stocknote.url','{FAKE}')")
        await pg2.goto(BASE, wait_until="networkidle")
        await pg2.wait_for_timeout(1500)
        after = await pg2.evaluate("JSON.parse(localStorage.getItem('stocknote.data.v1')).prices")
        check("실패해도 기존 숫자 유지", after == before, {"before": before, "after": after})
        check("실패해도 화면 살아 있음", (await pg2.inner_text("#heroProfit")) != "")
        await ctx2.close()

        check("콘솔·pageerror 0", not errs, errs)
        await browser.close()

    passed = sum(1 for _, ok in RESULTS if ok)
    print(f"price_auto_check: {passed}/{len(RESULTS)} 통과")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
