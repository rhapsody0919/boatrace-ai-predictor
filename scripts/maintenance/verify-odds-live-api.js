/**
 * verify-odds-live-api.js - オッズのライブ取得（BOA-487、api/odds/live.js）の検証。
 * DBにも取得先にも接続しない（取得関数と時計を差し替え、フィクスチャのHTMLを返す）。
 *
 * 確認すること:
 *   (a) パーサー: 「オッズ更新時間」（parseOddsUpdatedAt）・締切時オッズ（isFinalOdds）を、発売中の実ページ
 *       （江戸川8R 13:46・芦屋2R 8:14）と締切後の実ページ（桐生1R）で読み分ける。票0（「0.0」）は keepZero で 0 のまま残り、
 *       既定（cron の保存用）では従来どおり捨てる／null にする
 *   (b) parseLiveOddsPage: 5ページ（tf/3t/3f/2tf/k）の通り数、票0の艇・組み合わせが 0 で返る、未公開は published=false
 *   (c) クエリの検証: raceId の形式・JSTの当日のみ・page の列挙値・未知のパラメータ・GET以外 → 400/405（no-store）
 *   (d) handleLiveOddsRequest: 成功（s-maxage=30）・締切時オッズ（s-maxage=300）・未発売・HTTP非200・通信失敗・
 *       ブレーカー（retryAfterSec）→ 200+ok:false（s-maxage=10）。取得するURLが公式の該当ページ
 *   (e) 設定: api/odds/live.js の maxDuration=30・再試行なし・ブレーカーを DB ストアで共有、vite の READ_ONLY_API に odds。
 *       race_odds に書かない（api/odds/live.js・scripts/lib/liveOdds.js を字句で読み、書き込みを探す。読むのは許す）
 */
import fs from "node:fs";
import * as cheerio from "cheerio";
import * as espree from "espree";
import {
  parseOddsUpdatedAt,
  isFinalOdds,
  parseTrifectaAll,
  parseExactaAll,
  parseWideAll,
  parseRangeOddsValue,
} from "../lib/oddsParser.js";
import { scrapeWinOdds, scrapePlaceOdds } from "../daily/scrape-odds.js";
import { validateLiveOddsQuery, parseLiveOddsPage, liveOddsUrl } from "../lib/liveOdds.js";


import { runLiveOddsWiringScenes } from "./verifyData/odds-live-api-wiring-scenes.js";
import { runOddsLiveApiScenes1, runOddsLiveApiScenes2 } from "./verifyData/odds-live-api-scenes-1.js";
import { runOddsLiveApiScenes3, runOddsLiveApiScenes4 } from "./verifyData/odds-live-api-scenes-2.js";

const printOut = console.log.bind(console);
const printErr = console.error.bind(console);
console.log = () => {};
console.warn = () => {};
console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    printOut(`✅ ${label}`);
  } else {
    failures++;
    printErr(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

// race_odds を書く経路（Cron のオッズの保存・変わった行だけ書く共通の関数）
const RACE_ODDS_WRITER_MODULE =
  /scrapeJobs\/(oddsHandlers|finalOddsHandlers|predictionOddsHandlers)\.js|unchangedRows\.js/;
const WRITE_METHODS = new Set(["insert", "upsert", "update", "delete"]);

/**
 * ソースの中の race_odds への書き込みの手がかりを拾う（(e) で使う）。字句（espree の tokenize）で読むので、
 * コメント・文字列の中の語は数えない。拾うもの:
 * - `.from("race_odds")` に続く呼び出しの連なり（文の終わりまで）の .insert/.upsert/.update/.delete
 * - race_odds の文字列を `.from(...)` の引数以外で使う（変数に入れて渡す・upsertChangedRows に渡す等）
 * - `.rpc(`（関数の中で何を書くかをソースから確かめられない）
 * - race_odds を書くモジュールの import（名前を変えても出所で分かる）
 * 読み（`.from("race_odds").select(...)`）と、Map 等の .delete は拾わない
 * @param {string} src
 * @returns {string[]} 見つかった手がかり（無ければ空）
 */
function raceOddsWrites(src) {
  const toks = espree.tokenize(src, {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const val = (i) => toks[i]?.value;
  const hits = [];
  toks.forEach((t, i) => {
    if (t.value === "." && val(i + 1) === "rpc" && val(i + 2) === "(")
      hits.push(".rpc(");
    if (t.type !== "String" && t.type !== "Template") return;
    if (RACE_ODDS_WRITER_MODULE.test(t.value)) hits.push(`import ${t.value}`);
    // 表の名前そのもの（引用符の中が race_odds だけ）を見る。文の中の語は数えない
    if (t.value.slice(1, -1) !== "race_odds") return;
    const asFromArg =
      val(i - 3) === "." &&
      val(i - 2) === "from" &&
      val(i - 1) === "(" &&
      val(i + 1) === ")";
    if (!asFromArg) {
      hits.push(`${t.value} を .from( の外で使う`);
      return;
    }
    let depth = 0;
    for (let j = i + 2; j < toks.length; j++) {
      const v = toks[j].value;
      if (v === "(" || v === "[" || v === "{") depth++;
      else if (v === ")" || v === "]" || v === "}") {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && (v === ";" || v === ",")) break;
      else if (
        depth === 0 &&
        v === "." &&
        WRITE_METHODS.has(val(j + 1)) &&
        val(j + 2) === "("
      )
        hits.push(`.from(${t.value}).${val(j + 1)}(`);
    }
  });
  return hits;
}

const FIX = (name) =>
  fs.readFileSync(
    new URL(`../lib/__fixtures__/odds/${name}`, import.meta.url),
    "utf8",
  );
// 締切後（「締切時オッズ」表示）の実ページ（桐生1R、2026-09-19）
const FINAL = {
  tf: FIX("oddstf-2026-09-19-05-01.html"),
  "3t": FIX("odds3t-2026-09-19-05-01.html"),
  "3f": FIX("odds3f-2026-09-19-05-01.html"),
  "2tf": FIX("odds2tf-2026-09-19-05-01.html"),
  k: FIX("oddsk-2026-09-19-05-01.html"),
};
// 発売中・単勝1艇と複勝4艇が票0の実ページ（江戸川8R、2026-09-28 13:55取得。オッズ更新時間 13:46）
const TF_ZERO_VOTES = FIX("oddstf-zero-votes-2026-09-28-03-08.html");
// 発売中・3連単の5通りが票0の実ページ（芦屋2R、2026-09-29 8:36取得。オッズ更新時間 " 8:14"）
const T3_PREDEADLINE = FIX("odds3t-predeadline-2026-09-29-21-02.html");
const TF_UNPUBLISHED = FIX("oddstf-unpublished-2026-09-25-05-01.html");

// ---- (a) パーサー ----
{
  check(
    "parseOddsUpdatedAt: 発売中の単勝ページ → 13:46",
    parseOddsUpdatedAt(cheerio.load(TF_ZERO_VOTES)) === "13:46",
  );
  check(
    "parseOddsUpdatedAt: 1桁の時（' 8:14'）→ 08:14",
    parseOddsUpdatedAt(cheerio.load(T3_PREDEADLINE)) === "08:14",
  );
  check(
    "parseOddsUpdatedAt: 締切後のページ・未公開のページ → null",
    parseOddsUpdatedAt(cheerio.load(FINAL.tf)) === null &&
      parseOddsUpdatedAt(cheerio.load(TF_UNPUBLISHED)) === null,
  );
  check(
    "isFinalOdds: 締切後の5ページは true、発売中・未公開は false",
    Object.values(FINAL).every((html) => isFinalOdds(cheerio.load(html))) &&
      !isFinalOdds(cheerio.load(TF_ZERO_VOTES)) &&
      !isFinalOdds(cheerio.load(T3_PREDEADLINE)) &&
      !isFinalOdds(cheerio.load(TF_UNPUBLISHED)),
  );

  const $tf = cheerio.load(TF_ZERO_VOTES);
  check(
    "scrapeWinOdds: 既定は票0を null（cron の保存は従来どおり）",
    show(scrapeWinOdds($tf)) === show([1, 14.2, 14.2, null, 14.2, 14.2]),
    show(scrapeWinOdds($tf)),
  );
  check(
    "scrapeWinOdds keepZero: 票0を 0 で返す",
    show(scrapeWinOdds($tf, { keepZero: true })) ===
      show([1, 14.2, 14.2, 0, 14.2, 14.2]),
  );
  check(
    "scrapePlaceOdds: 既定は 0.0-0.0 を null、keepZero は {low:0,high:0}",
    scrapePlaceOdds($tf)[2] === null &&
      show(scrapePlaceOdds($tf, { keepZero: true })[2]) ===
        show({ low: 0, high: 0 }) &&
      show(scrapePlaceOdds($tf, { keepZero: true })[0]) ===
        show({ low: 1, high: 1.5 }),
  );
  check(
    "parseRangeOddsValue: 既定の挙動は変えない（0.0-0.0・逆転・全角は従来どおり）",
    parseRangeOddsValue("0.0-0.0") === null &&
      parseRangeOddsValue("2.0-1.0") === null &&
      show(parseRangeOddsValue("1.5－1.9")) === show({ low: 1.5, high: 1.9 }),
  );

  const $3t = cheerio.load(T3_PREDEADLINE);
  const def = parseTrifectaAll($3t);
  const keep = parseTrifectaAll($3t, { keepZero: true });
  check(
    "parseTrifectaAll: 既定は票0を捨て（115通り）、keepZero は 0 で残す（120通り・0が5件）",
    def.size === 115 &&
      keep.size === 120 &&
      [...keep.values()].filter((v) => v === 0).length === 5,
    `default=${def.size} keep=${keep.size}`,
  );
  check(
    "parseExactaAll/parseWideAll: keepZero を付けても締切後のページの通り数は同じ",
    parseExactaAll(cheerio.load(FINAL["2tf"]), { keepZero: true }).size ===
      30 && parseWideAll(cheerio.load(FINAL.k), { keepZero: true }).size === 15,
  );
}

// ---- (b) parseLiveOddsPage ----
{
  const tf = parseLiveOddsPage("tf", TF_ZERO_VOTES);
  check(
    "tf（発売中）: 単勝6・複勝6、票0の艇は 0、公式更新 13:46、final=false",
    tf.published &&
      !tf.final &&
      tf.officialUpdatedAt === "13:46" &&
      Object.keys(tf.data.win).length === 6 &&
      tf.data.win["4"] === 0 &&
      tf.data.win["1"] === 1 &&
      Object.keys(tf.data.place).length === 6 &&
      show(tf.data.place["6"]) === show({ low: 0, high: 0 }),
    show(tf),
  );
  const t3 = parseLiveOddsPage("3t", T3_PREDEADLINE);
  check(
    "3t（発売中）: 120通り・票0は0・公式更新 08:14",
    t3.published &&
      !t3.final &&
      t3.officialUpdatedAt === "08:14" &&
      Object.keys(t3.data.trifectaAll).length === 120 &&
      Object.values(t3.data.trifectaAll).filter((v) => v === 0).length === 5,
  );
  const counts = {
    tf: (d) => [Object.keys(d.win).length, Object.keys(d.place).length],
    "3t": (d) => [Object.keys(d.trifectaAll).length],
    "3f": (d) => [Object.keys(d.trioAll).length],
    "2tf": (d) => [
      Object.keys(d.exactaAll).length,
      Object.keys(d.quinellaAll).length,
    ],
    k: (d) => [Object.keys(d.wideAll).length],
  };
  const expected = {
    tf: [6, 6],
    "3t": [120],
    "3f": [20],
    "2tf": [30, 15],
    k: [15],
  };
  for (const page of Object.keys(FINAL)) {
    const parsed = parseLiveOddsPage(page, FINAL[page]);
    const got = counts[page](parsed.data);
    check(
      `${page}（締切後）: 通り数 ${show(expected[page])}・final=true・公式更新 null`,
      parsed.published &&
        parsed.final &&
        parsed.officialUpdatedAt === null &&
        show(got) === show(expected[page]),
      show(got),
    );
  }
  const unpub = parseLiveOddsPage("tf", TF_UNPUBLISHED);
  check(
    "未公開のページ: published=false・data は空",
    !unpub.published && show(unpub.data) === "{}",
  );
}

// ---- (c) クエリの検証 ----
const NOW = new Date("2026-09-29T08:19:00+09:00");
const TODAY_RACE = "2026-09-29-21-02";
{
  const ok = validateLiveOddsQuery({ raceId: TODAY_RACE, page: "3t" }, NOW);
  check(
    "当日の raceId と page=3t を受け付ける",
    ok.ok && ok.venue === 21 && ok.raceNo === 2 && ok.date === "2026-09-29",
  );
  check(
    "JSTの日付で判定する（UTCでは前日の 00:30 JST も当日扱い）",
    validateLiveOddsQuery(
      { raceId: "2026-09-30-01-01", page: "tf" },
      new Date("2026-09-29T15:30:00Z"),
    ).ok,
  );
  const bad = [
    [{ raceId: "2026-09-28-21-02", page: "3t" }, "前日のレース"],
    [{ raceId: "2026-09-30-21-02", page: "3t" }, "翌日のレース"],
    [{ raceId: "2026-09-29-25-02", page: "3t" }, "会場25"],
    [{ raceId: "2026-09-29-21-13", page: "3t" }, "13R"],
    [{ raceId: "20260929-21-02", page: "3t" }, "形式違い"],
    [{ raceId: TODAY_RACE, page: "odds3t" }, "page が列挙値以外"],
    [{ raceId: TODAY_RACE }, "page なし"],
    [{ page: "3t" }, "raceId なし"],
    [{ raceId: [TODAY_RACE, TODAY_RACE], page: "3t" }, "raceId が配列"],
    [{ raceId: TODAY_RACE, page: "3t", t: "1" }, "未知のパラメータ"],
  ];
  for (const [query, label] of bad) {
    check(`400: ${label}`, validateLiveOddsQuery(query, NOW).ok === false);
  }
  check(
    "liveOddsUrl: 公式の該当ページ",
    liveOddsUrl({ ...ok, page: "2tf" }) ===
      "https://www.boatrace.jp/owpc/pc/race/odds2tf?rno=2&jcd=21&hd=20260929",
  );
}

// ---- (d) handleLiveOddsRequest ----
const htmlResponse = (html, status = 200) => new Response(html, { status });
const fetcher = (fn) => {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    return fn(url);
  };
  f.calls = calls;
  return f;
};

// ---- 後半の場面（verifyData/odds-live-api-scenes-1.js） ----
await runOddsLiveApiScenes1({ check, show, FINAL, T3_PREDEADLINE, TF_UNPUBLISHED, NOW, TODAY_RACE, htmlResponse, fetcher });

// ---- (e) 設定 ----
// api/odds/live.js の本文の字は読まず、読み込んで export と、手前の部品へ渡した引数・呼び出しの記録で見る（verifyData/odds-live-api-wiring-scenes.js）
const live = await runLiveOddsWiringScenes({ check, show, htmlResponse, page: T3_PREDEADLINE, WRITE_METHODS });
{
  const { writes } = live;
  check(
    "api/odds/live.js・scripts/lib/liveOdds.js: race_odds に書かない（読むのは許す）",
    writes.length === 0,
    show(writes),
  );
  // 再現: 読むだけのソースは通り（前の検査はここで落ちた）、書くソースは落ちる
  for (const [label, src] of [
    [
      "select の連なり",
      'const { data } = await supabase.from("race_odds").select("window_min, scraped_at").eq("race_id", id).order("window_min", { ascending: false }).limit(1);',
    ],
    [
      "Promise.all の中の select",
      'const [a, b] = await Promise.all([supabase.from("race_odds").select("*"), cache.delete(id)]);',
    ],
    ["Map の delete・hash の update", "cache.delete(id); hash.update(body);"],
    [
      "コメント・文字列の中の語",
      '// supabase.from("race_odds").upsert(rows) はしない\n/*\n  .rpc( も使わない\n*/\nconst note = "race_odds に .insert( しない";',
    ],
  ]) {
    const got = raceOddsWrites(src);
    check(`検査の再現: 読むだけは通る（${label}）`, got.length === 0, show(got));
  }
  for (const [label, src] of [
    ["upsert", 'await supabase.from("race_odds").upsert(rows);'],
    ["insert", 'await supabase.from("race_odds").insert(row);'],
    [
      "改行をはさんだ update",
      'await supabase\n  .from("race_odds")\n  .update({ odds })\n  .eq("race_id", id);',
    ],
    ["delete", 'await supabase.from("race_odds").delete().eq("race_id", id);'],
    ["URL の後の upsert", 'await fetch("https://x").then(() => supabase.from("race_odds").upsert(rows));'],
    ["変数に入れた表の名前", 'const T = "race_odds"; await supabase.from(T).upsert(rows);'],
    ["upsertChangedRows に渡す", 'await save(supabase, "race_odds", rows);'],
    ["rpc", 'await supabase.rpc("save_odds_window", { rows });'],
    [
      "名前を変えた import",
      'import { createOddsCronHandler as h } from "../../scripts/lib/scrapeJobs/oddsHandlers.js";',
    ],
    [
      "unchangedRows の import",
      'import { upsertChangedRows as save } from "../../scripts/lib/unchangedRows.js";',
    ],
  ]) {
    check(
      `検査の再現: 書くソースは落ちる（${label}）`,
      raceOddsWrites(src).length > 0,
    );
  }
  const vite = fs.readFileSync(
    new URL("../../vite.config.js", import.meta.url),
    "utf8",
  );
  check(
    "vite.config.js: READ_ONLY_API に odds",
    /READ_ONLY_API = '[^']*\|odds\)/.test(vite),
  );
}

// ---- 後半の場面（verifyData/odds-live-api-scenes-1.js・odds-live-api-scenes-2.js） ----
await runOddsLiveApiScenes2({ check, show, FINAL, T3_PREDEADLINE, TF_UNPUBLISHED, NOW, TODAY_RACE, htmlResponse, fetcher, live });
await runOddsLiveApiScenes3({ printOut, check, show, TODAY_RACE });
if (failures > 0) {
  printErr(`❌ ${failures}件の検証に失敗しました`);
  process.exit(1);
}

// ---- 後半の場面（verifyData/odds-live-api-scenes-2.js） ----
runOddsLiveApiScenes4({ printOut, check, show, TODAY_RACE });
