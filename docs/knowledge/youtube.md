# YouTube 固有の知見

YouTube（Shorts 含む）の投稿・タイトル・構成に固有の知見。複数チャネルに共通する内容は glossary.md・number-wording.md・video-composition.md・fan-reactions.md に書く。書き方は [README.md](README.md)。

## タイトル・構成
- タイトルは「〇〇を比較」のような説明型にしない。冒頭の発見どうしのぶつかり（例: 1号艇302勝 vs モーター1位の4号艇）を「それでも〜を見る理由」の形で示し、動画が答えを回収できる問いにする（2026-10-13、オーナーが若松12Rの説明型タイトルを「弱い」と判断し hq 案を採用）
- 同じ BGM・同じ構図の画像・AI の台本で大量に投稿すると、YouTube のスパムポリシーの違反例に当たる。毎日の型の投稿では、レースごとのデータの発見を主役にし、冒頭・BGM を変える（2026-10-06、memory project_ai_multi_venture_ops_2026_10_05）

## API の認可
- YouTube Data API の OAuth クライアントは「ウェブ アプリケーション」型で作り、承認済みリダイレクト URI に https://developers.google.com/oauthplayground を足す。「デスクトップ アプリ」型は redirect_uri_mismatch になる。External/Testing の同意画面は認可するアカウントをテストユーザーに足す（2026-09-02、memory content_pipeline_youtube_oauth_setup_2026_09_02）
- YouTube は Data API v3 の正規のアップロードで自動投稿できる（承認→公開、api/admin/sns-hub/drafts/[id]/publish-youtube.js）（2026-09-02、memory content_multi_channel_pipeline_2026_09_01）
