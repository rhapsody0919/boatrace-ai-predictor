/**
 * verify-db-apply.js の後半の場面（2/3）。verify ではない。
 * 判定と期待値は分ける前の verify-db-apply.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import path from "node:path";
import { psqlArgs, AUTO_TIMEOUTS, renderSummary, inspectMigration } from "../../lib/dbApplySql.js";
import { dbApplyWiring2, dbApplyWiring4 } from "./db-apply-scenes-1.js";

let ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2;

/** { の中身を割った 5/5 */
function dbApplyWiring5({ body, runLines, yml }) {
  let inRun = false;
  let runIndent = 0;
  for (const l of yml.split("\n")) {
    const start = /^(\s*)(?:- )?run:\s*(.*)$/.exec(l);
    if (start) {
      inRun = start[2] === "|";
      runIndent = start[1].length;
      if (!inRun) runLines.push(start[2]);
      continue;
    }
    if (inRun) {
      if (l.trim() !== "" && l.search(/\S/) <= runIndent) inRun = false;
      else runLines.push(l);
    }
  }
  check(
    "run に ${{ }} を直接書かない（式インジェクション）",
    runLines.length > 0 && !runLines.some((l) => l.includes("${{")),
    runLines.filter((l) => l.includes("${{")).join(" / "),
  );
  check("set -x を使わない", !/set -[a-wyz]*x/.test(yml));
  check(
    "checkout は commit SHA で固定",
    [...yml.matchAll(/uses: (\S+)/g)].every((m) => /@[0-9a-f]{40}$/.test(m[1])),
  );
  check(
    "inspect・apply は起動時のコミット（github.sha）を取り出す",
    (body("inspect").match(/ref: \$\{\{ github\.sha \}\}/g) ?? []).length ===
      1 &&
      (body("apply").match(/ref: \$\{\{ github\.sha \}\}/g) ?? []).length === 1,
  );
  check(
    "inspect・apply は資格情報を残さない",
    /persist-credentials: false/.test(body("inspect")) &&
      /persist-credentials: false/.test(body("apply")),
  );
  check(
    "master 以外からの起動を落とす",
    /refs\/heads\/master/.test(body("inspect")),
  );
  check(
    "apply は承認前の sha256 を受け取る",
    /needs\.inspect\.outputs\.sha256/.test(body("apply")),
  );
}

/** { の中身を割った 2/13 */
function dbApplyWorkflow2() {
  const jobs = {};
  return { jobs };
}

/** { の中身を割った 4/13 */
function dbApplyWorkflow4({ jobs, yml }) {
  const body = (job) => (jobs[job] ?? []).join("\n");
  check("試運転の印 DB_APPLY_DRY_RUN は \"true\" か \"false\" の文字", /^ {2}DB_APPLY_DRY_RUN: "(true|false)"$/m.test(yml));
  check("切り替えのコミットは40桁の SHA で固定", /^ {2}DB_APPLY_SWITCH_SHA: [0-9a-f]{40}$/m.test(yml));
  check("workflow 全体に concurrency を掛けない（承認待ちの間も定期の起動が動き、6時間の通知を出せる）", !/^concurrency:/m.test(yml));
  check(
    "DB に当てる job は同じ group の job ごとの concurrency",
    ["apply", "apply-auto", "apply-gated"].every((j) => /concurrency:\n {6}group: db-apply-db\n {6}cancel-in-progress: false/.test(body(j))),
  );
  check(
    "手での起動の inspect は workflow_dispatch の mode=manual だけ（mode=reconcile では動かさない）",
    /github\.event_name == 'workflow_dispatch' &&\s+inputs\.mode != 'reconcile'/.test(body("inspect")),
  );
  // 定期の起動の条件（schedule か dispatch の mode=reconcile。docs/design/db-apply-automation-finish/plan.md §2）
  const periodic = /\(github\.event_name == 'schedule' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.mode == 'reconcile'\)\)/;
  check(
    "reconcile は定期の起動（schedule か dispatch の mode=reconcile）だけ・審査の App の ID が入るまで動かない",
    periodic.test(body("reconcile")) && /vars\.REVIEWER_BOT_USER_ID != ''/.test(body("reconcile")),
  );
  check(
    "reconcile の入口で、master 以外の ref と、ファイルの付いた mode=reconcile を落とす",
    /REF: \$\{\{ github\.ref \}\}/.test(body("reconcile")) &&
      /"\$REF" != "refs\/heads\/master"/.test(body("reconcile")) &&
      /MIGRATION: \$\{\{ inputs\.migration \}\}/.test(body("reconcile")) &&
      /if \[ -n "\$MIGRATION" \]; then\n\s+echo "::error::[^\n]*\n\s+exit 1/.test(body("reconcile")),
  );
  check(
    "notify も定期の起動（schedule か dispatch の mode=reconcile）だけ",
    periodic.test(body("notify")) && !/github\.event_name == 'schedule' && needs/.test(body("notify")),
  );
  check(
    "record は台帳に書くファイルと sha256 を起動の種類で分ける（`a || b` で混ぜない）",
    !/inputs\.migration \|\|/.test(body("record")) &&
      !/needs\.inspect\.outputs\.sha256 \|\|/.test(body("record")) &&
      /MANUAL: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.mode != 'reconcile' \}\}/.test(body("record")) &&
      (body("record").match(/steps\.target\.outputs\.migration/g) ?? []).length === 2,
  );
  return { body };
}

/** { の中身を割った 6/13 */
function dbApplyWorkflow6({ body }) {
  check("judge は reconcile が選んだときだけ", /if: needs\.reconcile\.outputs\.status == 'selected'/.test(body("judge")));
  check(
    "apply-auto は mode auto・Environment production-db-auto・apply-auto コマンド",
    /if: needs\.judge\.outputs\.mode == 'auto'/.test(body("apply-auto")) &&
      /^ {4}environment: production-db-auto$/m.test(body("apply-auto")) &&
      /db-apply\.js apply-auto /.test(body("apply-auto")),
  );
  check(
    "apply-gated は mode gated・Environment production-db・apply-gated コマンド",
    /if: needs\.judge\.outputs\.mode == 'gated'/.test(body("apply-gated")) &&
      /^ {4}environment: production-db$/m.test(body("apply-gated")) &&
      /db-apply\.js apply-gated /.test(body("apply-gated")),
  );
  check("reconcile・judge は Environment を持たない", ["reconcile", "judge"].every((j) => !/environment:/.test(body(j))));
  check(
    "record は手での起動か定期の起動の適用が成功したときだけ",
    /needs\.apply\.result == 'success'/.test(body("record")) &&
      /needs\.apply-auto\.result == 'success'/.test(body("record")) &&
      /needs\.apply-gated\.result == 'success'/.test(body("record")),
  );
}

/** { の中身を割った 8/13 */
function dbApplyWorkflow8({ body }) {
  check("notify は Environment prod-jobs（Slack の鍵）", /^ {4}environment: prod-jobs$/m.test(body("notify")));
  check(
    "notify は知らせることがありうるときだけ動く（selected・blocked・承認待ち）",
    /status == 'selected'/.test(body("notify")) && /status == 'blocked'/.test(body("notify")) && /stale != '\[\]'/.test(body("notify")),
  );
}

/** { の中身を割った 11/13 */
function dbApplyWorkflow11() {
  const dir = path.join(ROOT, ".github/workflows");
  return { dir };
}

/** { の中身を割った 13/13 */
function dbApplyWorkflow13({ autoUsers }) {
  check("Environment production-db-auto を使うのは db-apply.yml だけ", eq(autoUsers, ["db-apply.yml"]), autoUsers.join(", "));
  const auto = psqlArgs("single-transaction", "docs/db-migration/999_x.sql", AUTO_TIMEOUTS);
  check(
    "自動の経路は statement を短く（120s）、lock はファイルの SET LOCAL の上限と同じ10s",
    auto.includes("SET lock_timeout = '10s'") && auto.includes("SET statement_timeout = '120s'"),
    auto.join(" "),
  );
}

// 8b. production-db の secret を読めるのは db-apply.yml だけ（他のワークフローが environment: production-db を宣言すると、
//     承認画面では区別できないまま同じ鍵が渡る）
/** { の中身を割った 1/3 */
function dbApplyEnvUsers1() {
  const dir = path.join(ROOT, ".github/workflows");
  return { dir };
}

/** { の中身を割った 3/3 */
function dbApplyEnvUsers3({ users }) {
  check(
    "Environment production-db を使うのは db-apply.yml だけ",
    eq(users, ["db-apply.yml"]),
    users.join(", "),
  );
}

// 9. 承認画面（job summary）
/** { の中身を割った 1/3 */
export function dbApplyClassify1() {
  const summaryOf = (sql) =>
    renderSummary({
      path: "docs/db-migration/999_x.sql",
      sha256: "0".repeat(64),
      sql,
      inspection: inspectMigration(sql),
      fileUrl: "https://example.invalid/x",
      alreadyApplied: false,
    });
  const tableRows = (md) =>
    md
      .split("\n")
      .filter((l) => /^\| `/.test(l) && !/^\| [0-9]/.test(l));

  // 引用識別子には ` | < 改行を入れられる。コードスパンを抜けて表を壊したり HTML を差し込んだりさせない
  const evil = summaryOf(
    'CREATE TABLE "a`<details><summary>確認済み</summary>|x" (id int);\n',
  );
  const evilRow = tableRows(evil)[0] ?? "";
  check(
    "触るテーブル: 識別子の ` でコードスパンを抜けない",
    (evilRow.match(/`/g) ?? []).length === 2,
    evilRow,
  );
  check(
    "触るテーブル: 識別子の | で列を増やさない",
    evilRow.split(/(?<!\\)\|/).length === 4,
    evilRow,
  );
  const stmtRows = evil
    .split("\n")
    .filter((l) => /^\| [0-9]+ \| `/.test(l));
  check(
    "文の一覧: 識別子の ` でコードスパンを抜けない",
    stmtRows.length === 1 && (stmtRows[0].match(/`/g) ?? []).length === 2,
    stmtRows.join(" / "),
  );

  // 冒頭コメントの見出しは地の文に出る。HTML・強調を解釈させない
  const heading = summaryOf(
    "-- <details><summary>x</summary> **済** 確認:\n--   SELECT 1;\nSELECT 1;\n",
  );
  const headingLine =
    heading.split("\n").find((l) => l.includes("確認") && l.startsWith("**")) ??
    "";
  check(
    "確認 SQL の見出し: < > と * をエスケープする",
    headingLine.includes("&lt;details&gt;") &&
      !headingLine.includes("<details>") &&
      headingLine.includes("\\*\\*済\\*\\*"),
    headingLine,
  );

  // 見えない制御文字（Trojan Source）
  for (const [label, ch] of [
    ["RLO（U+202E）", "\u202E"],
    ["LRI（U+2066）", "\u2066"],
    ["ゼロ幅スペース（U+200B）", "\u200B"],
    ["BOM（U+FEFF）", "\uFEFF"],
  ]) {
    check(
      `見えない制御文字は拒否: ${label}`,
      rejects(`SELECT 1; -- a${ch}b\n`).some((r) => r.includes("見えない制御文字")),
    );
  }
  check(
    "日本語のコメントは拒否しない",
    rejects("-- 日本語のコメント（全角）\nSELECT 1;\n").length === 0,
  );

  // 長い行は注意を出す
  const long = summaryOf(`SELECT 1;${" ".repeat(300)}DROP TABLE t;\n`);
  check("200字を超える行には注意を出す", /200 字を超える行がある（1行目/.test(long));
  check(
    "短い行だけなら注意を出さない",
    !/字を超える行がある/.test(summaryOf("SELECT 1;\n")),
  );
  return { summaryOf };
}

function scene1() {
  {
    const { yml } = dbApplyWiring1();
    const { jobs } = dbApplyWiring2();
    dbApplyWiring3({ jobs, yml });
    const { body, runLines } = dbApplyWiring4({ jobs, yml });
    dbApplyWiring5({ body, runLines, yml });
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・eq・rejects・dbApplyWiring1・dbApplyWiring3・dbApplyWorkflow1・dbApplyWorkflow3・dbApplyWorkflow5・dbApplyWorkflow7・dbApplyWorkflow9・dbApplyWorkflow10・dbApplyWorkflow12・dbApplyEnvUsers2） */
export function runDbApplyScenes7(env) {
  ({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 } = env);
  scene1();
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・eq・rejects・dbApplyWiring1・dbApplyWiring3・dbApplyWorkflow1・dbApplyWorkflow3・dbApplyWorkflow5・dbApplyWorkflow7・dbApplyWorkflow9・dbApplyWorkflow10・dbApplyWorkflow12・dbApplyEnvUsers2） */
export function runDbApplyScenes8(env) {
  ({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・eq・rejects・dbApplyWiring1・dbApplyWiring3・dbApplyWorkflow1・dbApplyWorkflow3・dbApplyWorkflow5・dbApplyWorkflow7・dbApplyWorkflow9・dbApplyWorkflow10・dbApplyWorkflow12・dbApplyEnvUsers2） */
export function runDbApplyScenes9(env) {
  ({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・eq・rejects・dbApplyWiring1・dbApplyWiring3・dbApplyWorkflow1・dbApplyWorkflow3・dbApplyWorkflow5・dbApplyWorkflow7・dbApplyWorkflow9・dbApplyWorkflow10・dbApplyWorkflow12・dbApplyEnvUsers2） */
export function runDbApplyScenes10(env) {
  ({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・eq・rejects・dbApplyWiring1・dbApplyWiring3・dbApplyWorkflow1・dbApplyWorkflow3・dbApplyWorkflow5・dbApplyWorkflow7・dbApplyWorkflow9・dbApplyWorkflow10・dbApplyWorkflow12・dbApplyEnvUsers2） */
export function runDbApplyScenes11(env) {
  ({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・eq・rejects・dbApplyWiring1・dbApplyWiring3・dbApplyWorkflow1・dbApplyWorkflow3・dbApplyWorkflow5・dbApplyWorkflow7・dbApplyWorkflow9・dbApplyWorkflow10・dbApplyWorkflow12・dbApplyEnvUsers2） */
export function runDbApplyScenes12(env) {
  ({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 } = env);

}

function scene2() {
  {
    const { yml } = dbApplyWorkflow1();
    const { jobs } = dbApplyWorkflow2();
    dbApplyWorkflow3({ jobs, yml });
    const { body } = dbApplyWorkflow4({ jobs, yml });
    dbApplyWorkflow5({ body });
    dbApplyWorkflow6({ body });
    dbApplyWorkflow7();
    dbApplyWorkflow8({ body });
    dbApplyWorkflow9();
    dbApplyWorkflow10();
    const { dir } = dbApplyWorkflow11();
    const { autoUsers } = dbApplyWorkflow12({ dir });
    dbApplyWorkflow13({ autoUsers });
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・eq・rejects・dbApplyWiring1・dbApplyWiring3・dbApplyWorkflow1・dbApplyWorkflow3・dbApplyWorkflow5・dbApplyWorkflow7・dbApplyWorkflow9・dbApplyWorkflow10・dbApplyWorkflow12・dbApplyEnvUsers2） */
export function runDbApplyScenes13(env) {
  ({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 } = env);
  scene2();
}

function scene3() {
  {
    const { dir } = dbApplyEnvUsers1();
    const { users } = dbApplyEnvUsers2({ dir });
    dbApplyEnvUsers3({ users });
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・eq・rejects・dbApplyWiring1・dbApplyWiring3・dbApplyWorkflow1・dbApplyWorkflow3・dbApplyWorkflow5・dbApplyWorkflow7・dbApplyWorkflow9・dbApplyWorkflow10・dbApplyWorkflow12・dbApplyEnvUsers2） */
export function runDbApplyScenes14(env) {
  ({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 } = env);
  scene3();
}
