import asyncio, threading, functools, os, json, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PORT = 8793
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
        ctx = await b.new_context(viewport={"width": 420, "height": 900}, device_scale_factor=2, color_scheme="light")
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errs.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
        reqs = {}
        pg.on("response", lambda r: reqs.setdefault(r.url.replace(BASE, "/"), r.status))

        await pg.goto(BASE + "?demo=1", wait_until="load")
        await pg.wait_for_timeout(800)

        # 1) manifest 링크 + 파싱
        m = await pg.evaluate("""async () => {
          const l = document.querySelector('link[rel=manifest]');
          if (!l) return {error:'no manifest link'};
          const r = await fetch(l.href);
          const j = await r.json();
          return {href:l.href, status:r.status, type:r.headers.get('content-type'), json:j};
        }""")
        if 'error' in m: fails.append(m['error'])
        else:
            j = m['json']
            print("manifest:", m['status'], m['type'], m['href'])
            for k in ['name','short_name','start_url','scope','display','background_color','theme_color']:
                if not j.get(k): fails.append(f"manifest missing {k}")
            print(" ", {k: j.get(k) for k in ['name','short_name','start_url','scope','display','background_color','theme_color']})
            sizes = {(i['sizes'], i['purpose']) for i in j.get('icons', [])}
            print("  icons:", sorted(sizes))
            if ('192x192','any') not in sizes: fails.append("no 192 any icon")
            if ('512x512','any') not in sizes: fails.append("no 512 any icon")
            if not any(pr == 'maskable' for _, pr in sizes): fails.append("no maskable icon")

        # 2) 아이콘 HTTP 200 + 실제 픽셀 크기
        for f, size in [('icon-192.png',192), ('icon-512.png',512), ('icon-512-maskable.png',512), ('apple-touch-icon.png',180)]:
            st = reqs.get('/' + f)
            if st is None:
                st = await pg.evaluate("u => fetch(u).then(r => r.status)", BASE + f)
            print(f"{f}: {st}")
            if st != 200: fails.append(f"{f} status {st}")
        dims = await pg.evaluate("""async (files) => {
          const out = {};
          for (const f of files) {
            const blob = await (await fetch(f)).blob();
            const bmp = await createImageBitmap(blob);
            out[f] = bmp.width + 'x' + bmp.height;
          }
          return out;
        }""", ['icon-192.png','icon-512.png','icon-512-maskable.png','apple-touch-icon.png'])
        print("icon dims:", dims)

        # 3) 서비스 워커 등록
        sw = await pg.evaluate("""async () => {
          if (!('serviceWorker' in navigator)) return {error:'no serviceWorker'};
          const reg = await navigator.serviceWorker.ready;
          return {scope: reg.scope, active: !!reg.active, state: reg.active && reg.active.state};
        }""")
        print("sw:", sw)
        if sw.get('error') or not sw.get('active'): fails.append("service worker not active")

        # 캐시된 껍데기 확인
        cache = await pg.evaluate("""async () => {
          const keys = await caches.keys();
          const c = await caches.open(keys.find(k => k.startsWith('stock-note')));
          const reqs = await c.keys();
          return {keys, cached: reqs.map(r => new URL(r.url).pathname).sort()};
        }""")
        print("cache:", cache)

        # 4) 설치 UI — 설정 시트의 설치 줄
        await pg.click('#btnSettings')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=f"{OUT}/pwa-01-설정-설치줄.png")
        row = await pg.evaluate("""() => {
          const b = document.getElementById('btnInstall');
          const h = document.getElementById('installHint');
          return b && h ? {btn: b.textContent.trim(), hint: h.textContent.trim()} : null;
        }""")
        print("install row:", row)
        if not row: fails.append("settings install row missing")

        # 5) 설치 안내 시트 (프롬프트 없을 때의 안내)
        await pg.click('#btnInstall')
        await pg.wait_for_timeout(450)
        guide = await pg.evaluate("""() => {
          const t = document.getElementById('sheetTitle').textContent;
          const body = document.getElementById('sheetBody').innerText;
          return {title: t, body: body.slice(0, 300)};
        }""")
        print("guide:", guide['title'], '|', guide['body'].replace('\n',' ')[:180])
        if guide['title'] != '앱으로 설치': fails.append("install guide sheet not opened")
        await pg.screenshot(path=f"{OUT}/pwa-02-설치안내.png")
        await pg.click('#btnGuideClose')

        # 6) 재방문 시 서비스 워커가 문서를 제어하는지
        await pg.reload(wait_until="load")
        await pg.wait_for_timeout(700)
        ctrl = await pg.evaluate("!!navigator.serviceWorker.controller")
        print("controlled after reload:", ctrl)
        if not ctrl: fails.append("page not controlled by SW after reload")

        print("console errors:", errs)
        if errs: fails.append(f"console errors: {errs}")
        await b.close()

    print("\n=== RESULT:", "PASS" if not fails else "FAIL")
    for f in fails: print(" -", f)
    sys.exit(1 if fails else 0)

asyncio.run(main())
