# SNS動画のブランドガイドライン

SNSマーケティングハブPhase 2（`docs/design/sns-hub-phase2-pdca-loop/`）で生成Routineが新規のRemotionコンポジションを自律的に試作する際、最低限守るべきブランド要素をまとめる。試作前に必ず参照すること（spec.md要件7、ADR 0029）。

このドキュメントは「最低限のガードレール」であり、デザインの自由度を過度に縛ることを意図していない。新規ビジュアル・コンポジションの試作自体は自律的に行ってよい（`docs/operation/sns-marketing-strategy.md`「SNSマーケティングハブ Phase 2設計方針」参照、投稿前の人間承認フローが最終防波堤のため）。

## 艇番カラー（`BOAT_COLORS`）

`src/utils/colors.js`で定義されている公式カラー。艇番を表示する際は必ずこの配色を使う（独自の配色を作らない）。

| 艇番 | 背景色 | 文字色 | 色名 |
|---|---|---|---|
| 1 | `#ffffff` | `#000000` | 白 |
| 2 | `#000000` | `#ffffff` | 黒 |
| 3 | `#e53935` | `#ffffff` | 赤 |
| 4 | `#1e88e5` | `#ffffff` | 青 |
| 5 | `#fdd835` | `#000000` | 黄 |
| 6 | `#43a047` | `#ffffff` | 緑 |

Remotion側（`sns-video-studio/remotion/`配下）では`src/utils/colors.js`を直接importできないため、既存コンポジション（`LivePredictionHookCM.jsx`等）と同じ値を複製して使う。値を変更する場合は本ドキュメントと`src/utils/colors.js`の両方を更新する。

## ロゴ・キャラクター

- **ロゴ**: `public/logo.png`（金の龍のロゴ）。X・TikTokのプロフィール画像として現行使用中（2026-08-23リブランド時に統一）
- **マスコットキャラクター**: 龍神をモチーフにした複数候補（A'/B'/C'等）が動画内に登場する。プロフィール画像自体はロゴで統一し、マスコットは動画出演のみに使う方針（`docs/operation/sns-marketing-strategy.md`「マスコットキャラクター施策」参照）
- 新規コンポジションでキャラクターを使う場合、既存のマスコット素材（`sns-video-studio/remotion/public/mascot-*.png`等）を流用する。新しいキャラクターデザインを勝手に作らない

## トーン・配色の統一方針

- **GOLD統一のトーン**: 会場攻略型で確立した「非対称配置・実データ背景・ベタ塗り帯・GOLD統一」のデザイン思想（`docs/operation/sns-marketing-strategy.md`「動画カバー画像（frame=0）デザイン」参照）を、新規フォーマットでも基調として踏襲する
- 動画のカバー画像（frame=0）は、投稿一覧のサムネイルとしてそのまま使われる（X標準UIにカバー編集機能が無いため）。frame=0で主要な情報・ブランド要素が視認できる状態にする

## 用語・表記ルール（`risk-rules.json`と連動）

新規コンポジションが表示するテキストは、`sns-video-studio/remotion/risk-rules.json`のルールに抵触しないこと。主なルール:

- 「競艇」表記は禁止（「ボートレース」で統一。役所広告の出稿対象から外れるため、`.claude/rules/code-style.md`参照）
- 廃止済みの旧3モデル体系名（「本命狙い」「スタンダードモデル」「穴狙い」「今日のおすすめ」等）を使わない
- 射幸心を煽る表現（配当倍率・金額を主役にする演出、「儲かる」等）を避ける
- TikTok/YouTubeでは「本命」「対決」「VS」等、賭け事を直接連想させる言葉・構図も避ける（Xは対象外）

ルールの最新版は必ず`risk-rules.json`本体を参照する（本ドキュメントは概要のみで、機械チェックの正とはしない）。

## 関連ドキュメント

- `docs/reference/design-system.md`: Webアプリ全体のデザイントークン（本ドキュメントはSNS動画向けの抜粋・補足）
- `docs/operation/sns-marketing-strategy.md`: ブランド関連の意思決定ログ（リブランド経緯、マスコット施策、カバー画像デザイン等）
- `sns-video-studio/remotion/risk-rules.json`: 用語・表現ルールの機械可読な正
