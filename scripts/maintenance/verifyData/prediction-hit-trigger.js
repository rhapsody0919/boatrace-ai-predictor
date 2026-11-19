/**
 * verify-prediction-hit-judgement.js の予想・結果・期待値と、(b) DBトリガー（PGlite）の評価。verify ではない。
 * 変異検証で、壊したマイグレーションにも同じ評価をかける。PGlite は verify 側で読み込んで渡す。
 */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const HIT_KEYS = [
  "is_hit_win",
  "is_hit_place",
  "is_hit_trifecta",
  "is_hit_trio",
  "payout_win",
  "payout_place",
  "payout_trifecta",
  "payout_trio",
];
export const PAY = {
  payout_win: 150,
  payout_place_1: 110,
  payout_place_2: 200,
  payout_trifecta: 500,
  payout_trio: 900,
};
export const PRED = { top_pick: 1, top_2nd: 2, top_3rd: 3 };
export const TURN = {
  feature_contributions: {
    turnPrediction: { patterns: [{ winnerCourse: 1 }] },
  },
};

/** 予想・結果・期待値（展開予測以外）。DBトリガーでも同じ予想・結果を使う */
export const CASES = [
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
export const pick = (row) => HIT_KEYS.map((k) => row[k] ?? null);

const arr = (a) => (a === null ? null : `{${a.join(",")}}`);

/** 表を作り、マイグレーションを当てる。失敗は { error } */
async function createTriggerDb(PGlite, sql) {
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
    return { error: `マイグレーションの適用に失敗: ${e.message}` };
  }
  return { db };
}

/** 1つの場面: 予想・結果を入れ、トリガーが書いた値を JS の判定と比べる */
async function checkCase(db, c, i, judge, failed) {
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
async function checkPartialResult(db, failed) {
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
async function checkStatusOnlyUpdate(db, failed) {
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
    failed.push("race_status だけを no_race に直したとき、判定をやり直さない");
}

/** (b) DBトリガー: 失敗の文の一覧を返す（空なら合格） */
export async function evaluateTrigger(PGlite, sql, judge) {
  const failed = [];
  const made = await createTriggerDb(PGlite, sql);
  if (made.error) return [made.error];
  const { db } = made;
  for (const [i, c] of CASES.entries())
    await checkCase(db, c, i, judge, failed);
  await checkPartialResult(db, failed);
  await checkStatusOnlyUpdate(db, failed);
  await db.close();
  return failed;
}
