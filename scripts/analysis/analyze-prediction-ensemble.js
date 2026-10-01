/**
 * 予想アンサンブル（ランダムフォレスト的多数決）の可能性検証
 *
 * BOA-104【スケルトン】ランダムフォレストの可能性の検討
 *   → 複数の予想器（=投票者）の「共通する買い目」の的中率/回収率を分析する。
 *
 * 現状の投票者は本番3モデル（standard / safeBet / upsetFocus）。
 * predictions テーブルは非正規化済みで、各予想行に is_hit_trio / payout_trio
 * （100円あたりの払戻円）が入っているため、結果テーブルとの突合なしで検証できる。
 *
 * 「複数サイト」への拡張:
 *   collectVotersPerRace() が race_id → 投票者配列（{ source, combo, hit, payout }）を返す。
 *   外部サイト（boatrace.jp pcexpect / 平和島 等）のスクレイパーを投票者として
 *   追加すれば、そのままアンサンブル対象に組み込める（buildVoter を参照）。
 *
 * 使い方:
 *   node scripts/analysis/analyze-prediction-ensemble.js
 *   node scripts/analysis/analyze-prediction-ensemble.js --from=2026-04-01 --to=2026-06-30
 *   node scripts/analysis/analyze-prediction-ensemble.js --venue=4
 */

import { supabase, fetchAll, VENUE_NAMES } from "../lib/supabaseClient.js";

const BET_YEN = 100; // 1点あたり賭け金（100円換算の payout に対応）

/**
 * CLI引数をパース
 */
function parseArgs(argv = process.argv.slice(2)) {
  const get = (name) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.split("=")[1] : null;
  };
  return {
    from: get("from"), // YYYY-MM-DD（predicted_at の下限、含む）
    to: get("to"), // YYYY-MM-DD（predicted_at の上限、含む）
    venue: get("venue") ? parseInt(get("venue"), 10) : null,
  };
}

/**
 * 1予想行 → 投票者オブジェクト
 * @param {Object} row - predictions の1行
 * @returns {{ source: string, combo: string, hit: boolean, payout: number }|null}
 */
function buildVoter(row) {
  const { top_pick: t1, top_2nd: t2, top_3rd: t3 } = row;
  if (!t1 || !t2 || !t3) return null;
  // 同一艇の重複予想は無効（データ不整合ガード）
  if (new Set([t1, t2, t3]).size !== 3) return null;
  return {
    source: row.model_id,
    combo: `${t1}-${t2}-${t3}`, // 3連単の順序付き買い目
    // payout_trio=3連単・payout_trifecta=3連複（is_hit_* も同じ。列名と中身が逆。079、BOA-536）
    hit: !!row.is_hit_trio,
    payout: Number(row.payout_trio) || 0, // 100円あたりの払戻（外れは0）
  };
}

/**
 * predictions を取得して race_id → 投票者配列 に整形
 * @param {{from:string|null,to:string|null,venue:number|null}} opts
 * @returns {Promise<Map<string, Array>>}
 */
async function collectVotersPerRace(opts) {
  const rows = await fetchAll(
    "predictions",
    "race_id, model_id, top_pick, top_2nd, top_3rd, is_hit_trio, payout_trio",
    (q) => {
      let query = q.eq("is_shadow", false);
      if (opts.from) query = query.gte("predicted_at", `${opts.from}T00:00:00`);
      if (opts.to) query = query.lte("predicted_at", `${opts.to}T23:59:59`);
      return query;
    },
  );

  const byRace = new Map();
  for (const row of rows) {
    // 会場フィルタ（race_id: YYYY-MM-DD-VV-RR）
    if (opts.venue != null) {
      const vc = parseInt(row.race_id.slice(11, 13), 10);
      if (vc !== opts.venue) continue;
    }
    const voter = buildVoter(row);
    if (!voter) continue;
    if (!byRace.has(row.race_id)) byRace.set(row.race_id, []);
    byRace.get(row.race_id).push(voter);
  }
  return byRace;
}

/**
 * 集計アキュムレータ
 */
function newAcc() {
  return { races: 0, bets: 0, hits: 0, payout: 0 };
}
function addBet(acc, { hit, payout }) {
  acc.races += 1;
  acc.bets += 1;
  if (hit) acc.hits += 1;
  acc.payout += payout;
}
function summary(acc) {
  const invest = acc.bets * BET_YEN;
  return {
    races: acc.races,
    bets: acc.bets,
    hits: acc.hits,
    hitRate: acc.bets ? acc.hits / acc.bets : 0,
    invest,
    payout: acc.payout,
    recovery: invest ? acc.payout / invest : 0,
  };
}

/**
 * アンサンブル分析本体
 * @param {Map<string, Array>} byRace
 */
function analyze(byRace) {
  // 各戦略のアキュムレータ
  const acc = {
    standard: newAcc(),
    safeBet: newAcc(),
    upsetFocus: newAcc(),
    consensus2: newAcc(), // 2票以上一致した買い目に賭ける
    unanimous: newAcc(), // 3票全一致のときだけ賭ける
  };

  for (const voters of byRace.values()) {
    // 個別モデルのベースライン
    for (const v of voters) {
      if (acc[v.source]) addBet(acc[v.source], v);
    }

    // 買い目ごとの得票数を集計
    const tally = new Map(); // combo -> { count, hit, payout }
    for (const v of voters) {
      if (!tally.has(v.combo)) {
        tally.set(v.combo, { count: 0, hit: v.hit, payout: v.payout });
      }
      tally.get(v.combo).count += 1;
    }

    // 最多得票の買い目
    let best = null;
    for (const [combo, t] of tally) {
      if (!best || t.count > best.count) best = { combo, ...t };
    }
    if (!best) continue;

    if (best.count >= 2) addBet(acc.consensus2, best);
    if (best.count >= 3) addBet(acc.unanimous, best);
  }

  return acc;
}

/**
 * 結果を表形式で出力
 */
function report(acc, opts, totalRaces) {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const yen = (x) => `¥${Math.round(x).toLocaleString("ja-JP")}`;
  // 全角=2幅として左揃えパディング（半角スペース埋めで桁を揃える）
  const dispWidth = (s) =>
    [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);
  const padLabel = (s, width) =>
    s + " ".repeat(Math.max(0, width - dispWidth(s)));

  const scope =
    (opts.venue != null
      ? `${VENUE_NAMES[opts.venue] || "会場" + opts.venue} `
      : "全会場 ") +
    (opts.from || opts.to
      ? `${opts.from || "最初"}〜${opts.to || "最新"}`
      : "全期間");

  console.log("\n════════════════════════════════════════════════════════");
  console.log("  予想アンサンブル（多数決）可能性検証 — BOA-104");
  console.log(`  対象: ${scope}`);
  console.log(`  対象レース数: ${totalRaces.toLocaleString("ja-JP")}`);
  console.log("════════════════════════════════════════════════════════\n");

  const rows = [
    ["standard（単独）", acc.standard],
    ["safeBet（単独）", acc.safeBet],
    ["upsetFocus（単独）", acc.upsetFocus],
    ["consensus≥2（2票一致）", acc.consensus2],
    ["unanimous（3票全一致）", acc.unanimous],
  ];

  console.log(
    `${padLabel("戦略", 24)}| 賭数   | 的中  | 的中率  | 回収率  | 投資       | 払戻`,
  );
  console.log(
    "------------------------|--------|-------|---------|---------|------------|------------",
  );
  for (const [label, a] of rows) {
    const s = summary(a);
    console.log(
      `${padLabel(label, 24)}| ` +
        `${String(s.bets).padStart(6)} | ` +
        `${String(s.hits).padStart(5)} | ` +
        `${pct(s.hitRate).padStart(7)} | ` +
        `${pct(s.recovery).padStart(7)} | ` +
        `${yen(s.invest).padStart(10)} | ` +
        `${yen(s.payout).padStart(10)}`,
    );
  }

  // 妙味の判定コメント
  const base = Math.max(
    summary(acc.standard).recovery,
    summary(acc.safeBet).recovery,
    summary(acc.upsetFocus).recovery,
  );
  const cons = summary(acc.consensus2).recovery;
  const uni = summary(acc.unanimous).recovery;

  console.log("\n─── 所見 ───");
  console.log(
    `・単独モデル最高回収率: ${pct(base)} / consensus≥2: ${pct(cons)} / 全一致: ${pct(uni)}`,
  );
  const best = Math.max(cons, uni);
  if (best > base && best >= 1.0) {
    console.log(
      "・✅ 共通買い目が単独モデルを上回り、かつ回収率100%超 → アンサンブルに妙味あり。追加投票者（外部サイト）を導入して深掘りする価値が高い。",
    );
  } else if (best > base) {
    console.log(
      "・△ 共通買い目は単独モデルを上回るが100%未満。投票者の多様性（外部サイト追加）で改善余地を検証する価値あり。",
    );
  } else {
    console.log(
      "・✗ 現状3モデルの多数決では単独モデルを上回らず。3モデルは相関が高く多様性が不足の可能性。異質な外部予想の追加が鍵。",
    );
  }
  console.log(
    "・注: サンプル数が少ない戦略（特に全一致）は回収率が不安定。判断には十分なサンプル数を要する。\n",
  );
}

async function main() {
  if (!supabase) {
    console.error("❌ Supabase 環境変数が未設定です（.env.local を確認）");
    process.exit(1);
  }
  const opts = parseArgs();
  console.log("📥 predictions 取得中...");
  const byRace = await collectVotersPerRace(opts);
  console.log(`✅ ${byRace.size.toLocaleString("ja-JP")} レース分の投票を収集`);

  const acc = analyze(byRace);
  report(acc, opts, byRace.size);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err) => {
    console.error("❌ エラー:", err);
    process.exit(1);
  });
}

export { buildVoter, collectVotersPerRace, analyze, summary };
