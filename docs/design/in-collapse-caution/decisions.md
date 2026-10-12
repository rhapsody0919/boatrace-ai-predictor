# 決定事項（BOA-822）

## 2026-10-12 ユーザー回答「推奨通りでよい」（Q1〜Q3、オーケストレーター経由で出した推奨）

| # | 決定 | 根拠 |
|---|---|---|
| Q1 | 展開予測は画面から全部消す（AI予想タブの発走前・確定後、一覧の的中バッジ、`/accuracy`・`/races` の展開予測の数字、「約79%」の文言、シェア文、AIコピー）。計算（turnPrediction）は残し、利用先を spec で列挙して残す理由を書く。`/accuracy` はイン崩れ注意度の帯ごとの実績ページに作り替え、`/hit-races` は `/accuracy` へ301。自然検索の上位2記事（rough-race-signals・first-mark-prediction-guide）と `/about` は公開と同時に書き直す。残りのブログ（ja 41本・4言語65ファイル）と動画13作品は別チケット | [fan-panel-scope.md](./fan-panel-scope.md)、[second-opinion-q1-q3.md](./second-opinion-q1-q3.md) 指摘8 |
| Q2 | 平均ST を直近30走に替えるのはイン崩れ注意度だけ。統合モデルの入力は別チケット | [analysis/round1.md](./analysis/round1.md)（平均ST はほぼ効かないので、表示の名前と値をそろえる扱い） |
| Q3 | イン崩れ注意度の主役は「類似レース（全国・400件）で1号艇が1着を逃した割合」（件数・基準つき）。0〜100 の指数はやめる。思考アシスト「堅い？荒れる？」の見出しの値も同じ値にする（万舟のバー・級の並びの絵はモックで決める） | [analysis/round2.md](./analysis/round2.md)、second-opinion 指摘1・2・10・11 |

ユーザーの補足（2026-10-12）: 「本日のデータ（`/today`）のところは影響範囲が大きそう」→ [today-impact.md](./today-impact.md) で洗い出す。
