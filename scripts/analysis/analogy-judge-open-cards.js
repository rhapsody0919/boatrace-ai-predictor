/**
 * 龍神ソナー「差がつく材料」の判定の出方を、本番の facts API から数える（BOA-805）。
 *
 * 1日ごとに全24場×12Rの facts（stage=exhibition）を読み、各レース×艇（1〜6）×着順（1着・2着以内・3着以内）について、
 * 画面と同じ関数（src/utils/analogyFacts.js の defaultScope・factRows・openCardKeys）で
 *   - 「差が大きい」の枚数（ボート2連率を除く）
 *   - 最初から開くカードの枚数
 *   - ぶれ幅が重なる（はっきりしない）のに差が20ポイント以上のカードの数と、その少ない側の件数
 * を数える。比べるため、旧基準（5ポイント以上で「差が大きい」、全部開く）の枚数も同じデータで出す。
 *
 * 使い方: node scripts/analysis/analogy-judge-open-cards.js 2026-10-08 2026-10-09
 */
import {
  defaultScope,
  factRows,
  openCardKeys,
} from "../../src/utils/analogyFacts.js";

const BASE = process.env.ANALOGY_BASE ?? "https://www.boat-ai.jp";
const dates = process.argv.slice(2);
if (dates.length === 0) {
  console.error("日付を1つ以上渡す（例: 2026-10-08）");
  process.exit(1);
}

async function fetchFacts(id) {
  const res = await fetch(`${BASE}/api/analogy/facts/${id}?stage=exhibition`);
  if (res.status !== 200) return null;
  const j = await res.json();
  return j.today ? j : null;
}

const ids = dates.flatMap((d) =>
  Array.from({ length: 24 }, (_, v) =>
    Array.from(
      { length: 12 },
      (_, r) =>
        `${d}-${String(v + 1).padStart(2, "0")}-${String(r + 1).padStart(2, "0")}`,
    ),
  ).flat(),
);
const races = [];
for (let i = 0; i < ids.length; i += 8) {
  const got = await Promise.all(ids.slice(i, i + 8).map(fetchFacts));
  races.push(...got.filter(Boolean));
}

const bucket = (n) => (n === 0 ? "0" : n <= 2 ? "1-2" : n <= 4 ? "3-4" : "5+");
const hist = { large: {}, opened: {}, oldLarge: {} };
let cases = 0;
let unclearBig = 0;
const unclearBigN = { "<30": 0, "30-99": 0, "100+": 0 };
for (const d of races)
  for (const boat of [1, 2, 3, 4, 5, 6])
    for (const target of [1, 2, 3]) {
      const keys = d.today.scope_keys[String(boat)] ?? {};
      const def = defaultScope(keys, (k) => d.facts[k]?.n ?? null);
      const sf = d.facts[def.key];
      if (!sf) continue;
      const rows = factRows(sf, boat, target, true).filter(
        (r) => r.key !== "boat_2",
      );
      cases += 1;
      const large = rows.filter((r) => r.judge.level === "large").length;
      const old = rows.filter(
        (r) => r.judge.level === "large" || r.judge.level === "some",
      ).length;
      const opened = openCardKeys(rows).size;
      for (const [h, n] of [
        [hist.large, large],
        [hist.opened, opened],
        [hist.oldLarge, old],
      ])
        h[bucket(n)] = (h[bucket(n)] ?? 0) + 1;
      for (const r of rows)
        if (r.judge.level === "unclear" && Math.abs(r.spread) >= 0.2) {
          unclearBig += 1;
          const n = Math.min(r.all[0]?.[1] ?? 0, r.all[5]?.[1] ?? 0);
          unclearBigN[n < 30 ? "<30" : n < 100 ? "30-99" : "100+"] += 1;
        }
    }

const pct = (h, k) => `${(((h[k] ?? 0) / cases) * 100).toFixed(0)}%`;
const line = (name, h) =>
  `${name}: 0枚 ${pct(h, "0")}／1〜2枚 ${pct(h, "1-2")}／3〜4枚 ${pct(h, "3-4")}／5枚以上 ${pct(h, "5+")}`;
console.log(
  `期間 ${dates.join("・")}、レース ${races.length}、レース×艇×着順 ${cases}（既定の範囲、ボート2連率を除く）`,
);
console.log(
  line(
    "旧基準（5ポイント以上で差が大きい・全部開く）の差が大きい",
    hist.oldLarge,
  ),
);
console.log(line("新基準（10ポイント以上）の差が大きい", hist.large));
console.log(line("最初から開く（差が大きいの上位2枚）", hist.opened));
console.log(
  `ぶれ幅が重なるのに差が20ポイント以上: ${unclearBig}（少ない側の件数 30件未満 ${unclearBigN["<30"]}・30〜99件 ${unclearBigN["30-99"]}・100件以上 ${unclearBigN["100+"]}）`,
);
