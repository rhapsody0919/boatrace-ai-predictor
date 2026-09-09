# Xチャネル別パイプライン 制作ガイド

承認済みネタ（`sns_topics.status='approved'`）のうち、X向けに割り当てられた`sns_topic_targets`をポーリングして下書きを生成するRoutine向けの実行手順。設計背景は[`docs/design/sns-topic-gate/`](../design/sns-topic-gate/)（spec.md/plan.md、ADR 0036〜0038）を参照。チャネル別パイプライン分離の最初の1本（ADR 0037）として、note/blog/tiktok/youtubeへの展開時もこのドキュメントの構成をテンプレートにする。

**このRoutineはネタを自分で選定しない**。`sns-topic-proposer-weekly.md`・`sns-topic-proposer-daily-auto.md`・sns-hubの手動生成ボタン（日次・時間制約型、実装後）・企画型パイプライン（`scripts/daily/campaign-*.js`、`campaign_id`ありのネタ、後述「3'.」参照）のいずれかが作った承認済みネタを拾って生成するだけの、疎結合な下流工程。企画由来のネタは`sns-topic-proposer-daily-auto`とは無関係の別経路（このリポジトリ内のGitHub Actionsが自動生成）である点に注意（2026-09-09、ユーザーからの確認を受けて明記）。

## 実行トリガー

このRoutineは2つの起動方法を持つ。まず`<routine-fire-payload>`ブロックの有無を確認する。

- **無い場合（スケジュール起動）**: 定期ポーリング。以下「0.」以降にそのまま進む
  - 週次型（`venue-feature`）: 1時間おきのcronでポーリングする（2026-09-05、初期値の12時間おきから変更）。**企画型パイプラインのネタも`content_type_id`は`venue-feature`を流用しているため、この同じ周期で自然にポーリングされる**（`campaign_id`の有無で「3'.」の企画向け分岐に進む）
  - 日次・一般型（`daily-auto`）: 日次自動提案Routineの完了後にポーリングする（同じcron間隔でも自然に拾える）
  - 日次・時間制約型（`race-time-critical`）: このパイプラインでは扱わない。既存の`sns-hub-content-generation`（`sns-video-producer-prompt.md`）の手動生成ボタン系が担当する（type選択UIの実装後）
- **ある場合（API起動）**: ペイロードの`action`で分岐する
  - `redo`: `api/admin/sns-hub/drafts/[id]/redo.js`（ADR 0038、`resolveRoutineEnvPrefix`で`platform='x'`の下書きのみこのRoutineに発火する）からの修正指摘操作（2026-09-04、旧「一部修正」`revise.js`と統合済み）。ペイロード（`{action: 'redo', draftId, reasonCodes, freeText}`）を読み、下記「A'. 修正対応フロー」に進む（0.〜6.はスキップ）
  - `generate_now`: `api/admin/sns-hub/topics/[id]/targets/[targetId]/fire.js`（要件26、「⚡今すぐ生成」ボタン）からの即時生成リクエスト。ペイロード（`{action: 'generate_now', targetId}`）を読み、下記「A''. 即時生成フロー」に進む（0.はそのまま実施、1.をスキップして2.以降に進む）

### A'. 修正対応フロー（API起動時）

`sns-hub-content-generation`（`docs/operation/sns-video-producer-prompt.md`が担うRoutine）の同種フローと同じ設計思想を踏襲する。**軽微な修正か題材選定からのやり直しかは、`reasonCodes`/`freeText`の内容から自分で判断する**（2026-09-04、UI側で「一部修正」「全部作り直し」を分けて選ばせていたが実務上ほぼ全部作り直しになっていたため、UIの選択ステップを無くしRoutine側の判断に一本化した）:

- **軽微な修正で足りる場合**（誤字・トーン調整・デザイン指摘等、`reasonCodes`が`typo-or-data-error`/`tone-adjustment`/`design-*`等）: `draftId`の下書きを取得し、`reasonCodes`/`freeText`を反映して修正版を再生成する（3.以降と同じ映像設計・レンダリング手順）。新レコードをINSERT（`parent_draft_id`に元の`draftId`、`content_group_id`は元の下書きと同じ値を維持、`status: 'pending_review'`）し、元レコードを`status: 'archived'`・`archived_at`更新する
- **題材選定からやり直す場合**（`reasonCodes`に`format-or-topic-change`が含まれる、または`freeText`が「別のネタにしてほしい」等ネタそのものへの不満を示している場合）: 元の下書きに紐づく`sns_topic_targets`行を確認し、まだ`generated`のままなら`pending`に戻して1.のclaimを再実行する。対応する`sns_topic_targets`を`skipped`にし、人間に別ネタの承認を委ねてもよい
- 迷う場合は軽微な修正（前者）を優先する。安全側に倒すことで、意図せず全く別の題材が生成される事態を避ける

### A''. 即時生成フロー（API起動時、要件26）

対象は既に`status='pending'`であることがAPI側（`fire.js`）で検証済みの1件のみ。ポーリング起動の「1. claim対象の取得・claim」を丸ごとスキップし、`claimTopicTarget(targetId, routineRunId)`（`scripts/lib/snsTopics.js`）を`targetId`に対して直接呼ぶ。**戻り値がnullの場合**（ボタンを押した直後に通常ポーリングの別実行に先取りされた等）は、生成を行わずそのまま終了する（エラーではない、ADR 0036と同じ扱い）。claimに成功したら「2. ネタ本文・根拠insightの確認」以降は通常フローと同一。

## 0. 蓄積されたフィードバックの確認

- `getRecentRevisions({ platform: "x" })`（`scripts/lib/contentRevisionHistory.js`）で直近30日の修正依頼・却下理由を取得する
- `getActiveInsights({ platform: "x" })`（`scripts/lib/snsStrategyInsights.js`）でactiveな戦略insightを取得する
- どちらも該当が無ければ通常通り進めてよい

## 1. claim対象の取得・claim

1. `sns_target_accounts`から`platform='x'`のアカウントIDを取得する
2. `getClaimableTopicTargets(xAccountId)`（`scripts/lib/snsTopics.js`）で、claim可能な（承認済みネタに紐づくpending状態の）ターゲット一覧を取得する
3. このRoutine実行の一意な識別子（`routineRunId`）を1つ生成し、以降のclaim呼び出しすべてで使い回す
4. 取得した各ターゲットについて`claimTopicTarget(targetId, routineRunId)`（同ファイル）を呼ぶ。**戻り値がnullの場合は他のパイプライン実行に先取りされたということなのでスキップする**（エラーではない、ADR 0036）
5. claimに成功したターゲットのうち、**1回の実行で処理するのは1件まで**（頻度上限、トークン消費を抑えるため）。複数claimできてしまった場合は2件目以降を`pending`に戻す（`updateTopicTargetLabel`相当の操作、または単純に未処理のまま次回実行に委ねる）

claim対象が0件の場合はここで終了する（正常系、失敗ではない）。

## 2. ネタ本文・根拠insightの確認

`sns_topics`テーブルから、claimしたターゲットに紐づくネタ本文（`topic_text`）・型（`content_type_id`経由で`sns_content_types`）・根拠insight（`source_insight_ids`）を取得する。0.で確認済みのX向け却下理由・insightと合わせて、構成・訴求の判断材料にする。

### 企画（キャンペーン）由来のネタの場合

`sns_topics.campaign_id`が設定されている場合、単発ネタではなく複数日にまたがる企画の1エントリ（`docs/design/sns-hub-campaign-pipeline/`参照）。`getCampaignEntries(campaignId)`（`scripts/lib/snsCampaigns.js`）で同じ企画の過去エントリ（対象レース・買い目・実際の結果・払戻・通算収支）を取得し、**前回までの結果を踏まえた継続性のある本文**にする（例: 「◯日目、ここまで◯勝◯敗、通算収支◯円」）。過去エントリが0件（企画の1件目）の場合は、企画の趣旨・ルール（`sns_campaigns.purpose`）を紹介する導入回として書く。

このネタ自身が指す`sns_campaign_entries`行の`hit`が`null`（結果未確定）なら「事前の買い目発表」（運用フロー②）であり、まだ結果には触れられない。`hit`が確定済みなら「結果発表」（運用フロー③）または企画終了時の「最終まとめ」（運用フロー④、`campaign_status='completed'`）であり、`actual_result`・`payout_yen`・`cumulative_net_yen`を本文の中心に据える。`topic_text`自体に「結果発表」「企画終了まとめ」等の文言が含まれるため、どちらのネタかは`topic_text`を読めば判別できる。

**結果発表（運用フロー③）は「なぜ当たった/外れたか」も説明する（2026-09-09追加）**: `campaign-backfill-results.js`が`topic_text`に`✅整合: ...`・`⚠️不整合: ...`という形で、実データ（全国勝率・モーター2連率・展開予測）が実際の着順と合っていたか/違ったかの材料（`scripts/lib/campaignResultRetrospective.js`が生成）を埋め込んでいる。これはサイトのレース詳細ページ「データで振り返る」と同じ方法論（指標のレース内順位が上位/下位なら強気/弱気とみなし、実際の着順と突き合わせる）を簡易的に再現したもの。この材料をそのままキャプションに転記するのではなく、自然な日本語のプローズに書き直して「✅データと整合した点」「⚠️データと違った点」の2見出しで構造化する（サイトの見出し文言と統一する）。材料が空（該当する指標が無い等）の場合は無理に触れなくてよい。

## 3. 実データ取得・映像設計

**企画（キャンペーン）由来のネタの場合は、このセクションを丸ごとスキップし「3'. 企画由来ネタの画像生成」に進む。** 以下は非企画ネタ（通常の`venue-feature`/`daily-auto`型）向けの手順。

`sns-video-producer-prompt.md`で確立済みの技術手順をそのまま踏襲する（車輪の再発明をしない）。

- DBに実データがあることと、本番UIで実際に表示・再現できることは別物。台本確定前に必ずPlaywrightで実際の画面を確認する（同ドキュメント「制作フロー」2.参照）
- ネタの型に応じたフォーマットを選ぶ:
  - `venue-feature`型: `VenueRankingCM.jsx`の`VenueRankingTemplate`（ランキング・比較型）を優先して再利用する。**「最高値 vs 最低値」の2値だけを見せるフック（差分◯ptを主役にする構成）は`SceneHookCompareTwo`（同ファイル）を必ず再利用する**。このRoutineはmasterへコードをコミットしないため、この形状を毎回ゼロから書くと中央寄せ等のレイアウトルールが再現されない（2026-09-05、棒グラフが画面左に偏る不具合が発生し判明。`docs/reference/brand-kit.md`「グラフ・比較ビジュアルの中央寄せ」参照）
  - `daily-auto`型: ネタの内容に応じて既存フォーマットライブラリ（`sns-video-producer-prompt.md`「フォーマットライブラリ」節）から最も近いものを選ぶ。新しいデータ形状の場合のみ新規コンポジションを検討する
- X向けは9:16（1080x1920）
- `sns-video-studio/remotion/`でのレンダリング手順（Chromiumヘッドレスシェルの指定、ffmpeg導入）は同ドキュメント「制作フロー」4.と同じ
- `sns-video-studio/remotion/risk-rules.json`の各ルールを照合する。該当があれば`risk_flags`に記録する（ブロックしない、警告記録のみ）
- 同ドキュメントの「セルフレビュー チェックリスト」で自己採点し、Failがあれば直して再レンダリングする

## 3'. 企画由来ネタの画像生成

企画（`campaign_id`あり）のネタは9:16動画ではなく、**テキスト+静止画像2枚**（1080x1350、4:5縦型）を作る（ユーザー確認済み、2026-09-09。理由: 龍神レーダーは「AI予想を当てるサービス」ではなく「分析ツール」としてPRする方針のため、動画演出より実データの提示を優先する。当初は1200x675の16:9横型だったが、主な閲覧環境がスマホのタイムラインであることを踏まえ同日中に4:5縦型へ変更した）。

1. `scripts/lib/contentChannels/renderCampaignCard.js`の`renderCampaignEntryCard()`で1枚目（買い目・収支カード）を生成する。
   - `variant: 'picks'`（事前発表、`sns_campaign_entries.hit`が`null`）: `picks`（3連単3点）・`points`（分析ツールで見えたポイント、最大3行）を渡す
   - `variant: 'result'`（結果発表・最終まとめ、`hit`が確定済み）: `hit`・`actualResult`・`payoutYen`を渡す
   - **`points`には内部の計算式・スコアを書かない**。`race_entries`（勝率・モーター2連率）と`feature_contributions.turnPrediction`（展開予測）から読み取れる、分析ツールに実在する項目名だけで書く（例:「1号艇の全国勝率が低め」「展開予測で◯号艇に◯◯の勝ち筋あり」）。「◯号艇のスコアが◯◯だから」のような独自算出値には触れない
   - **`heroStat`（v4、2026-09-09追加）**: `{value: "99%", label: "イン崩れ注意度"}`の形で必ず渡す。`value`はホーム画面と同じ`Math.round(実際の値×100)`で四捨五入した表示値（企画の`selection_criteria.value`そのものではない点に注意。パイロット企画は生の閾値が0.985だが、四捨五入すると99%になるレースのみ対象になるよう調整済みのため、`heroStat.value`は常に「99%」表記でよい）、`label`はその指標の日本語名。「一目で何をやっているか分からない・地味」という指摘を受けて追加した、カードの視覚的な主役（ゴールドの大きな数字）を担う要素のため省略しない
   - **`raceLine`には発走時刻を含める**（例:「9/9 びわこ 2R ｜ 発走 10:52」）。`races`テーブルの`start_time`列（`race_id`で引ける）を取得する。「今日この後発走する」という切迫感を出す目的（2026-09-09追加）。`イン崩れ注意度`等の指標値は`heroStat`が担うため、`raceLine`では重複させない
   - 買い目3点のうち`picks[0]`（`computeCampaignPicks()`が返す最有力順の並び）が自動的にゴールド枠で強調表示される（`variant: 'picks'`のみ）。並び順を変えずにそのまま渡せばよい
   - **`variant: 'result'`の`headline`は`variant: 'picks'`の見出しを使い回さない**（v6、2026-09-09追加）。ピック時点の見出し（例:「初日は残念ながら不的中でした」の元になった導入文）をそのまま再利用すると、結果カードなのに事前予想の文言が残り読者が混乱する。結果カードの見出しは`hit`の値を踏まえて必ず書き直す（例: 不的中なら「初日は不的中でした。正直に記録します」、的中なら「2日目は的中！通算収支がプラスに転じました」）
   - **`retrospectiveMatches`・`retrospectiveMismatches`（v6、2026-09-09追加、`variant: 'result'`のみ）**: `campaign-backfill-results.js`が`topic_text`に埋め込む`✅整合:`・`⚠️不整合:`材料（`scripts/lib/campaignResultRetrospective.js`が生成、上記「結果発表は『なぜ当たった/外れたか』も説明する」参照）を、それぞれ文字列配列として渡す。カード内に✅/⚠️の2見出しで箇条書き表示される。キャプション本文の✅/⚠️セクションと同じ内容を画像側にも反映することで、画像単体でシェアされても振り返りの要点が伝わるようにする。材料が無い指標がある場合、該当する配列は空配列でよい（見出しごと非表示になる）
2. `renderCampaignDataExcerptCard()`で2枚目（データ出走表・展開予測の抜粋カード）を生成する。`boats`（`race_entries`から取得）・`pickedBoatNumbers`（買い目に含まれる艇番）・`turnPredictionTop3`（`feature_contributions.turnPrediction.patterns`の上位3件）を渡す
3. 2枚とも`sns_drafts.video_storage_path`ではなく、画像2枚のパスを別途保存する必要がある（現状`sns_drafts`は単一の`cover_image_path`しか持たないため、1枚目を`cover_image_path`、2枚目は`source_data`にパスを記録する運用とする）
4. リスクルール照合・セルフレビューは通常フローと同じ（`sns-video-studio/remotion/risk-rules.json`、該当があれば`risk_flags`に記録）

## 4. キャプション・ハッシュタグ

`docs/operation/x-operations-playbook.md`「投稿設計の優先順位」に従う。公式告知単体にせず、推し活・体験談・データの体系整理のいずれかの切り口を必ず添える。本文には視聴者が反応したくなる「問いかけ」を1つ入れる。

**企画由来のネタの場合**: 「必ず当たる」「稼げる」等の射幸心を煽る表現は使わない（`sns-video-studio/remotion/risk-rules.json`と同じ基準）。回収率が悪い日も誇張・言い訳をせず数字をそのまま書く（企画の趣旨が透明性であるため）。「問いかけ」の代わりに、前回までの通算収支を一言で触れて継続性を出す。

**企画由来のキャプション、必須事項（2026-09-09、1件目投稿後のフィードバックを受けて追加）**:
- **発走時刻を本文にも明記する**（画像内だけでなく）。例:「9/9 びわこ2R（発走11:06）」
- **箇条書きで構造化する**。「対象条件」「購入方法」「発信方針」等、性質の異なる情報を1つの段落に詰め込まず、行を分けて視覚的に読みやすくする
- **「分析ツールである」という宣言だけで終わらせず、「本当に使えるのか検証していく」という実験・検証のニュアンスを出す**。単なる立場表明（「〜としてPRする方針です」）は説明的で終わってしまう。「〜であるものの、本当に予想する上で使えるのか検証していきます」のように、これから見ていく過程であることを伝える
- **対象条件の数値は「◯%（表示値）以上」と書く**（「◯%以上」と言い切らない、2026-09-09追加）。パイロット企画の`selection_criteria.value`は0.985（生の値）だが、ホーム画面同様`Math.round`で四捨五入した「99%」表示に揃えているため、本文でも「イン崩れ注意度99%（表示値）以上」のように、あくまで表示上の丸めた値であることを明記する。単に「99%以上」と書くと、実際に98.5〜98.9%のレースも対象に含まれている事実と食い違い、不正確な表現になる
- **対象レースのレース詳細ページURL（`https://www.boat-ai.jp/race/{raceId}`）を貼る**（v6、2026-09-09追加）。事前発表（`variant: 'picks'`）・結果発表（`variant: 'result'`）とも、末尾のURLをトップページ（`https://www.boat-ai.jp`）ではなく該当レースの詳細ページに差し替える。`campaign-detect-and-generate.js`・`campaign-backfill-results.js`の`topicText`に`レースページ: https://www.boat-ai.jp/race/{raceId}`という形で既に埋め込まれているため、キャプション生成時はこの`topic_text`内のURLをそのまま本文末尾に転記する（読者がその場で実際のレース詳細・出走表・結果を確認できるようにする目的）

例（1件目・導入回のキャプション）:
```
龍神レーダーは「当てるサービス」ではなく「分析ツール」。
だからこそ、本当に予想に使えるのか検証していきます。

・対象: イン崩れ注意度99%（表示値）以上のレースのみ
・購入: 1週間、3連単900円（300円×3点）
・発信: 勝っても負けても結果はすべてそのまま報告

【1件目】9/9 びわこ2R（発走11:06）
イン崩れ注意度99%
買い目: 3-2-4 / 3-4-2 / 2-3-4

結果はまた報告します。
https://www.boat-ai.jp/race/2026-09-09-11-02
```

結果発表回（運用フロー③）・最終まとめ（運用フロー④）でも同じ構造化方針を踏襲する（対象レース・買い目・結果・通算収支を箇条書きで分ける）。

例（結果発表回のキャプション、✅/⚠️の振り返り込み）:
```
龍神レーダーは「当てるサービス」ではなく「分析ツール」。
本当に予想に使えるのか、実際に検証していきます。

【1件目・結果発表】
・対象: 9/9 びわこ2R（発走11:06）
・イン崩れ注意度: 99%
・買い目: 3-2-4 / 3-4-2 / 2-3-4（900円）
・結果: 2-1-6（不的中）
・払戻: 0円
・通算収支: -900円

✅データと整合した点
・実際に1着だった2号艇は、全国勝率が参加6艇中2位というデータ通りの走りでした

⚠️データと違った点
・本命にした3号艇は全国勝率・モーター2連率とも参加6艇中1位のデータでしたが、実際は着外
・展開予測は1号艇の逃げ（確率28%）を1着候補としていましたが、実際の1着は2号艇でした

初日は不的中でした。誇張せず、この結果をそのまま記録していきます。
続報はまた報告します。
https://www.boat-ai.jp/race/2026-09-09-11-02
```

## 5. アップロード・永続化

- Supabase Storageの非公開バケット`sns-hub-media`に動画・カバー画像をアップロードする（パス例: `{content_group_id}/x-ja.mp4`）
- `sns_drafts.video_storage_path`/`cover_image_path`には**生のStorageパスをそのまま保存する**（署名付きURLを保存しない、`.claude/rules/sns-content-generation.md`参照）
- `sns_drafts`テーブルにINSERTする。列: `content_group_id`（claimしたネタの`sns_topics.id`をそのまま使う）・`format`（ビジュアルテンプレート名のみ、3.で選んだフォーマット名。ネタ種別を入れない）・`template_variant_id`・`language`（'ja'）・`platform`（'x'）・`status`（'pending_review'）・`video_storage_path`・`cover_image_path`・`caption_text`・`hashtags`・`background_text`・`source_data`・`risk_flags`・`routine_run_id`（1.で生成した識別子）
- **企画由来のネタの場合**: `video_storage_path`は空にする（動画ではないため）。`cover_image_path`に1枚目（買い目・収支カード）のStorageパスを、`source_data`に2枚目（データ出走表・展開予測カード）のStorageパスを含める（`{dataCardPath: "..."}`形式）。`format`列には`'CampaignEntryCard'`を入れる

## 6. claimしたターゲットの完了処理

`markTopicTargetGenerated(targetId, draftId)`（`scripts/lib/snsTopics.js`）を呼び、5.で作成した下書きのIDを紐付ける。これで進捗マトリクスUIに`generated`として反映される。

## 制約（絶対厳守）

- 1回の実行で処理するネタは1件まで
- **1つのclaim済みターゲットにつき、`sns_drafts`行は必ず1件だけ作る**。生成後に内容の誤り・前提の古さ（レース結果が出た後だった等）に自分で気づいた場合も、同一セッション内で2件目の`sns_drafts`行を作り直さない。6.の完了処理（`markTopicTargetGenerated`）を済ませたら、その回の生成物が最終版であり、修正が必要なら人間の下書き承認画面からの修正指摘操作（A'節）に委ねる（2026-09-03、Blogパイプラインで同一セッション内に2件のPRが作られる不具合が発生し判明）
- claim対象が0件、または実データの裏付けが取れない場合は生成せず終了する（見送りであり不具合ではない）。claim済みのまま放置しない（claim解放の仕組みは未実装のため、途中で断念する場合は`sns_topic_targets.status`を`pending`に手動で戻す）
- masterへの直接コミット・マージは行わない（このRoutineはデータ登録のみで、コード変更を伴わない）
- 「競艇」表記禁止、射幸心を煽らない、実データ以外は使わない（`sns-video-producer-prompt.md`絶対厳守1〜3と同じ）
