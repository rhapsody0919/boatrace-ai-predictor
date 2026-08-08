# レースページ再設計 screens

spec: `spec.md` / plan: `plan.md`

## 影響する画面・コンポーネント一覧

| 画面/コンポーネント | 種別 | 内容 |
|---|---|---|
| `src/components/race/DataRaceTable.jsx` + `.css` | **新規** | データ出走表。転置テーブル（行=指標、列=6艇）。`useRaceAnalysisData`でデータ取得、行ラベルから`/winning-technique`各タブへディープリンク。基本行（級別・勝率）は`prediction.allPlayers`から即時表示 |
| `src/components/race/AiAnalysisSection.jsx` + `.css` | **新規** | 「🤖 AIデータ分析」折りたたみラッパー。ヘッダに本命サマリー（N号艇 選手名）常時表示。childrenとして既存AI予想ブロック群を無変更で内包 |
| `src/components/race/RaceReview.jsx` + `.css` | **新規** | データで振り返る。`prediction.result.finished`時のみ表示。勝者×分析データの機械的照合（整合/相違の2分類）+ AI検証 |
| `src/hooks/useRaceAnalysisData.js` | **新規** | 分析関数6本のPromise.allSettled並列取得フック |
| `src/components/race/PredictionPanel.jsx` | 変更 | 並び替え: 公式リンク→DataRaceTable→AiAnalysisSection（既存ブロック内包）→シェア→攻略ガイド |
| `src/components/race/PredictionSection.jsx` | 変更 | RaceResult直後にRaceReviewを追加 |
| `src/components/race/index.js` | 変更 | barrel exportに新規3コンポーネント追加 |
| `src/locales/{ja,en,zh-TW,ko}/common.json` | 変更 | `dataTable.*` / `aiSection.*` / `review.*` キー追加 |
| `e2e/smoke.spec.js` | 変更 | 新セクションのスモークテスト追加 |
| App.jsx / RaceDetail.jsx | **無改修** | PredictionSection/PredictionPanel共通化済みのため |

## 再利用の方針（component-reuse.md準拠）

- 転置テーブルのレイアウトパターンは`AttackDefenseTable`を参考にするが、データ構造・セル表現が異なるため新規コンポーネントとする（無理な共通化はしない）
- 既存AI予想ブロック群は1行も変更せず、ラッパーで包むだけ
- デザイントークンで表現できる部分: 色・スペーシング・角丸・フォントサイズ全て。新規CSSは転置テーブルのグリッド構造とセル状態クラスのみ

## ワイヤーフレーム（レース選択後）

```
┌──────────────────────────────┐
│ 📊 多摩川 3R                  │
│ [公式サイトで出走表を見る]      │
├──────────────────────────────┤
│ 📋 データ出走表                │
│ ┌────────┬──┬──┬──┬──┬──┬──┐ │
│ │指標＼艇  │1 │2 │3 │4 │5 │6 │ │
│ │級別/勝率 │A1│B1│..│  │  │  │ │
│ │モーター  │38│52│..│  │  │  │ │←行内1位をハイライト
│ │調子Δ    │↑ │↓ │..│  │  │  │ │
│ │ST安定   │  │  │  │  │  │  │ │
│ │展示T    │  │  │  │  │  │  │ │
│ │決まり手型│逃 │差 │..│  │  │  │ │
│ │回収率   │84%│122%│..│ │  │  │ │
│ └────────┴──┴──┴──┴──┴──┴──┘ │
│ ※各行ラベル→分析ツール該当タブ  │
├──────────────────────────────┤
│ 🤖 AIデータ分析  本命:4号艇 ▼  │←折りたたみ（デフォルト閉）
│ （展開すると既存の予想UI一式）   │
├──────────────────────────────┤
│ [結果確定後のみ]               │
│ レース結果（既存RaceResult）    │
│ 🔍 データで振り返る            │
│  ✅ データと整合した点          │
│   ・決まり手「まくり差し」は勝ち │
│     パターン1位(40%)と一致     │
│   ・モーター2連率はレース内1位   │
│  ⚠️ データと違った点           │
│   ・調子Δはマイナスだった       │
│  🤖 AI検証: 本命1号艇→不的中。 │
│   勝った4号艇は決まり手型・     │
│   モーターのデータが示していた   │
└──────────────────────────────┘
```
