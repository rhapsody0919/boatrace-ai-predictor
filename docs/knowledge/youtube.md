# YouTube 固有の知見

YouTube（Shorts 含む）の投稿・タイトル・構成に固有の知見。複数チャネルに共通する内容は glossary.md・number-wording.md・video-composition.md・fan-reactions.md に書く。書き方は [README.md](README.md)。

## タイトル・構成
- タイトルは「〇〇を比較」のような説明型にしない。冒頭の発見どうしのぶつかり（例: 1号艇302勝 vs モーター1位の4号艇）を「それでも〜を見る理由」の形で示し、動画が答えを回収できる問いにする（2026-10-13、オーナーが若松12Rの説明型タイトルを「弱い」と判断し hq 案を採用）
- 同じ BGM・同じ構図の画像・AI の台本で大量に投稿すると、YouTube のスパムポリシーの違反例に当たる。毎日の型の投稿では、レースごとのデータの発見を主役にし、冒頭・BGM を変える（2026-10-06、memory project_ai_multi_venture_ops_2026_10_05）
- 長い題を上限で切るときは句の区切りで切って「…」を付け、本編と Shorts で切り方をそろえる。旧の全貌の作り手は youtube_full.title を100字で「…」なしに切り、Shorts は89字＋「…」でそろっていなかった（2026-10-18、youtube-channel。受け取り側 push-full-picture.js は100字以下かだけを見るので、ちょうど100字に切った題は通る。2026-10-20 整理）
- 概要欄に章の名前だけを並べても YouTube の自動チャプターにならない。0:00 から始まる時刻を付ける（2026-10-18、youtube-channel。旧の全貌の作り手の指摘を一般化、2026-10-20 整理）
- YouTube のギャンブル関係の調査は「予想は当たることを保証しない」旨の免責を題・説明文に入れることを推奨（確度中）（2026-10-18、youtube-channel、docs/reference/youtube-algorithm-and-growth-notes.md 157行目。旧の作り手に入っていない旨の記録は 2026-10-20 に整理）

## API の認可
- YouTube Data API の OAuth クライアントは「ウェブ アプリケーション」型で作り、承認済みリダイレクト URI に https://developers.google.com/oauthplayground を足す。「デスクトップ アプリ」型は redirect_uri_mismatch になる。External/Testing の同意画面は認可するアカウントをテストユーザーに足す（2026-09-02、memory content_pipeline_youtube_oauth_setup_2026_09_02）
- YouTube は Data API v3 の正規のアップロードで自動投稿できる（承認→公開、api/admin/sns-hub/drafts/[id]/publish-youtube.js）（2026-09-02、memory content_multi_channel_pipeline_2026_09_01）

## 点検での見落としを防ぐ知見
- タグありの承認snapshotと送信payloadのdescription・snippet.tagsを対応させ、成功fixtureだけで承認タグが送られたとしない。（2026-10-13、2026-10-13-plan-review-youtube-20261013-01.md）
- v1 素材の容量制約と既存の本人承認 job の容量制約は範囲が違う。新 snapshot の生成上限を揃えても、保存済み承認 job の適用判断は別に残る（2026-10-13、2026-10-13-plan-review-20261013-10.md・2026-10-13-plan-review-20261013-23.md）
- 提案中の ADR・実装者の申告・オーケストレーター判断を、既存の承認範囲を狭めるオーナー決定の証拠にしない（2026-10-13、2026-10-13-plan-review-20261013-10.md・2026-10-13-plan-review-20261013-23.md）
- 媒体上限を共通 snapshot で変えると、動画だけでなく任意カバーの JS 上限も変わる。動画・カバー各々の SQL 上限と合計容量を分けて照合する（2026-10-13、2026-10-13-plan-review-20261013-23.md）
- 競合チャンネル一覧はID発見に使い、本人案内とYouTube側の表示名で対応を確認する。同じIDの旧名・番組名は二重登録しない。（2026-10-19、2026-10-19-competitor-discovery.md）
- 縦または正方形で3分以下の動画は Shorts として扱われる。全貌の完全版を通常の動画で出すため、尺 185秒以上を機械の検査にした（qa.machine.full_min185s）。仕様は確度中で、実機で確かめる（2026-10-20、youtube-channel、bundle.mjs）
- 完全版の題名は「〜と〜の比較・傾向」の説明型にせず、「【会場R・日付 ボートレース】1号艇は堅い？ 会場の1着率は全国より高い」のように、問いとその日の向きを入れる。概要欄の1行目は、モバイルで折りたたまれる前に見えるので「ボートレース」とその日の発見を置く。章の並びの文は、実際に作った章から組み立てる（大村11R は「軸」の章が無かった）（2026-10-20、youtube-channel・wording-editor、bundle.mjs）
- 自動チャプターの条件は、0:00 から・3つ以上・昇順・各章10秒以上。実ファイルの尺で検査する（qa.machine.chapters）（2026-10-20、youtube-channel、bundle.mjs の chaptersOk）
