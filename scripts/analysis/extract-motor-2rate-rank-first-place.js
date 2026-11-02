/**
 * モーター2連率の6艇中の順位（上位・中位・下位）ごとに、攻める艇と1号艇の1着の回数と R を取り出す（BOA-1224）。
 * 入力: docs/design/analogy-finder/slit-hint/mark1.json（mark1.py の出力。集計のやり直しはしない）
 * 出力: data/analysis/motor-2rate-rank-first-place.json（記事の数の照合用。各区分に n・1着の回数・率・Wilson 95% 区間）
 * 実行: node scripts/analysis/extract-motor-2rate-rank-first-place.js
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { wilson } from "./full-picture-answer-stage/lib/answer.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = "docs/design/analogy-finder/slit-hint/mark1.json";
const OUT = "data/analysis/motor-2rate-rank-first-place.json";

// 表記は mark1_md.py（mark1.md の生成元）と同じ
const SCOPES = {
  nat: "全国の枠なり",
  wk: "若松の枠なり",
  wkA1: "若松・6艇ともA1の枠なり",
  allA1: "全国・6艇ともA1の枠なり",
  allA1Y: "全国・6艇ともA1の優勝戦の枠なり",
};
const BANDS = {
  top: "上位（1〜2位）",
  mid: "中位（3〜4位）",
  low: "下位（5〜6位）",
};

const round3 = (x) => Math.round(x * 1000) / 1000;

/** [k, n]（mark1.json の形）から n・1着の回数・率・Wilson 95% 区間を作る */
function cell([wins, n]) {
  if (!Number.isInteger(wins) || !Number.isInteger(n) || wins < 0 || wins > n) {
    throw new Error(
      `mark1.json の値が [1着の回数, R] の形でない: ${JSON.stringify([wins, n])}`,
    );
  }
  if (n === 0) return { n, wins, rate: null, ci95: null };
  const [lo, hi] = wilson(wins, n, 1.96);
  return { n, wins, rate: round3(wins / n), ci95: [round3(lo), round3(hi)] };
}

/** 区分ごとの metrics から、指定の [k, n] を取り出す */
const byBand = (bands, key) =>
  Object.fromEntries(
    Object.entries(BANDS).map(([b, label]) => [
      b,
      { label, ...cell(bands[b][key]) },
    ]),
  );

function formEntry(fo) {
  const scopes = {};
  for (const [s, label] of Object.entries(SCOPES)) {
    const all = fo.all[s];
    const boat1 = {
      all: cell(all.b1_win),
      byMotorRank: byBand(fo.b1_by_motor[s], "b1_win"),
      byExhibitionRank: byBand(fo.b1_by_exh[s], "b1_win"),
    };
    const attacker =
      fo.attacker === null
        ? null
        : {
            boat: fo.attacker,
            all: cell(all.att_win),
            byMotorRank: byBand(fo.by_motor[s], "att_win"),
            byExhibitionRank: byBand(fo.by_exh[s], "att_win"),
          };
    scopes[s] = { label, races: all.n, attacker, boat1 };
  }
  return { label: fo.label, attackerBoat: fo.attacker, scopes };
}

function build(mark1, sha256) {
  const forms = Object.fromEntries(
    Object.entries(mark1.forms).map(([f, fo]) => [f, formEntry(fo)]),
  );
  return {
    source: {
      file: SRC,
      generator:
        "docs/design/analogy-finder/slit-hint/mark1.py（表は mark1_md.py → mark1.md）",
      sha256,
      ticket: "BOA-1224",
    },
    period: mark1.period,
    population: {
      description: mark1.notes.population,
      scopes: Object.fromEntries(
        Object.entries(SCOPES).map(([s, label]) => [
          s,
          { label, ...mark1.scopes[s] },
        ]),
      ),
      motorRankNeeds: mark1.notes.motor_rank_needs,
      exhibitionRankNeeds: mark1.notes.exh_rank_needs,
    },
    definitions: {
      rank: mark1.notes.rank,
      bands: BANDS,
      attacker:
        "形ごとに決めた攻める艇（枠なりなのでコース＝艇番）: カド一撃・カド受け凹み・ダッシュ勢先行→4号艇、イン凹み→2号艇、2コース凹み→3号艇、横一線・内3艇そろう→なし",
      wins: "1着の回数。attacker は攻める艇、boat1 は1号艇が1着になったR（決まり手は問わない）",
      n: "その区分の R（モーター2連率・展示タイムが6艇そろうレースだけ。区分の R の合計は形の R より少しずれる）",
      ci95: "Wilson 95% 区間（z=1.96）",
    },
    canSay: [
      "スリットの形・範囲ごとに、攻める艇（または1号艇）のモーター2連率の順位が上位・中位・下位のとき、過去に「N レース中 X 回」1着だった",
      "全国の枠なり（313,938R）では、攻める艇・1号艇とも、モーター2連率が上位の区分ほど1着の率が高い（区間が重ならない差）",
      "全国の枠なりでは、7形すべてで展示タイムの順位のほうがモーター2連率の順位より上位と下位の差が大きい（モーター 4〜8 ポイント、展示タイム 9〜18 ポイント。mark1.md の要点）",
    ],
    cannotSay: [
      "因果は言えない。モーター2連率が高いから勝つとは言えない（選手の級・会場・展示タイムなどほかの要因を分けていない）",
      "枠なり（コース＝艇番）のレースだけ。進入が変わったレースには当てはめられない",
      "モーター2連率は節の途中の値ではなく出走表時点の値",
      "スリットの形（本番のスタート）ごとの集計で、形を問わない全体の順位別の値はこの JSON に無い（形は重なりうるので、形ごとの R を足しても全体にならない）",
      "若松・A1・優勝戦の範囲は R が少なく（優勝戦は各形 21〜140R）、区間が重なる区分が多い。差は言えない",
      "1マークの位置のデータは無く、着順と決まり手で見ている",
      "同順位は小さいほうの順位になる（min 順位）ため、区分の R は均等でない",
    ],
    forms,
  };
}

function main() {
  const raw = readFileSync(join(ROOT, SRC));
  const out = build(JSON.parse(raw.toString("utf8")), createHash("sha256").update(raw).digest("hex"));
  writeFileSync(join(ROOT, OUT), `${JSON.stringify(out, null, 1)}\n`);
  const nat = out.forms.kado.scopes.nat;
  console.log(
    `saved ${OUT}（${Object.keys(out.forms).length} 形 × ${Object.keys(SCOPES).length} 範囲）`,
  );
  console.log(
    `例 カド一撃・全国 攻める4号艇 モーター上位: ${nat.attacker.byMotorRank.top.wins}/${nat.attacker.byMotorRank.top.n}`,
  );
}

main();
