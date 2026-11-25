/**
 * verify-site-feedback.js - サイト全体のご意見ボックスの画面側の検証（表は verify-site-feedback-migration.js）。
 *
 * 1. 画面の決まり（src/pure/siteFeedback.js）: ページの種類・出さない画面・送る1行の形
 * 2. ブラウザごとの識別番号（src/pure/clientKey.js。龍神ソナーの声と共通）
 * 画面と表の列挙の突き合わせと、表の適用の関門は、画面を全画面につなぐ PR の verify-site-feedback-gate.js が見る
 * （部品の PR は画面に出ないので、表より先に入ってよい）
 *
 * 実行: node scripts/maintenance/verify-site-feedback.js
 */
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

if (failures > 0) {
  console.error(`\nverify-site-feedback: NG（${failures} 件）`);
  process.exit(1);
}
console.log("\nverify-site-feedback: OK");
