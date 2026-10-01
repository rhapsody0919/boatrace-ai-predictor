/**
 * 現モデル (standard / safeBet / upsetFocus) と公式コンピュータ予想 (pcexpect) の
 * 的中率・一致率・自信度別精度を比較するレポートスクリプト。
 *
 * 使い方:
 *   node scripts/analysis/compare-pcexpect.js                    # 直近 7 日
 *   node scripts/analysis/compare-pcexpect.js --start 2026-01-01 --end 2026-01-08
 *   node scripts/analysis/compare-pcexpect.js --days 30          # 直近 N 日
 *
 * 出力: Markdown 形式のレポートを標準出力へ
 *
 * 比較指標:
 *   1. 3連単的中率（per-source, per-race）
 *   2. 平均チケット数（pcexpect は最大 6）
 *   3. 期待ROI = (hit時の払戻合計) / (賭金合計, 100円/チケット)
 *   4. 一致率: 現モデル top1-2-3 が pcexpect 展開チケットに含まれるか
 *   5. 自信度別 (1-5) 的中率
 */

import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import { getTodayDateJST } from "../lib/dateUtils.js";

const MODEL_IDS = ["standard", "safeBet", "upsetFocus"];

function parseArgs(argv = process.argv.slice(2)) {
  const args = { start: null, end: null, days: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--start") args.start = argv[++i];
    else if (a === "--end") args.end = argv[++i];
    else if (a === "--days") args.days = parseInt(argv[++i], 10);
  }
  // デフォルト: 直近 7 日
  if (!args.start && !args.end) {
    const days = args.days || 7;
    const end = getTodayDateJST();
    const start = new Date(end);
    start.setDate(start.getDate() - days + 1);
    args.start = start.toISOString().substring(0, 10);
    args.end = end;
  }
  return args;
}

/**
 * pcexpect の買い目パターン文字列 (例: "2=5-1") を全順列に展開
 * - "=" で隣接した位置は交換可能、連続する "=" は推移的グループになる
 *
 * @param {string} pattern 例 "2=5-1"
 * @param {string[]} seps  例 ["=", "-"]
 * @returns {number[][]} 例 [[2,5,1], [5,2,1]]
 */
function expandPattern(pattern, seps) {
  const nums = pattern.split(/[-=]/).map((s) => parseInt(s, 10));
  if (nums.some(Number.isNaN)) return [];

  // 連続する "=" でグループ化（推移的）
  const groups = [];
  let current = [nums[0]];
  for (let i = 0; i < seps.length; i++) {
    if (seps[i] === "=") {
      current.push(nums[i + 1]);
    } else {
      groups.push(current);
      current = [nums[i + 1]];
    }
  }
  groups.push(current);

  // 各グループ内で全順列を生成し、グループ順に結合
  const permsOfGroup = groups.map((g) => permutations(g));
  return cartesianConcat(permsOfGroup);
}

function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) {
      out.push([arr[i], ...p]);
    }
  }
  return out;
}

function cartesianConcat(listsOfLists) {
  return listsOfLists.reduce(
    (acc, list) => acc.flatMap((a) => list.map((b) => a.concat(b))),
    [[]],
  );
}

/**
 * trifecta チケット [a,b,c] が結果 (rank1,rank2,rank3) に一致するか
 */
function isTrifectaHit(ticket, r1, r2, r3) {
  return ticket[0] === r1 && ticket[1] === r2 && ticket[2] === r3;
}

async function fetchRange({ start, end }) {
  // race_results は race_id (YYYY-MM-DD-VV-RR) で日付フィルタ
  const { data: results, error: errR } = await supabase
    .from("race_results")
    .select(
      // payout_trio=3連単・payout_trifecta=3連複（is_hit_* も同じ。列名と中身が逆。079、BOA-536）
      "race_id, rank1, rank2, rank3, payout_trio, is_cancelled, is_no_race",
    )
    .gte("race_id", `${start}`)
    .lte("race_id", `${end}~`)
    .eq("is_cancelled", false)
    .eq("is_no_race", false);
  if (errR) throw new Error("race_results: " + errR.message);

  const { data: preds, error: errP } = await supabase
    .from("predictions")
    .select("race_id, model_id, top_pick, top_2nd, top_3rd, payout_trio")
    .in("model_id", MODEL_IDS)
    .eq("is_shadow", false)
    .gte("race_id", `${start}`)
    .lte("race_id", `${end}~`);
  if (errP) throw new Error("predictions: " + errP.message);

  const { data: exts, error: errE } = await supabase
    .from("external_predictions")
    .select("race_date, venue_code, race_no, payload")
    .eq("source", "pcexpect_official")
    .gte("race_date", start)
    .lte("race_date", end);
  if (errE) throw new Error("external_predictions: " + errE.message);

  return { results: results || [], preds: preds || [], exts: exts || [] };
}

function indexBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function extRaceId({ race_date, venue_code, race_no }) {
  const vv = String(venue_code).padStart(2, "0");
  const rr = String(race_no).padStart(2, "0");
  return `${race_date}-${vv}-${rr}`;
}

function aggregate({ results, preds, exts }) {
  const predsByRace = indexBy(preds, (p) => p.race_id);
  const extsByRace = indexBy(exts, (e) => extRaceId(e));

  // 集計用カウンタ
  const counts = {
    races: 0,
    races_with_ext: 0,
    perModel: Object.fromEntries(
      MODEL_IDS.map((m) => [m, { hits: 0, total: 0, payout: 0 }]),
    ),
    pcexpect: {
      hits: 0,
      total: 0,
      payout: 0,
      tickets_bet: 0,
      agree_with: Object.fromEntries(MODEL_IDS.map((m) => [m, 0])),
    },
    pcexpectByConfidence: Object.fromEntries(
      [1, 2, 3, 4, 5].map((lv) => [lv, { hits: 0, total: 0 }]),
    ),
  };

  for (const r of results) {
    counts.races++;
    const modelPreds = predsByRace.get(r.race_id) || [];
    const extRows = extsByRace.get(r.race_id) || [];

    // 現モデル
    for (const mp of modelPreds) {
      if (!counts.perModel[mp.model_id]) continue;
      const slot = counts.perModel[mp.model_id];
      slot.total++;
      if (
        mp.top_pick === r.rank1 &&
        mp.top_2nd === r.rank2 &&
        mp.top_3rd === r.rank3
      ) {
        slot.hits++;
        slot.payout += r.payout_trio || 0;
      }
    }

    // pcexpect
    if (extRows.length > 0) {
      counts.races_with_ext++;
      const ext = extRows[0];
      const tickets3t = [];
      for (const pick of ext.payload.focus_3t || []) {
        const seps = pick.seps || [];
        for (const ticket of expandPattern(pick.pattern, seps)) {
          if (ticket.length === 3) tickets3t.push(ticket);
        }
      }
      // 重複除去
      const uniq = Array.from(new Set(tickets3t.map((t) => t.join("-"))));
      counts.pcexpect.total++;
      counts.pcexpect.tickets_bet += uniq.length;
      const hit = uniq.some((s) => {
        const [a, b, c] = s.split("-").map(Number);
        return isTrifectaHit([a, b, c], r.rank1, r.rank2, r.rank3);
      });
      if (hit) {
        counts.pcexpect.hits++;
        counts.pcexpect.payout += r.payout_trio || 0;
      }

      const conf = ext.payload.confidence;
      if (conf && counts.pcexpectByConfidence[conf]) {
        counts.pcexpectByConfidence[conf].total++;
        if (hit) counts.pcexpectByConfidence[conf].hits++;
      }

      // 一致率: 現モデルの top1-2-3 が pcexpect の展開チケットに含まれるか
      const uniqSet = new Set(uniq);
      for (const mp of modelPreds) {
        if (!MODEL_IDS.includes(mp.model_id)) continue;
        if (mp.top_pick && mp.top_2nd && mp.top_3rd) {
          const key = `${mp.top_pick}-${mp.top_2nd}-${mp.top_3rd}`;
          if (uniqSet.has(key)) counts.pcexpect.agree_with[mp.model_id]++;
        }
      }
    }
  }

  return counts;
}

function fmtPct(num, den) {
  if (!den) return "-";
  return ((num / den) * 100).toFixed(1) + "%";
}

function fmtRoi(payoutYen, tickets) {
  if (!tickets) return "-";
  const cost = tickets * 100;
  return ((payoutYen / cost) * 100).toFixed(1) + "%";
}

function render({ start, end, counts }) {
  let md = "";
  md += `# pcexpect vs 現モデル 評価レポート\n\n`;
  md += `期間: **${start} 〜 ${end}**\n\n`;
  md += `- 集計対象レース: **${counts.races}** 件\n`;
  md += `- pcexpect データ存在: **${counts.races_with_ext}** 件 (${fmtPct(counts.races_with_ext, counts.races)})\n\n`;

  if (counts.races === 0) {
    md += "> 集計対象のレース結果がありません。\n";
    return md;
  }

  md += `## 3連単 的中率（per-race）\n\n`;
  md += `| ソース | チケット/レース | 的中率 | ROI* |\n`;
  md += `|---|---:|---:|---:|\n`;
  for (const m of MODEL_IDS) {
    const s = counts.perModel[m];
    md += `| ${m} | 1 | ${fmtPct(s.hits, s.total)} (${s.hits}/${s.total}) | ${fmtRoi(s.payout, s.total)} |\n`;
  }
  const pe = counts.pcexpect;
  const avgTickets = pe.total ? (pe.tickets_bet / pe.total).toFixed(2) : "-";
  md += `| pcexpect (3連単 6点展開) | ${avgTickets} | ${fmtPct(pe.hits, pe.total)} (${pe.hits}/${pe.total}) | ${fmtRoi(pe.payout, pe.tickets_bet)} |\n`;
  md += `\n*ROI = (払戻合計) / (賭金合計, 100円/チケット)\n\n`;

  md += `## 一致率（現モデルの 3連単 top が pcexpect 展開チケットに含まれる率）\n\n`;
  md += `| モデル | 一致 | 一致率 |\n`;
  md += `|---|---:|---:|\n`;
  for (const m of MODEL_IDS) {
    md += `| ${m} | ${pe.agree_with[m]} / ${pe.total} | ${fmtPct(pe.agree_with[m], pe.total)} |\n`;
  }

  md += `\n## pcexpect 自信度別 的中率\n\n`;
  md += `| 自信度 (★) | 件数 | 的中率 |\n`;
  md += `|---:|---:|---:|\n`;
  for (let lv = 1; lv <= 5; lv++) {
    const s = counts.pcexpectByConfidence[lv];
    md += `| ${"★".repeat(lv)} | ${s.total} | ${fmtPct(s.hits, s.total)} |\n`;
  }

  return md;
}

async function main() {
  const args = parseArgs();
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase 環境変数が未設定です");
    process.exit(1);
  }
  console.error(`📊 集計中: ${args.start} 〜 ${args.end}`);
  const data = await fetchRange(args);
  const counts = aggregate(data);
  const md = render({ start: args.start, end: args.end, counts });
  process.stdout.write(md);
}

main().catch((err) => {
  console.error("❌ 致命的エラー:", err);
  process.exit(1);
});
