#!/usr/bin/env node
/**
 * /api/predictions/{date} の入口の検査と応答から外す欄（api/_lib/predictionsResponse.js、BOA-1110）を検証する。
 *
 * 守るもの:
 * - 応答に廃止した3モデルの点（entries[].aiScoreStandard/SafeBet/UpsetFocus）と予想オッズ（races[].predictionOdds）が無い
 * - それ以外の欄（inCaution・turnPrediction・predictions・result・知らない新しいキー）は残る（外す欄は名指し）
 * - クエリは無しか ?light=true だけ（動的ルートの date はパスと同じ値だけ）。実在しない日付・JST の明日より先は 400・no-store で RPC を呼ばない
 * - ハンドラ（api/predictions/[date].js）を偽の fetch で呼び、上の3つが通しで成り立つ
 */
process.env.TZ = "UTC";
process.env.VITE_SUPABASE_URL = "https://example.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "test-anon";

import {
  REMOVED_ENTRY_FIELDS,
  REMOVED_RACE_FIELDS,
  stripUnusedPredictionFields,
  validatePredictionsRequest,
} from "../../api/_lib/predictionsResponse.js";

const failures = [];
let checked = 0;
function check(label, ok, detail = "") {
  checked += 1;
  if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`);
}
const show = (v) => JSON.stringify(v);

const rpcFixture = () => ({
  date: "2026-10-24",
  generatedAt: "2026-10-24T00:00:00Z",
  races: [
    {
      raceId: "2026-10-24-01-01",
      inCaution: { n: 100, nonWin: 40, level: "mid" },
      turnPrediction: null,
      futureKey: "kept",
      predictionOdds: { trifectaOddsStandard: 12.3 },
      entries: [
        {
          number: 1,
          name: "選手A",
          winRate: "6.50",
          aiScoreStandard: 80,
          aiScoreSafeBet: 70,
          aiScoreUpsetFocus: 60,
        },
      ],
      predictions: {
        unified: { topPick: 1, top3: [1, 2, 3] },
        safeBet: { top3: [1, 3, 2] },
      },
      result: null,
    },
  ],
});

// ---- 外す欄 ----
{
  const out = stripUnusedPredictionFields(rpcFixture());
  const race = out.races[0];
  for (const f of REMOVED_RACE_FIELDS)
    check(`races[].${f} が無い`, !(f in race));
  for (const f of REMOVED_ENTRY_FIELDS)
    check(`entries[].${f} が無い`, !(f in race.entries[0]));
  check(
    "ほかの欄は残る（inCaution・turnPrediction・predictions・result・知らないキー・entries の他の欄）",
    show(race.inCaution) === show({ n: 100, nonWin: 40, level: "mid" }) &&
      "turnPrediction" in race &&
      race.futureKey === "kept" &&
      show(race.predictions.safeBet.top3) === show([1, 3, 2]) &&
      "result" in race &&
      race.entries[0].name === "選手A" &&
      race.entries[0].winRate === "6.50",
    show(race),
  );
  check(
    "トップの欄は残る",
    out.date === "2026-10-24" && out.generatedAt != null,
  );
  check(
    "races が配列でなければそのまま",
    show(stripUnusedPredictionFields({ races: null })) ===
      show({ races: null }),
  );
  check("null はそのまま", stripUnusedPredictionFields(null) === null);
  check(
    "entries が無いレースはそのまま（entries を足さない）",
    !(
      "entries" in
      stripUnusedPredictionFields({ races: [{ raceId: "x" }] }).races[0]
    ),
  );
}

// ---- 入口の検査 ----
// 2026-10-24 06:00 JST（UTC では 10/23 21:00）。JST の明日は 10/25
const NOW = Date.parse("2026-10-23T21:00:00Z");
const v = (date, search) =>
  validatePredictionsRequest(date, new URLSearchParams(search), NOW);
check(
  "クエリ無し: 通る・全体版",
  show(v("2026-10-24", "")) === show({ ok: true, light: false }),
);
check(
  "?light=true: 通る・light",
  show(v("2026-10-24", "?light=true")) === show({ ok: true, light: true }),
);
check(
  "動的ルートの date（パスと同じ）: 通る",
  v("2026-10-24", "?date=2026-10-24").ok,
);
check("過去の日付: 通る", v("2025-01-01", "").ok);
check("JST の明日: 通る", v("2026-10-25", "").ok);
for (const [label, date, search] of [
  ["余計なクエリ", "2026-10-24", "?x=1"],
  ["キャッシュ外しのクエリ", "2026-10-24", "?light=true&_=123"],
  ["light=1", "2026-10-24", "?light=1"],
  ["light を2つ", "2026-10-24", "?light=true&light=true"],
  ["date がパスと違う", "2026-10-24", "?date=2026-10-23"],
  ["暦に無い日付", "2026-02-30", ""],
  ["月が99", "2026-99-01", ""],
  ["形が違う", "20261024", ""],
  ["JST の明後日", "2026-10-26", ""],
]) {
  check(
    `400 になる: ${label}`,
    v(date, search).ok === false,
    show(v(date, search)),
  );
}

// ---- ハンドラを通しで（偽の fetch） ----
{
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body });
    return new Response(JSON.stringify(rpcFixture()), { status: 200 });
  };
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    const { default: handler } =
      await import("../../api/predictions/[date].js");
    const ok = await handler(
      new Request(
        "https://www.boat-ai.jp/api/predictions/2026-10-24?light=true",
      ),
    );
    const body = await ok.json();
    check(
      "ハンドラ: 200・light の RPC・aiScore と predictionOdds が無い・inCaution は残る",
      ok.status === 200 &&
        calls.length === 1 &&
        calls[0].url.endsWith("/rest/v1/rpc/get_predictions_by_date_light") &&
        !("predictionOdds" in body.races[0]) &&
        REMOVED_ENTRY_FIELDS.every((f) => !(f in body.races[0].entries[0])) &&
        body.races[0].inCaution?.n === 100,
      show({ status: ok.status, calls, race: body.races?.[0] }),
    );
    const bad = await handler(
      new Request(
        "https://www.boat-ai.jp/api/predictions/2026-10-24?nocache=1",
      ),
    );
    check(
      "ハンドラ: 余計なクエリは 400・no-store・RPC を呼ばない",
      bad.status === 400 &&
        bad.headers.get("Cache-Control") === "no-store" &&
        calls.length === 1,
      show({
        status: bad.status,
        cache: bad.headers.get("Cache-Control"),
        calls: calls.length,
      }),
    );
  } finally {
    Date.now = realNow;
  }
}

if (failures.length > 0) {
  console.error(`❌ ${failures.length}/${checked} 件の検証に失敗しました`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ ${checked} 件の検証に成功しました`);
