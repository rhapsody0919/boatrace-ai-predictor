# 「本日のデータ一覧」ページ tasks

spec: [spec.md](./spec.md) / screens: [screens.md](./screens.md) / plan: [plan.md](./plan.md)

Linear: [BOA-402](https://linear.app/boat-ai/issue/BOA-402)　モック（承認済み、2026-09-24・案A）: https://claude.ai/artifact/7Dytu5kJjB82f7xLngAoHP

ADR: [ADR-0070](../../adr/0070-morning-digest-precomputed-rows.md) / [ADR-0071](../../adr/0071-venue-adjusted-skill-delta.md)

マイグレーション案（**未適用**）: [097](../../db-migration/097_morning_data_digest.sql)

---

## 着手前に読むもの

- 会話が圧縮された直後・別セッションで再開する際は、**記憶ではなくこのファイルを読み直してから続ける**（`.claude/rules/sdd-workflow.md`）。`/step4` を都度呼ぶ運用にする
- 粒度は目安。**同じファイルを触るタスクは1PRにまとめてよい**（UIはタブ/セクション単位でPlaywrightの自己検証が1回で済む）
- `src/**` を編集する前に `.claude/rules/frontend-data-fetch.md` と `.claude/rules/component-reuse.md` が自動で読み込まれる。`supabaseClient.js` は `.throwOnError()` 既定適用（[ADR-0069](../../adr/0069-query-error-propagation.md)）なので、**`if (error) return []` を書かない**
- spec §1 の実測値は 2026-09-24 時点のもの。**日が経つほど古くなるため、T1-1 の着手時に再実測して spec を更新する**

---

## ⛔ ゲート: `/step4` の前に独立エージェントのレビューを通す（省略不可）

`.claude/rules/sdd-workflow.md`「実装着手前に天才エンジニアの独立レビューを必ず挟む」（2026-09-23〜）。phase a で同じ位置に33件の指摘が出て、うち数値・前提の誤りで設計を巻き戻した実績がある。

- [ ] **G-0** Agent tool で独立エージェントに spec.md / screens.md / plan.md / tasks.md / ADR-0070 / ADR-0071 / 097 を渡し、批判的レビューを依頼する
  - 依頼する観点（最低限この4つを明示する）:
    1. **spec に書かれた実測値・統計値を、自分で同じクエリを実行して再現できるか**（293日・母数中央値8走/17走/26走・逃げベースレート52.7%・会場差20.3pt・1コース1着率と逃げの一致率95.47%・公式期別データとの相関0.964・帰郷の日次差分が競合6名＋若松1名を再現）
    2. **前提として引用した既存コードの挙動が実際のコードと一致しているか**（`racer_aggregated_stats` が使えない3つの理由、`race_results.course_N` が無効列、`entry_course` がほぼNULL、`getVenuesWithTodaysRaces` がイン崩れ指数を返す、マイグレーション094が適用済み、`.throwOnError()` が適用済み）
    3. **設計のキー・粒度・集計窓が実データの分布に対して妥当か**。**特に「地力窓＝利用可能な全期間」と「調子窓＝90日」の2層が成立するか、母数が実質0になるセルが無いか、窓の定義が複数箇所で食い違っていないか**を明示的に確認させる
    4. **失敗モード**（エラーの握りつぶし、キャッシュの残留、完全性チェックの空振り、節境界ガードの誤爆、ロールバック時に残る状態、`predicted` のクランプ）
  - 指摘は鵜呑みにしない。**一次情報（実DB・実コード）で自分で再現してから採否を決める**。再現できたものは設計に反映し、できなかったものは反論を明記して残す
  - **受入基準**: レビュー結果を「自分の結論」「レビューでの指摘」「指摘への対応（採用/反論）」の3点でまとめ、このファイルまたは spec/plan に反映する。反映が終わるまで T1-1 以降に着手しない

---

## Phase 1: 純関数と実測の再確認（DBへの変更なし）

- [ ] **T1-1** spec §1 の実測値を再測し、ずれていれば spec・plan を更新する
  - 対象: データ期間（`min(race_date)` と日数）／1コース進入の母数分布（30・60・90・120・180・全期間）／逃げのベースレート／会場別逃げ率の最大最小／`finish_mark` の100%運用開始日／`race_special_notes` の件数
  - **受入基準**: 再測したクエリと結果を spec §1 に反映し、変化があった箇所を明示する。窓の日数が変わっていても**固定値をコードに書かない**方針は変えない

- [ ] **T1-2** `src/utils/wilson.js`（純関数）を新規作成する
  - `wilsonLowerBound(successes, n, z = 1.96)` → 下限（0〜1）。`n === 0` は `null`
  - `isSmallSample(successes, n, baseRate)` → Wilson95%下限が `baseRate` 未満なら true
  - **受入基準**: p̂=0.70 のとき n=8→0.366 / n=20→0.481 / n=30→0.521 / n=35→0.535 を**小数第3位まで**再現する（spec §1.2 の表と一致）。`n=0` で例外を投げずに `null` を返す

- [ ] **T1-3** `src/utils/digestMetrics.js`（純関数）を新規作成する
  - `computeSkillDelta({ rate, expected })` → `rate - expected`
  - `computePredicted({ venueBaseline, skillDelta })` → `[0, 100]` にクランプし、クランプしたかを `{ value, clamped }` で返す（plan.md §2.2）
  - 指標ごとのベースレート定数（逃げ・まくり・逃がし）をここに1箇所だけ置く。**他所に第2の定義を作らない**
  - **受入基準**: ADR-0071 の表の4件（山本光雄 course2 +22.4pt / 横川聖志 course3 −14.0pt / 柘植政浩 course2 +6.4pt / 松尾拓 course4 −0.8pt）を**小数第1位まで**再現する。`clamped` が金子賢志（91.5%）・吉田裕平（92.4%）では false になる

---

## Phase 2: マイグレーションと夜間バッチ（B1）

- [ ] **T2-1** (ユーザー承認) マイグレーション097を適用し、`APPLIED.md` を「適用済み」に更新する
  - 適用前に長時間クエリが0件であることを確認する
  - 適用後の確認（読み取りのみ）: 4表が存在・RLS有効・`has_table_privilege('anon', …, 'SELECT')=true` かつ `'INSERT'=false`・公開読み取りポリシー各1件・`morning_digest_rows` のFKが `morning_digest_days` を指す
  - **受入基準**: 上記がすべて満たされ、`scripts/maintenance/check-anon-access.js --expect-applied` が通る

- [ ] **T2-2** 集計RPC 2本を097に追加する（`compute_venue_course_technique_baseline` / `compute_racer_course_technique_stats`）
  - 094 の `compute_st_course_baseline()` と同じ形（`SECURITY INVOKER`・`STABLE`・service_role のみ EXECUTE、anon/authenticated は REVOKE）
  - `window_start` / `window_end` / `window_days` は**実測値**を返す。365等の固定値を書かない
  - 除外条件は plan.md §2.2 の共通条件どおり。**`race_results.course_1〜6` を使わない**
  - **受入基準**: RPCの戻り値と、同じ定義を `node -e` で書いた独立のSQLの結果が**全行一致**する。`venue_course_technique_baseline` が144行以下、`racer_course_technique_stats` が8,000〜10,000行の範囲に入る
  - **注**: T2-1で097を適用済みの場合、RPCの追加は別マイグレーション（098）に切り出す。T2-1着手前にこのタスクを終えて1ファイルにまとめるのが望ましい

- [ ] **T2-3** `scripts/lib/unchangedRows.js` の `NUMERIC_SCALES` に097の4表を追加する
  - `venue_course_technique_baseline`: `nige_rate` 2 / `makuri_rate` 2 / `nigashi_rate` 2
  - `racer_course_technique_stats`: `nige_rate` `nige_expected` `makuri_rate` `makuri_expected` `nigashi_rate` `nigashi_expected` `nige_rate_90d` `makuri_rate_90d` `nigashi_rate_90d` 各2
  - `morning_digest_rows`: `metric_value` `metric_expected` `metric_skill_delta` `metric_venue_baseline` `metric_predicted` `rate_90d` `motor_2rate` `volatility_percentile` 各2
  - **受入基準**: 未登録のままだと毎日全行が「変更あり」になることを、登録前後の書き込み行数の差で確認する（T2-4の2回目実行で検証）

- [ ] **T2-4** `scripts/daily/update-racer-course-technique-stats.js` と `.github/workflows/aggregate-racer-course-technique-stats.yml`（JST 01:10）を作成する
  - `venue_course_technique_baseline` → `racer_course_technique_stats` の順に更新（後者が前者を参照する）
  - `upsertChangedRows` で変更のある行だけ書く
  - 「集計結果が0行」はエラー、「変更が無くて書き込み0行」は正常、として区別する
  - `continue-on-error` は付けない
  - **受入基準**: 本番で1回目に全行が投入され、**2回目の実行で全行が「変更なしスキップ」になる**（`aggregate-course-baseline-stats.yml` と同じ確認）。実行時間を記録し、RPC化の要否（plan.md 未確定事項#5）を判断する

- [ ] **T2-5** `nigashi` の地力閾値を実データで確定する（plan.md 未確定事項#1）
  - `racer_course_technique_stats` 投入後、閾値を10/15/20ptと変えて直近14日ぶんの日次該当件数を測る
  - **受入基準**: 採用した閾値で日次の該当件数が5〜15件に収まる。**特定の1会場に集中しない**（ADR-0071 の受入基準。素朴な差分では戸田8/12件だった）。測定結果を plan.md §7 に記録する

---

## Phase 3: 早朝バッチ（B2）

- [ ] **T3-1** `scripts/daily/generate-morning-digest.js` の骨格と完全性チェックを作る
  - `--date=YYYY-MM-DD`（既定は JST の当日）。日付の判定は **JSTで行う**（DBの `current_date` はUTC。spec §1.6）
  - 完全性チェック4項目（plan.md §3.2）を満たさなければ**書かずに終了**（終了コード0、ログに理由）
  - `morning_digest_days` を先に書き、`morning_digest_rows` は `digest_date` で全削除→再投入（1日ぶんは40〜60行なので差分更新しない。FKの `ON DELETE CASCADE` に頼らず明示的に消す）
  - **受入基準**: 出走表が未投入の日付を指定したとき、行を書かずに理由をログに出して終了する。`--date` で過去日を指定して再生成できる

- [ ] **T3-2** `nige` / `makuri` / `nigashi` セクションの抽出を実装する
  - `racer_course_technique_stats` と当日の `race_entries` を結合。`runs >= 10`、ベースラインの `runs >= 100`
  - 並びは `skill_delta` 降順。`nige` は最大25件
  - `makuri` は `detail.entryCourseTendency` に枠→進入コース分布を入れる（FR-9）
  - `is_small_sample` は `src/utils/wilson.js` で指標ごとのベースレートと比較して立てる
  - **受入基準**: 2026-09-24 を対象に実行したとき、`nige` に金子賢志（津1R・88.2%・地力+36.6pt・予測91.5%）と吉田裕平（若松12R・90.3%・地力+35.6pt・予測92.4%）が含まれ、値が**小数第1位まで**一致する。`makuri` に笠置博之（戸田4R・38.5%・地力+33.2pt・予測40.6%）が含まれる。同じ定義のSQLを `node -e` で独立実行した結果と全行一致する

- [ ] **T3-3** `flying` / `returned` セクションの抽出を実装する
  - `flying`: 前日（JST）の `finish_mark='F'`。対象日が 2026-09-21 より前なら `flying_data_complete=false`
  - `returned`: 前日の出走表にいたが、当日も同一会場の開催が続いているのに当日の出走表にいない選手。**1会場20件超で抑制**し `suppressed_venues` に記録（黙って0件にしない）
  - `race_special_notes`（`category='absence'`）に該当があれば `detail.reason` に理由を入れる。無くても行は出す
  - **受入基準**: 2026-09-24 を対象に実行したとき、`flying` が平見真彦（江戸川10R・枠1・F.01）と山本幸也（常滑9R・枠1・F.02）の**2件だけ**。`returned` が7件（黒崎竜也・黄金井力良・大久保佑香・渡邊哲也・金子和之・木山誠一・石本裕武）で、石本裕武にだけ `detail.reason = "帰郷（公傷のため）"` が入る。直近14日の各日で `returned` が0〜20件に収まる

- [ ] **T3-4** `featured` セクションの選定を実装する（plan.md §3.3）
  - `score = skill_delta × (consistency / 100)`。同点は `race_id` 昇順で決定的に解決
  - `volatility_percentile` が NULL（`isFallback`）の行は候補から除外
  - 選定理由の文を `detail.reason` にテンプレートで組み立てる（**数値の根拠を必ず含める**）
  - 候補0件の日は `featured` を書かない
  - **受入基準**: 同じ入力で10回実行して常に同じ `race_id` が選ばれる。2026-09-24 では戸田4R（笠置博之・まくり地力+33.2pt・イン崩れ指数84%）が選ばれる

- [ ] **T3-5** `.github/workflows/generate-morning-digest.yml`（JST 05:30 と 06:30）を作成する
  - 2回目は1回目が完全な結果を書けていれば何もしない
  - 2回目でも完全性チェックを満たせなければ**ジョブを失敗させる**（`continue-on-error` を付けない）
  - **受入基準**: `workflow_dispatch` で手動実行でき、当日ぶんが生成される。既に生成済みの日に再実行しても結果が変わらない（冪等）

---

## Phase 4: サービス層と画面（案A）

- [ ] **T4-1** `getMorningDigest(date)` を `src/services/supabaseDataService.js` に追加する
  - `morning_digest_days` と `morning_digest_rows` を `digest_date` で引き、セクション別に整形して返す
  - `withCache`。TTLは当日30分・過去日7日
  - **`if (error) return []` を書かない**。失敗は例外として伝播させる
  - **受入基準**: `npm run verify:query-errors` が通る。存在しない日付で空の結果（例外ではない）を返し、DB障害では例外を投げる

- [ ] **T4-2** 共通コンポーネント3点を作る（`DigestSection` / `DigestRaceCard` / `RateWithBaseline`）
  - `src/components/digest/` に新設し、`index.js` の barrel export を作る
  - `DigestRaceCard` の指標部分は **props の分岐ではなく `children` で差し替える**
  - 色は `design-tokens.css` の変数のみ。**ページ背景に直接乗るテキストは意味トークン（`--text-primary` / `--text-secondary`）必須**
  - 差分バッジは**色だけに頼らず ▲▼ の記号も付ける**
  - **受入基準**: 3コンポーネントが `nige`/`makuri`/`nigashi` の3セクションで再利用されている。モバイル320pxでページ全体の横スクロールが出ない

- [ ] **T4-3** `MorningDataDigest.jsx` とルーティング・SEOを実装する（T4-2と1PRにまとめてよい）
  - `src/AppRouter.jsx` に `<Route path="today" …>`。`TRANSLATED_PATHS` には**登録しない**（ja専用）
  - `useSocialMeta` の canonical は `?date=` の有無にかかわらず常に `/today`
  - 4状態（ローディング／取得失敗／該当0件／データ不完全）をすべて実装する（screens.md §6）。**セクションを消さない**
  - 選手名・会場名に `translate="no"`
  - **受入基準**: Playwrightで `/today` と `/today?date=2026-09-23` を開き、ライト／ダークの両方でスクリーンショットを撮って目視確認する。`document.querySelector('link[rel=canonical]')` が `?date=` 付きでも `/today` を指す

- [ ] **T4-4** 残りのコンポーネント4点（`FeaturedRaceCard` / `PeriodTrendSparkline` / `EntryCourseTendencyBar` / `FlyingRacerList` / `ReturnedRacerList`）を実装する
  - スパークラインはインラインSVG（Rechartsを使わない）
  - `PeriodTrendSparkline` は `racer_period_stats` 由来。**最新期が2026年2期であり「今期のデータは期終了後に反映される」旨をUIに出す**（spec FR-8）
  - **受入基準**: 推移が3期未満の選手でスパークラインが破綻しない。ダークモードでSVGのstrokeがページ背景に埋もれない

- [ ] **T4-5** ホーム（`VenueGridPage.jsx`）に `/today` への導線を1つ追加する
  - `TodaysVolatilityHighlights` の近傍
  - **受入基準**: 追加によってホームのCLSが悪化しない（要素の高さを確保する）。`npm run test:e2e` が通る

- [ ] **T4-6** `scripts/generate-sitemap.js` の `staticPages` に `/today` を追加する（**T4-3と同一PRで必須**）
  - **受入基準**: `npm run verify:sitemap` が通る

---

## Phase 5: SNS展開

- [ ] **T5-1** `generate-morning-digest.js` から `sns_topics` にネタを登録する（種別 `morning_digest`）
  - **受入基準**: 生成後に sns-hub 管理画面（`/admin/sns-hub`）にネタが現れる

- [ ] **T5-2** チャネル別の生成プロンプトに `morning_digest` を追加する（X / ブログ / note / YouTube）
  - `docs/operation/sns-pipeline-{x,blog,note,youtube}.md` に型を追記
  - 生成前に `getRecentRevisions()` と `getActiveInsights({platform, format, language})` を確認する（`.claude/rules/sns-content-generation.md`）
  - `checkRiskRules(text, platform)` を通し該当を `risk_flags` に記録（ブロックしない）
  - リンクは**常に `?date=` なしの `/today`**
  - 「競艇」使用禁止
  - **受入基準**: 4チャネルぶんの下書きが sns-hub の承認待ちに現れ、本文の数値が `morning_digest_rows` と一致する。**投稿の最終送信は行わない**（1件ごとにユーザーの明示承認）

- [ ] **T5-3** `/today` をAIスナップショットの対象に追加する
  - `scripts/generate-ai-snapshots.js` と `src/config/aiCrawlerBots.js` の `resolveSnapshotPath`
  - **静的な説明部分（ページの目的・各指標の定義）だけ**を生成する（`/winning-technique` と同じ方式。日替わりの中身は入らない）
  - **受入基準**: `npm run build` 後に `dist/ai-snapshots/today.html` が生成され、`scripts/verification/verify-ai-snapshots.js` が通る。**本番URLでの検証まで行う**（ローカルビルド成功は偽陽性になる実績あり）

---

## Phase 6: 仕上げ

- [ ] **T6-1** `docs/design/morning-data-digest/content-index.json` を作成する（フローA-2）
  - テンプレート: `docs/design/_template/content-index.json`
  - **受入基準**: `npm run verify:content-index` が通る

- [ ] **T6-2** ブログ記事を1本書く（フローA-3の新機能リリース必須ルール）
  - 本文2,000〜3,500字、見出しで構造化、実際のスクリーンショットを最低1枚、「よくある質問」セクション、内部リンク最低1本
  - `blogPosts.js` の `title` 30〜60字・`description` 120〜160字、カバー画像の alt は空にしない
  - **データを扱う記事なので、比較対象が3件以上あるものは表や図解で構造化する**
  - 公開前に spec §「ブログ記事の公開前品質チェック」の6観点を実施し、合格/不合格を明示する
  - **受入基準**: `node scripts/maintenance/check-deprecated-terms.js` が通る。「競艇」が本文・見出し・UIに無い

- [ ] **T6-3** 完了監査と検証をまとめて実行する
  - このファイルの全チェックボックスと実際のコミット・コードを突き合わせる（記憶ではなくファイルと実コードの対応で判定する）
  - `npm run build` / `npm run test:e2e` / `npm run verify:sitemap` / `npm run verify:content-index` / `npm run verify:er-diagram` / `npm run verify:adr-numbers` / `npm run verify:migration-numbers` / `npm run verify:query-errors`
  - **新規のデータ集計機能なのでデータ精度の検証を独立ステップとして行う**（`.claude/rules/analysis.md`）。コードレビューとは別に「集計結果が実データと一致しているか」だけを見る
  - **受入基準**: 全コマンドが通り、データ精度検証の結果を完了報告に含める

---

## Phase 2 として切り離した範囲（このtasks.mdの対象外）

`race_special_notes` の `equipment_change` 区分に実例が無いため、**本日の途中追加選手・本日の中間整備**は対象外（spec §3）。関連: [BOA-319](https://linear.app/boat-ai/issue/BOA-319) / [BOA-320](https://linear.app/boat-ai/issue/BOA-320) / [BOA-328](https://linear.app/boat-ai/issue/BOA-328)。

**昨日の帰郷選手は T3-3 で Phase 1 に含む**（2026-09-24に格上げ。`race_entries` の日次差分で算出できると判明したため）。
