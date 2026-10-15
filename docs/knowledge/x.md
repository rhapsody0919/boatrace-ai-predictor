# X（旧Twitter）固有の知見

X の投稿・返信・動画に固有の知見。複数チャネルに共通する内容は glossary.md・number-wording.md・video-composition.md・fan-reactions.md に書く。書き方は [README.md](README.md)。

## 投稿・動画
- BGM はオーナーの好みで X/TikTok の縦型動画の曲（soundtrack.wav）。note 用の Calm Corporate Relax は不採用（2026-10-11、オーナー v6。v3〜v5 時点の「既存の note 動画の Pixabay 曲」を置き換え。元は video-composition.md「音・尺・撮影」より移動）
- X でも全貌の動画（9:16・56秒、YouTube と同じ）を使う。問いを見せるだけで答えの無い15秒の入口動画は、情報量が少なく見る価値がない（2026-10-13、オーナーが若松12R の 1:1・15秒の入口動画を不採用。Codex 内の評価役は P0/P1 0件だった）
- X の標準の投稿画面にカバー画像の編集は無い（Media Studio は Premium だけ）。動画の frame=0 がそのままプレビューの静止画になる（2026-08-25、memory sns_marketing_phased_strategy_2026_08_22、docs/operation/sns-marketing-strategy.md）
- #ボートレース 上位約20件（2026-08-23）では推し活（選手への感情移入）と観戦・遠征の体験談が強く（約300〜1,200表示）、公式会場の告知は中位、買い目の数字だけの投稿が最下位、自社の新機能告知は13表示で最弱。機能告知はブログ等に任せる（2026-08-23、memory sns_marketing_phased_strategy_2026_08_22、BOA-210）
- AI予想を前に出す X アカウントは複数あるが、どれも1投稿数十表示・いいね0〜数件。AI の訴求が強いとは言えない（2026-08-23、memory sns_marketing_phased_strategy_2026_08_22）
- 投稿ごとの詳細アナリティクスは Premium の課金表示になり無料では見られない。無料で見えるのはプロフィールの直近7日の表示回数の合計（2026-09-05、memory x_tiktok_note_growth_2026_09_05、要確認）

## 返信
- 返信の候補探しは「観戦」「初めて」「行ってきた」等の体験談の語を掛け合わせる。「ボートレース」単体や「買い目」「舟券」は予想 bot・公式メディアに埋もれる。-filter:replies で他人の会話への割り込みを避ける（2026-09-06、memory x_reply_drafts_batch_workflow_2026_09_06・sns_marketing_phased_strategy_2026_08_22）
- 返信のトーンは相手の熟練度で変える。熟練層に基礎を説明すると上から目線に映るので、検証の形で控えめに出す（2026-08-25 オーナーの指摘、memory sns_marketing_phased_strategy_2026_08_22）
- 複数の返信を同時に送ると bot に見える。危ういのは送信の同時性で、送信は間隔を空ける（2026-09-06、memory x_reply_drafts_batch_workflow_2026_09_06、PR #547）

## API と運用
- X API は 2026-02 に従量課金が既定になった（読み取り1件 $0.005、月200万件まで。旧 Basic の月$200 は新規不可）。2026-08-29 時点は導入見送り（memory sns_marketing_hub_operational_state、要確認）
- X・note の戦略と1週間分の下書きを 2025-12-24 に作ったが、Week2 以降が無く約8か月止まった。下書きを作っても投稿する人・頻度・確認の流れが無いと続かない（2026-08-04 オーナー確認、memory feedback_x_strategy_lapsed_2025_12）

## 点検での見落としを防ぐ知見
- UTM付きURLを含む投稿の文字数は、生文字数・全角換算・XのURL換算を分けて記録する。（2026-10-12、2026-10-12-task-37-x-thread-12R.md）
- 添付静止画像内でも問いの答え・範囲・期間・条件・母数を示し、条件別の過去の割合を今日の時間変化のような矢印で表さない。（2026-10-13、2026-10-13-plan142204-ximage.md）
