#!/bin/sh
# GitHub Pages 배포: main → gh-pages (Pages 게시 브랜치는 gh-pages)
#   sh work/stock-note/deploy.sh
# 하는 일: main을 올리고, gh-pages에 main을 합쳐 올립니다. 사이트는 바로 갱신됩니다.
set -e
cd "$(dirname "$0")"

REPO="wjoehasa-eng/stock-note"
URL="https://github.com/$REPO.git"

gh repo view "$REPO" >/dev/null 2>&1 || {
  echo "저장소가 아직 없습니다: https://github.com/new 에서 $REPO 를 Public 으로 만들어 주세요." >&2
  exit 1
}

git remote set-url origin "$URL" 2>/dev/null || git remote add origin "$URL"

cur_branch="$(git rev-parse --abbrev-ref HEAD)"
git push -u origin "$cur_branch"

git fetch origin --quiet
git checkout -B gh-pages origin/gh-pages 2>/dev/null || git checkout -B gh-pages
git merge "$cur_branch" -m "deploy: $cur_branch → gh-pages"
git push origin gh-pages
git checkout "$cur_branch"

gh api "repos/$REPO/pages" --jq '"Pages: \(.status) \(.html_url)"' 2>/dev/null || true
echo "라이브 주소: https://wjoehasa-eng.github.io/stock-note/"
