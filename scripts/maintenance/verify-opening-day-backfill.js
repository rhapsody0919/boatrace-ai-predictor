/**
 * verify-opening-day-backfill.js - 節の初日バックフィル（scripts/lib/openingDayBackfill.js）の検証
 * （docs/issues/races-opening-day-missing.md）。DBにも公式サイトにも接続しない。
 *
 * 確認すること:
 *   (a) 対象の選択: --only の解釈・欠落リスト外の会場日の拒否・記録済みのスキップ・並び順・件数の上限
 *   (b) racesの行: 出走表のフィクスチャから、12レース分・予想側の列（volatility_*）を含まない行ができる
 *   (c) 取得器: 逐次の間隔・URLの重複取得なし（キャッシュ）・403/429/503の連続で全体停止・リクエスト数の上限
 *   (d) 実リストの整合: missing-venue-days.json の件数・重複なし
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRaceListPage } from "../lib/raceListParser.js";
import {
  BackfillAbortError,
  buildRaceRows,
  createThrottledFetch,
  hasFailure,
  hasGap,
  parseOnly,
  selectTargets,
  tallyOutcomes,
} from "../lib/openingDayBackfill.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const throws = async (fn, pattern) => {
  try {
    await fn();
    return false;
  } catch (e) {
    return pattern ? pattern.test(e.message) : true;
  }
};

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

// (a) 対象の選択
const rows = [
  { race_date: "2026-09-02", venue_code: 17 },
  { race_date: "2026-09-01", venue_code: 13 },
  { race_date: "2026-09-01", venue_code: 12 },
];
check(
  "parseOnly: 空は null",
  parseOnly(null) === null && parseOnly("") === null,
);
check(
  "parseOnly: 複数指定・会場コードの桁を揃える",
  show([...parseOnly("2026-09-01:12,2026-09-02:7")]) ===
    show(["2026-09-01:12", "2026-09-02:07"]),
);
check(
  "parseOnly: 不正な形式は例外",
  await throws(() => parseOnly("2026-09-01"), /形式が不正/),
);
check(
  "selectTargets: 日付・会場の順に並ぶ",
  show(selectTargets(rows).map((r) => `${r.race_date}:${r.venue_code}`)) ===
    show(["2026-09-01:12", "2026-09-01:13", "2026-09-02:17"]),
);
check(
  "selectTargets: --only で絞る",
  selectTargets(rows, { only: parseOnly("2026-09-01:13") }).length === 1,
);
check(
  "selectTargets: 欠落リストに無い会場日は例外（誤書き込みの防止）",
  await throws(
    () => selectTargets(rows, { only: parseOnly("2026-09-01:99") }),
    /欠落リストに無い/,
  ),
);
check(
  "selectTargets: 記録済みをスキップし、件数の上限を効かせる",
  selectTargets(rows, { skip: new Set(["2026-09-01:12"]), limit: 1 }).length ===
    1 &&
    selectTargets(rows, { skip: new Set(["2026-09-01:12"]) })[0].venue_code ===
      13,
);

// (b) racesの行
const html = fs.readFileSync(
  path.join(ROOT, "scripts/lib/__fixtures__/raceInfo/racelist-ippan.html"),
  "utf8",
);
const page = parseRaceListPage(html);
const built = buildRaceRows({ date: "2026-09-01", venueCode: 12, page });
check(
  "buildRaceRows: 締切予定時刻のあるレース分の行ができ、race_idの形式が正しい",
  built.rows.length === page.deadlines.filter((d) => d.time).length &&
    built.rows.every(
      (r) =>
        /^2026-09-01-12-\d{2}$/.test(r.race_id) &&
        r.start_time.endsWith(":00") &&
        r.race_date === "2026-09-01" &&
        r.venue_code === 12,
    ),
  show(built.rows[0]),
);
check(
  "buildRaceRows: 予想側の列（volatility_*・first_boat_*）を含まない",
  built.rows.every(
    (r) =>
      !Object.keys(r).some(
        (k) => k.startsWith("volatility_") || k.startsWith("first_boat_"),
      ),
  ),
);
check(
  "buildRaceRows: 12レースでなければ anomalies に残す",
  built.rows.length === 12 ||
    built.anomalies.some((a) => a.startsWith("races_count")),
);
check(
  "buildRaceRows: 日付の形式が不正なら例外",
  await throws(
    () => buildRaceRows({ date: "20260901", venueCode: 12, page }),
    /日付の形式/,
  ),
);

// (c) 取得器
{
  const sent = [];
  const sleeps = [];
  const respond = (status) => async (url) => {
    sent.push(url);
    return new Response(`body:${url}`, { status });
  };
  let clock = 1_000_000;
  const realNow = Date.now;
  Date.now = () => clock;
  const sleep = async (ms) => {
    sleeps.push(ms);
    clock += ms;
  };
  try {
    const t = createThrottledFetch({
      fetchImpl: respond(200),
      intervalMs: 3500,
      jitterMs: 0,
      sleep,
      random: () => 0,
    });
    const r1 = await t.fetchFn("https://x/a");
    const r2 = await t.fetchFn("https://x/b");
    const r3 = await t.fetchFn("https://x/a");
    check(
      "取得器: 2回目以降は間隔を空け、同じURLは再取得せずキャッシュを返す",
      sent.length === 2 &&
        sleeps.length === 1 &&
        sleeps[0] >= 3500 &&
        (await r3.text()) === "body:https://x/a" &&
        t.state.cacheHits === 1 &&
        r1.ok &&
        r2.ok,
      show({ sent: sent.length, sleeps, hits: t.state.cacheHits }),
    );
    t.clearCache();
    await t.fetchFn("https://x/a");
    check("取得器: clearCache 後は再取得する", sent.length === 3);

    sent.length = 0;
    const blocked = createThrottledFetch({
      fetchImpl: respond(429),
      intervalMs: 0,
      jitterMs: 0,
      sleep,
      random: () => 0,
    });
    await blocked.fetchFn("https://x/1");
    check("取得器: 1回のブロックでは止めない", blocked.state.tripped === null);
    await blocked.fetchFn("https://x/2");
    check(
      "取得器: 2回連続のブロックで全体を停止する",
      blocked.state.tripped !== null,
    );
    check(
      "取得器: 停止後は、通信せずに例外にする",
      (await throws(() => blocked.fetchFn("https://x/3"), /アクセス制限/)) &&
        sent.length === 2,
    );

    const mixed = createThrottledFetch({
      fetchImpl: async (url) =>
        new Response("ok", { status: url.endsWith("/ng") ? 503 : 200 }),
      intervalMs: 0,
      jitterMs: 0,
      sleep,
      random: () => 0,
    });
    await mixed.fetchFn("https://x/ng");
    await mixed.fetchFn("https://x/ok");
    await mixed.fetchFn("https://x/ng");
    check("取得器: 成功を挟めば連続とは数えない", mixed.state.tripped === null);

    const capped = createThrottledFetch({
      fetchImpl: respond(200),
      intervalMs: 0,
      jitterMs: 0,
      maxRequests: 2,
      sleep,
      random: () => 0,
    });
    await capped.fetchFn("https://x/1");
    await capped.fetchFn("https://x/2");
    check(
      "取得器: リクエスト数の上限を超えたら停止する",
      (await throws(() => capped.fetchFn("https://x/3"), /上限/)) &&
        capped.state.tripped !== null,
    );
    check(
      "取得器: 停止は BackfillAbortError",
      await (async () => {
        try {
          await capped.fetchFn("https://x/4");
        } catch (e) {
          return e instanceof BackfillAbortError;
        }
        return false;
      })(),
    );

    const failing = createThrottledFetch({
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
      intervalMs: 0,
      jitterMs: 0,
      sleep,
      random: () => 0,
    });
    await failing.fetchFn("https://x/1").catch(() => {});
    await failing.fetchFn("https://x/2").catch(() => {});
    check("取得器: 通信失敗の連続も停止の対象", failing.state.tripped !== null);
  } finally {
    Date.now = realNow;
  }
}

check(
  "tallyOutcomes・hasFailure: error と breaker_open だけを失敗とみなす",
  hasFailure(tallyOutcomes([{ outcome: "ok" }, { outcome: "error" }])) &&
    hasFailure(tallyOutcomes([{ outcome: "breaker_open" }])) &&
    !hasFailure(
      tallyOutcomes([
        { outcome: "ok" },
        { outcome: "skipped_have_data" },
        { outcome: "partial" },
        { outcome: "no_values" },
      ]),
    ),
);

check(
  "hasGap: no_values が1件でもあれば true（順延・中止の会場日を done にしない）",
  hasGap(tallyOutcomes([{ outcome: "ok" }, { outcome: "no_values" }])) &&
    !hasGap(tallyOutcomes([{ outcome: "ok" }, { outcome: "partial" }])),
);

// (d) 実リストの整合
{
  const list = JSON.parse(
    fs.readFileSync(
      path.join(
        ROOT,
        "data/analysis/races-opening-day-missing/missing-venue-days.json",
      ),
      "utf8",
    ),
  );
  const keys = list.rows.map((r) => `${r.race_date}:${r.venue_code}`);
  check(
    "欠落リスト: 件数が count と一致し、重複が無い",
    list.rows.length === list.count && new Set(keys).size === keys.length,
    `${list.rows.length}/${list.count}`,
  );
  check(
    "欠落リスト: 全て2026-04-10〜2026-09-11、会場コードは1〜24",
    list.rows.every(
      (r) =>
        r.race_date >= "2026-04-10" &&
        r.race_date <= "2026-09-11" &&
        r.venue_code >= 1 &&
        r.venue_code <= 24,
    ),
  );
}

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\n全ての検証に成功しました");
