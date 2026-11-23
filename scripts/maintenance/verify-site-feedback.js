/**
 * verify-site-feedback.js - サイト全体のご意見ボックスの画面側の検証（表は verify-site-feedback-migration.js）。
 *
 * 1. 画面の決まり（src/pure/siteFeedback.js）: ページの種類・出さない画面・送る1行の形
 * 2. ブラウザごとの識別番号（src/pure/clientKey.js。龍神ソナーの声と共通）
 * 3. 画面の列挙と、表（docs/db-migration/NNN_site_feedback.sql）の CHECK の列挙が同じこと
 *    （ずれると、その値の送信が全部「送れませんでした」になり、どこにも残らない）
 * 4. 出す順番の関門: 台帳（docs/db-migration/APPLIED.md）で表が「適用済み」でなければ赤にする
 *    （表が本番に無いまま画面を出すと、全員の送信が失敗する。db-apply が成功すると台帳が適用済みになる）
 *
 * 実行: node scripts/maintenance/verify-site-feedback.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import {
  FEEDBACK_KINDS,
  FEEDBACK_LANGS,
  FEEDBACK_MAX_COMMENT,
  FEEDBACK_MAX_RATING,
  FEEDBACK_PAGE_TYPES,
  buildSiteFeedbackRow,
  canSendFeedback,
  feedbackPageType,
  isFeedbackHiddenPath,
} from "../../src/pure/siteFeedback.js";
import { newUuidV4, readOrCreateClientKey } from "../../src/pure/clientKey.js";
import { isAppliedInLedger } from "../lib/dbApplySql.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const MIGRATION_DIR = path.join(ROOT, "docs/db-migration");

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`[OK] ${label}`);
  else {
    failures++;
    console.error(`[NG] ${label}${detail ? `: ${detail}` : ""}`);
  }
}
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

// ---- 1. 画面の決まり ----
const PAGE_CASES = [
  ["/", "home"],
  ["/en/", "home"],
  ["/en", "home"],
  ["/today", "today"],
  ["/race/2026-11-23-01-03", "race"],
  ["/zh-TW/race/2026-11-23-01-03", "race"],
  ["/races/2026-11-23", "race"],
  ["/racer/4444", "racer"],
  ["/racers", "racer"],
  ["/venue/12", "venue"],
  ["/en/venues/kiryu", "venue"],
  ["/winning-technique", "analysis"],
  ["/outcome-distribution", "analysis"],
  ["/accuracy/history", "analysis"],
  ["/hit-races", "analysis"],
  ["/blog/odds-expected-value-guide", "blog"],
  ["/ko/blog", "blog"],
  ["/guide", "guide"],
  ["/how-to-use", "guide"],
  ["/faq", "guide"],
  ["/privacy", "other"],
  ["/contact", "other"],
  ["/constructor", "other"],
  ["", "home"],
];
for (const [p, want] of PAGE_CASES)
  check(
    `ページの種類: ${p || "(空)"} → ${want}`,
    feedbackPageType(p) === want,
    feedbackPageType(p),
  );
check(
  "ページの種類は決まりの値だけを返す",
  PAGE_CASES.every(([p]) => FEEDBACK_PAGE_TYPES.includes(feedbackPageType(p))),
);

const HIDDEN_CASES = [
  ["/admin/rules", true],
  ["/admin", true],
  ["/share/today-sheet", true],
  ["/race/2026-11-23-01-03/assist", true],
  ["/en/race/2026-11-23-01-03/assist", true],
  ["/race/2026-11-23-01-03", false],
  ["/", false],
  ["/administrator", false],
  ["/blog/share-tips", false],
];
for (const [p, want] of HIDDEN_CASES)
  check(
    `出さない画面: ${p} → ${want}`,
    isFeedbackHiddenPath(p) === want,
    String(isFeedbackHiddenPath(p)),
  );

check(
  "空・空白だけは送れない",
  !canSendFeedback("") && !canSendFeedback("  \n "),
);
check("1文字は送れる", canSendFeedback("a"));
check(
  "500文字は送れ、501文字は送れない",
  canSendFeedback("あ".repeat(FEEDBACK_MAX_COMMENT)) &&
    !canSendFeedback("あ".repeat(FEEDBACK_MAX_COMMENT + 1)),
);

const KEY = "00000000-0000-4000-8000-000000000001";
const base = {
  kind: "feature",
  comment: "  モーターの成績も見たい  ",
  rating: 4,
  pathname: "/en/race/2026-11-23-01-03",
  lang: "en",
  clientKey: KEY,
};
const built = buildSiteFeedbackRow(base);
check(
  "送る1行: 前後の空白を除き、URL でなくページの種類を入れる",
  JSON.stringify(built) ===
    JSON.stringify({
      kind: "feature",
      comment: "モーターの成績も見たい",
      rating: 4,
      page_type: "race",
      lang: "en",
      client_key: KEY,
    }),
  JSON.stringify(built),
);
const bare = buildSiteFeedbackRow({ ...base, kind: null, rating: null });
check(
  "送る1行: 種類・満足度を選ばなければ null",
  bare.kind === null && bare.rating === null,
);
check(
  "送る1行: 決まりに無い言語は ja にする",
  buildSiteFeedbackRow({ ...base, lang: "fr" }).lang === "ja",
);
for (const [label, bad] of [
  ["空の内容", { comment: "   " }],
  ["決まりに無い種類", { kind: "bug" }],
  ["満足度 0", { rating: 0 }],
  ["満足度 6", { rating: 6 }],
  ["満足度が小数", { rating: 2.5 }],
  ["識別番号なし", { clientKey: "" }],
])
  check(
    `送る1行: ${label} は投げる`,
    throws(() => buildSiteFeedbackRow({ ...base, ...bad })),
  );

// ---- 2. ブラウザごとの識別番号 ----
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
check("識別番号: uuid v4 の形", UUID_V4.test(newUuidV4(webcrypto)));
{
  // randomUUID が無い古いブラウザの道（getRandomValues から作る）
  const old = { getRandomValues: (a) => webcrypto.getRandomValues(a) };
  const made = [newUuidV4(old), newUuidV4(old)];
  check(
    "識別番号: randomUUID が無くても uuid v4 の形で、毎回違う",
    made.every((u) => UUID_V4.test(u)) && made[0] !== made[1],
    made.join(" "),
  );
}
{
  const map = new Map();
  const storage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
  };
  const get = () => storage;
  const first = readOrCreateClientKey("boatai-user:x", get, webcrypto);
  check(
    "識別番号: 無ければ作って保存し、2回目は同じ値を返す",
    UUID_V4.test(first) &&
      map.get("boatai-user:x") === first &&
      readOrCreateClientKey("boatai-user:x", get, webcrypto) === first,
  );
  check(
    "識別番号: 保存の鍵が違えば別の値",
    readOrCreateClientKey("boatai-user:y", get, webcrypto) !== first,
  );
  map.set("boatai-user:x", "not-a-uuid");
  const repaired = readOrCreateClientKey("boatai-user:x", get, webcrypto);
  check(
    "識別番号: 保存してある値が uuid v4 の形でなければ作り直して保存する",
    UUID_V4.test(repaired) && map.get("boatai-user:x") === repaired,
    repaired,
  );
  const broken = () => {
    throw new Error("SecurityError");
  };
  check(
    "識別番号: 保存できない環境でも投げず、uuid v4 を返す",
    UUID_V4.test(readOrCreateClientKey("boatai-user:x", broken, webcrypto)) &&
      UUID_V4.test(
        readOrCreateClientKey(
          "boatai-user:x",
          () => ({ getItem: () => null, setItem: broken }),
          webcrypto,
        ),
      ),
  );
}

// ---- 3. 画面の列挙と表の CHECK ----
const migrationFile = fs
  .readdirSync(MIGRATION_DIR)
  .find((f) => /^\d+_site_feedback\.sql$/.test(f));
check(
  "表のマイグレーション（NNN_site_feedback.sql）がある",
  !!migrationFile,
  "表の PR（claude/site-feedback-db）が master に入っていない",
);
if (migrationFile) {
  const sql = fs.readFileSync(path.join(MIGRATION_DIR, migrationFile), "utf8");
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

  // ---- 4. 出す順番の関門 ----
  const ledger = fs.readFileSync(
    path.join(MIGRATION_DIR, "APPLIED.md"),
    "utf8",
  );
  check(
    `出す順番: 台帳で ${migrationFile} が適用済み`,
    isAppliedInLedger(ledger, migrationFile),
    "表が本番に無いまま画面を出すと、全員の送信が失敗する。オーナーが db-apply で当てた後に master を取り込む",
  );
}

if (failures > 0) {
  console.error(`\nverify-site-feedback: NG（${failures} 件）`);
  process.exit(1);
}
console.log("\nverify-site-feedback: OK");
