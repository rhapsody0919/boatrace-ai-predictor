# 龍神レーダーの知見（正本）

話題別の知見ノート。`.claude/agents/` の専門役・`discussion-panel`・各レーンが最初に読む。正本はここ1か所で、写しを作らない（2026-10-12 に役割別のノートと hq の `knowledge/ryujin/` をここへまとめた）。

## 話題ファイル

| ファイル | 中身 | 主に読む役 |
|---|---|---|
| [stat-findings.md](stat-findings.md) | 統計検証の結果の索引（各行に元の読み物のパス） | data-scientist |
| [data-definitions.md](data-definitions.md) | 公式データの仕様、数値の出典と母集団、生データの所在 | official-data-spec・data-scientist |
| [number-wording.md](number-wording.md) | 数字の言い方（母数・範囲・全国と個人・未検証の付け方） | wording-editor・visual-designer・ファンパネル |
| [glossary.md](glossary.md) | 用語と禁止語、誇大・保証・射幸心、SNS の表現の可否 | wording-editor・ファンパネル |
| [fan-reactions.md](fan-reactions.md) | オーナーとファン役が SNS・ブログ・画面で良し悪しとしたこと | ファンパネル・visual-designer |
| [video-composition.md](video-composition.md) | SNS 動画の構成・画面配置・字幕・動き・音 | visual-designer |
| [ui-layout.md](ui-layout.md) | サイトの画面の決まり（幅・押せる大きさ・余白・置き場所） | visual-designer |
| [measurement.md](measurement.md) | 計測の設計と GA4 | measurement-planner |
| [db-operations.md](db-operations.md) | ADR と番号、本番 DB の運用、Supabase の読み方 | system-architect |
| [seo.md](seo.md) | 検索・ボット向け HTML・ブログの SEO（SPA の制約、食い合い） | seo-marketer |
| [user-insights.md](user-insights.md) | オーナーがサイトを使って気づいたことと、その後の対応 | 全員（画面を変える前） |
| [x.md](x.md) | X（旧Twitter）固有の投稿・動画の知見 | X 運用（`/x-growth-report`等） |
| [youtube.md](youtube.md) | YouTube（Shorts 含む）固有のタイトル・構成の知見 | YouTube 運用 |
| [note.md](note.md) | note.com 固有の記事・コンプライアンスの知見 | note 運用（`/note-growth-report`等） |

## 書き方
- 1行1知見。行末に（日付、根拠）。根拠は誰の指摘か・出典のパス（リポジトリ内）。一時フォルダのパスは出典にしない
- 1ファイル500行未満。超えそうなら話題を分け、この表に足す
- 同じ知見は1か所に書く。別の話題から使うときはファイル名で指す
- 古くなった項目は消し、置き換える行に「（日付の『…』を置き換え）」と書く
- 鍵・個人情報は書かない
- 書き足すのは呼んだ側。専門役・ファンパネルが答えの最後に出す「知見ノートに足す行」を、話題に合うファイルへ書く

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
