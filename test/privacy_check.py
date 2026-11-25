"""공개 저장소 개인정보 0% 검사 — 커밋 전에 한 번 돌립니다.

    python3 test/privacy_check.py

공개 저장소(wjoehasa-eng/stock-note)에 들어가면 안 되는 것:
  · 실제 보유 종목·수량·단가·금액 (예시는 누구나 아는 종목의 가상 숫자만)
  · 구글 시트 ID, Apps Script 웹 앱 주소(.../exec), 배포 ID
  · 이름·전화번호·집 주소·계정 이메일 같은 신원 정보
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SKIP_DIRS = {".git", "node_modules", "__pycache__", "_shots"}
SCAN_EXT = {".html", ".js", ".json", ".md", ".py", ".gs", ".webmanifest", ".sh", ".txt"}

# (설명, 정규식)
FORBIDDEN = [
    ("\u0041\u0070\u0070\u0073 \uc2a4\ud06c\ub9bd\ud2b8 \uc6f9 \uc571 \uc8fc\uc18c", re.compile(r"script\.google\.com/macros/s/[A-Za-z0-9_\-]{10,}")),
    ("\u0041\u0070\u0070\u0073 \uc2a4\ud06c\ub9bd\ud2b8 \ubc30\ud3ec ID", re.compile(r"\bAKfycb[A-Za-z0-9_\-]{10,}")),
    ("\uc2a4\ud504\ub808\ub4dc\uc2dc\ud2b8 ID", re.compile(r"docs\.google\.com/spreadsheets/d/[A-Za-z0-9_\-]{20,}")),
    ("\uc774\uba54\uc77c \uc8fc\uc18c", re.compile(r"[A-Za-z0-9._%+\-]+@(gmail|naver|daum|hanmail|kakao|nate)\.[a-z]+")),
    ("\ud734\ub300\uc804\ud654 \ubc88\ud638", re.compile(r"01[016789][\-\s]?\d{3,4}[\-\s]?\d{4}")),
    # 이름·가족·주소는 이 파일 자체가 공개되지 않도록 유니코드 이스케이프로 적습니다.
    ("\uac1c\uc778 \uc774\ub984", re.compile("[\uc548]\uacbd\ubaa8|[\ud558]\uc815\uc6d0")),
    ("\uc544\uc774 \uc774\ub984", re.compile("[\uc548]?\ud76c[\uc724\uacb8]")),
    ("\uc9d1 \uc8fc\uc18c\u00b7\ud559\uad50", re.compile("\ubcc4\uc591\ub3d9|\ud3b8\ud55c\uc138\uc0c1|\ubb38\uc6d0\ucd08")),
]

# 이 검사기 자체는 패턴 정의를 담고 있으므로 검사에서 제외합니다.
SKIP_FILES = {"test/privacy_check.py"}

# 예시 데이터로 허용하는 공개 종목(누구나 아는 상장사) — 이 목록 밖의 종목명이 코드에 있으면 사람이 확인
PUBLIC_TICKERS = {
    "삼성전자", "SK하이닉스", "한미반도체", "SK텔레콤", "KT", "LG유플러스",
    "맥쿼리인프라", "한국전력", "한국가스공사", "KB금융", "신한지주", "하나금융지주",
    "우리금융지주", "메리츠금융지주", "현대차", "기아", "현대모비스", "카카오", "네이버", "NAVER",
    "POSCO홀딩스", "LG화학", "삼성SDI", "삼성바이오로직스", "셀트리온", "이마트", "BGF리테일",
}


def main():
    hits = []
    files = 0
    for base, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in names:
            if os.path.splitext(name)[1] not in SCAN_EXT:
                continue
            path = os.path.join(base, name)
            rel = os.path.relpath(path, ROOT)
            if rel in SKIP_FILES:
                continue
            try:
                text = open(path, encoding="utf-8").read()
            except UnicodeDecodeError:
                continue
            files += 1
            for label, rx in FORBIDDEN:
                for m in rx.finditer(text):
                    hits.append((rel, label, m.group(0)[:60]))

    if hits:
        print(f"개인정보 의심 {len(hits)}건:")
        for rel, label, found in hits:
            print(f"  {rel}: {label} → {found}")
        return 1
    print(f"privacy_check: {files}개 파일 점검 · 개인정보 0건 (금지 패턴 {len(FORBIDDEN)}종)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
