#!/usr/bin/env python3
"""주식노트 PWA 아이콘 생성 — 토스 블루(#3182F6) 바탕 + 흰색 상승 차트 심볼.

실행:  python3 test/gen_icons.py
결과:  icon-192.png · icon-512.png · icon-512-maskable.png · apple-touch-icon.png
       (모두 work/stock-note 루트에 저장, 알파 없는 불투명 PNG)
"""
from PIL import Image, ImageDraw

BLUE = (49, 130, 246, 255)      # #3182F6 — 토스 블루
WHITE = (255, 255, 255, 255)

# 앱 로고(24x24 viewBox)와 같은 꺾은선: 상승 차트 + 화살촉
LINE = [(4.0, 16.2), (9.0, 11.0), (12.4, 14.2), (20.0, 6.4)]
HEAD = [(15.6, 6.4), (20.0, 6.4), (20.0, 10.8)]
VB = 24.0
STROKE = 2.2


def draw_icon(size: int, logo_ratio: float, out: str) -> None:
    """size 정사각형. logo_ratio = 로고가 차지하는 캔버스 비율(안전영역 고려)."""
    s = 8  # 슈퍼샘플 배율 (안티앨리어싱)
    W = size * s
    img = Image.new("RGBA", (W, W), BLUE)
    d = ImageDraw.Draw(img)

    # 로고 영역을 캔버스 가운데에 놓이도록 좌표 변환
    span = W * logo_ratio
    scale = span / VB
    ox = (W - span) / 2.0
    oy = (W - span) / 2.0

    def pt(p):
        return (ox + p[0] * scale, oy + p[1] * scale)

    w = max(1, int(round(STROKE * scale)))
    line = [pt(p) for p in LINE]
    head = [pt(p) for p in HEAD]

    # 둥근 끝/이음: 각 점에 원을 찍고 선을 그어 joint="curve" 대신 부드럽게
    for path in (line, head):
        d.line(path, fill=WHITE, width=w, joint="curve")
        r = w / 2.0
        for x, y in path:
            d.ellipse([x - r, y - r, x + r, y + r], fill=WHITE)

    img = img.resize((size, size), Image.LANCZOS).convert("RGB")
    img.save(out, "PNG", optimize=True)
    print(f"{out}  {size}x{size}  logo={logo_ratio:.2f}")


if __name__ == "__main__":
    # any: 여백 있게 크게 (안드로이드가 마스크를 씌우지 않는 자리에 그대로 표시)
    draw_icon(192, 0.66, "icon-192.png")
    draw_icon(512, 0.66, "icon-512.png")
    # maskable: 안쪽 80% 안전영역 안에만 로고 (잘려도 심볼 온전)
    draw_icon(512, 0.52, "icon-512-maskable.png")
    draw_icon(192, 0.52, "icon-192-maskable.png")
    # iOS 홈 화면: 알파 없이 꽉 찬 사각형 (iOS가 모서리를 다듬음)
    draw_icon(180, 0.62, "apple-touch-icon.png")
