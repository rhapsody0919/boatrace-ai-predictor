# v2r1 の冒頭の答えの段は、今日のレースについて言えるか（BOA-1096）

全貌動画の今の型 v2 の直し（v2r1、台本 `docs/design/full-picture-type-gate/candidates/v2r1-answer-fill-explain/script.md`）の冒頭に出す答えの段（A いつもより堅い寄り・B いつもと同じ程度・C 崩れやすい寄り）を、試作の前に確かめた（UI/UX の前の統計検証）。hq のデータサイエンティスト社員は龍神のリポジトリと DB を読めず答えられなかったので、決まりどおり data-scientist サブエージェントで代わった（2026-10-25）。

## 結論

- 毎日選ぶ4本（76R・19日、2026-10-06〜10-24）の段の内訳: A 43.4%（33）、B 26.3%（20）、C 2.6%（2）、thin_data 6.6%（5）、no_form 21.1%（16）
- **A・C の言葉は今日のレースについて言えない**。過去の差（p−p0）は今日の結果に引き継がれない。A（過去の差 平均 +9.5pt）の今日の1号艇の1着は p0 より −1.9pt［−6.3, +2.4］（486R）。p−p0 に対する傾きは 0.28［−0.03, 0.59］。Brier は p 0.2467 > p0 0.2358（1,478R、前向き）
- 原因は物差しの違い: 過去は本番のスタートの形、今日は平均ST（直近30走）からの予想。横一線と予想して本番も横一線だったのは 16.3%（予想が別のとき 14.6%、枠なり 1,220R）
- 線（30件・Wilson 95%）を緩めても直らない（90%・80%・補集合との検定でも A が増えるだけ）
- 形を問わない割合 p0（段 N）は成り立つ: no_form の4本で n は最少 300・中央値 1,604。今日の実際−p0 は +1.3pt［−3.3, +6.0］（389R）
- 作らない本数（段 N あり）: thin_data だけで、0本 14日・1本 5日

## 言えること・言えないこと

- 言える: 「この組み合わせの過去で、1号艇の1着は約X割（N件）」（形を問わない割合）。過去の事実として
- 言えない: 予想の形の過去の割合をもとに、今日の1号艇が「いつもより堅い」「崩れやすい」と言うこと
- 注記は必須: 「過去の割合で、今日の結果を示すものではない」（この19日は実際が p0 より全体で 3.3pt 低かった）

## 危うさ

- 段は件数の多さでほぼ決まる（全国に替わると n が大きく A が出やすい）
- 同じ範囲の重なり（76R で範囲キー 47、同じ日・同じ会場の準優勝戦は同じ数字）
- 複数の形に当たるレース 25/60（SLIT_FORMS の順で先頭を取る）
- コース別の平均STが30走に満たない艇がいるレース 38/76（形の判定の揺れは未検証）
- 期間は19日・1季節だけ（scenario の保存が 10/06 から）

## 数字と再実行

- 結果: `data/analysis/full-picture-answer-stage/answer-stage.json`
- スクリプト: `scripts/analysis/full-picture-answer-stage/`（lib/ の answer.mjs・forms.mjs・analogyScenario.js は検証した時点の版 605e3585a の写し。再現のために固定する）
- 再実行（中間データは `data/analysis/full-picture-answer-stage/work/` に置き、git に入れない）:

```bash
cd data/analysis/full-picture-answer-stage/work
node ../../../../scripts/analysis/full-picture-answer-stage/collect.mjs 2026-10-06 2026-10-24
node --env-file=../../../../.env.local ../../../../scripts/analysis/full-picture-answer-stage/actual.cjs
node ../../../../scripts/analysis/full-picture-answer-stage/analyze.mjs
```

続けて outcome.mjs・decompose.mjs・slope.mjs を同じ場所で回す。collect2.mjs は偶数 R（2・4・6・8・10）を足すときに使う。
