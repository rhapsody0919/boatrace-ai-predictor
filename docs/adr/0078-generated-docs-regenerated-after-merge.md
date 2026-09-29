# ADR 0078: 機械生成の文書はPRに含めず、masterへのマージ後にCIが作り直す

## ステータス

採用（2026-09-29）

## 背景

`docs/reference/shared-logic-index.md`（共通ロジックの索引、`generate-lib-index.js`）と `docs/reference/display-coverage.md`（表示カバレッジ台帳、`generate-display-coverage.js`）は、ソースから機械生成してコミットしている。これまでは PR ごとに `verify-lib-index.js`・`verify-display-coverage.js` が「コミット済みの生成物がソースと一致するか」を検査していたため、ソースを変えた PR は生成物も作り直して同じ PR に含める必要があった。

生成物の入力は `scripts/lib`・`src/utils`・`src/services`・`src/`・`api/`・`docs/db-migration/` と広く、ほぼ全 PR で変わる。PR がマージされるたびに master 側の生成物が変わり、並行している他の PR が同じファイルでコンフリクトしていた（索引は2026-09-25の導入から5日間で10コミット、台帳は09-28の導入から2日間で4コミット、master で変更された）。

同種の生成物を洗い出した結果、PR ごとに最新性を検査してコミットしているのはこの2本だけだった。`generate-er-diagram.js` は設計ごとの `plan.md` に貼る方式で全 PR 共通のファイルを持たない。`public/sitemap.xml`・`public/llms.txt` は既に `update-sitemap.yml` が定時に作り直してコミットしている。

## 検討: `.gitattributes` で解消できるか

依頼元の案は `.gitattributes` の `merge=ours` 等で自動解消し、最新性は CI で担保するものだった。公式情報と実験で確かめた。

- **GitHub のサーバー側マージは `.gitattributes` のマージドライバを使わない。** GitHub Support の回答として「ユーザー定義の .gitattributes は考慮しない（独自の .gitattributes を使い、変更できない）」が引用されている（[community discussion #9288](https://github.com/orgs/community/discussions/9288)、2021〜2026年時点で未解決）。組み込みの `merge=union` も効かず、Kubernetes はそれを理由に `.gitattributes` の union 指定を削除した（[kubernetes#70576](https://github.com/kubernetes/kubernetes/pull/70576)）。PR の mergeable 判定・Merge ボタン・`gh pr merge`（API 経由のサーバー側マージ）はいずれもこれに当たる
- **`merge=ours` は組み込みのドライバではない。** 組み込みは `text`・`binary`・`union` の3つだけ（[gitattributes](https://git-scm.com/docs/gitattributes)）。各クローンで `git config merge.ours.driver true` を設定しない限り、通常の3-wayマージになる。手元の実験（git 2.43）でも、設定なしではコンフリクトし、設定ありでは自分側が残った
- **`merge=union` は手元では両側の行を残す**（実験で `lineB` と `lineA` の両方が残った）。Markdown の表では行の重複・順序の崩れになり、生成物として誤りになる
- **`linguist-generated` は差分表示と言語統計にだけ効く**（[GitHub Docs](https://docs.github.com/en/repositories/working-with-files/managing-files/customizing-how-changed-files-appear-on-github)）。マージには影響しない

結論として、`.gitattributes` だけでは「PR がコンフリクト扱いになる」問題は消えない。

## 決定

(a) を採用する。

1. **生成物は PR に含めない。** `verify-generated-docs-not-in-pr.js`（ci tier）が `git diff --name-only --no-renames origin/master...HEAD` を見て、生成物の変更を含む PR を落とす
2. **PR で見るのは「抽出ロジックが正しいか」と「生成が成功するか」だけ。** `verify-lib-index.js`・`verify-display-coverage.js` は生成スクリプトを `--dry-run`（生成まで行い書き込まない）で呼ぶ。コミット済みの生成物との比較はやめる。表示カバレッジの例外登録に実在しないテーブルが残っている検査は、ソース側の誤りなので dry-run で引き続き落とす。抽出が壊れて生成物が空になる場合は、生成スクリプトが書き込み前に落とす
3. **master への push ごとに `.github/workflows/regenerate-generated-docs.yml` が作り直し、差分があればコミットする。** push は `scripts/maintenance/push-with-retry.sh`（BOA-360）で行う。権限は `update-sitemap.yml` と同じくワークフロー単位の `permissions: contents: write`。GITHUB_TOKEN による push は他のワークフローを起動しないので、ループしない。失敗時は Slack に通知する
4. 生成物の一覧は `scripts/maintenance/generated-docs.js` の `GENERATED_DOCS` 1か所に置き、ワークフローと検査の両方がそこを読む

### 比較

| 観点 | (a) マージ後にCIが再生成 | (b) git管理から外し参照時に生成 | (c) `.gitattributes`＋ドライバ |
|---|---|---|---|
| GitHub上のコンフリクト | 解消する（PRが生成物を持たない） | 解消する | **解消しない**（サーバー側マージがドライバを使わない） |
| masterの最新性 | pushごとに再生成。マージ直後の数十秒〜数分だけ古い | 常に生成しないと存在しない | 手元マージのたびに誰かが作り直す必要がある |
| 参照側への影響 | なし（ファイルは従来どおりリポジトリにある） | **大きい**。`.claude/rules/` が「書く前にこのファイルを引く」と指示しており、エージェントは生成せずに読む。worktreeごとに生成が要る。GitHub上でも読めなくなる | なし |
| 追加するもの | ワークフロー1本・検査1本・一覧1本 | 参照の全箇所に生成手順を足す | 全クローン・全worktree・CIに `git config` の設定 |
| 既存の verify との関係 | 最新性の比較をやめ、生成の成否と抽出ロジックの検査に置き換え | 比較対象が無くなる | 最新性の比較を維持できるが、コンフリクトは残る |
| 失敗したとき | Slack通知。次のpushで自然に直る | 参照時に失敗が見える | 手元でコンフリクトが残る |

## 結果

- 生成物の変更で他の PR がコンフリクトしなくなる
- master の生成物は、マージ後に1回ワークフローが走るまで（通常数十秒〜数分）古い。ワークフローが失敗した場合は Slack に通知され、次の push で作り直される
- 生成物の自動コミットは master への push なので、既存の `[automated]` コミット（sitemap・取得結果JSON等）と同じく Vercel の本番デプロイを1回余分に起動する。文書だけの変更なので画面には影響しない。抑止するには Vercel の Ignored Build Step が要り、全デプロイに影響するためこの ADR では扱わない
- この ADR 以前に作られ、生成物の変更を含んでいる PR は、`git checkout origin/master -- <生成物>` で戻してコミットし直す必要がある（検査のエラーメッセージに手順を出す）
- 生成物を手元で見たいときは作り直して読み、コミットせずに戻す（`.claude/rules/frontend-data-fetch.md` の6）

## 関連

- [ADR-0072](0072-verify-script-registry-and-ci.md)（検証スクリプトの台帳とCI）
- BOA-360（`push-with-retry.sh`）
