# ADR 0100: PR ゲートの e2e は差分で範囲を変える（記事だけは軽い組、docs だけは0件）

## ステータス

採用（2026-10-23、BOA-929・BOA-769。system-architect の審査 2026-10-22）

## 背景

PR ゲートの e2e（`.github/workflows/e2e-smoke-test.yml`）は、どの PR でも全テスト（2,234件）を3つの組に分けて流している。3つ目の組は `--grep-invert` の「残り全部」で、2026-10-21 の run 39527057420 では 1,467件が30分の上限で打ち切られ、445件しか終わらなかった（BOA-929）。

直近1か月（2026-09-23〜10-23）にマージした PR 943件を下の判定にかけると、次のとおり（gh pr list の files で判定。改名は新しいパスだけで数えた。ファイルが100を超えた2件は全部に数えた）。

| 範囲 | 件数 | 割合 |
|---|---|---|
| 0件（docs だけ） | 95 | 10.1% |
| 軽い組（記事の中身だけ、docs との混在を含む） | 25 | 2.7% |
| 全部 | 823 | 87.3% |

記事・docs だけの PR に全テストを流しても、見ているのは記事に関係しない画面で、待ち時間と並行の枠を使うだけになる。

## 決定

### 1. 範囲は3つ。許可の一覧に全ファイルが当たるときだけ軽くする

`scripts/maintenance/e2e-scope.js` が差分のパス（改名は元と先の両方）から決める。

| 範囲 | 条件 | 流すもの |
|---|---|---|
| `none` | 全ファイルが `e2eSkipPathPatterns`（`docs/`。`docs/content-manifests/` と、e2e が例の JSON を読む `docs/design/blog-charts/` は除く）に当たる | 何も流さずに成功 |
| `light` | 全ファイルが `allowedPathPatterns`（記事の中身だけの PR の許可の一覧）か `e2eSkipPathPatterns` に当たる | `vite build` と `@blog` の試験（114件） |
| `full` | それ以外。空の差分・判定できないときも | 従来どおり全部 |

- 一覧は `scripts/content/content-pr-gate.json` を読む（記事の PR の関門と同じ一覧。写さない）。`.github`・`scripts`・`src`（記事の JSON を除く）・`e2e`・`package*.json`・vite/playwright の設定は一覧に無いので、触れば必ず `full` になる
- 記事の JSON は `src/data/blogPosts.js` の `import.meta.glob`（eager）で画面の束に入り、1つ壊れると全体が壊れる。そのため軽い組でも `vite build` と記事に関わる試験は残す
- e2e が `../docs/` から読むファイル（今は `docs/design/blog-charts/` の例の JSON）は0件の対象から外す。`verify-e2e-scope.js` が e2e の中の `../docs/` の読み込みを拾い、0件にならないことを確かめる
- 記事の JSON はホーム（最新記事のカード）でも描画するので、ホーム（`/`・`/en` 等）を開く試験にも印を付ける
- 記事に関わる試験には題に `@blog` を付ける。付け漏れは `scripts/maintenance/check-e2e-blog-tags.js` が、`check-e2e-shard-coverage.js` と同じく `--list` の一覧を読んで落とす（題・本体に `/blog`・記事のデータ・記事の部品の class があるのに印が無いもの）

### 2. 必須のチェックの名前は `e2e` のまま

範囲を決めるジョブ `e2e-scope`、全部の組 `e2e-shard`、軽い組 `e2e-light` を並べ、集約ジョブ `e2e` が範囲ごとに走るべきジョブの成否で合否を決める。集約ジョブは `if: always()` のまま（ADR-0097）で、範囲は step summary に出す。範囲が分からないときは失敗にする。

### 3. 抜け道を2段で塞ぐ

- **ワークフロー**: 判定のスクリプトと一覧は base（マージコミットの1つ目の親）側のものを取り出して実行する。PR の側で一覧やスクリプトを書き換えても、その PR には効かない。base に無ければ `full`
- **マージ時**: `pull_request` のワークフロー自体は PR の側の定義で動くので、`.github` を書き換えれば軽い組に逃げられる。`scripts/maintenance/guard-pr-merge.js` が `origin/master` の一覧で差分を判定し直し、`full` なのに `e2e-shard` が全部成功していなければ（skip を含む）止める。`--auto` で GitHub にチェックを任せる場合は `e2e` の集約しか見られないので、`.github/workflows` を変える PR は手のマージに回す
- `pull_request_target` は使わない（PR のコードを秘密の鍵のある文脈で動かすことになるため）

### 4. 組の分け方は e2e/shards.json の1か所に置き、所要時間で割る（BOA-929 の 2）

以前は `e2e-smoke-test.yml` の `e2e-shard` と `e2e-rerecord.yml` の `replay` の matrix に、同じ分け方を2回手で書いていた。最後の組の `--grep-invert` の正規表現も手で書いていた。3つ目の組は「残り全部」なので、spec が増えるたびに重くなった。2026-10-23 の実測（run 39870857258、全2,234件・合計8,626 worker 秒）では、3つ目の組だけで約3,700 worker 秒あった。2026-10-21 の再生（run 39527057420）では、30分の上限で打ち切られている。

- 分け方は `e2e/shards.json` に置く。`scripts/maintenance/e2e-shards.js --matrix` がこれを両ワークフローの matrix に直す。`check-e2e-shard-coverage.js` も同じファイルを読み、分け方の誤りを先に出す
- 件数でなく、実測の所要（worker 秒）で5組に割る。layout.spec.js は5つの幅（プロジェクト）を2組に分ける。`smoke` プロジェクトは layout.spec.js を無視し、`layout-*` は layout.spec.js だけに当たるので、`--project` を並べれば layout の一部の幅と他の spec を1つの組に混ぜられる
- 最後の組は `rest: true` で、上の組に書いた spec を除く残り全部。新しい spec は自動でここに入る

| 組 | 中身 | worker 秒 |
|---|---|---|
| 1 | smoke.spec.js | 1,784 |
| 2 | layout（mobile・tablet・laptop）＋ race-odds-live | 1,780 |
| 3 | layout（desktop・wide）＋ thinking-assist-states ＋ race-share-text | 1,754 |
| 4 | analogy-contribution ほか10本 | 1,637 |
| 5 | 残り全部 | 約1,670 |

replay の `timeout-minutes`（30）は、組を増やした効果を測ってから見直す。

## ADR-0077 との関係

ADR-0077（録画の再生と時計の固定）は変えない。軽い組も同じ録画を再生し、録画に無い通信は同じく本番へ素通しして一覧を出す。この ADR は「どのテストを流すか」だけを決め、「どう流すか」は ADR-0077 のまま。

## 結果

- 直近1か月の実績では、約13%の PR が e2e の全部を流さずに済む（0件 10.1%、軽い組 2.7%）
- 3つ目の組が重い問題は、下の「4. 組の分け方」で直す（BOA-929 の 2、別の PR）
- `.claude/` だけの PR（46件、4.9%）は今回は `full` のまま。hooks のスクリプトを含むため、一覧に足すかは別に決める
