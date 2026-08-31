# SNSハブ管理画面 UX改善（承認フロー・フォーマットカタログ・フィードバック恒久化）

## 種別

UI機能（`/admin/sns-hub`の画面・コンポーネント変更を含む）。この後 `/step1-screens` に進む。

## 対応チケット

なし（ユーザーからの直接フィードバックを起点にSDDフローで仕様化）

## 背景

ユーザーが実際に管理画面(`/admin/sns-hub`)を使う中で4つの課題を報告し、天才マーケター・天才エンジニア・天才デザイナー・天才経営者・ファン4名の8人パネルで議論した結果、以下の対応方針で合意した。実装コードの調査（`src/pages/admin/SnsHubAdmin.jsx`、`api/admin/sns-hub/`、`docs/design/sns-marketing-hub/`、`docs/design/sns-hub-phase2-pdca-loop/`）で各課題の技術的原因を特定済み。

## 機能要件

### 1. 「一部修正」の送信ボタンが自由記述のみでは押せないバグを修正

**優先度**: 高（明確なバグ）

**現状の原因**: `SnsHubAdmin.jsx`の`RevisionPanel`で`canSubmit = mode === "redo" || reasonCodes.length > 0`となっており、`mode === "revise"`の場合は定型理由チップを1つ以上選ばない限り、自由記述(`freeText`)の内容に関わらず常に送信ボタンが無効化される。API側(`api/admin/sns-hub/drafts/[id]/revise.js`)も`reasonCodes`必須のバリデーションになっている。

**受入基準**:
- 定型理由チップを1つも選ばず、自由記述欄にのみテキストを入力した状態で送信ボタンが有効になる
- その状態で送信すると、API側でも400エラーにならず正常に処理される（`reasonCodes`または`freeText`のいずれか一方が入力されていれば送信可能なバリデーションに変更）
- 定型理由チップ・自由記述のどちらも空の場合は、従来通り送信ボタンは無効のまま

### 2. revise/redo実行後の処理状況を画面上で分かるようにする

**優先度**: 高

**現状の原因**: revise/redoを押すと元の下書きは即座に`revision_requested`ステータスになり承認/修正/作り直しボタンは非表示になるが、実際の新規下書き生成・旧下書きのarchived化は非同期Routine任せで、画面には完了を検知する仕組みが無い。ユーザーは「新しい下書きがいつ生成されるのか」「元の下書きがどうなるのか」が分からず不安を感じる。

**方針（ユーザー確認済み）**: リアルタイム自動更新（ポーリング等）は行わず、**手動更新ボタン**で最新状態を取得する方式とする。

**受入基準**:
- revise/redoを実行すると、元の下書きに「処理中」等、処理が進行中であることが分かるバッジ・表示が付く
- 「処理中」表示のある下書きは、（既存仕様通り）承認/修正/作り直しボタンは非表示のまま
- 画面に手動更新ボタンを設置し、押すと下書き一覧を再取得する（`loadDrafts()`の明示的な再実行）。更新後、Routineの処理が完了していれば新しい下書きが「承認待ち」に表示され、元の下書きは`archived`として区別される
- Routine処理がまだ完了していないタイミングで更新ボタンを押した場合、「処理中」表示のまま変化がない（エラーにはならない）
- `revision_requested`になってから一定時間（目安30分）経過している下書きには、「処理中」とは別に「時間がかかっています」等の警告表示を出す。Routineがセッションエラー・週間利用量上限等で新規下書きを生成できないまま止まっているケースを、ユーザーが「まだ処理中」と区別できないままにしない

### 3. 「フォーマットカタログ」タブを新設し、型・ペルソナ・デザイン・目的を一覧できるようにする

**優先度**: 中

**現状の原因**: 既存の「戦略メモ」タブはPhase 2のinsight PDCA（改善提案の判断待ち・履歴）専用であり、ユーザーが求めていた「どんなデザイン・型・ペルソナ・目的で投稿を生成しているか」という情報とは管轄が異なる。この情報は現状、DBの`sns_template_variants`テーブル（型の一覧のみ、機械的なメタデータ）と、`docs/operation/sns-video-producer-prompt.md`・`docs/operation/x-operations-playbook.md`・`docs/reference/sns-brand-guideline.md`等のドキュメント（ペルソナ選定ロジック・デザイン方針が文章で記述）に分散しており、管理画面からは確認できない。

**方針（ユーザー確認済み）**: 新設するカタログ画面は、DBの型一覧とドキュメント内容の両方を統合表示する。ドキュメント内容の統合方式は、Markdownを機械的にパースして構造化表示するのではなく、**該当ドキュメントへのリンク＋関連セクションの引用表示**を基本方針とする（天才エンジニア・天才SNSマーケター議論、2026-08-31）。自由形式の長文ドキュメントを完全に構造化パースするのは壊れやすく、ドキュメント更新のたびに追従コストが発生するため。

**受入基準**:
- 新規タブ（「戦略メモ」とは別）で、`sns_template_variants`の一覧（型名・フォーマット・作成者(human/routine)・稼働状態）が確認できる
- 同じ画面（または同タブ内のセクション）で、`docs/operation/sns-video-producer-prompt.md`・`docs/operation/x-operations-playbook.md`・`docs/reference/sns-brand-guideline.md`（Phase 2のRoutine権限=ADR 0029で新規コンポジション試作前の参照が必須とされている中核ドキュメント）へのリンクと、関連セクションの引用が確認できる
- ドキュメント内容の具体的な同期実装方式（リンク先セクションの特定方法等）は`/step2`（システム設計）で技術判断する

### 4. revise/redoの自由記述フィードバックを、選択した場合のみ恒久方針に反映できるようにする

**優先度**: 中

**現状の原因**: `revision_reason_freetext`は該当1件の再生成にのみ使われ、恒久的な生成方針（`sns_strategy_insights`等）に反映される仕組みが存在しない。

**方針（ユーザー確認済み）**: 自由記述を書いた後、ユーザー自身が「この指摘を今後の生成方針に反映する」を選択できるようにする。選択された場合のみ、`sns_strategy_insights`に`status='proposed'`で登録し、既存の週次insight昇格フロー（`scripts/maintenance/promote-strategy-insights.js`、risk-rules.json照合）にそのまま乗せる。`source`カラムに新しい値（`revision-feedback`等）を追加するスキーマ変更が必要。

**受入基準**:
- revise/redoの自由記述欄に、「この指摘を今後の生成方針に反映する」を選択できるチェックボックス（またはトグル）が表示される
- チェックした状態で送信すると、`sns_strategy_insights`に新規レコードが`status='proposed'`、`source='revision-feedback'`（新規追加するenum値）で登録される。`platform`/`format`/`language`は対象下書きの値を引き継ぐ
- `evidence`カラムには、元下書きの`content_group_id`と自由記述の指摘内容を含める。他のinsight（`/x-growth-report`等由来）と異なり調査エビデンスを伴わない「ユーザーの一言」であるため、週次昇格判断時に人間が元の文脈（どの下書きへの、どんな指摘か）を追えるようにする（天才SNSマーケター指摘、2026-08-31）
- チェックしない場合は、従来通り単発の再生成コンテキストとしてのみ使われ、`sns_strategy_insights`への登録は行われない
- 週次のinsight昇格判定（Monday実行の`promote-strategy-insights.js`）は`source`の値を問わず既存ロジックのまま動作する（`revision-feedback`由来のinsightも他のinsightと同じ基準でactive/retired判定される）

### 5. ダウンロードボタンを押すと動画が再生されてしまう問題を修正

**優先度**: 高（明確なバグ）

**現状の原因**: `PostingActionLinks`の`<a href={draft.video_url} download>`が指す`video_url`はSupabase Storageの署名付きURLであり、管理画面(`www.boat-ai.jp`)とは別オリジン。HTML仕様上、`download`属性はクロスオリジンのURLに対してはブラウザに無視されるため、クリック時にリンク先URLへ直接遷移し、ブラウザの標準動画再生UIが表示されてしまう。PC・モバイル（Android等、Web Share非対応環境）の両方で同様に発生しうる。

**受入基準**:
- ダウンロードボタンを押すと、動画が再生されることなく、ファイルとしてダウンロードが開始される（PC・モバイル問わず）
- 実装方式: fetchで動画データをBlobとして取得し、同一オリジンのblob URLを経由して`<a download>`をトリガーする（クロスオリジンのdownload属性制約を回避する標準的な方法）。`src/utils/webShare.js`の`canShareVideo`と同じfetch+blobパターンを踏襲する
- fetch完了までダウンロードが開始されないため、ボタンにローディング表示を出す（動画ファイルサイズによっては数秒かかりうる。反応が無いことで「押せていない」と誤解されないようにする）
- 既存のiOS Safari向け「共有して投稿」ボタン（Web Share API、`canShareVideo`判定）の挙動・分岐条件は変更しない。あくまでWeb Share非対応環境（iOSでシェア不可の場合・Android・PC）のフォールバックである「ダウンロード」ボタンのみを対象とする
- fetch失敗時（ネットワークエラー等）は、既存の`copyFeedback`と同様のインラインエラーメッセージを表示する

## スコープ

### やること
- 上記5機能要件（バグ修正2件、UX改善1件、新規タブ1件、フィードバック恒久化1件）
- `sns_strategy_insights.source`のenum値追加（マイグレーション）

### やらないこと
- revise/redo完了のリアルタイム自動検知（WebSocket・ポーリング）——手動更新ボタンのみとする
- 「フォーマットカタログ」のドキュメント内容を自動同期する仕組み化（Markdown変更検知・自動反映パイプライン等）——複雑な自動化は作らない。表示方式はstep2で判断するが、シンプルな実装を優先する
- insight自動昇格ロジック（risk-rules.json照合等）自体の変更——既存フローに新しい`source`を追加するのみ
- 既存のinsight PDCAループ（`/x-growth-report`・`/tiktok-growth-report`）の変更——影響なし

## 非機能要件

- 課題5（ダウンロードボタン修正）はPC・モバイル（Android Chrome等）の両方で動作すること。iOS Safariは既存のWeb Share分岐が優先されるため対象外
- それ以外は特になし（内部管理画面、Basic認証の既存ユーザーのみが対象。既存の`/admin/sns-hub`のモバイル対応方針をそのまま踏襲し、新たな数値要件は設けない）

## 制約・前提

- 既存コンポーネント再利用: `RevisionPanel`・`DraftCard`・`InsightTab`等、既存の`SnsHubAdmin.jsx`内コンポーネントのパターンを踏襲する（`.claude/rules/component-reuse.md`）
- データ源: 課題1・2は`sns_drafts`テーブル（既存）。課題3は`sns_template_variants`テーブル（既存）＋`docs/operation/sns-video-producer-prompt.md`・`docs/operation/x-operations-playbook.md`等のドキュメント。課題4は`sns_strategy_insights`テーブル（既存、`source`カラムにenum値を追加）
- 法的制約: 該当なし（内部管理画面）
- 用語ルール: 「競艇」使用禁止等、既存ルールをそのまま適用

## 未確定事項

| # | 項目 | 内容 | いつ・誰が決めるか |
|---|------|------|---------------------|
| 1 | フォーマットカタログのドキュメント同期方式 | Markdownを都度サーバー側でfetch・パースして表示するか、構造化データ（DBまたは設定ファイル）として抽出し手動更新する運用にするか | `/step2`（システム設計）でClaudeが技術判断し提示、必要ならユーザー確認 |
| 2 | 「処理中」バッジのラベル文言・具体的なUI配置 | ステータス表示の具体的な文言・デザイン | `/step1-screens`で画面設計として確定 |
| 3 | insight登録時の`platform`/`format`/`language`が特定できないケースの扱い | 対象下書きに値が無い場合の挙動（起こりうるか含めて要確認） | `/step2`で確認、必要なら`/step1-screens`にフィードバック |
| 4 | `sns_strategy_insights.source`の実DB型 | ネイティブENUM型かCHECK制約かで値追加の実装方法・将来の変更容易性が変わる（天才エンジニア指摘、2026-08-31） | `/step2`でスキーマ確認 |
