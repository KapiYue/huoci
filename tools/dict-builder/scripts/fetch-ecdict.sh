#!/usr/bin/env bash
# ECDICT 完整版（340 万词）→ data/ecdict.csv
# Release 1.0.28 的附件里没有 csv，所以走 sqlite 转出。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data

ZIP=data/ecdict-sqlite-28.zip
[ -f "$ZIP" ] || curl -L --retry 3 -o "$ZIP" \
  https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip

unzip -o "$ZIP" -d data/ecdict-sqlite
sqlite3 -header -csv data/ecdict-sqlite/stardict.db \
  "select word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio from stardict;" \
  > data/ecdict.csv

echo "data/ecdict.csv  $(du -h data/ecdict.csv | cut -f1)  ($(sqlite3 data/ecdict-sqlite/stardict.db 'select count(*) from stardict;') 词条)"
echo "转完了。data/ecdict-sqlite/ 和 $ZIP 可以删，占 1GB。"
