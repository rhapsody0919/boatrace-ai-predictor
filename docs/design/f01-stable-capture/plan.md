# 完全版 f01 の崩れない撮影（plan）

spec: [spec.md](./spec.md)

## 部品の切り出し（PR (a)、本番の DOM は変えない）
本番の部品から、撮る範囲だけを名前付きの export に切り出す。本番の画面は切り出した部品を同じ順に並べるだけで、要素・クラス・属性は変えない（fragment で包む）。

| ファイル | 切り出す部品 | 本番での使い手 |
|---|---|---|
| `src/components/race/analogy/FactRadar.jsx` | `RadarFigure`（暗い枠＋七角形）・`RadarBoatLegend`（艇の行） | FactRadar |
| `src/components/race/analogy/SimilarRacesTab.jsx` | `SimilarWinBars`（見出し・凡例・6艇の棒） | SimilarRacesTab |
| `src/components/race/analogy/FinishSankey.jsx` | `SankeyFigure`（暗い枠＋流れの図）。配置は純関数 `sankeyLayout.js` | FinishSankey |
| `src/components/race/analogy/SlitShapePicker.jsx` | `SlitShapeCard`（形の札1枚） | SlitShapePicker |
| `src/components/race/assist/WinFollowers.jsx` | `FollowTop`（軸のボタン・見出し・結論）・`FollowTable`（2着の棒の表） | WinFollowers |
| `src/utils/analogyAggregate.js` | `similarSlice`（スライダーの既定の件数までの集計） | SimilarRacesTab |

## 撮影用の頁（PR (a)）
- `src/snsCapture/f01Parts.js`: 部品の表（部品名・ファイル・渡す props の名前・撮る幅・CSS の文脈・幅・余白）と、材料から props を作る純関数 `f01PartProps`。本番のタブと同じ util（radarBoats・similarSlice・hintRows・winFollowers・axisMarks）を呼ぶ。node から読める
- `src/snsCapture/F01Capture.jsx`: `window.__F01_MATERIALS__` の材料と URL の引数から props を作って部品を描き、描き終えたら `[data-f01-shot]` に `data-f01-ready` と `data-f01-meta` を付ける。作れない（材料が無い・部品の子の数が違う）ときは `data-f01-error` を出す（黙って別の物を撮らない）
- `src/main.jsx`: `import.meta.env.VITE_SNS_CAPTURE === "1"` かつ `/sns-capture/` のときだけ、頁を lazy で読み込む。分析・Cookie の帯・ルーターを通さない

## 撮る側（PR (b)）
- `f01-capture.mjs`: dev サーバー（vite、`VITE_SNS_CAPTURE=1`・`API_PROXY_TARGET=""`）を空いた port で立て、Playwright で part ごとに開いて箱を1回撮る。dev サーバーの外と `/api/` への読み取りは止め、読もうとしたら撮影を止める。`reducedMotion: reduce`・`animations: disabled`
- `f01-build.mjs`: PLAN の②を 18-10 の形（1着の棒 → 流れの押す前 → 押した後）に戻す。同じ部品の倍率をそろえる組を、座標の近さではなく撮る側の `group` で決める。②の字の線を③と同じ 22px（18-10 の実測 22.4px）
- 検査: `verify-f01-capture-contract.js`（ci）— 部品の表の props の名前と部品の引数（@babel/parser で読む）が一致する・`f01PartProps` が fixture の材料で全 part の props を作れる・main.jsx の分岐が旗で閉じている。`verify-f01-capture-stable.js`（manual）— 同じ材料で2回撮り、全 part の画素が一致する

## 壊れ方
- 部品の props の名前が変わった → contract の検査で落ちる（PR の CI）
- 本番の見た目（CSS）が変わった → 撮る画像も同じに変わる（本番と同じ部品・CSS）。撮影は落ちない
- 部品の子の数が変わった（艇の行・軸のボタンが6つでない）→ 頁が `data-f01-error` を出し、撮影が止まる（今の型で黙って作らない）
