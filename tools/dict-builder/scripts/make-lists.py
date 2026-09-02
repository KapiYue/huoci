#!/usr/bin/env python3
"""raw-lists/*.csv → data/lists/*.txt（一行一个 lemma）。

原件每行是 `headword,词形1,词形2,...`，`##` 开头是说明文字。
取第一列，转小写，去重，重音折成 ASCII——ECDICT 是纯 ASCII 词形表，
不折叠 café / résumé 这类词必然在第 03 步对不上。

  python3 scripts/make-lists.py
"""
import csv, os, re, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW  = os.path.join(ROOT, 'data', 'raw-lists')
DEST = os.path.join(ROOT, 'data', 'lists')

JOBS = [
  ('ngsl.txt',        'NGSL_12_lemmatized_for_research.csv',
   'NGSL 1.2 · New General Service List',
   'https://www.newgeneralservicelist.com/new-general-service-list'),
  ('bsl.txt',         'BSL_120_lemmatized_for_research.csv',
   'BSL 1.20 · Business Service List',
   'https://www.newgeneralservicelist.com/business-service-list'),
  ('tsl.txt',         'TSL_12_lemmatized_for_research.csv',
   'TSL 1.2 · TOEIC Service List',
   'https://www.newgeneralservicelist.com/toeic-service-list'),
  ('nawl.txt',        'NAWL_12_lemmatized_for_research.csv',
   'NAWL 1.2 · New Academic Word List',
   'https://www.newgeneralservicelist.com/new-academic-word-list'),
  ('ngsl-spoken.txt', 'NGSL-Spoken_12_lemmatized_for_research.csv',
   'NGSL-Spoken 1.2',
   'https://www.newgeneralservicelist.com/ngsl-spoken'),
]

# NAWL / TSL 的原件是 latin-1，其余是 UTF-8（NGSL-Spoken 带 BOM）
def decode(b):
    for enc in ('utf-8-sig', 'utf-8', 'cp1252', 'latin-1'):
        try: return b.decode(enc)
        except UnicodeDecodeError: continue
    return b.decode('latin-1', 'replace')

WORD = re.compile(r"^[a-z][a-z'.\- ]*$")

def main():
    os.makedirs(DEST, exist_ok=True)
    for out, src, name, url in JOBS:
        text = decode(open(os.path.join(RAW, src), 'rb').read())
        text = text.replace('\r\n', '\n').replace('\r', '\n')
        lemmas, dropped, folded_note, seen = [], [], [], set()
        for line in text.split('\n'):
            if not line.strip() or line.lstrip().startswith('##'):
                continue
            head = next(csv.reader([line]), [''])[0].strip().lower()
            folded = ''.join(c for c in unicodedata.normalize('NFKD', head)
                             if not unicodedata.combining(c))
            if folded != head:
                folded_note.append(f'{head} → {folded}')
                head = folded
            if not head:
                continue
            if not WORD.match(head):
                dropped.append(head); continue
            if head in seen:
                continue
            seen.add(head); lemmas.append(head)

        body = '\n'.join([
            f'# {name}',
            f'# source: {url}',
            '# license: CC BY-SA 4.0 · Browne, C., Culligan, B. & Phillips, J.',
            f'# extracted from {src} (first column = headword lemma)',
            '',
        ] + lemmas) + '\n'
        with open(os.path.join(DEST, out), 'w', encoding='utf-8') as f:
            f.write(body)

        msg = f'{out:16} {len(lemmas):5} lemma'
        if folded_note: msg += f'   折叠 {folded_note}'
        if dropped:     msg += f'   丢弃 {len(dropped)}: {dropped[:5]}'
        print(msg)

if __name__ == '__main__':
    main()
