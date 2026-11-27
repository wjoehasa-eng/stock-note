"""배당 자동 조회(v2.1) 화면 검증 — 로컬 서버 + Playwright/Chromium.

구글 시트 대신 가짜 스크립트 응답을 돌려주어, 앱이
  · action=load 로 받은 배당(auto- 행 포함)을 배당 화면에 그리는지
  · action=prices 응답의 dividends 를 합쳐 주당예상·수량·새 종목을 반영하는지
  · 서버에서 정리된 자동 행(보유 0)을 이 기기에서도 지우는지
  · ⚙ 설정 [불러오기]가 action=refresh 로 최신 배당을 받아 오는지
  · 모바일 390×844 / 데스크톱 1280 에서 넘침·JS 에러가 없는지

    python3 test/dividend_ui_check.py
    STOCKNOTE_SHOTS=downloads/stock-note-v21 python3 test/dividend_ui_check.py
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
PORT = int(os.environ.get("STOCKNOTE_PORT", "8801"))
OUT = os.environ.get("STOCKNOTE_SHOTS") or os.path.join(ROOT, "_shots", "v21")
FAKE = "https://script.google.com/" + "macros/s/" + "FAKE_DEPLOYMENT_FOR_TEST" + "/exec"
RESULTS = []
calls = []


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

TRADES = [
    {"id": "t1", "date": "2026-05-12", "name": "삼성전자", "side": "buy", "qty": 20, "price": 68000,
     "funding": "cash", "reasons": ["저평가(PER·PBR)"], "mood": "보통", "horizon": "장기", "rule": "", "memo": ""},
    {"id": "t2", "date": "2026-06-18", "name": "KB금융", "side": "buy", "qty": 10, "price": 78000,
     "funding": "cash", "reasons": ["배당 매력"], "mood": "보통", "horizon": "장기", "rule": "", "memo": ""},
    {"id": "t3", "date": "2026-07-08", "name": "SK텔레콤", "side": "buy", "qty": 30, "price": 52000,
     "funding": "cash", "reasons": ["배당 매력"], "mood": "보통", "horizon": "장기", "rule": "", "memo": ""},
]

DIV_LOAD = [
    {"id": "auto-005930-12", "name": "삼성전자", "month": 12, "expectedPer": 361, "confirmedPer": None,
     "qty": 20, "exDate": "", "payDate": "", "note": ""},
    {"id": "auto-105560-12", "name": "KB금융", "month": 12, "expectedPer": 850, "confirmedPer": None,
     "qty": 10, "exDate": "", "payDate": "", "note": ""},
    {"id": "u-manual", "name": "맥쿼리인프라", "month": 3, "expectedPer": 220, "confirmedPer": 218,
     "qty": 100, "exDate": "2026-03-27", "payDate": "2026-04-15", "note": "공시로 배당기준일 변경"},
]

# prices 응답 1: 삼성전자 주당예상 361→380, 수량 20→25, SK텔레콤 자동 행 새로 생김
DIV_P1 = [
    {"id": "auto-005930-12", "name": "삼성전자", "month": 12, "expectedPer": 380, "confirmedPer": None,
     "qty": 25, "exDate": "", "payDate": "", "note": ""},
    {"id": "auto-105560-12", "name": "KB금융", "month": 12, "expectedPer": 850, "confirmedPer": None,
     "qty": 10, "exDate": "", "payDate": "", "note": ""},
    {"id": "auto-017670-12", "name": "SK텔레콤", "month": 12, "expectedPer": 500, "confirmedPer": None,
     "qty": 30, "exDate": "", "payDate": "", "note": ""},
    {"id": "u-manual", "name": "맥쿼리인프라", "month": 3, "expectedPer": 220, "confirmedPer": 218,
     "qty": 100, "exDate": "2026-03-27", "payDate": "2026-04-15", "note": "공시로 배당기준일 변경"},
]
# refresh 응답(수동 불러오기): KB금융을 전량 매도해 서버가 자동 행을 정리한 상황
DIV_P2 = [d for d in DIV_P1 if d["id"] != "auto-105560-12"]

PRICES = {"삼성전자": 71200, "KB금융": 88500, "SK텔레콤": 56000}


def total_of(rows):
    return sum((r["confirmedPer"] if r["confirmedPer"] is not None else r["expectedPer"]) * r["qty"] for r in rows)


def make_handler():
    state = {"prices_calls": 0}

    async def handler(route):
        q = parse_qs(urlparse(route.request.url).query)
        action = (q.get("action") or [""])[0]
        cb = (q.get("callback") or [""])[0]
        calls.append(action)
        if not cb:
            await route.fulfill(status=200, body="{}", content_type="application/json")
            return
        if action == "load":
            body = {"ok": True, "app": "stocknote", "version": "1.3.0", "savedAt": "2026-11-28T00:00:00.000Z",
                    "data": {"settings": {"principal": 30000000}, "prices": {}, "sectors": {}, "customReasons": {},
                             "trades": TRADES, "dividends": DIV_LOAD, "gurus": [], "curve": []}}
        elif action in ("prices", "refresh"):
            if action == "prices":
                state["prices_calls"] += 1
                divs = DIV_P1 if state["prices_calls"] <= 1 else DIV_P1
            else:
                divs = DIV_P2
            body = {"ok": True, "prices": PRICES, "codes": {"삼성전자": "005930"},
                    "updated": "2026-11-28T01:30:00.000Z", "refreshed": 3,
                    "dividends": divs, "divAdded": 1, "divUpdated": 1, "divRemoved": 0, "divFailed": 0}
        else:
            body = {"ok": True, "app": "stocknote", "version": "1.3.0"}
        await route.fulfill(status=200, body=f"{cb}({json.dumps(body, ensure_ascii=False)});",
                            content_type="application/javascript")

    return handler


async def open_app(browser, viewport):
    ctx = await browser.new_context(viewport=viewport, device_scale_factor=2)
    pg = await ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
    await pg.route("https://script.google.com/**", make_handler())
    await pg.goto(BASE, wait_until="networkidle")
    await pg.evaluate("localStorage.clear()")
    await pg.evaluate(f"localStorage.setItem('stocknote.url','{FAKE}')")
    await pg.goto(BASE, wait_until="networkidle")
    await pg.wait_for_timeout(1800)
    return ctx, pg, errs


async def main():
    serve()
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()

        # ---------------- 모바일 390×844
        ctx, pg, errs = await open_app(browser, {"width": 390, "height": 844})
        check("load 다음 prices 호출", "load" in calls and "prices" in calls, calls)

        divs = await pg.evaluate("JSON.parse(localStorage.getItem('stocknote.data.v1')).dividends")
        want = total_of(DIV_P1)
        got = await pg.evaluate("async()=>{document.querySelector('button[data-view=\"dividends\"]').click();return 1}")
        await pg.wait_for_timeout(400)
        tot = await pg.inner_text("#divTotal")
        check("배당 화면 합계 = 서버 자동 배당", tot.replace(",", "").replace("원", "") == str(want), f"{tot} != {want}")
        auto_rows = [d for d in divs if str(d.get("id", "")).startswith("auto-")]
        check("자동 행 3개 반영", len(auto_rows) == 3, divs)
        sam = [d for d in divs if d.get("id") == "auto-005930-12"][0]
        check("주당예상·수량 자동 갱신", sam["expectedPer"] == 380 and sam["qty"] == 25, sam)
        manual = [d for d in divs if d.get("id") == "u-manual"][0]
        check("직접 넣은 행 보존", manual["confirmedPer"] == 218 and manual["note"].find("기준일") >= 0, manual)

        badges = await pg.eval_on_selector_all("#divByStock .badge", "els=>els.map(e=>e.textContent)")
        check("종목별 목록에 '자동' 배지", badges.count("자동") == 3, badges)
        note = await pg.inner_text("#divAutoNote")
        check("자동 조회 안내 문구", "네이버 금융 자동" in note and "3종목" in note, note)

        ov = await pg.evaluate("()=>{const d=document.documentElement;return d.scrollWidth-d.clientWidth;}")
        check("모바일 가로 넘침 0", ov <= 0, ov)
        await pg.screenshot(path=os.path.join(OUT, "dividends-390.png"), full_page=True)
        await ctx.close()

        # ---------------- 수동 불러오기 → 서버에서 정리된 자동 행이 기기에서도 사라짐
        ctx2, pg2, errs2 = await open_app(browser, {"width": 1280, "height": 1000})
        await pg2.evaluate("document.querySelector('button[data-view=\"dividends\"]').click()")
        await pg2.wait_for_timeout(300)
        before_n = len(await pg2.evaluate("JSON.parse(localStorage.getItem('stocknote.data.v1')).dividends"))
        calls.clear()
        await pg2.click("#btnSettings")
        await pg2.wait_for_timeout(400)
        await pg2.click("#btnPullPrices")
        await pg2.wait_for_timeout(1200)
        after = await pg2.evaluate("JSON.parse(localStorage.getItem('stocknote.data.v1')).dividends")
        check("수동 [불러오기]가 action=refresh 호출", "refresh" in calls, calls)
        check("서버에서 정리된 자동 행을 기기에서도 삭제",
              not [d for d in after if d.get("id") == "auto-105560-12"], [d.get("id") for d in after])
        check("자동 행 수 2개로 정리", len([d for d in after if str(d.get("id", "")).startswith("auto-")]) == 2, after)
        toast = await pg2.inner_text("#toast")
        check("반영 토스트", "반영" in toast or "같습니다" in toast, toast)
        ov2 = await pg2.evaluate("()=>{const d=document.documentElement;return d.scrollWidth-d.clientWidth;}")
        check("데스크톱 가로 넘침 0", ov2 <= 0, ov2)
        await pg2.screenshot(path=os.path.join(OUT, "dividends-1280.png"), full_page=True)
        await ctx2.close()

        check("콘솔·pageerror 0 (모바일)", not errs, errs)
        check("콘솔·pageerror 0 (데스크톱)", not errs2, errs2)
        await browser.close()

    passed = sum(1 for _, ok in RESULTS if ok)
    print(f"dividend_ui_check: {passed}/{len(RESULTS)} 통과  (스크린샷 {OUT})")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
