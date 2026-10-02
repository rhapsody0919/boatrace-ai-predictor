/**
 * verify-prediction-hit-judgement.js - 不成立・返還を的中判定と成績集計から外す（BOA-544）の検証。DBにも取得先にも接続しない。
 *
 *   (a) 判定関数（hitCalculator.js の buildPredictionHitUpdate）: 不成立は全券種・展開予測が NULL。返還艇を本命にした予想は
 *       単勝・複勝が NULL、上位3艇に返還艇があれば3連系が NULL。返還艇と関係の無い券種は通常どおり判定する。race_status が
 *       NULL（078以前）は今までどおり。top_3rd を予想しないモデルの3連系は NULL。外れの配当は 0、対象外は NULL
 *   (b) DBトリガー（マイグレーション117、PGlite で実際に適用）: 同じ予想・結果で、(a) と同じ値を書く（展開予測以外）。
 *       不成立では is_hit_turn を NULL にし、それ以外では触らない。race_status だけの更新でも判定をやり直す
 *   (c) 欠落の補完（scrape-results.js の fixMissingHitFlags）: 判定対象外のまま（今の値と同じ）の行は書かず、
 *       notJudgeable として数える（毎日同じ行を書き直さない）。欠落していた行は書く
 *   (d) 成績集計（calculate-accuracy.js の summarizeHits・computeStats）: 母数は券種ごとの「判定した予想」の数
 *   (e) 変異検証: 判定・トリガー・補完・集計を壊した版で、上の検証が失敗する
 *
 * 実行: node scripts/maintenance/verify-prediction-hit-judgement.js（PGlite は devDependencies）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION = fs.readFileSync(
  path.join(
    ROOT,
    "docs/db-migration/117_prediction_hits_exclude_no_race_refund.sql",
  ),
  "utf8",
);

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const HIT_KEYS = [
  "is_hit_win",
  "is_hit_place",
  "is_hit_trifecta",
  "is_hit_trio",
  "payout_win",
  "payout_place",
  "payout_trifecta",
  "payout_trio",
];
const PAY = {
  payout_win: 150,
  payout_place_1: 110,
  payout_place_2: 200,
  payout_trifecta: 500,
  payout_trio: 900,
};
const PRED = { top_pick: 1, top_2nd: 2, top_3rd: 3 };
const TURN = {
  feature_contributions: {
    turnPrediction: { patterns: [{ winnerCourse: 1 }] },
  },
};

/** 予想・結果・期待値（展開予測以外）。DBトリガーでも同じ予想・結果を使う */
const CASES = [
  {
    name: "通常・全的中",
    pred: PRED,
    result: {
      rank1: 1,
      rank2: 2,
      rank3: 3,
      race_status: "normal",
      refund_boats: [],
    },
    expected: [true, true, true, true, 150, 110, 500, 900],
  },
  {
    name: "通常・外れ（配当0）",
    pred: { top_pick: 4, top_2nd: 5, top_3rd: 6 },
    result: {
      rank1: 1,
      rank2: 2,
      rank3: 3,
      race_status: "normal",
      refund_boats: [],
    },
    expected: [false, false, false, false, 0, 0, 0, 0],
  },
  {
    name: "不成立: 全券種 NULL",
    pred: PRED,
    result: {
      rank1: 1,
      rank2: 2,
      rank3: 3,
      race_status: "no_race",
      refund_boats: [2, 3, 4, 5, 6],
    },
    expected: [null, null, null, null, null, null, null, null],
  },
  {
    name: "一部返還・本命が返還艇: 全券種 NULL",
    pred: { top_pick: 4, top_2nd: 1, top_3rd: 2 },
    result: {
      rank1: 1,
      rank2: 2,
      rank3: 3,
      race_status: "partial_refund",
      refund_boats: [4],
    },
    expected: [null, null, null, null, null, null, null, null],
  },
  {
    name: "一部返還・3番手が返還艇: 単勝・複勝は判定、3連系は NULL",
    pred: { top_pick: 1, top_2nd: 2, top_3rd: 6 },
    result: {
      rank1: 1,
      rank2: 2,
      rank3: 3,
      race_status: "partial_refund",
      refund_boats: [6],
    },
    expected: [true, true, null, null, 150, 110, null, null],
  },
  {
    name: "一部返還・予想と関係の無い艇: 通常どおり判定",
    pred: PRED,
    result: {
      rank1: 1,
      rank2: 2,
      rank3: 3,
      race_status: "partial_refund",
      refund_boats: [5],
    },
    expected: [true, true, true, true, 150, 110, 500, 900],
  },
  {
    name: "race_status が NULL（078以前）: 今までどおり（2着の複勝）",
    pred: { top_pick: 2, top_2nd: 1, top_3rd: 3 },
    result: {
      rank1: 1,
      rank2: 2,
      rank3: 3,
      race_status: null,
      refund_boats: null,
    },
    expected: [false, true, true, false, 0, 200, 500, 0],
  },
  {
    name: "top_3rd を予想しないモデル: 3連系は NULL",
    pred: { top_pick: 1, top_2nd: 2, top_3rd: null },
    result: {
      rank1: 1,
      rank2: 2,
      rank3: 3,
      race_status: "normal",
      refund_boats: [],
    },
    expected: [true, true, null, null, 150, 110, null, null],
  },
];
const pick = (row) => HIT_KEYS.map((k) => row[k] ?? null);

// ---------------------------------------------------------------------------
// (a) 判定関数
// ---------------------------------------------------------------------------
function evaluateJudge(m) {
  const failed = [];
  for (const c of CASES) {
    const got = pick(
      m.buildPredictionHitUpdate(c.pred, { ...PAY, ...c.result }),
    );
    if (!same(got, c.expected))
      failed.push(
        `${c.name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(c.expected)}`,
      );
  }
  const turn = (result) =>
    m.buildPredictionHitUpdate(
      { ...PRED, ...TURN },
      { ...PAY, rank2: 2, rank3: 3, ...result },
    ).is_hit_turn;
  if (turn({ rank1: 1, race_status: "no_race", refund_boats: [2] }) !== null)
    failed.push("展開予測: 不成立は NULL");
  if (
    turn({ rank1: 1, race_status: "partial_refund", refund_boats: [1] }) !==
    true
  )
    failed.push("展開予測: 一部返還は1着で判定する");
  if (
    m.buildPredictionHitUpdate(PRED, { ...PAY, rank1: 1, rank2: 2, rank3: 3 })
      .is_hit_turn !== null
  )
    failed.push("展開予測: パターンが無ければ NULL");
  return failed;
}

// ---------------------------------------------------------------------------
// (b) DBトリガー（PGlite）
// ---------------------------------------------------------------------------
let PGlite;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  console.error(
    "@electric-sql/pglite が見つかりません。npm ci を実行してから再実行してください",
  );
  process.exit(1);
}

async function evaluateTrigger(sql, judge) {
  const failed = [];
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE predictions (
      prediction_id serial PRIMARY KEY, race_id text, model_id text, is_shadow boolean DEFAULT false,
      top_pick smallint NOT NULL, top_2nd smallint, top_3rd smallint,
      is_hit_win boolean, is_hit_place boolean, is_hit_trifecta boolean, is_hit_trio boolean, is_hit_turn boolean,
      payout_win integer, payout_place integer, payout_trifecta integer, payout_trio integer);
    CREATE TABLE race_results (
      race_id text PRIMARY KEY, rank1 smallint, rank2 smallint, rank3 smallint,
      payout_win integer, payout_place_1 integer, payout_place_2 integer, payout_trifecta integer, payout_trio integer,
      race_status text, refund_boats smallint[]);
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE bet_recommendations (race_id text, model_id text, actual_hit boolean, actual_payout integer);
  `);
  try {
    await db.exec(sql);
  } catch (e) {
    return [`マイグレーションの適用に失敗: ${e.message}`];
  }
  const arr = (a) => (a === null ? null : `{${a.join(",")}}`);
  for (const [i, c] of CASES.entries()) {
    const raceId = `2026-09-30-01-${String(i + 1).padStart(2, "0")}`;
    await db.query(
      `INSERT INTO predictions (race_id, model_id, top_pick, top_2nd, top_3rd, is_hit_turn) VALUES ($1, 'standard', $2, $3, $4, true)`,
      [raceId, c.pred.top_pick, c.pred.top_2nd, c.pred.top_3rd],
    );
    await db.query(
      `INSERT INTO bet_recommendations VALUES ($1, 'standard', null, null)`,
      [raceId],
    );
    const r = { ...PAY, ...c.result };
    await db.query(
      `INSERT INTO race_results VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        raceId,
        r.rank1,
        r.rank2,
        r.rank3,
        r.payout_win,
        r.payout_place_1,
        r.payout_place_2,
        r.payout_trifecta,
        r.payout_trio,
        r.race_status,
        arr(r.refund_boats),
      ],
    );
    const { rows } = await db.query(
      `SELECT * FROM predictions WHERE race_id = $1`,
      [raceId],
    );
    const got = pick(rows[0]);
    const js = pick(judge(c.pred, r));
    if (!same(got, js))
      failed.push(
        `トリガー ${c.name}: ${JSON.stringify(got)} ≠ JS ${JSON.stringify(js)}`,
      );
    const turnExpected = c.result.race_status === "no_race" ? null : true;
    if (rows[0].is_hit_turn !== turnExpected)
      failed.push(
        `トリガー ${c.name}: is_hit_turn=${rows[0].is_hit_turn}（期待 ${turnExpected}）`,
      );
    const { rows: br } = await db.query(
      `SELECT actual_hit FROM bet_recommendations WHERE race_id = $1`,
      [raceId],
    );
    if (br[0].actual_hit !== rows[0].is_hit_win)
      failed.push(
        `トリガー ${c.name}: bet_recommendations.actual_hit が is_hit_win と一致しない`,
      );
  }
  // rank1 が無い行（結果の書きかけ）では、展開予測を消さない
  {
    const raceId = "2026-09-30-02-02";
    await db.query(
      `INSERT INTO predictions (race_id, model_id, top_pick, top_2nd, top_3rd, is_hit_turn) VALUES ($1, 'standard', 1, 2, 3, true)`,
      [raceId],
    );
    await db.query(
      `INSERT INTO race_results (race_id, race_status) VALUES ($1, 'normal')`,
      [raceId],
    );
    const { rows } = await db.query(
      `SELECT is_hit_turn FROM predictions WHERE race_id = $1`,
      [raceId],
    );
    if (rows[0].is_hit_turn !== true)
      failed.push("rank1 が無い結果で is_hit_turn を消した");
  }
  // race_status だけの更新（確定後の修正）でも判定をやり直す
  {
    const raceId = "2026-09-30-02-01";
    await db.query(
      `INSERT INTO predictions (race_id, model_id, top_pick, top_2nd, top_3rd) VALUES ($1, 'standard', 1, 2, 3)`,
      [raceId],
    );
    await db.query(
      `INSERT INTO race_results VALUES ($1,1,2,3,150,110,200,500,900,'normal','{}')`,
      [raceId],
    );
    await db.query(
      `UPDATE race_results SET race_status = 'no_race' WHERE race_id = $1`,
      [raceId],
    );
    const { rows } = await db.query(
      `SELECT is_hit_win FROM predictions WHERE race_id = $1`,
      [raceId],
    );
    if (rows[0].is_hit_win !== null)
      failed.push(
        "race_status だけを no_race に直したとき、判定をやり直さない",
      );
  }
  await db.close();
  return failed;
}

// ---------------------------------------------------------------------------
// (c) 欠落の補完
// ---------------------------------------------------------------------------
/** fixMissingHitFlags が使う範囲（select・gte・lt・is・range）と update・eq だけの偽クライアント */
function fakeClient(tables) {
  const updates = [];
  return {
    updates,
    from(table) {
      const filters = [];
      const q = {
        select: () => q,
        gte: (c, v) => (filters.push((r) => r[c] >= v), q),
        lt: (c, v) => (filters.push((r) => r[c] < v), q),
        is: (c, v) => (filters.push((r) => (r[c] ?? null) === v), q),
        range: async (from, to) => ({
          data: tables[table]
            .filter((r) => filters.every((f) => f(r)))
            .slice(from, to + 1),
          error: null,
        }),
        update: (data) => ({
          eq: async (c, v) => {
            updates.push({ table, [c]: v, data });
            return { error: null };
          },
        }),
      };
      return q;
    },
  };
}

async function evaluateFix(fixMissingHitFlags) {
  const failed = [];
  const nulls = Object.fromEntries(
    [...HIT_KEYS, "is_hit_turn"].map((k) => [k, null]),
  );
  const client = fakeClient({
    predictions: [
      // 不成立のレースの予想（判定対象外のまま。書かない）
      { prediction_id: 1, race_id: "2026-09-30-03-01", ...PRED, ...nulls },
      // 欠落（通常のレース。書く）
      { prediction_id: 2, race_id: "2026-09-30-03-02", ...PRED, ...nulls },
    ],
    race_results: [
      {
        race_id: "2026-09-30-03-01",
        rank1: 1,
        rank2: 2,
        rank3: 3,
        ...PAY,
        race_status: "no_race",
        refund_boats: [2, 3],
      },
      {
        race_id: "2026-09-30-03-02",
        rank1: 1,
        rank2: 2,
        rank3: 3,
        ...PAY,
        race_status: "normal",
        refund_boats: [],
      },
    ],
  });
  const r = await fixMissingHitFlags("2026-09-30", "2026-09-30", { client });
  if (!(r.missing === 1 && r.fixed === 1 && r.notJudgeable === 1))
    failed.push(
      `戻り値 ${JSON.stringify(r)}（期待 missing 1・fixed 1・notJudgeable 1）`,
    );
  if (
    !same(
      client.updates.map((u) => u.prediction_id),
      [2],
    )
  )
    failed.push(
      `書いた予想 ${JSON.stringify(client.updates.map((u) => u.prediction_id))}（期待 [2]）`,
    );
  if (client.updates[0]?.data.is_hit_win !== true)
    failed.push("欠落していた予想に is_hit_win=true を書く");
  return failed;
}

// ---------------------------------------------------------------------------
// (c2) 書き直しの CLI（backfill-refund-hit-flags.js の planRefundHitBackfill）
function evaluatePlan(m) {
  const failed = [];
  const result = {
    rank1: 1,
    rank2: 2,
    rank3: 3,
    ...PAY,
    race_status: "partial_refund",
    refund_boats: [6],
  };
  const noRace = {
    ...result,
    race_id: "R2",
    race_status: "no_race",
    refund_boats: [2, 3],
  };
  const base = {
    ...PRED,
    ...TURN,
    is_hit_win: true,
    is_hit_place: true,
    is_hit_trifecta: true,
    is_hit_trio: true,
    payout_win: 150,
    payout_place: 110,
    payout_trifecta: 500,
    payout_trio: 900,
  };
  const plan = m.planRefundHitBackfill(
    [
      { ...base, prediction_id: 1, race_id: "R1", is_hit_turn: null }, // 旧モデルで展開予測が NULL のまま
      { ...base, prediction_id: 2, race_id: "R2", is_hit_turn: true }, // 不成立
      {
        ...base,
        prediction_id: 3,
        race_id: "R1",
        top_3rd: 6,
        is_hit_turn: true,
      }, // 3番手が返還艇
    ],
    new Map([
      ["R1", { ...result, race_id: "R1" }],
      ["R2", noRace],
    ]),
  );
  const ids = plan.map((p) => p.prediction.prediction_id);
  if (!same(ids, [2, 3]))
    failed.push(
      `書き直す予想 ${JSON.stringify(ids)}（期待 [2,3]。展開予測の NULL は埋めない）`,
    );
  if (
    plan.find((p) => p.prediction.prediction_id === 2)?.update.is_hit_turn !==
    null
  )
    failed.push("不成立の予想の展開予測を NULL にする");
  if (
    plan.find((p) => p.prediction.prediction_id === 3)?.update.is_hit_turn !==
    true
  )
    failed.push("一部返還の予想の展開予測は今の値のまま");
  return failed;
}

// (d) 成績集計
// ---------------------------------------------------------------------------
function evaluateAccuracy(m) {
  const failed = [];
  const row = (win, trio, payoutWin, payoutTrio) => ({
    is_hit_win: win,
    is_hit_place: win,
    is_hit_trifecta: trio,
    is_hit_trio: trio,
    payout_win: payoutWin,
    payout_place: payoutWin,
    payout_trifecta: payoutTrio,
    payout_trio: payoutTrio,
  });
  const preds = [
    row(true, true, 300, 1000), // 的中
    row(false, false, 0, 0), // 外れ
    row(true, null, 200, null), // 3番手が返還艇: 3連系は母数外
    row(false, null, 0, null), // 同上
  ];
  const h = m.summarizeHits(preds);
  if (!(
    h.win.n === 4 &&
    h.win.hits === 2 &&
    h.win.hitRate === 0.5 &&
    h.win.recoveryRate === 500 / 400
  ))
    failed.push(`単勝 ${JSON.stringify(h.win)}（期待 母数4・的中2・回収125%）`);
  if (!(
    h.trio.n === 2 &&
    h.trio.hits === 1 &&
    h.trio.hitRate === 0.5 &&
    h.trio.recoveryRate === 1000 / 200
  ))
    failed.push(
      `3連単 ${JSON.stringify(h.trio)}（期待 母数2・的中1・回収500%。返還の2件は母数に入れない）`,
    );
  const s = m.computeStats(preds);
  if (!(
    s.totalRaces === 4 &&
    s.top3IncludedRate === 0.5 &&
    s.actualRecovery.trio.recoveryRate === 5
  ))
    failed.push(`computeStats ${JSON.stringify(s)}`);
  const empty = m.summarizeHits([row(null, null, null, null)]);
  if (!(
    empty.trio.n === 0 &&
    empty.trio.hitRate === 0 &&
    empty.trio.recoveryRate === 0
  ))
    failed.push("母数0は率0（0除算しない）");
  return failed;
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------
const hit = await import("../lib/hitCalculator.js");
const scrape = await import("../daily/scrape-results.js");
const accuracy = await import("../daily/calculate-accuracy.js");

const judgeFailed = evaluateJudge(hit);
check(
  "(a) 判定関数: 不成立・返還艇・078以前・top_3rd なし・配当",
  judgeFailed.length === 0,
  judgeFailed.join(" / "),
);
const trigFailed = await evaluateTrigger(
  MIGRATION,
  hit.buildPredictionHitUpdate,
);
check(
  "(b) DBトリガー（117）: JS の判定と同じ値・不成立で展開予測を NULL・race_status の更新で再判定",
  trigFailed.length === 0,
  trigFailed.join(" / "),
);
const fixFailed = await evaluateFix(scrape.fixMissingHitFlags);
check(
  "(c) 欠落の補完: 判定対象外のままの行は書かない",
  fixFailed.length === 0,
  fixFailed.join(" / "),
);
const planFailed = evaluatePlan(await import("./backfill-refund-hit-flags.js"));
check(
  "(c2) 書き直しの CLI: 判定の変わる予想だけ・展開予測は不成立で NULL にするだけ",
  planFailed.length === 0,
  planFailed.join(" / "),
);
const accFailed = evaluateAccuracy(accuracy);
check(
  "(d) 成績集計: 券種ごとの母数",
  accFailed.length === 0,
  accFailed.join(" / "),
);

// (e) 変異検証: 同じディレクトリに置き換えた版を書いて import する（相対 import を保つ）
async function withMutant(relPath, from, to, run) {
  const file = path.join(ROOT, relPath);
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes(from)) return [`置き換え元が見つからない: ${from}`];
  const mutant = file.replace(/\.js$/, `.__mutant${Date.now()}.js`);
  fs.writeFileSync(mutant, src.replace(from, to));
  try {
    return await run(await import(pathToFileURL(mutant).href));
  } catch (e) {
    return [`例外: ${e.message}`];
  } finally {
    fs.rmSync(mutant, { force: true });
  }
}
const MUTANTS = [
  [
    "判定: 単勝の返還艇の確認を外す",
    "scripts/lib/hitCalculator.js",
    "const judgeWin = isBetJudgeable(result, [pred.top_pick]);",
    "const judgeWin = isJudgeable(result);",
    (m) => evaluateJudge(m),
  ],
  [
    "判定: 3連系の返還艇の確認を外す",
    "scripts/lib/hitCalculator.js",
    "pred.top_3rd != null && isBetJudgeable(result, top3)",
    "pred.top_3rd != null && isJudgeable(result)",
    (m) => evaluateJudge(m),
  ],
  [
    "書き直し: 展開予測の NULL を埋める",
    "scripts/maintenance/backfill-refund-hit-flags.js",
    "if (isJudgeable(result)) update.is_hit_turn",
    "if (false) update.is_hit_turn",
    (m) => evaluatePlan(m),
  ],
  [
    "判定: 展開予測で不成立を見ない",
    "scripts/lib/hitCalculator.js",
    "turnPatterns.length > 0 &&\n    isJudgeable(result)",
    "turnPatterns.length > 0",
    (m) => evaluateJudge(m),
  ],
  [
    "補完: 変わらない行も書く",
    "scripts/daily/scrape-results.js",
    "if (HIT_COLUMNS.every((c) => (pred[c] ?? null) === update[c])) {",
    "if (false) {",
    (m) => evaluateFix(m.fixMissingHitFlags),
  ],
  [
    "集計: 母数を全予想にする",
    "scripts/daily/calculate-accuracy.js",
    "const n = judged.length;",
    "const n = predictions.length;",
    (m) => evaluateAccuracy(m),
  ],
];
for (const [label, rel, from, to, run] of MUTANTS) {
  const failed = await withMutant(rel, from, to, run);
  check(
    `(e) 変異検証: ${label} → 検証が失敗する（${failed.length}項目）`,
    failed.length > 0,
  );
}
const SQL_MUTANTS = [
  [
    "トリガー: 単勝の返還艇の確認を外す",
    "judgeable AND NOT (q.top_pick = ANY (refunded)) AS win",
    "judgeable AS win",
  ],
  [
    "トリガー: 不成立を見ない",
    "AND NEW.race_status IS DISTINCT FROM 'no_race';",
    ";",
  ],
  [
    "トリガー: rank1 が無いと展開予測を消す",
    "CASE WHEN NEW.race_status = 'no_race' THEN NULL ELSE p.is_hit_turn END",
    "CASE WHEN judgeable THEN p.is_hit_turn END",
  ],
  [
    "トリガー: 発火条件に race_status を入れない",
    "payout_trio,\n  race_status, refund_boats",
    "payout_trio",
  ],
  [
    "トリガー: 外れの配当を NULL に戻す",
    "THEN COALESCE(NEW.payout_trio, 0)\n            ELSE 0",
    "THEN COALESCE(NEW.payout_trio, 0)\n            ELSE NULL",
  ],
];
for (const [label, from, to] of SQL_MUTANTS) {
  const failed = MIGRATION.includes(from)
    ? await evaluateTrigger(
        MIGRATION.replace(from, to),
        hit.buildPredictionHitUpdate,
      )
    : [];
  check(
    `(e) 変異検証: ${label} → 検証が失敗する（${failed.length}項目）`,
    failed.length > 0,
  );
}

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nALL OK");
