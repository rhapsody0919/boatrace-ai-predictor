/**
 * seriesPoints - 今節の得点率（phase a FR-3 Phase B）
 *
 * ## なぜ自前で計算するのか
 *
 * 公式サイトの「得点率一覧」（`race/pointrank`）は **SG/G1 の4日目以降にしか出ない**。
 * 2026-09-26に実機で確認: 若松G1（ヤングダービー）は表が出るが、同日の桐生・戸田の
 * 一般戦はどちらも「※ データはありません。」。自社の `racer_series_points` が
 * 101行（2節・いずれもG1）しか無いのは取得漏れではなくこれが理由。
 * ボートレース日和は一般戦でも得点率を出しており（桐生の一般戦で確認）、
 * 同じことをするには自前計算しかない。
 *
 * ## 計算規則（公式データで検証済み）
 *
 * 2026-09-22〜 若松G1 の公式「得点率一覧」と、自社の `race_results` から計算した値を
 * 全選手で照合し、**得点・得点率とも49名中49名が完全一致**した。規則は次の4つ。
 *
 * 1. 着順点（予選・一般）: 1着10 / 2着8 / 3着6 / 4着4 / 5着2 / 6着1
 * 2. **特別戦（ドリーム戦・選抜戦）は別配点**: 1着12 / 2着10 / 3着9 / 4着7 / 5着6 / 6着5
 *    （若松G1の初日ドリーム戦の6名で、着順ごとの差が +2/+2/+3/+3/+4/+4 と揃うことから確定）
 * 3. **失格・落水・転覆は0点だが、分母（走数）には含める**。実データでは着順に載らず
 *    `rank5`/`rank6` が null になる（例: 2026-09-23 若松9R）
 * 4. **準優勝戦・優勝戦は算入しない**（公式の表も「予選終了時点」と明記している）
 *
 * 賞典除外・途中帰郷の選手は公式が得点率を出さない（「-」）。ここでは判定材料を
 * 持っていないので、走った分から計算した値をそのまま返す。
 */
import { finishPositionOf } from "./basicInfoStats.js";

/** 予選・一般戦の着順点 */
export const SCORE_POINTS = { 1: 10, 2: 8, 3: 6, 4: 4, 5: 2, 6: 1 };
/** ドリーム戦の着順点（SG/G1の実データで検証済み） */
export const SPECIAL_SCORE_POINTS = { 1: 12, 2: 10, 3: 9, 4: 7, 5: 6, 6: 5 };
/**
 * 特選・特賞・選抜の着順点（通常配点の各着 +1）。
 *
 * **公式データでは照合できない**（公式の得点率一覧はSG/G1の4日目以降しか出ず、
 * 「予選特選」「予選特賞」はSG/G1の番組に出てこない）。根拠は2つ。
 *
 * 1. 独立した2つの二次情報が同じ 11/9/7/5/3/2 を挙げている
 * 2. `scripts/analysis/series-points-scoring-hypotheses.mjs` の実測。予選終了時点の
 *    得点率上位N人（N=準優の枠数）と**実際の準優進出者**の一致で候補を比べると、
 *    - 特選/特賞が予選期間内にある229節（4,080枠）: 加点なし 91.84% → +1 で
 *      92.11%（全枠一致の節も 30 → 35）
 *    - 選抜が予選期間内にある113節（1,980枠）: 加点なし 91.16% → +1 で 92.27%
 *      （全枠一致の節も 13 → 20）
 *    「特別」「目玉」も同じ形で試したが改善しなかったので対象にしない
 */
export const TOKUSEN_SCORE_POINTS = { 1: 11, 2: 9, 3: 7, 4: 5, 5: 3, 6: 2 };

/**
 * `race_stage` の表記ゆれを吸収する。
 *
 * `race_stage` は racelist ページの表示文字列をほぼ生で保存しているため
 * （`scripts/lib/raceStageParser.js`）、全角の英数（「桐生ＤＲ戦」）・空白・
 * 「男子」「女子」の接尾が会場ごとに混在する。部分一致で判定する前にここを通す。
 */
export function normalizeStage(stage) {
  if (!stage) return "";
  return (
    String(stage)
      // 全角英数 → 半角（ＤＲ → DR）
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) - 0xfee0),
      )
      // 半角・全角（U+3000。ソースに直書きするとlintの no-irregular-whitespace に
      // 当たるのでコード指定で書く）の空白を落とす
      .replace(/\s/gu, "")
      .replaceAll(String.fromCharCode(0x3000), "")
      .toUpperCase()
  );
}

/**
 * 得点率の配点区分。
 *
 * - `excluded` … 勝ち上がり戦（準優・優勝戦）。得点率に算入しない
 * - `dream` … ドリーム戦。`SPECIAL_SCORE_POINTS`
 * - `tokusen` … 特選・特賞・選抜。`TOKUSEN_SCORE_POINTS`
 * - `normal` … 予選・一般戦とそれ以外。`SCORE_POINTS`
 *
 * 会場ごとの表記は `node --env-file=.env.local scripts/analysis/race-stage-inventory.mjs`
 * で棚卸しできる（2026-09-28時点で349種）。`normal` は「通常配点と確認できた」ではなく
 * **「特別配点と判定する根拠が無い」** の意味。未知の表記を特別配点に寄せると
 * 得点率が上振れするため、既定を通常配点に置いている。
 */
export function classifyStage(stage) {
  const s = normalizeStage(stage);
  if (!s) return "normal";
  // 「準々優勝戦」「準優進出戦」も勝ち上がり戦なので先に落とす
  if (s.includes("準優") || s.includes("優勝戦")) return "excluded";
  // 「ドリーム」と、その略記「DR」（「桐生DR戦女子」「ツッキーDR戦」等）。
  // 「ドラドキ」は桐生のシリーズ名で、DRを含まないので当たらない
  if (s.includes("ドリーム") || s.includes("DR")) return "dream";
  if (s.includes("特選") || s.includes("特賞") || s.includes("選抜"))
    return "tokusen";
  return "normal";
}

/**
 * 得点率に算入しないレース（勝ち上がり後のレース）。
 * 公式の得点率一覧が「◯日目12R終了時点」＝予選までで確定することに合わせる
 */
export function isExcludedStage(stage) {
  return classifyStage(stage) === "excluded";
}

/**
 * その種別に使う着順点の表を返す。
 *
 * 旧実装は「選抜」をドリーム戦と同じ 12/10/9/7/6/5 にしていたが、これは
 * **一度も公式データで検証されていなかった**。PR #871 が公式と一致させた
 * 若松G1・多摩川G1では、予選期間内にあった特別戦はドリーム戦だけで、
 * 「特別選抜戦」「静波まつり選抜」はいずれも最終日（予選終了後）＝算入対象外。
 * つまりその分岐は一般戦・G3の「予選選抜」「記者選抜戦」等にだけ効いていた。
 * 準優進出者との一致で比べると、選抜は 12/10/9/7/6/5 と 11/9/7/5/3/2 の差が
 * 小さい（1,980枠のうち1,822 vs 1,827、全枠一致はどちらも20節）ので、二次情報が
 * 挙げている「選抜戦は+1点」に合わせて後者にした（BOA-458）。
 */
export function scoreTableFor(stage) {
  switch (classifyStage(stage)) {
    case "dream":
      return SPECIAL_SCORE_POINTS;
    case "tokusen":
      return TOKUSEN_SCORE_POINTS;
    default:
      return SCORE_POINTS;
  }
}

/**
 * 節で最後に「予選」と付いたレースの `race_id`（＝予選の締めの目印）。
 *
 * 種別名の部分一致をここ1か所に閉じる（BOA-457）。「予選」ラベルが1本も無い節
 * （会場固有名だけで組まれる節）では null になり、そのときは算入範囲を切らない。
 *
 * @param {Array<{raceId?: string, race_id?: string, raceStage?: string|null,
 *   race_stage?: string|null}>} rows 節の全レース
 * @returns {string|null}
 */
export function prelimEndRaceIdOf(rows) {
  return (
    (Array.isArray(rows) ? rows : [])
      .filter((r) => (r.raceStage ?? r.race_stage ?? "").includes("予選"))
      .map((r) => r.raceId ?? r.race_id)
      .sort()
      .pop() ?? null
  );
}

/**
 * 節に組まれた**準優勝戦**の `race_id`（枠数の算出に使う）。
 *
 * 「準優進出戦」は準優勝戦の1つ前の勝ち上がり戦で、準優の枠ではない
 * （蒲郡・丸亀の一般戦の実例: 5日目に準優進出戦4個 → 6日目に準優勝戦3個）。
 * 単純な `includes("準優")` だと 7個 = 42枠と数えてしまうので除く（BOA-457）。
 *
 * @param {Array<{raceId?: string, race_id?: string, raceStage?: string|null,
 *   race_stage?: string|null}>} rows 節の全レース
 * @returns {string[]} `race_id` 昇順
 */
export function semifinalRaceIdsOf(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => {
      const st = r.raceStage ?? r.race_stage ?? "";
      return st.includes("準優") && !st.includes("準優進出");
    })
    .map((r) => r.raceId ?? r.race_id)
    .sort();
}

/**
 * 節の**準優の枠数**（＝準優の本数 × 6）。無ければ null（画面が既定値に落とす）。
 *
 * 番組に残っているだけで**実際には行われなかった準優を数えない**。中止順延が
 * あると同じ準優が2日ぶん番組に残り、枠数が倍になる（江戸川 2026-05-25開催:
 * 5/29の11R・12Rが中止 → 5/30に同じ6名で再編成。単純に数えると 4×6 = 24枠だが
 * 実際は12枠）。枠数はボーダー（準優の目安）と必要得点の基準なので、倍になると
 * 「届かず」の判定まで狂う（BOA-490）。
 *
 * ## 判定は中止フラグ単独ではなく、**中止フラグと結果の両方**
 *
 * 中止・順延はマイグレーション047（BOA-254）が `races` に記録している。中止かどうかの
 * 判定そのものは `src/utils/raceCancellation.js` の `isRaceCancelled` に集めてあり、
 * ここは**確定した中止の `race_id` の集合を受け取るだけ**にしてある。2026-09-28 の
 * 実測では、準優1,528本のうち「過去日なのに結果も中止の印も無い」は**0本**で、
 * 印は取りこぼしていない。
 *
 * それでも**結果が無いことも併せて要求する**。中止が確定と記録されているのに実際は
 * 行われて結果があるレースが32本ある（すべて2026-09-12の各会場1R〜3R。BOA-512）。
 * 準優には1本も無いが、条件を足しておけば誤って枠を減らすことが原理的に起きない。
 *
 * 「結果が無い準優を落とす」だけにしないのは、**予選中は準優にまだ結果が無い**ため。
 * そこが枠数をいちばん知りたい場面で、全部落としてしまう。
 *
 * ## 残っている限界: フラグは「取得できなかった」でも立つ
 *
 * 047 は中止の確定を「発走90分後を過ぎても**結果が取得できなかった**、または
 * 疑いの段階から昇格」と定義している。つまり中止と、結果取得の障害が同じ印になる。
 * 結果スクレイプが90分以上止まると、実際には行われた準優を落として枠数が過小になる
 * （4本中2本が巻き込まれれば 24枠 → 12枠。13〜24位の選手に「届かず」が出る）。
 *
 * 実データでは該当が無い。準優で「中止が確定かつ結果あり」は0本、部分的に中止と
 * 記録されているのは順延4節だけで、いずれも振替先が実施済み。中止の4例はどれも
 * **その日の後半が連続して**欠けており、取得失敗の飛び飛びの形ではない。
 * それでも「常に倍になる」修正前より誤差が小さいというだけで、消えてはいない。
 * 中止判定そのものの精度は BOA-512 の担当。
 *
 * @param {Array<{raceId?: string, race_id?: string, raceStage?: string|null,
 *   race_stage?: string|null}>} rows 節の全レース
 * ## 枠数は「本数 × 6」ではなく**準優に出た実人数**
 *
 * 多摩川 2026-03-20開催の「Ｗ準優戦前半」「Ｗ準優戦後半」は、**同じ12名が
 * 顔ぶれを組み替えて2回走るヒート**だった（前半4本・後半4本で、出走者の集合は
 * 前半と後半で完全に同一）。本数で数えると 8本 × 6 = 48枠になるが、実際に
 * 準優を走ったのは24名。`racersByRace` を渡せば実人数で数える。
 *
 * 他の5節では本数 × 6 と実人数が一致するので、渡しても答えは変わらない。
 * 渡さない呼び出し（分析スクリプト等）は従来どおり本数 × 6 に落ちる。
 *
 * @param {{cancelledRaceIds?: Set<string>|Array<string>,
 *   ranRaceIds?: Set<string>|Array<string>,
 *   racersByRace?: Map<string, Array<number>>|Object}} [options]
 *   `cancelledRaceIds` は `isRaceCancelled` が真になる `race_id`、
 *   `ranRaceIds` は結果がある `race_id`。どちらも省略すると従来どおり全部数える。
 *   `racersByRace` があれば枠数を実人数で数える
 * @returns {number|null}
 */
export function semifinalSlotsOf(rows, options = {}) {
  const cancelled = toSet(options.cancelledRaceIds);
  const ran = toSet(options.ranRaceIds);
  const all = semifinalRaceIdsOf(rows);
  const kept = all.filter((id) => !(cancelled.has(id) && !ran.has(id)));
  const racersByRace = options.racersByRace ?? null;
  if (racersByRace) {
    const get = (raceId) =>
      racersByRace instanceof Map
        ? (racersByRace.get(raceId) ?? [])
        : (racersByRace?.[raceId] ?? []);
    const seats = new Set();
    for (const id of kept.length ? kept : all)
      for (const r of get(id)) if (r !== null && r !== undefined) seats.add(r);
    // 出走表がまだ無い準優（番組だけ出ている）は実人数が0になるので、
    // そのときは本数から出す方に落とす
    if (seats.size > 0) return seats.size;
  }
  // **全部落ちたら番組どおりの本数に戻す**。中止ぶんを引くのは「振替が同じ節に
  // 残っている」ことが前提で、1本も残らないなら枠数が分かったのではなく
  // 見えなくなっただけ。呼び出し側は表示日までの番組しか持っていないので、
  // 中止された当日を開くと振替（翌日）がまだ窓に入らず、この形になる
  // （江戸川 2026-05-29: 窓の準優は中止された2本だけ。引くと0になるが正解は12枠）
  return (kept.length || all.length) * 6 || null;
}

/** `Set` でも配列でも受けられるようにする（呼び出し側の形に合わせない） */
function toSet(v) {
  if (v instanceof Set) return v;
  return new Set(Array.isArray(v) ? v : []);
}

/**
 * **男女Ｗ優勝戦の節**を、2つのシリーズに分ける（純関数、BOA-511/BOA-476）。
 *
 * 1つの「節」の中に独立した2シリーズが同居する開催がある（優勝戦が2本組まれる）。
 * 節を1つの母集団として扱うと、**別シリーズの選手と混ぜて節内順位を振り、
 * 準優の枠数も2シリーズ合計になる**。ボーダー（準優の目安）と必要得点は
 * そこに乗っているので、まとめて狂う。
 *
 * ## 分け方: 同じレースを走った選手を辿る
 *
 * Ｗ開催では1つのレースに両シリーズが混ざらない。だから「同じレースに出た」で
 * 選手を繋いでいくと、連結成分がそのままシリーズになる。
 *
 * **繋ぐのは得点率に算入するレースだけ**（`countsForSeriesScore`）。全レースで
 * 繋ぐと多摩川 2026-03-20開催が割れない——優勝戦の日の1R・2R「一般」が
 * 両シリーズの選手を混ぜた消化レースで、そこが橋になる。予選終了後なので
 * 算入対象外であり、既存の判定をそのまま通せば落ちる。
 *
 * ## 適用は2つの条件が揃ったときだけ
 *
 * 1. `race_title` に「Ｗ優勝戦」が入っている（全期間で6節。準優が4本以上ある
 *    節の一覧と完全に一致し、取りこぼしは無い）
 * 2. 連結成分がちょうど2個
 *
 * 2だけを根拠にすると、**Ｗ優勝戦でないのに割れる節が7節**出る（2025-12〜
 * 2026-01の `race_stage` が全て null の期間で、データの欠測で連結が切れている）。
 * どちらか欠ければ分けない。
 *
 * ## 検算
 *
 * 桐生 2026-09-20開催だけは `race_stage` に「予選男子」「予選女子」の接尾があり、
 * 正解として使える。この分け方の結果は**男24人/女0人 と 男0人/女24人**で
 * ラベルと完全に一致した（6節で唯一の正解データ）。他の5節は接尾がばらばら
 * （「Ｗ準優戦前半/後半」「ツッキー/ツッピー優勝戦」、または区別なし）で、
 * 接尾での判定は一般解にならない。
 *
 * @param {Array<{race_id?: string, raceId?: string, race_stage?: string|null,
 *   raceStage?: string|null, race_title?: string|null,
 *   raceTitle?: string|null}>} rows 節の全レース（種別）
 * @param {Map<string, Array<number>>|Object} racersByRace `race_id` → 出走選手ID
 * @returns {Array<Set<number>>|null} シリーズごとの選手ID。該当しなければ null
 */
export function splitMeetSeries(rows, racersByRace) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return null;
  const isW = list.some((r) =>
    /[ＷW]優勝戦/u.test(r.raceTitle ?? r.race_title ?? ""),
  );
  if (!isW) return null;

  const get = (raceId) => {
    if (racersByRace instanceof Map) return racersByRace.get(raceId) ?? [];
    return racersByRace?.[raceId] ?? [];
  };
  const prelimEnd = prelimEndRaceIdOf(list);
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    // 経路圧縮
    while (parent.get(x) !== root) {
      const next = parent.get(x);
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  for (const r of list) {
    const raceId = r.raceId ?? r.race_id;
    const stage = r.raceStage ?? r.race_stage ?? "";
    if (!countsForSeriesScore(stage, raceId, prelimEnd)) continue;
    const racers = get(raceId).filter((v) => v !== null && v !== undefined);
    for (let i = 1; i < racers.length; i += 1) {
      const a = find(racers[0]);
      const b = find(racers[i]);
      if (a !== b) parent.set(a, b);
    }
  }
  const groups = new Map();
  for (const racer of [...parent.keys()]) {
    const g = find(racer);
    if (!groups.has(g)) groups.set(g, new Set());
    groups.get(g).add(racer);
  }
  const comps = [...groups.values()];
  // ちょうど2つに割れたときだけ採用する（安全弁）
  if (comps.length !== 2) return null;
  // 大きいほうを先に返す（表示の並びを安定させる）
  return comps.sort((a, b) => b.size - a.size);
}

/**
 * そのレースが**予選最終日より後の日**かどうか。
 *
 * 公式の得点率一覧は「◯日目12R終了時点」＝**日単位**で止まる。PR #871 は
 * 「種別が『予選』の最後のレース」で切ったが、それだと**すべての予選レースに
 * 「予選」と付ける会場でしか正しくない**。丸亀の一般戦は 1R〜5R が「予選」で
 * 6R以降が「かけうどん６」「蒼月まるる特賞」のような会場固有名なので、
 * 最後の「予選」より後ろが丸ごと落ちていた（BOA-457）。
 *
 * @param {string} raceId
 * @param {string|null} prelimEndRaceId 節で最後に「予選」と付いたレース。
 *   null（まだ予選中で締めが分からない）なら false
 */
export function isPastPrelimDay(raceId, prelimEndRaceId) {
  if (!prelimEndRaceId) return false;
  return String(raceId).slice(0, 10) > String(prelimEndRaceId).slice(0, 10);
}

/**
 * 得点率に算入するレースか（純関数）。
 *
 * 得点率・節内順位・ボーダー・必要得点・早見の**すべてがこの1本に依存する**ので、
 * 各所で種別の部分一致を書き下ろさずここを通す（BOA-457）。3条件で落とす。
 *
 * 1. 勝ち上がり戦（準優・優勝戦）
 * 2. 予選最終日より後の日
 * 3. 予選最終日のうち、**「予選」ラベルの最終レースより後**で種別に「一般」と
 *    付くレース。予選最終日の遅いレースが「一般特選」「一般記者特選」のように
 *    組まれる会場（蒲郡・丸亀等）があり、これは予選が締まった後の番組
 *
 * 逆に、予選期間内で「一般」と付かないものは**種別名が「予選」でなくても算入する**
 * （「サンライズＸ戦」「ドラドキ３」「蒼月まるる特賞」等も番組上は予選）。
 *
 * 3番目を「予選ラベルの最終レースより後」に限っているのは、**予選がまだ続いて
 * いる日の「一般」を落とさないため**。実データ（2026-02〜09の563節）では
 * 「一般」と付くレースが予選ラベルの最終レース以前に出たことは0件で、日単位で
 * 落としても結果は同じだが、そちらは未知の番組で予選レースを取りこぼす。
 *
 * この切り方は `scripts/analysis/series-points-scoring-hypotheses.mjs` で
 * 4案を実測比較して選んだ。公式との一致はどの案でも保たれ（若松G1 49/49、
 * 多摩川G1 43/43）、準優進出者との一致は 92.20% → 92.79%（267節・4,746枠、
 * 全枠一致の節も 48 → 52）。PR #871 以前の「最初の準優より前」は 87.95% で
 * 明確に劣る。
 */
export function countsForSeriesScore(stage, raceId, prelimEndRaceId) {
  if (isExcludedStage(stage)) return false;
  if (!prelimEndRaceId) return true;
  if (isPastPrelimDay(raceId, prelimEndRaceId)) return false;
  // 「予選」ラベルの最終レースまでは無条件に算入する
  if (String(raceId) <= String(prelimEndRaceId)) return true;
  return !normalizeStage(stage).includes("一般");
}

/**
 * その走を**走数に数えるか**（純関数）。
 *
 * 着順に載らない走には2種類ある。
 *
 * - **失格・落水・転覆**: 走ったが着順が付かない。**0点だが走数には入れる**
 * - **欠場（不出走）**: そもそも走っていない。**走数にも入れない**
 *
 * 旧実装はこの2つを区別せず、欠場も「0点で1走」と数えていた。得点率が過小に
 * なり、全走が欠場だった選手は**得点率0.00で順位表に並び、着順欄に「失」が
 * 並ぶ**（2026-06-13 浜名湖5R・12Rの選手3849で実際に出ていた）。実測では
 * 2026-06-01以降の298節のうち77節（26%）・96組（節×選手）に影響し、
 * 得点率のズレは中央0.70・最大6.67だった（BOA-489）。
 *
 * 区別は `started`（本番スタートの記録があるか）で行う。呼び出し側が
 * `race_start_timings` から入れる。**`started` が付いていない行は数える**
 * （旧来の呼び出し・STが未取得のレースで走を落とさないための既定）。
 * 着順が付いている走は `started` を見ない——着順に載っている以上は走っている。
 */
function countsAsRun(row) {
  if (finishPositionOf(row) !== null) return true;
  return row.started !== false;
}

/**
 * 今節の得点・走数・得点率を計算する（純関数）。
 *
 * @param {Array<Object>} meetRecords `buildMeetResults` の戻り値（節内の走）。
 *   `started`（本番STの記録があるか）が入っていれば欠場を走数から外す
 * @param {{prelimEndRaceId?: string|null}} [options] `prelimEndRaceId` は
 *   節で最初に組まれた準優勝戦の `race_id`。**これ以降のレースは算入しない**
 * @returns {{points: number, runs: number, rate: number|null}}
 */
export function computeSeriesScore(meetRecords, options = {}) {
  const { prelimEndRaceId = null } = options;
  const rows = Array.isArray(meetRecords) ? meetRecords : [];
  let points = 0;
  let runs = 0;
  rows.forEach((r) => {
    // **予選が終わったらそこで確定**。予選終了後の一般戦・特別選抜戦・
    // 準優・優勝戦は公式の得点率に算入されない。公式の得点率一覧も
    // 「4日目12R終了時点」と予選終了時点で止まる（2026-09-27、若松G1の
    // 最終日に公式ページで確認）。判定は `countsForSeriesScore` に集約
    if (!countsForSeriesScore(r.raceStage, r.raceId, prelimEndRaceId)) return;
    // **結果がまだ無いレースは分母に入れない**。節の全選手を引く経路では
    // その日のこれから走るレースも `race_entries` に入っており、数えると
    // 「得点率4.00（4走）なのに日別の表は3行」という食い違いが出る
    // （2026-09-26 尼崎10Rで実際に発生）。
    // 失格・落水は結果行そのものはあり `rank1` に他艇が入るので、
    // `rank1` の有無で「実施されたか」を判定できる
    if (r.rank1 === null || r.rank1 === undefined) return;
    // 欠場（そもそも走っていない）は走数にも入れない
    if (!countsAsRun(r)) return;
    runs += 1;
    const rank = finishPositionOf(r);
    if (rank === null) return; // 失格・落水・転覆は0点（分母には入れる）
    points += scoreTableFor(r.raceStage)[rank] ?? 0;
  });
  return { points, runs, rate: runs > 0 ? points / runs : null };
}

/**
 * 「今日この着順を取ると得点率がこうなる」の早見（純関数）。
 *
 * **表示中レースの種別で配点を切り替える**。ドリーム戦の日に予選配点（1着+10）で
 * 出すと、実際は+12なので早見と翌日の得点率が食い違う。種別は
 * `getMeetScoreboard` の `currentStage` で取れる（追加クエリ0本）。
 *
 * @param {{points: number, runs: number}} current `computeSeriesScore` の戻り値
 * @param {string|null} [stage] 表示中レースの `race_stage`
 * @returns {Array<{rank: number, rate: number}>} 1着〜6着
 */
export function forecastSeriesScore(current, stage = null) {
  const points = current?.points ?? 0;
  const runs = current?.runs ?? 0;
  const table = scoreTableFor(stage);
  return [1, 2, 3, 4, 5, 6].map((rank) => ({
    rank,
    rate: (points + table[rank]) / (runs + 1),
  }));
}

/**
 * 準優勝戦の既定の枠数。直近2ヶ月の実測では129節中118節が3個レース＝18名
 * （4個=24名が3節、2個=12名が7節、1個=6名が1節）。節の準優が既に組まれていれば
 * 実数を使い、予選中で未定のときだけこの既定値を目安として使う
 */
export const SEMIFINAL_DEFAULT_SLOTS = 18;

/**
 * **Ｗ優勝戦の節**で、準優がまだ番組に出ていないときの既定の枠数（BOA-511）。
 *
 * 節が2つの勝ち上がりに分かれる開催では、母集団が24人前後になる。そこに通常の
 * 既定値18を当てると「24人中18位まで」という緩すぎる線になり、実測では
 * 「準優の線の内側」の誤判定が285人中75人まで増えた。
 *
 * 実データ6節の各側の枠数は**すべて12**だった（準優に出た実人数で数えた値。
 * 多摩川はＷ準優戦が前半4本・後半4本あるが、同じ12名が2回走るヒートなので
 * 本数ではなく実人数で数えると他の5節と同じ12になる）。18になる側は1つも無い。
 */
export const SEMIFINAL_SPLIT_DEFAULT_SLOTS = 12;

/**
 * 今節の着順の並びを古い順に返す（純関数）。
 *
 * 得点率は「平均」なので、**同じ5.00でも「1着→6着」と「3着→3着」では
 * 次のレースの見方が変わる**。勝負駆けを読むファンは並びを見るため、
 * 得点率とは別に素の着順を出す。
 *
 * 未実施のレース（`rank1` が無い）は含めない。失格・落水は `null` で返し、
 * 呼び出し側が「失」等に落とす（0点だが走ったことに変わりはない）。
 * **欠場（走っていない）は `FINISH_ABSENT` で返す**。走っていない走に「失」を
 * 出していた（BOA-489）ため一度は並びから外したが、外すと「欠場した」こと
 * 自体が画面から消える（BOA-504）。呼び出し側が「欠」に落とす。
 * 得点率・走数には入れない（`computeSeriesScore`）。
 *
 * **得点率に算入したレースだけを並べる**。並びは得点率の隣に出すので、
 * 算入していない走（予選終了後の一般戦・準優等）を混ぜると
 * 「着順1・1・2・3・2 なのに3走で9.67」という食い違いになる
 * （2026-09-28、丸亀2026-03-04 9Rで実際にこの表示が出ていた。BOA-457）。
 * 節の全走は下の履歴テーブルで見られる。
 *
 * @param {Array<Object>} meetRecords 節内の走
 * @param {{prelimEndRaceId?: string|null}} [options] `computeSeriesScore` と同じ
 * @returns {Array<number|null|typeof FINISH_ABSENT>} 着順（古い順）
 */
export function listSeriesFinishes(meetRecords, options = {}) {
  const { prelimEndRaceId = null } = options;
  return (Array.isArray(meetRecords) ? [...meetRecords] : [])
    .filter((r) => r.rank1 !== null && r.rank1 !== undefined)
    .filter((r) => countsForSeriesScore(r.raceStage, r.raceId, prelimEndRaceId))
    .sort((a, b) => String(a.raceId).localeCompare(String(b.raceId)))
    .map((r) => (countsAsRun(r) ? finishPositionOf(r) : FINISH_ABSENT));
}

/**
 * 本番STの行が「欠場」か（純関数、BOA-504）。
 *
 * `race_start_timings` は欠場した艇にも行を持ち、`start_timing` が null・
 * `finish_mark` が「欠」になる（2026-06以降の実測: ST空の27行のうち25行が「欠」、
 * 2行は「L」＝出遅れで、これは走っている）。行の有無だけで「走った」と判定すると
 * 欠場を1走に数え、得点率の分母に入れて着順の並びに「失」を出す
 */
export function isAbsentStartRow(row) {
  return row?.finish_mark === "欠";
}

/**
 * 1走ぶんの着順の表示（純関数、BOA-537）。6艇の推移の点の下に出す。
 *
 * - フライングは「F」（本番STの is_flying）
 * - 欠場は「欠」（本番STの着順欄が「欠」、またはそのレースに他艇のST行があるのに
 *   自艇だけ行が無い。`isAbsentStartRow` と同じ判定）
 * - 着順が付いていれば 1〜6
 * - 着順が無く、本番STの着順欄に記号（転・落・妨・エ・不・L・沈 など、公式の表記）が
 *   あればそれ
 * - 結果が無い（未実施）・記号も無いときは null（出さない。推測で「失」と書かない）
 *
 * @param {Object|null} result `race_results` の1行（rank1〜rank6 は艇番）
 * @param {number} boatNumber 艇番
 * @param {Object|null} stRow 本番STの行（finish_mark・is_flying）
 * @param {boolean} raceHasSt そのレースに本番STの行が1つでもあるか
 * @returns {number|string|null}
 */
export function runFinishLabel(result, boatNumber, stRow, raceHasSt) {
  if (stRow?.is_flying) return "F";
  if (isAbsentStartRow(stRow) || (!stRow && raceHasSt && result)) return "欠";
  if (!result) return null;
  const pos = finishPositionOf({ ...result, boatNumber });
  if (pos !== null) return pos;
  const mark = stRow?.finish_mark;
  if (typeof mark === "string" && mark !== "" && !/^[0-9]$/.test(mark))
    return mark;
  return null;
}

/** 着順の並びで「欠場」を表す値（`listSeriesFinishes`） */
export const FINISH_ABSENT = "absent";

/**
 * 今節の走が**全て欠場**の選手を返す（純関数、BOA-504）。
 *
 * 走数0で得点率が出ないため `buildMeetRanking` には載らない。そのまま比較表を
 * 組むと、6艇のうち1艇が**黙って消える**（2026-06-13 浜名湖12Rの2号艇で発生）。
 * 画面はこの一覧で「欠場」の行を足す。
 *
 * **欠場と分かる走が1つ以上ある選手だけ**を返す。今節の走がまだ無い選手
 * （初日の1走目など）は欠場ではないので含めない。母集団（男女Ｗ優勝戦の
 * シリーズ）と算入範囲（予選まで）は `buildMeetRanking` と同じ。
 *
 * @param {Object|null} scoreboard `getMeetScoreboard` の戻り値
 * @returns {Array<{racerId: number, playerName: string, finishes: Array}>}
 */
export function listAbsentOnlyRacers(scoreboard) {
  const all = scoreboard?.entries;
  if (!Array.isArray(all) || all.length === 0) return [];
  const seriesRacerIds = scoreboard?.seriesRacerIds ?? null;
  const inSeries = seriesRacerIds ? new Set(seriesRacerIds) : null;
  const prelimEndRaceId = scoreboard?.prelimEndRaceId ?? null;
  const byRacer = new Map();
  all
    .filter((e) => !inSeries || inSeries.has(e.racerId))
    .forEach((e) => {
      if (!byRacer.has(e.racerId))
        byRacer.set(e.racerId, { playerName: e.playerName, rows: [] });
      byRacer.get(e.racerId).rows.push(e);
    });
  return [...byRacer.entries()]
    .map(([racerId, { playerName, rows }]) => ({
      racerId,
      playerName,
      finishes: listSeriesFinishes(rows, { prelimEndRaceId }),
    }))
    .filter(
      (r) =>
        r.finishes.length > 0 && r.finishes.every((f) => f === FINISH_ABSENT),
    );
}

/**
 * 公式の得点率一覧の値を使ってよいか（純関数、BOA-475）。
 *
 * 公式の行は節に1行しか無く、中身は「◯日目１２R終了時点」＝**予選終了時点の
 * スナップショット**。レース詳細は過去日も開けるので、予選中のレースを開いて
 * いるときに使うと**まだ走っていない走を含む得点率・順位**を出してしまう。
 * 実測では予選2日目で最大47名の走数がズレ、予選最終レースでも、そのレースに
 * 乗っている6名ぶんが先取りになる。
 *
 * 表示中のレースが得点率に算入される＝まだ予選の途中、なので使わない。
 * サービス層のこの判断を回帰テストできるよう、純関数に切り出してある。
 *
 * @param {string|null} currentStage 表示中レースの `race_stage`
 * @param {string} raceId 表示中のレース
 * @param {string|null} prelimEndRaceId 節で最後に「予選」と付いたレース
 */
export function shouldUseOfficialSeries(currentStage, raceId, prelimEndRaceId) {
  return !countsForSeriesScore(currentStage, raceId, prelimEndRaceId);
}

/**
 * 公式の得点率一覧（`racer_series_points`）の1行を、当社の
 * `{points, runs, rate, finishes}` に読み替える（純関数、BOA-475）。
 *
 * ## なぜ読み替えるのか
 *
 * **公式の得点率 = (着順点の合計 − 減点) ÷ 走数**。当社は減点を持っていないため、
 * 減点のある選手の得点率が過大になり、**その下にいる全員の節内順位までズレる**
 * （多摩川G1では公式順位がある45名のうち25名が不一致だった）。公式の行がある
 * 開催では、当社計算ではなく公式の値を使う。
 *
 * ## 走数は `placements` の文字数から出す
 *
 * 公式データに走数の列は無いが、`placements`（着順の文字列）の空白を除いた文字数が
 * 走数になる。**全角空白は「日の区切り」ではなく「未消化のスロット」**
 * （1日2枠の固定スロットのうち走らなかった枠。マイグレーション064のCOMMENT）。
 * 実データ「１□２３１□４３」（□は全角空白）は 1日目[1,空] / 2日目[2,3] /
 * 3日目[1,空] / 4日目[4,3] の4日ぶんで、日の区切りとして読むと3グループになり
 * 実際の走と合わない。走数（非空白の文字数）と着順の並びはどちらの読み方でも
 * 同じだが、「日ごとに分けて出す」等でこの前提に乗ると壊れる。
 * 2026-09-28に収録済みの全101行で検算し、`(得点 − 減点) ÷ 得点率` と
 * **得点率のある94行すべてで一致**した。
 *
 * ## 減点99は引かない
 *
 * `penalty_points = 99` は**賞典除外の印**で、実際に引く点数ではない
 * （マイグレーション064のCOMMENT）。引くと得点が負になる（実データ: 得点40・減点99）。
 *
 * @param {{placements: string|null, total_points: number|null,
 *   penalty_points: number|null}} row
 * @returns {{points: number, runs: number, rate: number,
 *   finishes: Array<number|null>}|null} 読み替えられなければ null
 */
export function officialSeriesScore(row) {
  if (!row) return null;
  if (row.total_points === null || row.total_points === undefined) return null;
  const finishes = parseOfficialPlacements(row.placements);
  const runs = finishes.length;
  if (runs === 0) return null;
  const penalty = row.penalty_points ?? 0;
  // 99は賞典除外の印。引き算の対象ではない
  const points = row.total_points - (penalty === 99 ? 0 : penalty);
  return { points, runs, rate: points / runs, finishes };
}

/**
 * 公式の `placements`（着順の文字列）を着順の配列にする（純関数）。
 *
 * 全角空白は未消化のスロットなので落とす。全角・半角の数字は着順、それ以外
 * （「妨」＝妨害失格、「落」＝落水 等）は着順が付いていないので null にする
 * （当社の `listSeriesFinishes` と同じ形）。
 *
 * @param {string|null} placements
 * @returns {Array<number|null>}
 */
export function parseOfficialPlacements(placements) {
  if (!placements) return [];
  const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);
  return [...String(placements)]
    .filter((c) => !/\s/u.test(c) && c !== IDEOGRAPHIC_SPACE)
    .map((c) => {
      const half = /[\uFF10-\uFF19]/u.test(c)
        ? String.fromCharCode(c.charCodeAt(0) - 0xfee0)
        : c;
      return /^[1-6]$/u.test(half) ? Number(half) : null;
    });
}

/**
 * 節の全選手の得点率を計算して順位を付ける（純関数）。
 *
 * 得点率は**単独では読めない**（「3.67」だけでは準優に乗るか分からない）。
 * 節の中での位置と、準優の枠に対する距離を出して初めて判断材料になる。
 *
 * @param {{entries: Array<Object>, seriesRacerIds?: Array<number>|null}|null}
 *   scoreboard `getMeetScoreboard` の戻り値。`seriesRacerIds` があれば
 *   その選手だけを母集団にする（男女Ｗ優勝戦の節）
 * @returns {Array<{racerId: number, playerName: string, points: number,
 *   runs: number, rate: number, rank: number|null, withdrawn: boolean}>}
 *   得点率の降順。同率は同順位。途中で節を離脱した選手は `rank: null`
 */
export function buildMeetRanking(scoreboard) {
  const all = scoreboard?.entries;
  if (!Array.isArray(all) || all.length === 0) return [];
  // **男女Ｗ優勝戦の節では、同じシリーズの選手だけを母集団にする**（BOA-511）。
  // 1つの節に独立した2シリーズが同居する開催があり、混ぜて順位を振ると
  // 節内順位・出場人数・準優の目安が実際の勝ち上がり争いとズレる。
  // どのシリーズを見せるかはサービス層が決める（表示中の6艇が属するほう）
  const seriesRacerIds = scoreboard?.seriesRacerIds ?? null;
  const inSeries = seriesRacerIds ? new Set(seriesRacerIds) : null;
  const entries = inSeries ? all.filter((e) => inSeries.has(e.racerId)) : all;
  if (entries.length === 0) return [];
  const prelimEndRaceId = scoreboard?.prelimEndRaceId ?? null;
  // 途中で節を離脱した選手（途中帰郷）は順位の対象から外す。公式の順位表と
  // 同じ扱い。得点率自体は出すので、行が消えることはない（rank が null になる）
  const withdrawn = new Set(scoreboard?.withdrawnRacerIds ?? []);

  const byRacer = new Map();
  entries.forEach((e) => {
    if (!byRacer.has(e.racerId))
      byRacer.set(e.racerId, { playerName: e.playerName, rows: [] });
    byRacer.get(e.racerId).rows.push(e);
  });

  // 公式の得点率一覧がある開催では、当社計算ではなく公式の値を使う（BOA-475）。
  // **いつ使うかはサービス層が決める**（`officialByRacer` を渡すかどうか）。
  // 公式の行は「予選終了時点」のスナップショットなので、予選中のレースを
  // 開いているときに使うと**まだ走っていない走を含む値**になってしまう
  const officialByRacer = scoreboard?.officialByRacer ?? null;

  const rows = [...byRacer.entries()]
    .map(([racerId, { playerName, rows: runs }]) => {
      const official = officialByRacer
        ? officialSeriesScore(officialByRacer[racerId])
        : null;
      // 公式に行が無い選手（予選終了後に乗り込んだ選手等）は当社計算に戻す。
      // 予選を走っていなければ走数0で `rate` が null になり、順位から外れる
      const own = official
        ? null
        : computeSeriesScore(runs, { prelimEndRaceId });
      return {
        racerId,
        playerName,
        points: official ? official.points : own.points,
        runs: official ? official.runs : own.runs,
        rate: official ? official.rate : own.rate,
        finishes: official
          ? official.finishes
          : listSeriesFinishes(runs, { prelimEndRaceId }),
        // この行が公式の値か（画面が出典の注記を出し分ける）
        fromOfficial: Boolean(official),
      };
    })
    .filter((r) => r.rate !== null)
    .sort((a, b) => b.rate - a.rate);

  // 同率は同順位（1,2,2,4…）。公式の得点率一覧と同じ付け方。
  // 離脱者は順位を飛ばさず（母集団から外して）詰める
  let rank = 0;
  let prev = null;
  let counted = 0;
  return rows.map((r) => {
    if (withdrawn.has(r.racerId)) return { ...r, rank: null, withdrawn: true };
    counted += 1;
    if (prev === null || Math.abs(r.rate - prev) > 0.0001) rank = counted;
    prev = r.rate;
    return { ...r, rank, withdrawn: false };
  });
}

/**
 * ボーダーに届くのに必要な得点（純関数）。
 *
 * 公式の「必要得点」＝「準優ボーダーをクリアするために必要な得点」を、
 * 公式の実データから逆算した式で再現する
 * （https://www.boatrace.jp/static_extra/pc/guide/guide-7.html の図:
 *  篠崎 得点率5.75・4走・残り2走 → 13点、池田 7.00・5走・残り1走 → 1点。
 *  どちらも `ボーダー × (走数 + 残り走数) − 得点` で一致する）。
 *
 * `max`（残り走で取りうる最大得点）は**残りレースの種別ごとの1着の点**を足す。
 * 予選配点の10点で決め打ちすると、残りにドリーム戦（1着12）や特選（同11）が
 * 含まれる選手を「届かず」と誤って出す（BOA-457）。
 *
 * @param {{points: number, runs: number}} current `computeSeriesScore` の戻り値
 * @param {number|null} border ボーダー（準優の目安）の得点率
 * @param {number} remaining 残りの予選走数（表示中のレースを含む）
 * @param {number|null} [maxPoints] 残り走で取りうる最大得点。省略時は
 *   予選配点の1着 × 残り走数（種別が分からない呼び出し向けのフォールバック）
 * @returns {{needed: number, max: number, reachable: boolean}|null}
 *   `needed` は必要得点（0未満は0に丸める）、`max` は残り走で取りうる最大得点、
 *   `reachable` は届く見込みがあるか。残り0走・ボーダー不明なら null
 */
export function pointsNeededForBorder(
  current,
  border,
  remaining,
  maxPoints = null,
) {
  if (border === null || border === undefined) return null;
  if (!remaining || remaining <= 0) return null;
  const points = current?.points ?? 0;
  const runs = current?.runs ?? 0;
  const raw = border * (runs + remaining) - points;
  // 得点は整数なので切り上げる。既に足りている場合は0
  const needed = Math.max(0, Math.ceil(raw - 1e-9));
  const max = maxPoints ?? SCORE_POINTS[1] * remaining;
  return { needed, max, reachable: needed <= max };
}

/**
 * 得点率に小標本の印を付ける走数の下限。
 *
 * 節の予選は6走前後で、2走以下だと1走の着順で得点率が2点近く動く
 * （2走2勝なら10.00、そこから6着を1つ挟むと7.00）。条件別タブの
 * `SMALL_SAMPLE_THRESHOLD`（n<6）は全期間の集計向けで、節には大きすぎるため別に持つ
 */
export const MEET_SMALL_SAMPLE_RUNS = 3;
