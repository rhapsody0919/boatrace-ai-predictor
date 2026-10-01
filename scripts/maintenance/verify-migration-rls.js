/**
 * verify-migration-rls.js - docs/db-migration/ の新規マイグレーションが、公開スキーマのテーブルを
 * RLSなし・匿名書き込み可のまま作っていないかを機械検査する（BOA-370の再発防止）。
 *
 * 背景: マイグレーション060〜071で作った16テーブルが、RLS無効のまま本番に入り、匿名キーで
 * 書き込み・削除できる状態になっていた（Supabaseは新規テーブルにanon/authenticatedの全権限を
 * 既定で付ける）。テーブル作成時にRLSを付ける規律を、記憶ではなく手元の検査で強制する。
 * verify-migration-numbers.js と同じ流儀（CI連携はせず、Claude自身が手元で実行する）。
 *
 * 検査対象: 番号が MIN_CHECKED_NUMBER 以上の NNN_*.sql（076以降。それ以前は凍結、076で一括是正済み）
 *
 * 失敗にする条件:
 *   1. CREATE TABLE（publicスキーマ、TEMPを除く）のテーブルに、同じファイル内で
 *      ALTER TABLE ... ENABLE ROW LEVEL SECURITY が無い
 *   2. GRANT で anon / authenticated / PUBLIC に INSERT/UPDATE/DELETE/TRUNCATE/ALL を付与している
 *   3. CREATE POLICY で FOR ALL/INSERT/UPDATE/DELETE を anon/authenticated/public（TO省略=public）に付与している
 *      （公開ポリシーは FOR SELECT のみ。書き込みはservice_role=RLS迂回で行う）
 *   4. CREATE VIEW で security_invoker を指定していない（ビューは所有者権限で基底テーブルのRLSを迂回する。
 *      security_invoker=true が要る。SELECTのみの内部用ビューで意図的な場合は除外マーカーを付ける）
 *   6. 【113番以降】CREATE [OR REPLACE] FUNCTION（publicスキーマ）の関数に、同じファイル内で
 *      GRANT EXECUTE / REVOKE ... ON FUNCTION が無い（112で既定のEXECUTE付与を剥奪したため、
 *      匿名に呼ばせるかどうかを関数ごとに明示させる。BOA-575）
 *   7. 【113番以降】SECURITY DEFINER の関数の EXECUTE を anon / authenticated / PUBLIC に付与している
 *      （所有者権限でRLSを迂回する関数を匿名に公開しない）
 * 警告のみ:
 *   5. RLS有効＋SELECTポリシーがあるのに GRANT SELECT が無い（076で既定権限を剥奪済みのため、
 *      匿名からは読めない。読ませたいなら GRANT SELECT ON ... TO anon, authenticated を書く）
 *
 * 意図的な例外は、該当行の直前または同じ文の中に除外マーカーを書く（理由を必ず添える）:
 *   -- rls-exempt: <テーブル名> <理由>      （1: RLSを付けないテーブル）
 *   -- grant-exempt: <理由>                  （2・3: 書き込み権限・書き込みポリシー）
 *   -- view-exempt: <ビュー名> <理由>        （4）
 *   -- function-exempt: <関数名> <理由>      （6・7）
 * 除外マーカーはレビューで理由を確認すること。
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = path.join(__dirname, "../../docs/db-migration");
/** これ以降の番号を検査する（076=RLS一括是正のマイグレーション） */
export const MIN_CHECKED_NUMBER = 76;
/** 関数の権限の明示（6・7）を検査する番号（112=関数の既定EXECUTEの剥奪。113以降が対象） */
export const FUNCTION_GRANT_MIN_NUMBER = 113;

const stripComments = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const norm = (name) =>
  name
    .replace(/^public\./i, "")
    .replace(/"/g, "")
    .toLowerCase();

function exemptions(sql, kind) {
  const re = new RegExp(`--\\s*${kind}:\\s*([^\\s]+)?`, "gi");
  const set = new Set();
  let m;
  while ((m = re.exec(sql))) if (m[1]) set.add(norm(m[1]));
  return { set, any: new RegExp(`--\\s*${kind}:`, "i").test(sql) };
}

/** SQL文字列を検査し、{errors, warnings} を返す（純関数）。number はマイグレーション番号（6・7の適用判定） */
export function checkMigrationSql(sql, { number = Infinity } = {}) {
  const errors = [];
  const warnings = [];
  const body = stripComments(sql);
  const rlsExempt = exemptions(sql, "rls-exempt");
  const grantExempt = exemptions(sql, "grant-exempt");
  const viewExempt = exemptions(sql, "view-exempt");
  const functionExempt = exemptions(sql, "function-exempt");

  // 1. CREATE TABLE と RLS有効化
  const created = [];
  const createRe =
    /CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)/gi;
  let m;
  while ((m = createRe.exec(body))) {
    const raw = m[1];
    if (/^"?(?!public\b)[\w]+"?\./i.test(raw)) continue; // public以外のスキーマ
    created.push(norm(raw));
  }
  const enabled = new Set();
  const enableRe =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
  while ((m = enableRe.exec(body))) enabled.add(norm(m[1]));
  for (const t of new Set(created)) {
    if (!enabled.has(t) && !rlsExempt.set.has(t)) {
      errors.push(
        `テーブル ${t}: ENABLE ROW LEVEL SECURITY が無い（匿名キーで読み書きできてしまう）。` +
          `意図的なら "-- rls-exempt: ${t} <理由>" を書く`,
      );
    }
  }

  // 2. 書き込み権限のGRANT
  const grantRe =
    /GRANT\s+([\s\S]*?)\s+ON\s+(?:TABLE\s+|ALL\s+TABLES\s+IN\s+SCHEMA\s+)?([\s\S]*?)\s+TO\s+([^;]+);/gi;
  while ((m = grantRe.exec(body))) {
    const privs = m[1];
    const grantees = m[3];
    if (/\bEXECUTE\b|\bUSAGE\b/i.test(privs)) continue;
    if (!/\b(anon|authenticated|public)\b/i.test(grantees)) continue;
    if (/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALL)\b/i.test(privs)) {
      if (!grantExempt.any) {
        errors.push(
          `GRANT ${privs.trim()} ON ${m[2].trim()} TO ${grantees.trim()}: ` +
            `anon/authenticated/PUBLICに書き込み権限を付けない（SELECTのみ）。` +
            `意図的なら "-- grant-exempt: <理由>" を書く`,
        );
      }
    }
  }

  // 3. 書き込みポリシー
  const policyRe =
    /CREATE\s+POLICY\s+("[^"]+"|[\w]+)\s+ON\s+((?:"?[\w]+"?\.)?"?[\w]+"?)([^;]*);/gi;
  const hasSelectPolicy = new Set();
  while ((m = policyRe.exec(body))) {
    const rest = m[3];
    const table = norm(m[2]);
    const forMatch = rest.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i);
    const cmd = (forMatch ? forMatch[1] : "ALL").toUpperCase(); // FOR省略=ALL
    const to = rest.match(/\bTO\s+([\w,\s"]+?)(?:\s+USING|\s+WITH|$)/i);
    const roles = to ? to[1] : "public";
    const open = /\b(anon|authenticated|public)\b/i.test(roles);
    if (cmd === "SELECT" && open) hasSelectPolicy.add(table);
    if (cmd !== "SELECT" && open && !grantExempt.any) {
      errors.push(
        `POLICY ${m[1]} ON ${table}: FOR ${cmd} を anon/authenticated/public に付けない` +
          `（公開ポリシーは FOR SELECT のみ）。意図的なら "-- grant-exempt: <理由>" を書く`,
      );
    }
  }

  // 4. ビューの security_invoker
  const viewRe =
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?VIEW\s+((?:"?[\w]+"?\.)?"?[\w]+"?)([\s\S]*?)\bAS\b/gi;
  while ((m = viewRe.exec(body))) {
    const name = norm(m[1]);
    if (/security_invoker\s*=\s*(true|on|1)/i.test(m[2])) continue;
    const alter = new RegExp(
      `ALTER\\s+VIEW\\s+(?:public\\.)?"?${name}"?\\s+SET\\s*\\(\\s*security_invoker\\s*=\\s*(true|on|1)`,
      "i",
    );
    if (alter.test(body) || viewExempt.set.has(name)) continue;
    errors.push(
      `ビュー ${name}: security_invoker=true が無い（所有者権限で基底テーブルのRLSを迂回する）。` +
        `WITH (security_invoker = true) を付ける。意図的なら "-- view-exempt: ${name} <理由>" を書く`,
    );
  }

  // 6・7. 関数の権限の明示と、SECURITY DEFINER の匿名公開
  if (number >= FUNCTION_GRANT_MIN_NUMBER) {
    // 関数本文（ドル引用）の中の文字列を拾わないよう、本文を印に置き換えてから探す。
    // 本文が消えるので、CREATE FUNCTION 文は次の ; で終わる（SECURITY DEFINER が本文の前後どちらにあっても拾える）
    const outer = body.replace(
      /\$([\w]*)\$[\s\S]*?\$\1\$/g,
      () => " __BODY__ ",
    );
    const fnRe =
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:"?[\w]+"?\.)?"?[\w]+"?)\s*\(([^;]*);/gi;
    while ((m = fnRe.exec(outer))) {
      const raw = m[1];
      if (/^"?(?!public\b)[\w]+"?\./i.test(raw)) continue; // public以外のスキーマ
      const name = norm(raw);
      if (functionExempt.set.has(name)) continue;
      const onFn = `ON\\s+FUNCTION\\s+(?:public\\.)?"?${name}"?\\s*\\(`;
      const grantRe2 = new RegExp(
        `GRANT\\s+[^;]*\\bEXECUTE\\b[^;]*${onFn}[^;]*;`,
        "gi",
      );
      const revokeRe2 = new RegExp(`REVOKE\\s+[^;]*${onFn}`, "i");
      const grants = outer.match(grantRe2) ?? [];
      if (grants.length === 0 && !revokeRe2.test(outer)) {
        errors.push(
          `関数 ${name}: GRANT EXECUTE / REVOKE が無い（112で既定のEXECUTE付与を剥奪済み）。` +
            `画面から呼ぶなら GRANT EXECUTE ON FUNCTION public.${name}(<引数>) TO anon, authenticated;、` +
            `バッチ専用なら REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role; を書く。` +
            `意図的なら "-- function-exempt: ${name} <理由>" を書く`,
        );
      }
      const definer = /\bSECURITY\s+DEFINER\b/i.test(m[2]);
      const toAnon = grants.some((g) =>
        /\bTO\b[^;]*\b(anon|authenticated|public)\b/i.test(g),
      );
      if (definer && toAnon) {
        errors.push(
          `関数 ${name}: SECURITY DEFINER の関数を anon/authenticated/PUBLIC に公開しない` +
            `（所有者権限でRLSを迂回する）。SECURITY INVOKER にする。意図的なら "-- function-exempt: ${name} <理由>" を書く`,
        );
      }
    }
  }

  // 5. GRANT SELECT の付け忘れ（警告）
  // 076のようにDOブロックで動的にGRANT SELECTするマイグレーションは、文面で判定できないため対象外
  const dynamicGrant = /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.%I/i.test(body);
  for (const t of dynamicGrant ? [] : hasSelectPolicy) {
    const selRe = new RegExp(
      `GRANT\\s+[^;]*\\bSELECT\\b[^;]*\\bON\\s+(?:TABLE\\s+)?(?:public\\.)?"?${t}"?[^;]*\\bTO\\b[^;]*\\b(anon|authenticated|public)\\b`,
      "i",
    );
    if (!selRe.test(body)) {
      warnings.push(
        `テーブル ${t}: SELECTポリシーはあるが GRANT SELECT が無い。076で既定権限を剥奪したため、` +
          `GRANT SELECT ON ${t} TO anon, authenticated; が無いと匿名から読めない`,
      );
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// 検査器そのものの自己テスト（毎回実行。文字列のみで即座に終わる）
// ---------------------------------------------------------------------------
function selfTest() {
  const cases = [
    {
      name: "RLS無しのCREATE TABLE",
      sql: "CREATE TABLE IF NOT EXISTS public.foo (id int);",
      errors: 1,
    },
    {
      name: "RLS有効＋SELECTポリシー＋GRANT SELECT",
      sql: `CREATE TABLE public.foo (id int);
ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;
CREATE POLICY foo_read ON public.foo FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.foo TO anon, authenticated;`,
      errors: 0,
      warnings: 0,
    },
    {
      name: "anonへの書き込みGRANT",
      sql: `CREATE TABLE foo (id int); ALTER TABLE foo ENABLE ROW LEVEL SECURITY;
GRANT ALL ON foo TO anon;`,
      errors: 1,
    },
    {
      name: "FOR ALL ポリシー（TO省略=public）",
      sql: `CREATE TABLE foo (id int); ALTER TABLE foo ENABLE ROW LEVEL SECURITY;
CREATE POLICY p ON foo FOR ALL USING (true);`,
      errors: 1,
    },
    {
      name: "GRANT SELECT の付け忘れは警告のみ",
      sql: `CREATE TABLE foo (id int); ALTER TABLE foo ENABLE ROW LEVEL SECURITY;
CREATE POLICY p ON foo FOR SELECT USING (true);`,
      errors: 0,
      warnings: 1,
    },
    {
      name: "security_invokerの無いビュー",
      sql: "CREATE OR REPLACE VIEW v_x AS SELECT 1;",
      errors: 1,
    },
    {
      name: "security_invoker付きビュー",
      sql: "CREATE VIEW v_x WITH (security_invoker = true) AS SELECT 1;",
      errors: 0,
    },
    {
      name: "除外マーカー付きのRLSなしテーブル",
      sql: "-- rls-exempt: foo 内部の一時集計。anon権限なし\nCREATE TABLE foo (id int);",
      errors: 0,
    },
    {
      name: "コメント内のCREATE TABLEは無視",
      sql: "-- CREATE TABLE foo (id int);\nSELECT 1;",
      errors: 0,
    },
    {
      name: "public以外のスキーマは対象外",
      sql: "CREATE TABLE internal.foo (id int);",
      errors: 0,
    },
    {
      name: "EXECUTEのGRANTは対象外",
      sql: "GRANT EXECUTE ON FUNCTION f() TO anon, authenticated;",
      errors: 0,
    },
    {
      name: "113番以降: GRANT/REVOKEの無い関数",
      sql: "CREATE OR REPLACE FUNCTION public.f(p int) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
      number: 113,
      errors: 1,
    },
    {
      name: "112番以前は関数の権限を検査しない",
      sql: "CREATE OR REPLACE FUNCTION public.f(p int) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
      number: 112,
      errors: 0,
    },
    {
      name: "113番以降: 匿名へのGRANT EXECUTEあり",
      sql: `CREATE FUNCTION f(p int) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
GRANT EXECUTE ON FUNCTION public.f(int) TO anon, authenticated;`,
      number: 113,
      errors: 0,
    },
    {
      name: "113番以降: service_role限定（REVOKE＋GRANT）",
      sql: `CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
REVOKE ALL ON FUNCTION public.f() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.f() TO service_role;`,
      number: 113,
      errors: 0,
    },
    {
      name: "113番以降: SECURITY DEFINERを匿名に公開",
      sql: `CREATE FUNCTION public.f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
GRANT EXECUTE ON FUNCTION public.f() TO anon;`,
      number: 113,
      errors: 1,
    },
    {
      name: "113番以降: 本文の後ろに書いたSECURITY DEFINERも拾う",
      sql: `CREATE FUNCTION public.f() RETURNS int AS $fn$ SELECT 1 $fn$ LANGUAGE sql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION public.f() TO authenticated;`,
      number: 113,
      errors: 1,
    },
    {
      name: "113番以降: 本文中の文字列 ON FUNCTION は数えない（ドル引用の中）",
      sql: `CREATE FUNCTION public.f() RETURNS text LANGUAGE sql AS $$ SELECT 'CREATE FUNCTION g()' $$;
GRANT EXECUTE ON FUNCTION public.f() TO anon;`,
      number: 113,
      errors: 0,
    },
    {
      name: "113番以降: 除外マーカー付き",
      sql: `-- function-exempt: f 既存関数の本文だけの差し替え。権限は既存のまま
CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;`,
      number: 113,
      errors: 0,
    },
  ];
  const failed = [];
  for (const c of cases) {
    const r = checkMigrationSql(c.sql, { number: c.number });
    if (r.errors.length !== c.errors)
      failed.push(`${c.name}: errors=${r.errors.length}(期待${c.errors})`);
    if (c.warnings !== undefined && r.warnings.length !== c.warnings)
      failed.push(
        `${c.name}: warnings=${r.warnings.length}(期待${c.warnings})`,
      );
  }
  return failed;
}

async function main() {
  const selfFailures = selfTest();
  if (selfFailures.length) {
    console.error("検査器の自己テストに失敗:");
    for (const f of selfFailures) console.error(`  - ${f}`);
    process.exit(1);
  }

  const files = (await fs.readdir(MIGRATION_DIR))
    .filter((f) => /^\d{3}[a-z]?_.+\.sql$/.test(f))
    .filter((f) => Number(f.slice(0, 3)) >= MIN_CHECKED_NUMBER)
    .sort();

  let failed = false;
  for (const f of files) {
    const sql = await fs.readFile(path.join(MIGRATION_DIR, f), "utf8");
    const { errors, warnings } = checkMigrationSql(sql, {
      number: Number(f.slice(0, 3)),
    });
    for (const w of warnings) console.warn(`[WARN] ${f}: ${w}`);
    for (const e of errors) {
      failed = true;
      console.error(`[NG] ${f}: ${e}`);
    }
  }
  if (failed) {
    console.error(
      "\nRLS・権限の規律違反があります。docs/db-migration/076_enable_rls_on_public_tables.sql のヘッダーと" +
        " .claude/rules/data-acquisition.md「DBマイグレーションのRLS規律」を参照してください",
    );
    process.exit(1);
  }
  console.log(
    `[OK] ${files.length} 件のマイグレーション（${MIN_CHECKED_NUMBER}番以降）にRLS・権限の規律違反なし`,
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
