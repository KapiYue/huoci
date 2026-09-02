#!/usr/bin/env bash
# 五张 CC BY-SA 词表原件 → data/raw-lists/
# 一律走 newgeneralservicelist.com。.org 已是停放页，BSL 页面被插了外链且版本陈旧。
# 只按固定文件名取，不解析网页——官网改版时宁可 404，也不要静默抓错。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw-lists

FILES=(
  NGSL_12_lemmatized_for_research.csv
  BSL_120_lemmatized_for_research.csv
  TSL_12_lemmatized_for_research.csv
  NAWL_12_lemmatized_for_research.csv
  NGSL-Spoken_12_lemmatized_for_research.csv
)

for f in "${FILES[@]}"; do
  curl -fsSL --retry 3 -A "Mozilla/5.0" -o "data/raw-lists/$f" \
    "https://www.newgeneralservicelist.com/s/$f" \
    && echo "✓ $f  $(wc -c < "data/raw-lists/$f" | tr -d ' ') bytes" \
    || { echo "✗ $f  取不到——去 README 里对应页面确认文件名是否改了"; exit 1; }
done

echo "接着跑：python3 scripts/make-lists.py"
