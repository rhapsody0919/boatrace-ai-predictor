# 龍神レーダーの知見（正本）

話題別の知見ノート。`.claude/agents/` の専門役・`discussion-panel`・各レーンが最初に読む。正本はここ1か所で、写しを作らない（2026-10-12 に役割別のノートと hq の `knowledge/ryujin/` をここへまとめた）。

## 話題ファイル

| ファイル | 中身 | 主に読む役 |
|---|---|---|
| [stat-findings.md](stat-findings.md) | 統計検証の結果の索引（各行に元の読み物のパス） | data-scientist |
| [data-definitions.md](data-definitions.md) | 公式データの仕様、数値の出典と母集団、生データの所在 | official-data-spec・data-scientist |
| [data-columns.md](data-columns.md) | DB の列・テーブルの読み違い、公式ファイル・公式ページの取得の時点、オッズ | official-data-spec・data-scientist・system-architect |
| [number-wording.md](number-wording.md) | 数字の言い方（母数・範囲・全国と個人・未検証の付け方） | wording-editor・visual-designer・ファンパネル |
| [glossary.md](glossary.md) | 用語と禁止語、誇大・保証・射幸心、SNS の表現の可否 | wording-editor・ファンパネル |
| [fan-reactions.md](fan-reactions.md) | オーナーとファン役が SNS・ブログ・画面で良し悪しとしたこと | ファンパネル・visual-designer |
| [video-composition.md](video-composition.md) | SNS 動画の構成・画面配置・字幕・動き・音 | visual-designer |
| [video-qa.md](video-qa.md) | SNS 動画の検査・合格判定・計画と承認の扱い | visual-designer・動画の評価役 |
| [ui-layout.md](ui-layout.md) | サイトの画面の決まり（幅・押せる大きさ・余白・置き場所） | visual-designer |
| [ui-implementation.md](ui-implementation.md) | 画面の実装の落とし穴（CLS・部品の埋め込み・状態の共有・機能変更で古くなるもの） | visual-designer・実装者 |
| [i18n.md](i18n.md) | 多言語の実装の落とし穴と言語ごとの検索の需要 | 多言語のページ・記事を触る人 |
| [measurement.md](measurement.md) | 計測の設計と GA4 | measurement-planner |
| [db-readonly.md](db-readonly.md) | 読取専用ロール・権限検査・読取CLI | system-architect・実装者 |
| [db-operations.md](db-operations.md) | ADR と番号、本番 DB の運用、Supabase の読み方 | system-architect |
| [sns-send-ops.md](sns-send-ops.md) | SNS 自動送信（承認・runner・通知・容量・cron）の運用と点検 | system-architect・実装者 |
| [batch-and-ci.md](batch-and-ci.md) | 定時実行・API のキャッシュ・Vercel・CI と E2E の落とし穴 | system-architect・実装者 |
| [seo.md](seo.md) | 検索・ボット向け HTML・ブログの SEO（SPA の制約、食い合い） | seo-marketer |
| [user-insights.md](user-insights.md) | オーナーがサイトを使って気づいたことと、その後の対応 | 全員（画面を変える前） |
| [x.md](x.md) | X（旧Twitter）固有の投稿・動画の知見 | x-channel・X 運用（`/x-growth-report`等） |
| [youtube.md](youtube.md) | YouTube（Shorts 含む）固有のタイトル・構成の知見 | youtube-channel・YouTube 運用 |
| [note.md](note.md) | note.com 固有の記事・コンプライアンスの知見 | note 運用（`/note-growth-report`等） |

## 書き方
- 1行1知見。行末に（日付、根拠）。根拠は誰の指摘か・出典のパス（リポジトリ内）。一時フォルダのパスは出典にしない
- 1ファイル500行未満。超えそうなら話題を分け、この表に足す
- 1ファイル 15KB を目安にする。超えたら同じ趣旨の行をまとめる
- 足すのは毎日の差分案（hq の knowledge-harvest、22:30）からを基本にする。各セッションは完了報告・PR 本文の「## 知見の候補」に書き、直接足すのは急ぐときだけにする
- 同じ知見は1か所に書く。別の話題から使うときはファイル名で指す
- 古くなった項目は消し、置き換える行に「（日付の『…』を置き換え）」と書く
- 鍵・個人情報は書かない
- 書き足すのは呼んだ側。専門役・ファンパネルが答えの最後に出す「知見ノートに足す行」を、話題に合うファイルへ書く
- 知見の差分をまとめるときは、入力の候補の単位と追加する行の単位を決め、全候補の採否・重複先・確認待ちを台帳に残す（2026-10-13、2026-10-13-task-73-knowledge-merge.md・PR #1524）
- 作業場所の写しと指定の土台に差があるときは、新しい側の行を無断で移さず、読んだ両方・土台・移植しない行を明記する（2026-10-13、2026-10-13-task-73-knowledge-merge.md）
- 記憶（memory）から移した行の根拠は「memory 記憶ファイル名」でリポジトリの外を指す。記憶を消す前に、元の PR・BOA・パスで追えるか確かめる（2026-10-13、PR #1528）

- 差分作成前に作業場所のknowledge/とrefのdocs/knowledge/の版・内容差を確認し、指定された土台と異なる版を採る必要がある場合は理由を報告して判断を求める。（2026-10-19、2026-10-18-task-76-knowledge-merge.md）
- 報告・PRの「知見の候補」は候補が無いときは「なし」の1行とし、話題ファイルごとの同じ再確認を繰り返さない。（2026-10-19、2026-10-18-task-76-knowledge-merge.md）

## 旧ファイルとの対応（2026-10-12 まで）

古い記録（`docs/design/**` のファンパネル等）にある旧パスはこの表で読み替える。

| 旧 | 新 |
|---|---|
| docs/knowledge/data-scientist.md | stat-findings.md（検証結果）・data-definitions.md（進入の列） |
| docs/knowledge/official-data-spec.md | data-definitions.md（平均ST の名前の付け方は number-wording.md） |
| docs/knowledge/visual-designer.md | video-composition.md（SNS 動画）・ui-layout.md（サイトの画面） |
| docs/knowledge/sns-fan.md | fan-reactions.md（表現の可否は glossary.md、数字の言い方は number-wording.md） |
| docs/knowledge/wording-editor.md | glossary.md |
| docs/knowledge/measurement-planner.md | measurement.md |
| docs/knowledge/system-architect.md | db-operations.md |
| hq knowledge/ryujin/boatrace-fan.md | fan-reactions.md・number-wording.md・glossary.md・video-composition.md |
| hq knowledge/ryujin/designer.md | video-composition.md・number-wording.md |
| hq knowledge/ryujin/data-scientist.md | stat-findings.md・data-definitions.md |
