# ADR 0043: 企画型パイプラインでのAI用プロンプト再現方法

## ステータス
採用

## 背景
企画型パイプライン（`docs/design/sns-hub-campaign-pipeline/spec.md`）は、対象レースについて既存の「AI用プロンプトコピー機能」（`useAiCopyText.js`、BOA-194）と同じ内容のプロンプトをRoutine（Node.jsスクリプト）側で組み立てる必要がある。

`useAiCopyText.js`のデータ取得（`useRaceAnalysisData`フック経由、`src/services/supabaseDataService.js`の各`getRaceXxxBreakdown()`）は、フロントエンド用のSupabaseクライアント（anon key、モジュールスコープの単一インスタンス）に直接依存しており、クライアントを注入できる設計になっていない。Node.jsスクリプトは`scripts/lib/supabaseClient.js`（service role key）を使うため、このままでは共有できない。

## 決定
`scripts/lib/campaignPromptBuilder.js`を新設し、`useAiCopyText.js`が使うのと同じテーブル・RPC（`race_entries`、`get_race_technique_profile_breakdown`等）を、`scripts/lib/supabaseClient.js`から独立して呼び出す。行のフォーマット処理（`buildRows()`相当）は`useAiCopyText.js`から関数を`export`し、スクリプト側からimportして再利用する（この部分はReactに依存しない純粋関数のため共有可能）。プロンプト文言自体（`AI_COPY_PROMPT_TYPES.TRIFECTA`）も`src/utils/aiCopyPrompts.js`からそのままimportする。

クエリ部分（RPC呼び出し）のみ重複が発生するが、呼び出し先のRPC自体はサーバー側の単一の実装であり、フロントエンドとスクリプトという2つの独立した呼び出し元が存在するだけで、集計ロジックの二重実装ではない。

## 却下した選択肢
**案A: `supabaseDataService.js`の各メソッドをクライアント注入可能にリファクタリングする**
DRYの観点では望ましいが、`supabaseDataService.js`は3,700行超・多数のページ/コンポーネントから参照される中核ファイルであり、このためだけに広範囲のリファクタリングを行うのはリスクに見合わない。KISS/YAGNIを優先する。

**案B: ヘッドレスブラウザ（Playwright）で実際のAI用プロンプトコピー機能をUI操作し、コピー結果を取得する**
ユーザー体験を完全に再現できる利点はあるが、日次バッチで実行するには速度・安定性のコストが高い。既存のPlaywrightは「フロントエンド変更の確認」用途であり、本番データ取得の常用経路としては想定されていない。

## 影響
- RPC呼び出しコード（`race_entries`・`race_technique_profile_breakdown`等の取得部分）がフロントエンドとスクリプトの2箇所に存在する状態になる。将来RPCのインターフェースが変わった場合、両方の更新が必要になる点は技術的負債として認識しておく
- `useAiCopyText.js`の`buildRows()`をexportする変更は、既存のUI動作に影響を与えない（関数のエクスポートのみ、ロジック変更なし）
