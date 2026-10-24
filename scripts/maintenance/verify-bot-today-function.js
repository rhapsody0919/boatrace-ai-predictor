#!/usr/bin/env node
/**
 * ボット向け HTML の /today の関数（ADR 0089 第2段、BOA-848。api/bot-page/today.js、中身は api/_lib/botToday.js）を検証する。
 * 材料の取得（PostgREST）と時計を差し替えてハンドラを呼ぶ。材料は本番の 2026-10-12 を同じ select で読んで保存したフィクスチャ。
 *
 * 守るもの:
 * 1. 200・Content-Type・Cache-Control（第1段と同じ）。head の title・description・canonical・robots が人の /today と同じ、
 *    hreflang なし（ja 専用）、JSON-LD は index.html の共通の3つと BreadcrumbList（ホーム › 本日のデータ一覧）
 * 2. 本文: 見出し・日付と開催数・期間・注目レース（会場・レース番号・締切・理由の文・リンク）・各セクションの名前と件数・
 *    逃げ／まくり／逃がしのレースのリンク（人と同じ /race/{id}、初期表示の6枚だけ。人の DigestCardGrid と同じ）・フライング／帰郷は件数と説明だけ・用語・免責・ホームへのリンク
 * 3. 選手の値を取りに行かない（select に racer_id・racer_name・grade・boat_number・motor_2rate 等が無い）、本文に選手の値が入らない
 * 4. 材料が取れない・壊れた・環境変数が無い → 503・no-store（「まだ公開されていません」にしない）。正しく読めて行が無い・
 *    generated_at が NULL のときだけ「まだ公開されていません」の 200（ADR 0069）
 * 5. 日付は JST の今日（UTC で動かしても前日にならない）。材料は日付ごとに60秒使い回す。GET・HEAD 以外は 405
 * 6. 値のエスケープ、vercel.json で syd1・edge でないこと
 */
process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

const {
  createTodayBotHandler,
  createDigestSource,
  ROW_SELECT,
  NOT_GENERATED_TEXT,
  CARD_PREVIEW_COUNT,
} = await import("../../api/_lib/botToday.js");
const { ROBOTS, parseJsonLdScripts } =
  await import("../../api/_lib/botPage.js");
const { MORNING_DIGEST_META, MORNING_DIGEST_SECTION_BY_KEY } =
  await import("../../src/data/morningDigestCopy.js");
const todayModule = await import("../../api/bot-page/today.js");
check("today.js の default がハンドラ", typeof todayModule.default, "function");

const FIXTURE = JSON.parse(
  read(
    "scripts/lib/__fixtures__/morning-digest/morning-digest-2026-10-12.json",
  ),
);
const fresh = () => JSON.parse(JSON.stringify(FIXTURE));
// 2026-10-12 08:00 JST（UTC では 10/11 23:00。UTC の日付を使うと前日になる時刻）
const NOW = Date.parse("2026-10-11T23:00:00Z");
const ENV = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_ANON_KEY: "anon-test",
};

const jsonResponse = (body, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
/** PostgREST の代わり。URL で days・rows を返し分け、呼ばれた URL と apikey を残す */
function stubRest(
  fixture = fresh(),
  { dayStatus = 200, rowsStatus = 200 } = {},
) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, apikey: init?.headers?.apikey });
    if (url.includes("/morning_digest_days?"))
      return jsonResponse(fixture.day, dayStatus);
    if (url.includes("/morning_digest_rows?"))
      return jsonResponse(fixture.rows, rowsStatus);
    return jsonResponse({}, 404);
  };
  fn.calls = calls;
  return fn;
}

function fakeRes() {
  const headers = {};
  return {
    statusCode: 0,
    headers,
    body: undefined,
    setHeader(k, v) {
      headers[k.toLowerCase()] = String(v);
    },
    end(body) {
      this.body = body;
    },
  };
}

async function call({
  fetchImpl = stubRest(),
  method = "GET",
  now = () => NOW,
  env = ENV,
} = {}) {
  const handler = createTodayBotHandler({
    getDigest: createDigestSource({ fetchImpl, now, env }),
    now,
  });
  const res = fakeRes();
  await handler({ method, url: "/today?date=2026-01-01", headers: {} }, res);
  return { res, calls: fetchImpl.calls };
}

const SUCCESS_CC =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=60, stale-if-error=3600";
const attr = (html, re) => html.match(re)?.[1] ?? null;
const bodyOf = (html) => html.split("<body>")[1] ?? "";
const links = (html) =>
  [...bodyOf(html).matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);

// ---- 1・2 ----
{
  const { res, calls } = await call();
  const html = res.body;
  check("200", res.statusCode, 200);
  check(
    "Content-Type",
    res.headers["content-type"],
    "text/html; charset=utf-8",
  );
  check("Cache-Control", res.headers["cache-control"], SUCCESS_CC);
  check(
    "材料は days・rows の2回、日付は JST の今日（?date= は読まない）",
    calls.map((c) => c.url.match(/digest_date=eq\.([\d-]+)/)?.[1]),
    ["2026-10-12", "2026-10-12"],
  );
  check(
    "anon キーで読む",
    calls.every((c) => c.apikey === "anon-test"),
    true,
  );
  check("lang", attr(html, /<html lang="([^"]*)"/), "ja");
  check(
    "title",
    attr(html, /<title>([^<]*)<\/title>/),
    MORNING_DIGEST_META.title,
  );
  check(
    "description",
    attr(html, /<meta name="description" content="([^"]*)"/),
    MORNING_DIGEST_META.description,
  );
  check(
    "canonical",
    attr(html, /<link rel="canonical" href="([^"]*)"/),
    "https://www.boat-ai.jp/today",
  );
  check("robots", attr(html, /<meta name="robots" content="([^"]*)"/), ROBOTS);
  check("hreflang なし（ja 専用）", html.includes('rel="alternate"'), false);
  const ld = parseJsonLdScripts(html);
  check(
    "JSON-LD の型",
    ld.map((l) => l["@type"]),
    ["WebSite", "SoftwareApplication", "Organization", "BreadcrumbList"],
  );
  check(
    "パンくず",
    ld[3].itemListElement.map((i) => [i.name, i.item]),
    [
      ["ホーム", "https://www.boat-ai.jp/"],
      ["本日のデータ一覧", "https://www.boat-ai.jp/today"],
    ],
  );
  const b = bodyOf(html);
  check("見出し", b.includes(`<h1>${MORNING_DIGEST_META.h1}</h1>`), true);
  check(
    "日付と開催数",
    b.includes("<p>10月12日（月）　14会場 168レース</p>"),
    true,
  );
  check(
    "期間",
    b.includes(
      "<p><strong>集計期間</strong> 2025-12-02 〜 2026-10-10（313日）／ 調子は直近90日</p>",
    ),
    true,
  );
  check("注目レース", b.includes("<h2>今日の注目レース</h2>"), true);
  check(
    "注目レースの会場・レース番号・締切",
    b.includes("<p><span>浜名湖 11R</span> <span>締切 16:02</span></p>"),
    true,
  );
  check("注目レースの理由の文", b.includes("全国56走で87.5%"), true);
  check(
    "逃げの件数（人の DigestSection と同じ。候補23件で23件）",
    b.includes("<span>23件</span>"),
    true,
  );
  for (const key of ["nige", "makuri", "nigashi", "flying", "returned"]) {
    check(
      `セクション ${key} の名前`,
      b.includes(`<h2>${MORNING_DIGEST_SECTION_BY_KEY[key].title}</h2>`),
      true,
    );
  }
  check(
    "まくりの注意書き",
    b.includes(MORNING_DIGEST_SECTION_BY_KEY.makuri.notice),
    true,
  );
  check(
    "用語の時刻（JST）",
    b.includes("この数値は 10/12 05:30 時点のものです。"),
    true,
  );
  const raceRows = FIXTURE.rows.filter((r) =>
    ["featured", "nige", "makuri", "nigashi"].includes(r.section),
  );
  check(
    "リンク先: 注目・逃げ・まくり・逃がしのレース（人と同じ /race/{id}）とホーム",
    links(html),
    [
      `/race/${raceRows[0].race_id}`,
      ...["nige", "makuri", "nigashi"].flatMap((s) =>
        FIXTURE.rows
          // 逃がしは2号艇だけ（3号艇は人の画面の折りたたみの中。2026-10-15）
          .filter((r) => r.section === s && (s !== "nigashi" || r.course === 2))
          .slice(0, 6)
          .map((r) => `/race/${r.race_id}`),
      ),
      "/",
    ],
  );
  check(
    "フライング（前日）のレースへのリンクは無い（選手の一覧を出さない）",
    links(html).includes("/race/2026-10-11-09-03"),
    false,
  );
  check(
    "フライング・帰郷の件数",
    b.includes("<span>1件</span>") && b.includes("<span>3件</span>"),
    true,
  );
  check(
    "「まだ公開されていません」は出ない",
    b.includes(NOT_GENERATED_TEXT),
    false,
  );

  // HEAD
  const head = await call({ method: "HEAD" });
  check(
    "HEAD は 200・本文なし",
    [head.res.statusCode, head.res.body],
    [200, undefined],
  );
}

// 人の DigestCardGrid の初期表示の枚数と同じ（残りは「もっと見る」まで描かれない）
check(
  "カードの枚数は人の DigestCardGrid の previewCount の既定値と同じ",
  read("src/components/digest/DigestCardGrid.jsx").match(
    /previewCount\s*=\s*(\d+)/,
  )?.[1],
  String(CARD_PREVIEW_COUNT),
);

// ---- 3. 選手の値 ----
{
  for (const col of [
    "racer_id",
    "racer_name",
    "grade",
    "boat_number",
    "motor_2rate",
    "metric_value",
    "detail,",
  ]) {
    check(`select に ${col} が無い`, ROW_SELECT.includes(col), false);
  }
  // 材料に選手の値が混ざって返っても、本文に出さない
  const fx = fresh();
  for (const r of fx.rows) {
    r.racer_name = "選手名テスト";
    r.racer_id = 9999;
    r.motor_2rate = 77.7;
  }
  const { res } = await call({ fetchImpl: stubRest(fx) });
  const b = bodyOf(res.body);
  check(
    "本文に選手の名前・登録番号・モーター2連率が無い",
    ["選手名テスト", "9999", "77.7", "モーター2連率", "<script"].filter((w) =>
      b.includes(w),
    ),
    [],
  );
}

// ---- 逃がしは2号艇だけ出す（2026-10-15。3号艇は人の画面の折りたたみの中、4〜6号艇は出さない） ----
{
  const fx = fresh();
  const nigashi = fx.rows.filter((r) => r.section === "nigashi");
  nigashi[0].course = 2;
  nigashi[1].course = 2;
  const { res } = await call({ fetchImpl: stubRest(fx) });
  const b = bodyOf(res.body);
  const section = b.split(
    `<h2>${MORNING_DIGEST_SECTION_BY_KEY.nigashi.title}</h2>`,
  )[1].split("<h2>")[0];
  check(
    "逃がしの件数は2号艇の行だけを数える",
    section.includes("<span>2件</span>"),
    true,
  );
  check(
    "逃がしのリンクは2号艇の行だけ",
    [...section.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]),
    [`/race/${nigashi[0].race_id}`, `/race/${nigashi[1].race_id}`],
  );
  check("select に course がある（逃がしを分けるため）", ROW_SELECT.includes("course"), true);
}

// ---- BOA-1004: 0件の文言は人の画面と同じ ----
for (const noNigashiRows of [false, true]) {
  const fx = fresh();
  fx.rows = fx.rows.filter((r) => !["nige", "makuri"].includes(r.section));
  if (noNigashiRows) {
    fx.rows = fx.rows.filter((r) => r.section !== "nigashi");
  } else {
    for (const r of fx.rows.filter((r) => r.section === "nigashi")) {
      r.course = 3;
    }
  }
  const { res } = await call({ fetchImpl: stubRest(fx) });
  check(`0件の応答（逃がし行なし: ${noNigashiRows}）`, res.statusCode, 200);
  const b = bodyOf(res.body);
  const defaultEmpty = "本日、条件に該当するレースはありません";
  for (const key of ["nige", "makuri", "nigashi"]) {
    const copy = MORNING_DIGEST_SECTION_BY_KEY[key];
    const section = b.split(`<h2>${copy.title}</h2>`)[1].split("<h2>")[0];
    const label = `${key}（逃がし行なし: ${noNigashiRows}）`;
    check(`${label}: 0件`, /<span>(?:上位0件 \/ \d+件|0件)<\/span>/.test(section), true);
    check(
      `${label}: 人の画面と同じ0件の文言`,
      section.includes(`<p>${copy.emptyMessage ?? defaultEmpty}</p>`),
      true,
    );
    check(
      `${label}: 既定の文言は逃げ・まくりだけ`,
      section.includes(defaultEmpty),
      key !== "nigashi",
    );
    check(`${label}: レースのリンクなし`, section.includes('<a href="'), false);
  }
}

// ---- 4. 失敗と未生成 ----
{
  const origError = console.error;
  console.error = () => {};
  try {
    const broken = [
      ["days が HTTP 500", stubRest(fresh(), { dayStatus: 500 })],
      ["rows が HTTP 401", stubRest(fresh(), { rowsStatus: 401 })],
      [
        "JSON でない",
        Object.assign(async () => jsonResponse("<html>"), { calls: [] }),
      ],
      [
        "取得で例外",
        Object.assign(
          async () => {
            throw new TypeError("fetch failed");
          },
          { calls: [] },
        ),
      ],
      ["rows が配列でない", stubRest({ day: fresh().day, rows: { x: 1 } })],
      [
        "レースの行の会場コードが範囲外",
        stubRest({
          day: fresh().day,
          rows: [
            {
              section: "nige",
              rank: 1,
              race_id: "2026-10-12-30-01",
              venue_code: 30,
              race_number: 1,
            },
          ],
        }),
      ],
      ["days が2行", stubRest({ day: [{}, {}], rows: [] })],
    ];
    for (const [label, fetchImpl] of broken) {
      const { res } = await call({ fetchImpl });
      check(`${label}: 503`, res.statusCode, 503);
      check(`${label}: no-store`, res.headers["cache-control"], "no-store");
      check(
        `${label}: 「まだ公開されていません」にしない`,
        (res.body ?? "").includes("公開されていません"),
        false,
      );
    }
    const noEnv = await call({ env: {} });
    check("環境変数が無い: 503", noEnv.res.statusCode, 503);
  } finally {
    console.error = origError;
  }

  const none = await call({ fetchImpl: stubRest({ day: [], rows: [] }) });
  check("行が無い: 200", none.res.statusCode, 200);
  check(
    "行が無い: 「まだ公開されていません」",
    bodyOf(none.res.body).includes(`<p>${NOT_GENERATED_TEXT}</p>`),
    true,
  );
  check(
    "行が無い: 日付だけ",
    bodyOf(none.res.body).includes("<p>10月12日（月）</p>"),
    true,
  );
  check(
    "行が無い: セクション・用語は出さない（人も出さない）",
    bodyOf(none.res.body).includes("<h2>"),
    false,
  );
  const half = fresh();
  half.day[0].generated_at = null;
  const midway = await call({ fetchImpl: stubRest(half) });
  check(
    "generated_at が NULL（生成の途中）: 「まだ公開されていません」",
    bodyOf(midway.res.body).includes(NOT_GENERATED_TEXT),
    true,
  );
}

// ---- 5. 日付・使い回し・メソッド ----
{
  let clock = NOW;
  const now = () => clock;
  const f = stubRest();
  const getDigest = createDigestSource({ fetchImpl: f, now, env: ENV });
  const h = createTodayBotHandler({ getDigest, now });
  const hit = async () => {
    const res = fakeRes();
    await h({ method: "GET", url: "/today", headers: {} }, res);
    return res.statusCode;
  };
  await hit();
  clock = NOW + 59_000;
  await hit();
  check(
    "使い回し: 60秒以内は1回（days・rows で2リクエスト）",
    f.calls.length,
    2,
  );
  clock = NOW + 61_000;
  await hit();
  check("使い回し: 61秒後に取り直す", f.calls.length, 4);
  // JST の日付が変わったら別の日付で取り直す（15:00Z = 翌日 0:00 JST）
  clock = Date.parse("2026-10-12T15:00:00Z");
  await hit();
  check(
    "JST の日付が変わったら翌日を読む",
    f.calls.at(-1).url.match(/digest_date=eq\.([\d-]+)/)?.[1],
    "2026-10-13",
  );
  const post = await call({ method: "POST" });
  check(
    "POST: 405",
    [post.res.statusCode, post.res.headers.allow],
    [405, "GET, HEAD"],
  );
}

// ---- 6. エスケープ・配置 ----
{
  const fx = fresh();
  fx.rows[0].reason = `<script>alert("x")</script>&'"`;
  const { res } = await call({ fetchImpl: stubRest(fx) });
  check(
    "理由の文はエスケープする",
    bodyOf(res.body).includes(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;&quot;",
    ),
    true,
  );
  check(
    "生の <script> が無い（JSON-LD 以外）",
    /<script(?! type="application\/ld\+json">)/i.test(res.body),
    false,
  );
  const vercel = JSON.parse(read("vercel.json"));
  check(
    "vercel.json: api/bot-page/**/*.js は syd1",
    vercel.functions?.["api/bot-page/**/*.js"]?.regions,
    ["syd1"],
  );
  check(
    "today.js は edge でない",
    /runtime\s*:\s*["']edge["']/.test(read("api/bot-page/today.js")),
    false,
  );
}

if (failures.length > 0) {
  console.error(
    `❌ verify-bot-today-function: ${failures.length}件の失敗（${checked}件中）`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-bot-today-function: ${checked}件すべて通過`);
