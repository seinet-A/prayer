# tools/source/{krv.json, books.json} → bible/index.json + bible/<책ID>.json (66개)
# 표준 라이브러리만. 프로젝트 루트에서: python tools/build_bible.py
import json, os, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = json.load(open(os.path.join(ROOT, 'tools/source/krv.json'), encoding='utf-8'))
books = json.load(open(os.path.join(ROOT, 'tools/source/books.json'), encoding='utf-8'))
out = os.path.join(ROOT, 'bible')
os.makedirs(out, exist_ok=True)

OT = 39  # books.json 앞 39권이 구약
verses = collections.defaultdict(dict)  # book -> {(ch, v): text}
for key, text in src['verses'].items():
    b, c, v = key.split('.')
    verses[b][(int(c), int(v))] = text
titles = collections.defaultdict(dict)  # book -> {ch: title}
for key, t in src.get('titles', {}).items():
    b, c = key.split('.')
    titles[b][c] = t

index, total, missing = [], 0, []
for i, bk in enumerate(books):
    b = bk['id']
    vs = verses[b]
    nch = max(c for c, _ in vs)
    chapters = []
    for c in range(1, nch + 1):
        nv = max(v for cc, v in vs if cc == c)
        arr = []
        for v in range(1, nv + 1):
            t = vs.get((c, v))
            if t is None:
                missing.append(f'{b}.{c}.{v}')
            else:
                total += 1
            arr.append(t)
        chapters.append(arr)
    with open(os.path.join(out, f'{b}.json'), 'w', encoding='utf-8') as f:
        json.dump({'chapters': chapters, 'titles': titles[b]}, f, ensure_ascii=False, separators=(',', ':'))
    index.append({'id': b, 'ko': bk['ko'], 'chapters': nch, 'ot': i < OT})

with open(os.path.join(out, 'index.json'), 'w', encoding='utf-8') as f:
    json.dump(index, f, ensure_ascii=False, separators=(',', ':'))

with open(os.path.join(ROOT, 'tools/build_report.txt'), 'w', encoding='utf-8') as f:
    f.write(f'books {len(index)}\nverses {total}\nmissing {len(missing)}\n' + '\n'.join(missing) + '\n')
print(f'books {len(index)} verses {total} missing {len(missing)} (자세한 건 tools/build_report.txt)')
