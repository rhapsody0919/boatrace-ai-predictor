// prep9b: 範囲 v20A1（若松で6艇とも A1）・allA1（全国で6艇とも A1）の SQL を、prep8／prep8b の SQL から文字列置換で作る。
// 置換は (1) 母集団に「6艇とも出走時の級別が A1」の列 all_a1 を足して pool を all_a1 に絞る、(2) 範囲の展開を v20A1・allA1 にする、だけ。
// 母集団・除外・進入の型・スリットの形・セル集計・tri/wt は prep8／prep8b と同じ SQL のまま。使い方: node gen_p9b.js [list のキー（空白区切り）]
import fs from "node:fs"; import path from "node:path";
const dir = path.dirname(new URL(import.meta.url).pathname);
const rd = (f) => fs.readFileSync(path.join(dir, f), "utf8");
const wr = (f, s) => fs.writeFileSync(path.join(dir, f), s);
const rep = (s, a, b) => { if (!s.includes(a)) throw new Error("置換元が見つからない: " + a.slice(0, 80)); return s.split(a).join(b); };

const poolMain = (() => {
  let s = rd("sql/p8_pool_main.sql");
  s = rep(s, "-- prep8 本体 母集団:", "-- prep9b 本体 母集団（prep8 の pool に、6艇とも出走時の級別 race_entries.grade が A1 の列 all_a1 を足し、pool を all_a1 に絞ったもの）。元の説明:");
  s = rep(s, "OR e.boat_number = ANY (coalesce(res.refund_boats, '{}')) AS returned,", "OR e.boat_number = ANY (coalesce(res.refund_boats, '{}')) AS returned,\ne.grade AS cls,");
  s = rep(s, "array_agg(returned ORDER BY boat_number) AS ret_by_boat,", "array_agg(returned ORDER BY boat_number) AS ret_by_boat,\ncoalesce(bool_and(cls = 'A1'), false) AS all_a1,");
  s = rep(s, "WHERE a.n_boats = 6 AND NOT a.has_absent", "WHERE a.all_a1 AND a.n_boats = 6 AND NOT a.has_absent");
  return s;
})();
const poolKb = (() => {
  let s = rd("sql/p8_pool_kb.sql");
  s = rep(s, "-- prep8 kb 母集団:", "-- prep9b kb 母集団（prep8 の pool に、6艇とも出走時の級別 kb_archive_boats.class が A1 の列 all_a1 を足し、pool を all_a1 に絞ったもの）。元の説明:");
  s = rep(s, "coalesce(b.is_flying, false) OR coalesce(b.is_late_start, false) AS returned,", "coalesce(b.is_flying, false) OR coalesce(b.is_late_start, false) AS returned,\nb.class AS cls,");
  s = rep(s, "array_agg(returned ORDER BY boat_number) AS ret_by_boat,", "array_agg(returned ORDER BY boat_number) AS ret_by_boat,\ncoalesce(bool_and(cls = 'A1'), false) AS all_a1,");
  s = rep(s, "WHERE a.n_boats = 6 AND NOT a.has_absent", "WHERE a.all_a1 AND a.n_boats = 6 AND NOT a.has_absent");
  return s;
})();
wr("sql/p9b_pool_main.sql", poolMain);
wr("sql/p9b_pool_kb.sql", poolKb);

let common = rd("sql/p8_common_tail.sql");
common = rep(common, "-- prep8 共通部:", "-- prep9b 共通部（prep8 と同じ。範囲の展開だけ allA1・v20A1 に置換。pool は既に all_a1 に絞ってある）。元の説明:");
common = rep(common, `  CROSS JOIN LATERAL unnest(ARRAY['all']
    || CASE WHEN p.venue_code = 20 THEN ARRAY['v20'] ELSE '{}'::text[] END
    || CASE WHEN p.venue_code = 20 AND p.grade = 'G1' THEN ARRAY['v20G1'] ELSE '{}'::text[] END) sc`,
`  CROSS JOIN LATERAL unnest(ARRAY['allA1']
    || CASE WHEN p.venue_code = 20 THEN ARRAY['v20A1'] ELSE '{}'::text[] END) sc`);
wr("sql/p9b_common_tail.sql", common);

// セル（prep8 の cells・excl）と prep8b の tri・wt を1回で返す
const cells = rd("sql/p8_cells_tail.sql");
const p8b = rd("sql/p8b_cells_tail.sql");
const p8bCte = p8b.slice(p8b.indexOf(", g AS MATERIALIZED"), p8b.indexOf("SELECT string_agg(concat_ws('|', t.scope"));
const i = cells.indexOf("SELECT jsonb_build_object(");
let tail = "-- prep9b セル集計: prep8 の p8_cells_tail.sql（cells・excl）に、prep8b の p8b_cells_tail.sql の g・t・w（tri・wt）を同じ u から足したもの\n"
  + cells.slice(0, i) + p8bCte
  + rep(cells.slice(i), "\n) AS r;", ",\n 'tw', (SELECT string_agg(concat_ws('|', t.scope, t.et, t.form, t.tri, w.wt), ';' ORDER BY t.scope, t.et, t.form) FROM t JOIN w USING (scope, et, form))\n) AS r;")
    .replace("SELECT jsonb_build_object(", "-- md5_cells・md5_tw: 返ってきた cells・tw の文字列の md5（build9.js が raw に写した文字列の md5 と照合する＝写し間違いの検出）\nSELECT jsonb_set(jsonb_set(q.r, '{md5_cells}', to_jsonb(md5(q.r->>'cells'))), '{md5_tw}', to_jsonb(md5(q.r->>'tw'))) AS r FROM (SELECT jsonb_build_object(")
    .replace("\n) AS r;", "\n) AS r) q;");
wr("sql/p9b_cells_tail.sql", tail);
wr("sql/p9b_executed_cells_main.sql", poolMain + "\n" + common + "\n" + tail);
wr("sql/p9b_executed_cells_kb.sql", poolKb + "\n" + common + "\n" + tail);

// 一覧（件数30未満のセル）: 引数でキーを受け取る
if (process.argv[2]) {
  const keys = process.argv[2].split(" ");
  const q = (s) => `'${s}'`;
  const list = `-- prep9b 一覧用: 件数30未満のセルごとに新しい順30件に入るレースを1行ずつ返す（セルへの振り分けと件数の照合は build9.js）。e までは p9b_common_tail.sql と同じ
-- 1行 = race_id|日付|会場|グレード|開催名|ステージ|R|1着-2着-3着|決まり手|3連単払戻|進入コース(1..6号艇)|形(,区切り)|進入の型
, k AS (
  SELECT e.*, scope || '|' || et2 || '|' || fm AS key FROM e
  CROSS JOIN LATERAL unnest(ARRAY[e.et, 'all'] || CASE WHEN e.et LIKE 'mae%' THEN ARRAY['mae'] ELSE '{}'::text[] END) et2
  CROSS JOIN LATERAL unnest(ARRAY['any'] || CASE WHEN e.st_ok THEN e.forms ELSE '{}'::text[] END) fm
), kk AS (
  SELECT k.*, row_number() OVER (PARTITION BY key ORDER BY race_date DESC, race_number DESC) AS rn FROM k
  WHERE key = ANY (ARRAY[${keys.map(q).join(", ")}])
), sel AS (SELECT DISTINCT race_id FROM kk WHERE rn <= 30)
SELECT q.n, q.rows, md5(q.rows) AS md5_rows FROM (SELECT count(*) AS n, string_agg(concat_ws('|', race_id, race_date, venue_code, coalesce(grade, ''), replace(coalesce(title, ''), '|', '/'), replace(coalesce(stage_raw, ''), '|', '/'), race_number,
  rank1 || '-' || rank2 || '-' || rank3, coalesce(tech_raw, ''), coalesce(pay3::text, ''), array_to_string(course_by_boat, ','), array_to_string(forms, ','), et), ';' ORDER BY race_date DESC, race_number DESC) AS rows
FROM (SELECT DISTINCT ON (race_id) * FROM e WHERE race_id IN (SELECT race_id FROM sel) ORDER BY race_id) z) q;
`;
  // common の u は使わない（e まで）。u の CTE を残しても害はないのでそのまま連結する
  wr("sql/p9b_list_tail.sql", list);
  wr("sql/p9b_executed_list_main.sql", poolMain + "\n" + common + "\n" + list);
  wr("sql/p9b_executed_list_kb.sql", poolKb + "\n" + common + "\n" + list);
}
console.log("ok");
