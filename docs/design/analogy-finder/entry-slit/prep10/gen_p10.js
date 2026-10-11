// prep10: 範囲 allA1Y（全国・6艇とも A1・優勝戦）の SQL を、prep9b の SQL から文字列置換で作る。
// 置換は (1) pool の絞り込みに round = 'yusho'（prep8 から使っている pool の round 列）を足す、(2) 範囲の展開を allA1Y だけにする、だけ。
// 取りこぼしの確認用に、pool に最終日12R フラグ fd12 を足し、all_a1・round の絞り込みを外した照合 SQL（p10_check_*）も作る。
// 使い方: node gen_p10.js [list のキー（空白区切り）]
import fs from "node:fs";
import path from "node:path";
const dir = path.dirname(new URL(import.meta.url).pathname);
const rd = (f) => fs.readFileSync(path.join(dir, f), "utf8");
const wr = (f, s) => fs.writeFileSync(path.join(dir, f), s);
const rep = (s, a, b) => {
  if (!s.includes(a))
    throw new Error("置換元が見つからない: " + a.slice(0, 80));
  return s.split(a).join(b);
};

// 実行時の設定: round='yusho' で pool が小さくなると、kb_a の件数見積もりが1行になり kr の CTE を入れ子ループで全件なめ直して時間切れになる（EXPLAIN で確認）。
// 結果は変わらない設定なので、executed_* の先頭で入れ子ループを切って実行した
const HDR = "-- 実行時の設定（結果は変わらない。round='yusho' で件数見積もりが1行になり入れ子ループで時間切れになるのを避ける）\nSET statement_timeout = '300s'; SET enable_nestloop = off;\n";
const kb9 = rd("sql/p9b_pool_kb.sql"),
  main9 = rd("sql/p9b_pool_main.sql");
const poolKb = rep(
  rep(
    kb9,
    "-- prep9b kb 母集団（",
    "-- prep10 kb 母集団（prep9b の pool をさらに round = 'yusho'〔優勝戦〕に絞ったもの）。prep9b の説明: （",
  ),
  "WHERE a.all_a1 AND a.n_boats = 6",
  "WHERE a.all_a1 AND r.round = 'yusho' AND a.n_boats = 6",
);
const poolMain = rep(
  rep(
    main9,
    "-- prep9b 本体 母集団（",
    "-- prep10 本体 母集団（prep9b の pool をさらに round = 'yusho'〔優勝戦〕に絞ったもの）。prep9b の説明: （",
  ),
  "WHERE a.all_a1 AND a.n_boats = 6",
  "WHERE a.all_a1 AND a.round = 'yusho' AND a.n_boats = 6",
);
wr("sql/p10_pool_kb.sql", poolKb);
wr("sql/p10_pool_main.sql", poolMain);

let common = rd("sql/p9b_common_tail.sql");
common = rep(
  common,
  "-- prep9b 共通部（",
  "-- prep10 共通部（prep9b と同じ。範囲の展開だけ allA1Y に置換。pool は既に all_a1・round='yusho' に絞ってある）。prep9b の説明: （",
);
common = rep(
  common,
  `  CROSS JOIN LATERAL unnest(ARRAY['allA1']
    || CASE WHEN p.venue_code = 20 THEN ARRAY['v20A1'] ELSE '{}'::text[] END) sc`,
  `  CROSS JOIN LATERAL unnest(ARRAY['allA1Y']) sc`,
);
wr("sql/p10_common_tail.sql", common);

const cells = rep(
  rd("sql/p9b_cells_tail.sql"),
  "-- prep9b セル集計:",
  "-- prep10 セル集計（prep9b と同じ）。prep9b の説明:",
).replace("build9.js が raw に写した", "build10.js が raw に写した");
wr("sql/p10_cells_tail.sql", cells);
wr("sql/p10_executed_cells_kb.sql", HDR + poolKb + "\n" + common + "\n" + cells);
wr("sql/p10_executed_cells_main.sql", HDR + poolMain + "\n" + common + "\n" + cells);

// 取りこぼしの確認: pool（all_a1・round の絞り込みなし）に fd12＝節の最終日（is_final_day）の12R を足し、
// all_a1 × round='yusho' × fd12 の件数と、片方だけに当たるレースのステージ名の内訳を返す
let ckKb = rep(
  kb9,
  "-- prep9b kb 母集団（",
  "-- prep10 取りこぼし確認 kb: prep9b の pool から all_a1 の絞り込みを外し、fd12（kb_archive_venue_days.is_final_day かつ 12R）を足したもの。prep9b の説明: （",
);
ckKb = rep(
  ckKb,
  "vd.race_grade AS g0, vd.title AS title0",
  "vd.race_grade AS g0, vd.title AS title0, (coalesce(vd.is_final_day, false) AND kr.race_number = 12) AS fd12",
);
ckKb = rep(
  ckKb,
  "r.title0::text AS title, r.stage::text AS stage_raw",
  "r.title0::text AS title, r.stage::text AS stage_raw, a.all_a1, r.fd12, r.stage_kind::text AS stage_kind",
);
ckKb = rep(ckKb, "WHERE a.all_a1 AND a.n_boats = 6", "WHERE a.n_boats = 6");
let ckMain = rep(
  main9,
  "-- prep9b 本体 母集団（",
  "-- prep10 取りこぼし確認 本体: prep9b の pool から all_a1 の絞り込みを外し、fd12（12R かつ〔race_conditions.is_final_day または race_series.end_date＝その日〕。本体の is_final_day は NULL の日があるため race_series で補う）を足したもの。prep9b の説明: （",
);
ckMain = rep(
  ckMain,
  "c.weather, c.wind_speed, c.wave_height, c.race_title,",
  "c.weather, c.wind_speed, c.wave_height, c.race_title, (r.race_number = 12 AND (coalesce(c.is_final_day, false) OR EXISTS (SELECT 1 FROM race_series s2 WHERE s2.venue_code = r.venue_code::smallint AND s2.end_date = r.race_date))) AS fd12,",
);
ckMain = rep(
  ckMain,
  "mr_r.race_title AS title\n",
  "mr_r.race_title AS title, mr_r.fd12\n",
);
ckMain = rep(
  ckMain,
  "res.payout_trio, res.title, res.wx,",
  "res.payout_trio, res.title, res.fd12, res.wx,",
);
ckMain = rep(
  ckMain,
  "max(rn) AS race_number,",
  "max(rn) AS race_number, bool_or(fd12) AS fd12,",
);
ckMain = rep(
  ckMain,
  "a.title::text AS title, a.stage_raw::text AS stage_raw",
  "a.title::text AS title, a.stage_raw::text AS stage_raw, a.all_a1, a.fd12, NULL::text AS stage_kind",
);
ckMain = rep(ckMain, "WHERE a.all_a1 AND a.n_boats = 6", "WHERE a.n_boats = 6");
const ckTail = `-- 1) all_a1 × yusho（round='yusho'）× fd12 の件数（pool 段階＝返還艇・進入不明を除く前）
-- 2) 片方だけに当たるレースのステージ名の内訳（all_a1 のレースだけ、件数の多い順）
SELECT jsonb_build_object(
 'xtab', (SELECT jsonb_agg(jsonb_build_object('all_a1', all_a1, 'yusho', yusho, 'fd12', fd12, 'n', n) ORDER BY all_a1, yusho, fd12) FROM (
   SELECT all_a1, coalesce(round = 'yusho', false) AS yusho, fd12, count(*) n FROM pool WHERE race_date <= DATE '2026-09-26' GROUP BY 1, 2, 3) z),
 'a1_mismatch', (SELECT jsonb_agg(jsonb_build_object('yusho', yusho, 'fd12', fd12, 'stage', stage_raw, 'stage_kind', stage_kind, 'race_number_set', rns, 'n', n, 'example', ex) ORDER BY yusho, n DESC, stage_raw) FROM (
   SELECT coalesce(round = 'yusho', false) AS yusho, fd12, stage_raw, stage_kind, string_agg(DISTINCT race_number::text, ',') rns, count(*) n, max(race_id) ex
   FROM pool WHERE all_a1 AND race_date <= DATE '2026-09-26' AND coalesce(round = 'yusho', false) <> fd12 GROUP BY 1, 2, 3, 4) z)
) AS r;
`;
wr("sql/p10_check_tail.sql", ckTail);
wr("sql/p10_executed_check_kb.sql", ckKb + "\n" + ckTail);
wr("sql/p10_executed_check_main.sql", ckMain + "\n" + ckTail);

if (process.argv[2]) {
  const keys = process.argv[2].split(" ");
  let list = rep(
    rd("sql/p9b_list_tail.sql"),
    "-- prep9b 一覧用:",
    "-- prep10 一覧用（prep9b と同じ。キーだけ差し替え）:",
  )
    .replace("p9b_common_tail.sql", "p10_common_tail.sql")
    .replace("build9.js", "build10.js");
  list = list.replace(
    /WHERE key = ANY \(ARRAY\[[^\]]*\]\)/,
    `WHERE key = ANY (ARRAY[${keys.map((k) => `'${k}'`).join(", ")}])`,
  );
  wr("sql/p10_list_tail.sql", list);
  wr("sql/p10_executed_list_kb.sql", HDR + poolKb + "\n" + common + "\n" + list);
  wr("sql/p10_executed_list_main.sql", HDR + poolMain + "\n" + common + "\n" + list);
}
console.log("ok");
