/**
 * facts の表の絞りの設定（boatai.facts_racer_id）を立てる道が get_racer_runs だけかを、SQL の文で照らす規則（ADR-0113 決定4 の (a)〜(e)）。
 * 読み書きはしない純関数。verify-facts-racer-guc.js がマイグレーションと schema-snapshot.json の関数に当てる
 */
export const GUC = "boatai.facts_racer_id";

/** 注釈（-- と /* *\/）を空白にする。文字列（'…'）と $タグ$ の中は残す */
export function stripComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      const end = sql.indexOf("'", i + 1);
      const stop = end < 0 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
    } else if (c === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (!tag) {
        out += c;
        i += 1;
        continue;
      }
      const end = sql.indexOf(tag[0], i + tag[0].length);
      const stop = end < 0 ? sql.length : end + tag[0].length;
      out += sql.slice(i, stop);
      i = stop;
    } else if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
    } else if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += " ";
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** 注釈を除いた SQL を、文字列と $ 引用の外の ; で文に分ける */
export function splitTopLevel(sql) {
  const text = stripComments(sql);
  const out = [];
  let cur = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const tag = c === "$" ? /^\$[A-Za-z_]*\$/.exec(text.slice(i)) : null;
    if (c === "'" || tag) {
      const q = tag ? tag[0] : "'";
      const end = text.indexOf(q, i + q.length);
      const stop = end < 0 ? text.length : end + q.length;
      cur += text.slice(i, stop);
      i = stop;
    } else if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      i += 1;
    } else {
      cur += c;
      i += 1;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const RACER_RUNS = /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?get_racer_runs\s*\(/i;
const FACTS_POLICY = /^CREATE\s+POLICY\s+\w+\s+ON\s+(?:public\.)?(?:run_facts|race_facts)\b/i;
const COMMENT = /^COMMENT\s+ON\b/i;
const FUNCTION = /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i;

/** 1つの文の違反（文字列の配列）。where は報告に使う場所の名前 */
export function statementErrors(stmt, where) {
  const errors = [];
  const isRacerRuns = RACER_RUNS.test(stmt);
  if (stmt.includes(GUC) && !isRacerRuns && !FACTS_POLICY.test(stmt) && !COMMENT.test(stmt)) {
    errors.push(`${where}: ${GUC} は get_racer_runs とファクトの表のポリシーの外で使わない`);
  }
  const isAlterDefault = /^ALTER\s+(?:ROLE|DATABASE|USER)\b[\s\S]*\bSET\s+"?boatai\./i.test(stmt);
  if (isAlterDefault) {
    errors.push(`${where}: ロール・DB の既定で boatai.〜 を立てない`);
  } else if (!isRacerRuns && /(?:^|\s)SET\s+(?:LOCAL\s+|SESSION\s+)?"?boatai\./i.test(stmt)) {
    errors.push(`${where}: boatai.〜 を SET で立てない`);
  }
  if (FUNCTION.test(stmt) && /set_config\s*\(\s*(?!')/i.test(stmt)) {
    errors.push(`${where}: set_config の第1引数は文字列の直書きにする`);
  }
  return errors;
}

/** get_racer_runs の定義が決定4 の形か（違反の配列） */
export function racerRunsErrors(stmt) {
  const errors = [];
  if (/\bSECURITY\s+DEFINER\b/i.test(stmt)) errors.push("get_racer_runs: SECURITY DEFINER にしない");
  if (!/\bSECURITY\s+INVOKER\b/i.test(stmt)) errors.push("get_racer_runs: SECURITY INVOKER を明示する");
  // 関数の SET 句は、本番の postgres（superuser でない）が未知の設定に作れない（212 の db-apply の失敗、2026-11-27）
  if (/\bSET\s+"?boatai\./i.test(stmt)) errors.push(`get_racer_runs: ${GUC} を関数の SET 句で立てない（本番で作れない）`);
  const guc = GUC.replace(".", "\\.");
  const calls = [...stmt.matchAll(new RegExp(`set_config\\s*\\(\\s*'${guc}'\\s*,\\s*([^,]+?)\\s*,\\s*(\\w+)\\s*\\)`, "gi"))];
  if (!calls.some((c) => c[1] !== "''" && c[2].toLowerCase() === "true")) {
    errors.push(`get_racer_runs: set_config('${GUC}', …, true) で立てる（第3引数は true）`);
  }
  if (!calls.some((c) => c[1] === "''" && c[2].toLowerCase() === "true")) {
    errors.push(`get_racer_runs: 読んだ後に set_config('${GUC}', '', true) で空に戻す`);
  }
  if (calls.some((c) => c[2].toLowerCase() !== "true")) errors.push(`get_racer_runs: set_config の第3引数は true だけ`);
  return errors;
}

/** SQL の全文の違反と、get_racer_runs の定義の数 */
export function checkSql(sql, where) {
  const errors = [];
  let racerRuns = 0;
  splitTopLevel(sql).forEach((stmt, i) => {
    errors.push(...statementErrors(stmt, `${where} の ${i + 1} 文目`));
    if (RACER_RUNS.test(stmt)) {
      racerRuns += 1;
      errors.push(...racerRunsErrors(stmt).map((e) => `${where}: ${e}`));
    }
  });
  return { errors, racerRuns };
}

/** schema-snapshot.json の関数（定義は行の配列、設定は 'name=value' の配列）の違反 */
export function snapshotFunctionErrors(functions) {
  const errors = [];
  for (const fn of functions) {
    if (fn.name === "get_racer_runs") continue;
    const def = Array.isArray(fn.definition) ? fn.definition.join("\n") : String(fn.definition ?? "");
    const where = `写しの ${fn.name}`;
    errors.push(...statementErrors(stripComments(def).trim(), where));
    for (const c of fn.config ?? []) {
      if (/^boatai\./i.test(c)) errors.push(`${where}: 関数の設定で boatai.〜 を立てない`);
    }
  }
  return errors;
}
