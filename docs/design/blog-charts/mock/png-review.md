# 図の PNG の書き出しの形（承認待ち）

承認したモック（`APPROVED.md`）の外の形なので、オーナーの確認を待つ。画像はビルドと同じ処理（`scripts/lib/blogChartPng.js`）で契約の例（`../example-venue-course-win.json`）を撮ったもの（手元の Mac の Chromium。本番のフォントは Noto Sans JP）。

| 大きさ | 画像 | 使う先 |
|---|---|---|
| portrait 1080×1350（CSS 400×500 を 2.7 倍） | `png-portrait.png` | X（4:5）・note の本文 |
| landscape 1280×720（CSS 640×360 を 2 倍） | `png-landscape.png` | note の見出し画像・本文、PC。スマホの X では字が小さく読めない |

記事の図から変えたところ（撮るときだけ。記事の画面は変わらない）:
- 切り替え（ボタン・選ぶ箱）を消し、札の1つ目を「会場 福岡」の形にする（押せない画像に押せる見た目を写さない）
- 行 32+8 → 26+4、棒 22 → 18、枠線と角の丸みなし、余白 12/14。行が4つまでなら元の行の高さ
- 下端に細い線と、左「龍神レーダー」（金・太字）右「boat-ai.jp」（13px）。ロゴの絵は入れない
- 注記は外さない
- landscape は見出しと答えを全幅、下を2段（左に横棒、右に札・注記・出典・出所）

決めた経緯: ファン役 `../fan-panel-png-v1.md`、x-channel・visual-designer（2026-10-20、寸法と2点）。

収まる行の数（手元の実測。本番のフォントでは未確認）: portrait は注記つきで6行まで（7行で 5px はみ出す）、landscape は7行まで（12行で 42px はみ出す）。はみ出す大きさは作らず `/ai-snapshots/status.json` の `blogChartPng.skipped` に理由を残す。
