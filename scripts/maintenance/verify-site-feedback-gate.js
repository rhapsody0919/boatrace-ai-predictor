/**
 * verify-site-feedback-gate.js - ご意見ボックスを全画面につなぐ前の関門（画面の決まりは verify-site-feedback.js、
 * 表は verify-site-feedback-migration.js）。
 *
 * 1. 画面の列挙（src/pure/siteFeedback.js）と、表（docs/db-migration/NNN_site_feedback.sql）の CHECK の列挙・上限が同じこと
 *    （ずれると、その値の送信が全部「送れませんでした」になり、どこにも残らない）
 * 2. 出す順番の関門: 台帳（docs/db-migration/APPLIED.md）で表が「適用済み」でなければ赤にする
 *    （表が本番に無いまま画面を出すと、全員の送信が失敗する。db-apply が成功すると台帳が適用済みになる）
 * （ポリシーを画面より先に入れる順番は、E2E の site-feedback-placement.spec.js が /privacy の表示で見る）
 *
 * 実行: node scripts/maintenance/verify-site-feedback-gate.js
 */
import {
  FEEDBACK_KINDS,
  FEEDBACK_LANGS,
  FEEDBACK_MAX_COMMENT,
  FEEDBACK_MAX_RATING,
  FEEDBACK_PAGE_TYPES,
} from "../../src/pure/siteFeedback.js";
import { isAppliedInLedger } from "../lib/dbApplySql.js";
import { readSiteFeedbackTable } from "./verifyData/site-feedback-ledger.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`[OK] ${label}`);
  else {
    failures++;
    console.error(`[NG] ${label}${detail ? `: ${detail}` : ""}`);
  }
}

const { file: migrationFile, sql, ledger } = readSiteFeedbackTable();
check(
  "表のマイグレーション（NNN_site_feedback.sql）がある",
  !!migrationFile,
  "表の PR（claude/site-feedback-db-v2）が master に入っていない",
);
if (migrationFile) {
  // 名前つきの制約の IN (...) の中の文字列を取り出す
  const listOf = (name) => {
    const m = sql.match(
      new RegExp(`CONSTRAINT ${name} CHECK \\([\\s\\S]*?IN \\(([^)]*)\\)`),
    );
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort() : null;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify([...b].sort());
  for (const [name, screen] of [
    ["site_feedback_kind", FEEDBACK_KINDS],
    ["site_feedback_page_type", FEEDBACK_PAGE_TYPES],
    ["site_feedback_lang", FEEDBACK_LANGS],
  ]) {
    const table = listOf(name);
    check(
      `列挙: 画面と表の ${name} が同じ`,
      table && same(table, screen),
      `表 ${JSON.stringify(table)} / 画面 ${JSON.stringify(screen)}`,
    );
  }
  check(
    "上限: 表の内容の上限が画面と同じ",
    sql.includes(`char_length(comment) <= ${FEEDBACK_MAX_COMMENT}`),
  );
  check(
    "上限: 表の満足度の範囲が画面と同じ",
    sql.includes(`rating BETWEEN 1 AND ${FEEDBACK_MAX_RATING}`),
  );
  check(
    `出す順番: 台帳で ${migrationFile} が適用済み`,
    isAppliedInLedger(ledger, migrationFile),
    "表が本番に無いまま画面を出すと、全員の送信が失敗する。オーナーが db-apply で当てた後に master を取り込む",
  );
}

if (failures > 0) {
  console.error(`\nverify-site-feedback-gate: NG（${failures} 件）`);
  process.exit(1);
}
console.log("\nverify-site-feedback-gate: OK");
