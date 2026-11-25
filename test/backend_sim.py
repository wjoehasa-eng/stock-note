"""Code.gs(v1.2.0) 백엔드 시뮬레이션 테스트.

실제 Apps Script 없이, 브라우저에서 Code.gs 원문을 읽어 가짜 스프레드시트/UrlFetchApp/CacheService로
그대로 실행합니다. 확인하는 것:
  · 문법 오류 0
  · 종목코드 자동 조회(네이버 검색 목업) · 현재가 파싱 · 60초 캐시
  · 시세 탭 줄 추가 · 코드 기록 · GOOGLEFINANCE 수식 보존 · 실패 시 기존 숫자 폴백
  · saveAll_ 저장 + 시세 갱신 + 이유태그(직접 입력) 저장
  · v1.1 시트(옛 태그·초기보유 ID)와의 하위 호환

    python3 test/backend_sim.py
"""
import asyncio
import functools
import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("STOCKNOTE_PORT", "8794"))


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def handle_error(self, request, client_address):
        pass


def serve():
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()


async def main():
    serve()
    js = open(os.path.join(ROOT, "test", "backend_sim.js"), encoding="utf-8").read()
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded")
        result = await page.evaluate(js)
        await browser.close()

    if result.get("syntaxError"):
        print("SYNTAX ERROR:", result["syntaxError"])
        return 1
    passed = sum(1 for s in result["steps"] if s["pass"])
    total = len(result["steps"])
    for s in result["steps"]:
        if not s["pass"]:
            print(f"  FAIL  {s['name']}  {s['extra']}")
    print(f"backend_sim: {passed}/{total} 통과 (Code.gs v{result.get('version')})")
    if errs:
        print("pageerror:", errs)
    return 0 if passed == total and not errs else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
