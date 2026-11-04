"""同梱の Noto Sans JP（NotoSansJP-wght.woff2）と、字の範囲（coverage.js）を作り直す。

元: Google Fonts の配布（https://github.com/google/fonts/raw/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf、
版 2.004、可変 wght 100〜900、SIL OFL 1.1）。@remotion/google-fonts 4.0.512 が読んでいた fonts.gstatic.com の分割（v56）と同じ版。
字は絞らず、woff2 に詰め直すだけ（分割の japanese・latin が含む 16,591 字に、ギリシャ・キリル・ローマ数字など 141 字を足した全 16,732 字）。

使い方（fontTools と brotli が要る）: python3 build.py <NotoSansJP[wght].ttf>
"""
import hashlib
import json
import os
import sys

from fontTools.ttLib import TTFont

here = os.path.dirname(os.path.abspath(__file__))
src = TTFont(sys.argv[1], recalcTimestamp=False)
cps = sorted(src.getBestCmap().keys())
src.flavor = "woff2"
woff2 = os.path.join(here, "NotoSansJP-wght.woff2")
src.save(woff2)

# 連続する字は [始め, 終わり] の範囲にまとめる（描いた字の検査 glyphCoverage.js が読む）
ranges = []
for c in cps:
    if ranges and ranges[-1][1] == c - 1:
        ranges[-1][1] = c
    else:
        ranges.append([c, c])
with open(woff2, "rb") as f:
    sha = hashlib.sha256(f.read()).hexdigest()
# JSON ではなく JS（Remotion の bundle と Node の検査の両方がそのまま import できる）
with open(os.path.join(here, "coverage.js"), "w") as f:
    f.write("// fonts/noto-sans-jp/build.py が作る。手で直さない\n")
    f.write("export default ")
    json.dump({"font": "NotoSansJP-wght.woff2", "sha256": sha, "count": len(cps), "ranges": ranges}, f, separators=(",", ":"))
    f.write(";\n")
print(f"{len(cps)} 字・{len(ranges)} 範囲・{os.path.getsize(woff2)} バイト・sha256 {sha}")
