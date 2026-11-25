# ADR-0110: 依存の向きと大きさの関所は「全体で0＋減る向きだけの例外の表」で見る

## 状況

- lint-changed --ci の依存の向き（lintDepTree.js）と大きさ（lintTrees.js）は、PR の base（merge-base）の木を基準に作り、その差だけを見ていた。大きさはさらに FREEZE_SHA の木の数の半分で既存のファイルにも厳しくする旗を持っていた（BOA-1425・1434、hq の設計図）
- この形では、master に一度入った違反（並行の PR の組み合わせ・関所の外を通ったマージ等）がそのまま次の基準になり、二度と赤にならない
- 2026-11-25 の点検（コードの健全さの点検、窓口）で、リファクタの後に依存の違反は 54→0、線を越える関数は 682→3（全部 `__fixtures__`）、実質400行を越えるファイルは 228→10 まで減っていた。差で守る理由が薄れた

## 決定

1. **依存の向き**: HEAD だけに dependency-cruiser を回し、違反の辺は全部 `scripts/maintenance/dependency-exceptions.json` に要る（辺ごと。データ層の和の中の from はまとめない）。循環は今までどおり全体で0（表に書いても通らない）
2. **大きさ**: HEAD の木の JS（`__fixtures__` を除く）に、線を越える関数（100行・複雑さ15）は1つも置かない。実質の行（空行・注釈を除く）が400を越えるファイルは `scripts/maintenance/size-exceptions.json` の上限の内に限る
3. **例外の表は減る向きだけ**: base の表より行を足す・上限を上げると赤。表の行が今の違反・行数とちょうど合わない（直したのに行が残る、上限が今より多い、ファイルが無い）のも赤にし、直した PR の中で表も縮める（残すと、後で戻しても通る）
4. **base の表の有無は git で分ける**: base の木に表が無いとき（表を足す PR）だけ増えを見ない。ほかの読みの失敗は赤
5. 表の名前は `*-allowlist.json` にしない（guard_weakening の許可リストの向きの検査は PARSERS に無い表を縮めても赤にする）。表の増えは lint の側が見る
6. 線の値（100行・15・400行）は変えない（目安、根拠なし）

## 結果

- base の木を作り直さないので、依存は dependency-cruiser 1回・大きさは木1本の読みになる（手元の負荷の高い所で 18秒・22秒だった。CI での得は未測）
- 一度 master に入った違反は、次に CI を回す全ての PR と master への push で赤になる。無関係の PR も止まるので、見つけたら直す PR を先に出す
- 関所の本体（lint-changed 系・dependency-rules.cjs・sizeBaselines.js）は CODEOWNERS にも pr-lane の H5 にも無い。規則や線を緩める変更をこの関所は止めない（オーナーへの指摘、未対応）
- 大きさの旧の部品（buildBaseline・checkAgainstBaseline・checkBaselineShrink）と依存の baselineOfEdges・compareEdgesToBaseline は試験だけが読む。試験と一緒に消すのは別の PR

## 戻し方

lintDepTree.js・lintTrees.js を前の版（base との差）へ戻し、表の2ファイルを消す。表の行は前の作りでは使わないので、戻しても赤にはならない。
