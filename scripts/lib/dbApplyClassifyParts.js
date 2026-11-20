/**
 * scripts/lib/dbApplySql.js から移した、軽い／重い／止めるの判定（ADR-0097）の部品。1文の判定（classifyStatement を形ごとに分けた）・
 * 削除の対象・控えの記録・個人情報らしい列。正規表現と文字列は元のまま。
 */
import {
  ID,
  ONE_ID,
  PAREN_KEYWORDS,
  canonName,
  columnsOfCreateTable,
  disallowedCalls,
  isPiiColumn,
  splitTopLevel,
} from "./dbApplyNameParts.js";
import { extractTables } from "./dbApplySqlParts.js";

/** 削除の前の控えを置くスキーマ（API に出さない） */
export const BACKUP_SCHEMA = "db_backup";

const CREATE_TABLE_RE = new RegExp(
  String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${ID})\s*\(([\s\S]*)\)$`,
  "i",
);
const CREATE_INDEX_RE = new RegExp(
  String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:${ONE_ID}\s+)?ON\s+(?:ONLY\s+)?(${ID})(?:\s+USING\s+(?:BTREE|GIN|GIST|HASH|BRIN))?\s*\(([^()]*)\)(?:\s+INCLUDE\s*\(([^()]*)\))?(?:\s+WHERE\s+([\s\S]+))?$`,
  "i",
);
const INDEX_COLUMN_RE = new RegExp(
  String.raw`^${ONE_ID}(?:\s+${ONE_ID})?(?:\s+(?:ASC|DESC))?(?:\s+NULLS\s+(?:FIRST|LAST))?$`,
  "i",
);
const ALTER_TABLE_RE = new RegExp(
  String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${ID})\s+([\s\S]+)$`,
  "i",
);
const ADD_COLUMN_RE = new RegExp(
  String.raw`^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(${ONE_ID})\s+([\s\S]+)$`,
  "i",
);
// serial 型は暗黙の DEFAULT nextval と NOT NULL を伴い、既存の行を全部書き直す
const ADD_COLUMN_FORBIDDEN =
  /\b(DEFAULT|NOT\s+NULL|GENERATED|PRIMARY|UNIQUE|CHECK|COLLATE|CONSTRAINT|AS|USING|SMALLSERIAL|SERIAL[248]?|BIGSERIAL)\b/i;
const CREATE_POLICY_RE = new RegExp(
  String.raw`^CREATE\s+POLICY\s+${ONE_ID}\s+ON\s+(${ID})(?:\s+AS\s+(?:PERMISSIVE|RESTRICTIVE))?\s+FOR\s+SELECT(?:\s+TO\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)?(?:\s+USING\s*\(([\s\S]*)\))?$`,
  "i",
);
const REVOKE_RE = new RegExp(
  String.raw`^REVOKE\s+(?:ALL(?:\s+PRIVILEGES)?|(?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)(?:\s*,\s*(?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER))*)\s+ON\s+(?:TABLE\s+)?(${ID}(?:\s*,\s*${ID})*)\s+FROM\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*(?:\s+CASCADE)?$`,
  "i",
);
const SET_LOCAL_RE =
  /^SET\s+LOCAL\s+(lock_timeout|statement_timeout)\s*(?:=|TO)\s*'?(\d+)\s*(ms|s|min)?'?$/i;
// 自動の経路で SET LOCAL に許す上限（これを超えて待たせる・走らせるのは重い）
// 自動の経路の上限（AUTO_TIMEOUTS）と同じにする。ファイルの SET LOCAL は psql の -c の SET より後に効くので、これより長いと上限が延びる
const SET_LOCAL_MAX_MS = { lock_timeout: 10_000, statement_timeout: 120_000 };
const EXEMPT_MARKER_RE = /--\s*(rls|grant|view|function)-exempt:/;
const NO_BACKUP_MARKER_RE = /--\s*db-apply:\s*no-backup\s+(\S+)\s+\S/g;

const heavy = (reason) => ({ kind: "heavy", reason });
const light = (reason) => ({ kind: "light", reason });

function classifyCreateTable(flat, ctx) {
  const ct = CREATE_TABLE_RE.exec(flat);
  if (!ct) return null;
  const table = canonName(ct[1]);
  if (table.includes(".")) return heavy(`public 以外のスキーマの表（${table}）`);
  // 重い CREATE TABLE でも、同じファイルで作った表であることは変わらない（後ろの RLS・policy・REVOKE の判定に使う）
  ctx.createdTables.add(table);
  const body = ct[2];
  if (/\bLIKE\b|\bEXCLUDE\b/i.test(body)) return heavy("CREATE TABLE の LIKE・EXCLUDE");
  const calls = disallowedCalls(body);
  if (calls.length > 0) return heavy(`CREATE TABLE の中で関数を呼ぶ（${calls.join(", ")}）`);
  return light("CREATE TABLE");
}

function classifyCreateIndex(flat) {
  const ci = CREATE_INDEX_RE.exec(flat);
  if (!ci) return null;
  const columns = [...splitTopLevel(ci[2]), ...(ci[3] ? splitTopLevel(ci[3]) : [])];
  if (!columns.every((c) => INDEX_COLUMN_RE.test(c))) return heavy("式の索引");
  if (ci[4] !== undefined) {
    const calls = disallowedCalls(ci[4]);
    if (calls.length > 0 || /\bSELECT\b/i.test(ci[4]))
      return heavy(`索引の WHERE で関数・副問い合わせを使う（${calls.join(", ")}）`);
  }
  return light("CREATE INDEX");
}

// ALTER TABLE の1つの操作。重いならその判定、軽いなら null
function classifyAlterAction(action, table, ctx) {
  const add = ADD_COLUMN_RE.exec(action);
  if (add) {
    if (ADD_COLUMN_FORBIDDEN.test(add[2]))
      return heavy("ADD COLUMN に既定値・NOT NULL・制約・生成列がある");
    const calls = disallowedCalls(add[2]);
    return calls.length > 0 ? heavy(`ADD COLUMN の中で関数を呼ぶ（${calls.join(", ")}）`) : null;
  }
  if (/^(ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY$/i.test(action)) {
    return ctx.createdTables.has(table)
      ? null
      : heavy(`同じファイルで作っていない表（${table}）の RLS の変更`);
  }
  return heavy(`ALTER TABLE の ${action.split(/\s+/).slice(0, 3).join(" ")}`);
}

function classifyAlterTable(flat, ctx) {
  const at = ALTER_TABLE_RE.exec(flat);
  if (!at) return null;
  const table = canonName(at[1]);
  for (const action of splitTopLevel(at[2])) {
    const bad = classifyAlterAction(action, table, ctx);
    if (bad) return bad;
  }
  return light("ALTER TABLE（ADD COLUMN・RLS の有効化）");
}

const classifyComment = (flat) =>
  /^COMMENT\s+ON\s+[\s\S]+\s+IS\s+(?:''|NULL)$/i.test(flat) ? light("COMMENT") : null;

function classifyPolicy(flat, ctx) {
  const cp = CREATE_POLICY_RE.exec(flat);
  if (!cp) return null;
  const table = canonName(cp[1]);
  if (!ctx.createdTables.has(table))
    return heavy(`同じファイルで作っていない表（${table}）の policy`);
  const calls = cp[2] === undefined ? [] : disallowedCalls(cp[2], new Set([...PAREN_KEYWORDS, "auth.uid", "auth.role"]));
  if (calls.length > 0 || /\bSELECT\b/i.test(cp[2] ?? ""))
    return heavy(`policy の USING で関数・副問い合わせを使う（${calls.join(", ")}）`);
  return light("CREATE POLICY（SELECT だけ）");
}

function classifyRevoke(flat, ctx) {
  const rv = REVOKE_RE.exec(flat);
  if (!rv) return null;
  const tables = splitTopLevel(rv[1]).map(canonName);
  const others = tables.filter((t) => !ctx.createdTables.has(t));
  if (others.length > 0) return heavy(`同じファイルで作っていない表（${others.join(", ")}）の REVOKE`);
  return light("REVOKE（同じファイルの表）");
}

const classifyNotify = (flat) => (/^NOTIFY\s+pgrst(?:\s*,\s*'')?$/i.test(flat) ? light("NOTIFY pgrst") : null);

function classifySetLocal(text, flat) {
  const sl = SET_LOCAL_RE.exec(text.replace(/\s+/g, " ").trim().replace(/;$/, ""));
  if (!(sl && /^SET\s+LOCAL\b/i.test(flat))) return null;
  const unit = (sl[3] ?? "ms").toLowerCase();
  const ms = Number(sl[2]) * (unit === "min" ? 60_000 : unit === "s" ? 1000 : 1);
  // 0 は PostgreSQL では無制限なので軽いにしない
  if (ms > 0 && ms <= SET_LOCAL_MAX_MS[sl[1].toLowerCase()]) return light(`SET LOCAL ${sl[1]}`);
  return heavy(`SET LOCAL ${sl[1]} が自動の上限を超える`);
}

/**
 * 1文の判定。ctx.createdTables は同じファイルでこの文より前に CREATE TABLE した表（canonName）
 * @returns {{ kind: "light" | "heavy", reason: string }}
 */
export function classifyStatement(code, text, ctx) {
  const flat = code.replace(/\s+/g, " ").trim();
  if (flat.includes("$")) return heavy("$$ の本体（DO・関数）を含む");
  return (
    classifyCreateTable(flat, ctx) ??
    classifyCreateIndex(flat) ??
    classifyAlterTable(flat, ctx) ??
    classifyComment(flat) ??
    classifyPolicy(flat, ctx) ??
    classifyRevoke(flat, ctx) ??
    classifyNotify(flat) ??
    classifySetLocal(text, flat) ??
    heavy(flat.split(" ").slice(0, 4).join(" "))
  );
}

/**
 * データを消す文と、その表（ALTER TABLE … DROP COLUMN は列も）を返す
 * @returns {{ table: string, column?: string, what: string }[]}
 */
export function destructiveTargets(code) {
  const flat = code.replace(/\s+/g, " ").trim();
  const targets = [];
  for (const { table, op } of extractTables(code)) {
    if (op === "DROP" || op === "TRUNCATE" || op === "DELETE")
      targets.push({ table: canonName(table), what: op });
  }
  const at = ALTER_TABLE_RE.exec(flat);
  if (at) {
    for (const action of splitTopLevel(at[2])) {
      const dc = new RegExp(String.raw`^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?(${ONE_ID})`, "i").exec(action);
      if (dc && !/^DROP\s+(CONSTRAINT|DEFAULT|NOT|EXPRESSION|IDENTITY)\b/i.test(action))
        targets.push({ table: canonName(at[1]), column: canonName(dc[1]), what: "DROP COLUMN" });
    }
  }
  return targets;
}

// 依存する表・列ごと消すが、どの表かを文からは決められない削除。控えで守れないので止める
const UNBACKUPABLE_DROP_RE =
  /^(DROP\s+(SCHEMA|TYPE|DOMAIN|EXTENSION)\b[\s\S]*\bCASCADE\b|DROP\s+OWNED\b)/i;

const BACKUP_RE = new RegExp(
  String.raw`^CREATE\s+TABLE\s+(${ID})\s+AS\s+(?:TABLE\s+(${ID})|SELECT\s+([\s\S]+?)\s+FROM\s+(${ID}))$`,
  "i",
);

/** 文が足す列のうち、個人情報らしい名前のもの */
function piiColumns(flat) {
  const ct = CREATE_TABLE_RE.exec(flat);
  const names = ct ? columnsOfCreateTable(ct[2]) : [];
  const at = ALTER_TABLE_RE.exec(flat);
  if (at) {
    for (const action of splitTopLevel(at[2])) {
      const add = new RegExp(String.raw`^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(${ONE_ID})`, "i").exec(action);
      if (add && !/^ADD\s+(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)\b/i.test(action)) names.push(add[1]);
    }
  }
  return names.filter(isPiiColumn).map(canonName);
}

/**
 * 削除の前の控えの文（CREATE TABLE db_backup._bak_<番号>_<表> AS …）なら、控えの記録と判定の行。
 * 表の名前が期待と違えば null（普通の文として続きを判定する）
 */
export function backupEntry(flat, line, number) {
  const bk = BACKUP_RE.exec(flat);
  if (!bk) return null;
  const target = canonName(bk[1]);
  const source = canonName(bk[2] ?? bk[4]);
  const expected = `${BACKUP_SCHEMA}._bak_${number}_${source.replace(/\./g, "_")}`.toLowerCase();
  if (target !== expected) return null;
  return {
    backup: {
      table: source,
      line,
      columns: bk[3] === undefined || bk[3].trim() === "*" ? null : splitTopLevel(bk[3]).map(canonName),
    },
    result: { line, kind: "backup", reason: `削除の前の控え（${source}）` },
  };
}

/** データを消す文のうち、前に控えが無いものの止める文 */
export function missingBackupStops(s, backups, noBackup, number) {
  const stops = [];
  for (const t of destructiveTargets(s.code)) {
    const copied = backups.some(
      (b) => b.table === t.table && (b.columns === null || (t.column !== undefined && b.columns.includes(t.column))),
    );
    const isBackup = t.table.startsWith(`${BACKUP_SCHEMA}.`);
    if (!copied && !noBackup.has(t.table) && !isBackup) {
      stops.push(
        `${s.line}行目: ${t.what}（${t.table}${t.column ? `.${t.column}` : ""}）の前に控えが無い。` +
          `同じファイルの前の文で CREATE TABLE ${BACKUP_SCHEMA}._bak_${number}_${t.table} AS TABLE ${t.table} を書く`,
      );
    }
  }
  return stops;
}

/** 控えで守れない削除と、個人情報らしい列を足す文の止める文 */
export function statementStops(s, flat) {
  const stops = [];
  if (UNBACKUPABLE_DROP_RE.test(flat)) {
    stops.push(`${s.line}行目: 依存する表・列ごと消しうる削除（${flat.split(" ").slice(0, 3).join(" ")} … CASCADE / DROP OWNED）は控えで守れない`);
  }
  for (const col of piiColumns(flat)) {
    stops.push(`${s.line}行目: 個人情報らしい列（${col}）を足す`);
  }
  return stops;
}

/** `-- db-apply: no-backup <表> <理由>` で控えを免除された表 */
export const noBackupTables = (sql) =>
  new Set([...sql.matchAll(NO_BACKUP_MARKER_RE)].map((m) => canonName(m[1])));

export const hasExemptMarker = (sql) => EXEMPT_MARKER_RE.test(sql);
