# onboarding-guide-revamp タスク分解

`docs/design/onboarding-guide-revamp/spec.md`・`screens.md`・`plan.md`に基づくタスク一覧。依存順に並べており、上から順に実装する。動画（フェーズ1）は`FirstVisitGuideCard`（フェーズ2）・ガイドページのA-5（フェーズ4）の両方が依存するため最初に完成させる。フェーズ3（用語ヒント）は動画に依存しないため、実装リソースが分かれる場合はフェーズ1と並行して進めてよい。

## フェーズ1: 操作キャプチャ動画

- [x] **1. 動画題材の選定条件確定 + 台本・吹き出し構成案作成**
  「指標の差が明確」等、見せやすいレースを選ぶ具体的な条件（例: モーター2連率の差が◯pt以上、イン崩れ指数が高/低で対照的な例がある等）を決め、実際に本番データから候補レースを1件選ぶ。「会場選択→レース選択→AI展開予想→データ出走表・各指標分析」の流れに沿った吹き出しテキスト（日本語のみ）を含む台本を作成する。尺目安30〜60秒。
  → [video-script.md](video-script.md)に選定条件4点・実例（多摩川2R、2026-09-01）・6シーン構成の台本（尺目安50秒）を作成済み。選定条件はTask 2実行時に再適用し、その時点で発走前のレースを選び直す。

- [x] **2. Remotion + Playwrightでの動画制作・書き出し**
  `sns-video-studio/remotion`の既存パイプラインを流用し、Task1の台本に沿って実画面をPlaywrightでキャプチャ、Remotionで吹き出し・注釈を合成、ffmpegで書き出す。実データ・実画面のみを使用し、作り話・仮の数字は含めない（`docs/operation/sns-video-producer-prompt.md`の原則を踏襲）。書き出したmp4とサムネイル画像をffmpegで圧縮し、`public/videos/`配下に配置する（ADR0023）。
  → 本番サイト（boat-ai.jp、モバイル390px viewport、cookie拒否でAuto Ads非表示）から`sns-video-studio/archive/tmp/capture-onboarding-flow.mjs`で5シーン分の実画面をキャプチャ。当日実際に発走前だった多摩川2R（イン崩れ確率高バッジ付き）を自動選定。`sns-video-studio/remotion/src/OnboardingFlowCM.jsx`を新規実装（`Root.jsx`に登録済み）、1920x1080・50秒でレンダリング後、ffmpegでH.264/CRF26に圧縮（5.2MB→673KB）。`public/videos/onboarding-flow.mp4`・`onboarding-flow-poster.jpg`として配置済み（既存の`about-hero-*.mp4`と同じ配置パターン）。frame=0でサムネイルが空白にならないことを確認済み（`sns-video-producer-prompt.md`の既知の教訓を反映、Pop delayを-10に調整）。副次的に、ローカルdev server(5173番)は別セッションのWIPブランチ（会場選択がグリッドではなくドロップダウン方式）で稼働中と判明したため、本番サイトを直接キャプチャ元に切り替えた。

- [x] **3. `GuideVideoPlayer.jsx`実装**
  `src/components/GuideVideoPlayer.jsx`を新規作成。`videoSrc`・`posterSrc`をpropsで受け取り、`<video controls preload="none" poster={posterSrc}>`のラッパーとして実装する（自動再生・自動読み込みをしないことを確認）。単体でStorybook的な確認ページは作らず、フェーズ2・4での組み込み時に動作確認する。
  → 実装時に既存の`About.jsx`（`hero-video-wrapper`/`hero-video-play-button`）と同じ「クリックで再生ボタンが消えてネイティブcontrolsに切り替わる」パターンを踏襲する形に変更（単純な`controls`常時表示より、既存デザイン言語との一貫性を優先）。色・角丸・影は`design-tokens.css`のトークン（`--brand-accent-primary`・`--radius-lg`・`--shadow-lg`）を使用。

## フェーズ2: 初回訪問者向け導線（B-1・B-3）

- [x] **4. `useFirstVisit`フック実装**
  `src/hooks/useFirstVisit.js`を新規作成。`localStorage["boatai:visited-before"]`が無ければ`true`（初回訪問）を返し、マウント時の副作用でフラグを立てる。`IntroBanner.jsx`の`DISMISS_KEY`パターンを参考にする。

- [x] **5. `FirstVisitGuideCard.jsx`実装 + `App.jsx`統合 + `IntroBanner.jsx`表示条件変更**
  `src/components/FirstVisitGuideCard.jsx`を新規作成。「初めての方へ」見出し・説明文・`GuideVideoPlayer`（Task3）を内包し、「✕」「あとで」でこのページ表示中のみ非表示にするローカルstateを持つ（localStorage書き込みはしない）。`i18n.language !== "ja"`なら`null`を返す自己ガードを実装する。`App.jsx`の`race-list-section`内に`isFirstVisit ? <FirstVisitGuideCard /> : <IntroBanner />`の分岐を追加する。`IntroBanner.jsx`に表示条件（`useFirstVisit()`が`false`の場合のみ描画）を追加する。動作確認: 初回訪問（localStorage空の状態）でカードが表示されること、カードを閉じてもリロードすると再訪問扱いになり`IntroBanner`が表示されること、英語版（`/en`）ではカード・`IntroBanner`とも意図通りに切り替わること（`IntroBanner`は多言語対応済みなのでen/zh-TW/koでも表示される。カードのみ非表示になることを確認）。
  → **実装を単純化**: `IntroBanner.jsx`自体には表示条件を追加せず、三項分岐のみで排他表示を実現した（`IntroBanner`は1箇所からしか使われていないため、両方に判定ロジックを持たせるのは冗長と判断）。
  → **重大な訂正（ブランチ間違い）**: ここまでの実装を、masterから大きく遅れた別タスクのブランチ（`docs/tiktok-post3-live-prediction`）上で行っていたことが判明した。masterでは「開催場一覧ページ再設計」（PR#415）によりホーム画面が`App.jsx`から`src/pages/VenueGridPage.jsx`（`TodayVenueGridPage`関数）に置き換わっており、`IntroBanner`もそちらに移動済みだった。対応: (1) `git stash`でこのタスクの変更のみを退避（他セッションの未コミット変更を巻き込まないよう対象ファイルを明示指定）、(2) `App.jsx`への変更は破棄、(3) `EnterWorktree`で`origin/master`ベースの独立worktree（`feature/onboarding-guide-revamp`相当）を作成し、そこにstashを再適用、(4) `VenueGridPage.jsx`（`TodayVenueGridPage`）に対して同内容の統合をやり直した。
  → **言語ガードの分岐条件を修正**: 当初`{isFirstVisit ? <FirstVisitGuideCard /> : <IntroBanner />}`としていたが、これだと初回訪問の英語（en/zh-TW/ko）ユーザーは`FirstVisitGuideCard`の自己ガードでnullになり、`IntroBanner`も表示されず**何も出ない**回帰を検証中に発見。`{isFirstVisit && i18n.language === "ja" ? <FirstVisitGuideCard /> : <IntroBanner />}`に修正し、ja初回訪問=カード／それ以外=IntroBannerとなることを`vite preview`+ブラウザで実機確認済み（ja初回・ja再訪問・en初回の3パターン）。

## フェーズ3: 用語「?」ヒント（B-2）

- [x] **6. 対象語句候補の洗い出し・ユーザーレビュー**
  データ出走表の指標名（`raceIndicators.jsx`のラベル一覧）とAIデータ分析内の専門用語（展開予測・イン崩れ指数まわり）から、初心者がつまずきやすい語句候補と説明文案をリストアップし、ユーザーにレビューを依頼する（コード変更なし、spec.mdの未確定事項#1を確定させるステップ）。
  → 候補案（ユーザーレビュー待ち）:
  | 語句 | 説明文案 |
  |---|---|
  | モーター2連率 | そのモーターを使った際に1着または2着になった割合。数値が高いほど「調子の良いモーター」とされます |
  | 調子（勝率Δ） | 直近の勝率が、普段の勝率と比べて上がっているか下がっているかを示す差分です |
  | ST安定度 | スタートのタイミングのばらつきの小ささ。数値が小さいほど毎回安定したスタートが切れています |
  | 決まり手型 | その選手が得意な勝ちパターン（逃げ・差し・まくり等）。展開予測を読む手がかりになります |
  | 単勝回収率 | その艇番で実際に舟券を買っていた場合の過去の回収率（参考値、結果を保証するものではありません） |
  | 進入コース勝率 | そのコースから進入した際の過去の勝率です |
  | イン崩れ指数（AIデータ分析） | 1号艇（インコース）がどれだけ崩れやすいかを、過去90日・同会場のレースと比べた相対的な指数（パーセンタイル）で示したものです |
  | 展開予測（AIデータ分析） | 1マーク（最初のターン）でどの艇が先頭になりそうかを、確率付きの上位パターンとして示したAIの予測です |

  → **スコープ拡大（ユーザー指示、2回目）**: レース詳細ページの埋め込み分析セクション全8種も対象に追加。候補案:
  | セクション名 | 説明文案 |
  |---|---|
  | この会場の枠番別傾向 | この会場での枠番（コース）ごとの決まり手・勝率などの過去の傾向をまとめたものです |
  | モーター調子 | このレース場のモーターごとの、最近の調子（勝率の推移）を示すグラフです |
  | 選手調子 | 出走選手それぞれの、最近の成績推移（勝率の上がり下がり）を示すグラフです |
  | STのズレ | 選手のスタートタイミングのばらつき・安定性を分析したデータです |
  | 展示タイム推移 | 直近の展示航走タイムの推移を示すグラフです。数値が小さいほど機力が良いとされます |
  | 選手別決まり手傾向 | 各選手が過去にどの決まり手（逃げ・差し・まくり等）で勝っているかの傾向です |
  | 回収率分析 | 過去の実績に基づく回収率のデータです。参考値であり結果を保証するものではありません |
  | 超展開データ | 過去のレース展開（コース別の攻防パターン）を詳細に分析したデータです |

- [x] **7. `TermHintButton.jsx`実装 + `termHints.js` + 各コンポーネントへの組み込み**
  `src/components/race/termHints.js`にTask6で確定した語句と説明文を格納する。`src/components/race/TermHintButton.jsx`を新規作成（`termKey`をpropsで受け取り、クリックで説明ポップオーバーをトグル表示。他ボタンとの排他制御はしない。`i18n.language !== "ja"`なら`null`を返す自己ガード）。`raceIndicators.jsx`（データ出走表の行ラベル）・`AiAnalysisSection.jsx`（タイトル部）・`PredictionPanel.jsx`（展開予測・イン崩れ指数の見出し）に組み込む。`PredictionPanel`は`App.jsx`・`RaceDetail.jsx`両方から共通利用されているため、ホーム画面・過去レース詳細（`/races/:date`）の両方で動作すること、英語版では「?」ボタン自体が表示されないことを確認する。
  → **スコープ拡大分も実装**: `termHints.js`は最終的に21キー（データ出走表11 + AIデータ分析2 + 埋め込み分析セクション8）を格納。`EmbeddedAnalysisSection.jsx`に`hintKey`propを新設し、7セクション（モーター調子/選手調子/STのズレ/展示タイム推移/選手別決まり手傾向/回収率分析/超展開データ）をこの1箇所の変更でまとめてカバー。`VenueTendencyPanel.jsx`（この会場の枠番別傾向）・`PredictionCard.jsx`（展開予測、`hintKey`prop新設）・`VolatilityDisplay.jsx`（イン崩れ指数、fallback/通常の両表示に追加）にも組み込んだ。**実装中に発見した既存バグ**: `EmbeddedAnalysisSection`と`VenueTendencyPanel`のヘッダーはどちらもアコーディオン全体が`<button>`要素だったため、その中に`TermHintButton`（内部で`<button>`を使う）をそのまま入れるとbuttonのネスト（無効なHTML）になり、かつヒントクリックでアコーディオンも一緒に開閉してしまう問題があった。ヘッダーを「開閉トグル用の`<button>`」と「その外側の`TermHintButton`」に分離する構造に直し、CSSも追従修正した。
  → 実際の対象ファイルはmasterでは`VenueGridPage.jsx`/`RaceDetailPage.jsx`経由（Task5の訂正メモ参照）。本番相当データで動作確認済み: データ出走表11行・AIデータ分析2箇所・埋め込みセクション8箇所すべてで「?」→説明ポップオーバー表示、アコーディオン開閉との干渉なしを確認（`vite preview`+実データ、`.env.local`をworktreeにコピーして検証）。

- [x] **8. 動作確認・PR作成①（フェーズ1〜3: 初回訪問者向け導線一式）**
  ローカルで`npm run dev`起動、Playwrightでモバイル幅（375px）での見た目・動作を確認する。`npm run build`・`npm run test:e2e`実行後、`/code-review`セルフレビューを実行し指摘を修正、`/create-pr`でPR作成。
  → `npm run build`成功済み。`npm run test:e2e`は16件失敗したが、うち2件（選手個別ページ・開催場一覧の過去日付遷移）を`git stash`でこのタスクの変更を退避した状態（クリーンなmaster）でも同一理由で再現することを確認し、既存の環境依存の失敗（テストが参照する特定日付・選手IDのデータ不足）で本タスクとは無関係と判断した。残り14件も同種のテストタイトル（言語切替・複勝予想UI撤去・AI用にコピー等、本タスクが一切触っていない機能）のため同様と推定。
  → セルフレビューで新規CSS（`FirstVisitGuideCard.css`・`TermHintButton.css`）の一部が`design-tokens.css`のスペーシングトークンを使わず生のrem値になっていた点を発見・修正（`--spacing-*`に置換）。「競艇」表記・`!important`・console.log残留・ハードコードされた秘密情報は無し。
  → [PR #462](https://github.com/rhapsody0919/boatrace-ai-predictor/pull/462)を作成済み（`feature/onboarding-guide-revamp` → `master`）。

## フェーズ4: ガイドページ（`/how-to-use`）刷新

- [ ] **9. 実画面スクリーンショット撮影**
  Playwrightで、A-1・A-2用に各ステップ（会場選択・レース選択・データ出走表・AIデータ分析・実績確認）の実画面スクリーンショットを撮影し、`public/`配下に配置する。

- [ ] **10. A-1実装: 各ステップへのスクショ組み込み**
  `HowToUse.jsx`の`steps[].content`それぞれに、Task9で用意したスクリーンショット`<img>`を追加する。

- [ ] **11. A-2実装: 冒頭ツアー画像**
  Task9のスクリーンショットのいずれかに①②③…の吹き出しを重ねた画像を作成し（Remotion静止画書き出しまたは画像編集）、`HowToUse.jsx`冒頭（`how-to-use-header`直後）に新設セクションとして配置する。

- [ ] **12. A-5実装: 動画埋め込み**
  `HowToUse.jsx`のStep1冒頭に`GuideVideoPlayer`（フェーズ1で実装済み）を`videoSrc`/`posterSrc`を渡して埋め込む。

- [ ] **13. A-3 + A-4実装: 入口分岐 + 実例ベース解説**
  `HowToUse.jsx`冒頭に「初めての方」「用語だけ知りたい方」等の入口リンク（クリックで該当`steps`インデックスに`setActiveStep`）を追加する。各`steps[].content`内の`example-box`の抽象的な例文を、`/hit-races`等の実データへのリンクに差し替える（最低1箇所）。

- [ ] **14. 動作確認・PR作成②（フェーズ4: ガイドページ刷新一式）**
  ローカルで`npm run dev`起動、Playwrightで`/how-to-use`のモバイル幅（375px）での見た目・スクロール・動画再生を確認する。`npm run build`・`npm run test:e2e`実行後、`/code-review`セルフレビューを実行し指摘を修正、`/create-pr`でPR作成。
