# note 固有の知見

note.com の記事・コンプライアンス表現に固有の知見。複数チャネルに共通する内容は glossary.md・number-wording.md・fan-reactions.md に書く。書き方は [README.md](README.md)。

## コンプライアンス
- note の公開済み2記事の「確実に増やす」「稼ぐロードマップ」「再現性重視」は利益保証表現として記録し、様子見としていた（2026-09-05 ユーザー判断、memory note_compliance_flag_watch_2026_09_05。元は glossary.md「誇大・保証・射幸心・SNS の規則」より移動）。2026-10-27 にオーナーがこの2記事を非公開にして運営へ問い合わせると決めた（hq drafts/note-channel-20261027.md 75cb334）
- note.com/boatai は全記事・プロフィールに noindex, nofollow が付き、Google と note 内の検索から外れている。同ジャンル45アカウントは索引あり、規約 10.1 の措置の見込み。解除までは note の記事を作らない（2026-10-27 オーナー決定、hq の調査 drafts/note-channel-20261027.md 75cb334）

## SEO
- note は canonical を書き手が指定できず、本文のリンクは nofollow。blog の全文転載は boat-ai.jp の SEO に効かないので、note に「blog の再配信による SEO」の役を置かない（2026-10-27、hq の調査 drafts/note-channel-20261027.md 75cb334）

## 投稿
- note の公開は最後まで手でコピペする。Routine は本文・タグ・画像か YouTube リンクの完成形を用意するまで（2026-09-02 ユーザー判断、memory content_multi_channel_pipeline_2026_09_01）
- note の下書きには画像か動画を最低1枚入れる。文章だけの下書きは質が低いと指摘された（2026-08-31 オーナー、memory note_posting_operations_2026_08_31）
- note のエディタは「## 」「### 」「1. 」を見出し・番号付きリストに自動で変える。![alt](url) は変換されず文字のまま残るので、画像はアップロードの UI から入れる（2026-08-31、memory note_posting_operations_2026_08_31）
- 動画の作り直しを起票する根拠には、完成動画とその欠点の証拠が要る。実装ファイル（NoteExplainer 等）や文章の下書きがあるだけでは起票しない（動画が存在しないという断定ではない）（2026-10-13、2026-10-13-plan-2128.md）
