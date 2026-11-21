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
 * 賞典除外・途中帰郷の選手は公式が得点率を出さない（「-」）。内部の値は並びのため数で残し、
 * 公式の除外理由がある行は meetRateHidden で画面の得点率を隠す。
 */
import { finishPositionOf } from "./finishPosition.js";
import { getRaceStageKey } from "./raceStageConfig.js";
import { officialMarkOf, officialSeriesScore } from "./seriesPointsParts.js";

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
 * - `excluded` … 勝ち上がり戦（準々・準決・準優・優勝戦）。得点率に算入しない
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
  // 「準々決勝戦」「準々優勝戦」「準決勝戦」「準優進出戦」も先に落とす
  if (
    s.includes("準々") ||
    s.includes("準決") ||
    s.includes("準優") ||
    s.includes("優勝戦")
  )
    return "excluded";
  // 「優勝戦」「準優」を含まない優勝戦・準優勝戦（決勝戦・準決勝戦・王将位決定戦・〜優 等）。
  // バッジと同じ判定 v2（raceStageConfig.js の getRaceStageKey、BOA-271 T1-1）
  if (getRaceStageKey(stage)) return "excluded";
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
  return (
    (Array.isArray(meetRecords) ? [...meetRecords] : [])
      .filter((r) => r.rank1 !== null && r.rank1 !== undefined)
      .filter((r) =>
        countsForSeriesScore(r.raceStage, r.raceId, prelimEndRaceId),
      )
      .sort((a, b) => String(a.raceId).localeCompare(String(b.raceId)))
      // 着順が付かない走は、公式の記号（落・転・妨など）があればそれを出す。
      // 無ければ null（画面は「失」）。推移の点の下と同じ表記にそろえる（BOA-537）。
      // フライングは本番STの is_flying を先に見る。着欄の記号（finish_mark）が未取得の走
      // （2026-09前半以前）で「失」と出て、推移の「F」と食い違っていた（BOA-589）
      .map((r) =>
        countsAsRun(r)
          ? (finishPositionOf(r) ??
            (r.isFlying === true ? "F" : officialMarkOf(r.finishMark)))
          : FINISH_ABSENT,
      )
  );
}

/**
 * 今節フライング（F）を切った選手（純関数、BOA-587）。**賞典除外**の判定に使う。
 *
 * Fを切った選手はその節の準優勝戦・優勝戦に乗れない（賞典除外）。公式の得点率一覧の
 * 備考（`racer_series_points.remarks`）が取れている節ではそちらが正で、これは
 * 備考が無い節のための推定。2026-09-30実測（備考がある3節）: 今節Fの2人は
 * 2人とも「賞典除外」、Fがあるのに賞典除外でない選手は0人。
 * L はこの関数では扱わない。選手責任の出遅れ（L1）は
 * `lateStartL1RacerIdsInMeet` で別に判定する（BOA-1072）
 *
 * @param {Array<Object>} starts `race_start_timings` の行（表示中レースより前の今節ぶん）
 * @param {Array<Object>} entries `race_entries` の行（race_id・boat_number・racer_id）
 * @returns {Array<number>} 選手ID
 */
export function flyingRacerIdsInMeet(starts, entries) {
  const racerByKey = new Map(
    (entries ?? []).map((e) => [`${e.race_id}|${e.boat_number}`, e.racer_id]),
  );
  const ids = new Set();
  for (const r of starts ?? []) {
    const flying =
      r.is_flying === true || r.finish_mark === "F" || r.finish_mark === "Ｆ";
    if (!flying) continue;
    const id = racerByKey.get(`${r.race_id}|${r.boat_number}`);
    if (id !== null && id !== undefined) ids.add(id);
  }
  return [...ids];
}

/**
 * 今節に選手責任の出遅れ（L1）がある選手（純関数、BOA-1072）。
 *
 * F と同じく賞典除外の推定に使う。公式の備考がある節はそちらが正。
 * `official_finish_code` が L1 の行だけを対象にし、L0（選手責任外）や
 * 責任の分からない `finish_mark` の L だけでは判定しない。
 *
 * @param {Array<Object>} starts `race_start_timings` の行（表示中レースより前の今節ぶん）
 * @param {Array<Object>} entries `race_entries` の行（race_id・boat_number・racer_id）
 * @returns {Array<number>} 選手ID
 */
export function lateStartL1RacerIdsInMeet(starts, entries) {
  const racerByKey = new Map(
    (entries ?? []).map((e) => [`${e.race_id}|${e.boat_number}`, e.racer_id]),
  );
  const ids = new Set();
  for (const r of starts ?? []) {
    if (r.official_finish_code !== "L1") continue;
    const id = racerByKey.get(`${r.race_id}|${r.boat_number}`);
    if (id !== null && id !== undefined) ids.add(id);
  }
  return [...ids];
}

/**
 * **予選が終わった後のレースで**今節Fを切った選手（純関数、BOA-626）。
 *
 * 順位は予選終了で確定しているので、予選後のFでは順位の対象から外さない
 * （`getMeetScoreboard` は予選終了までのFだけで賞典除外を判定する）。公式の
 * 得点率一覧も予選後のFは順位・得点率をそのまま残し、備考も付けない（SG/G1/G2の
 * 9例で確認、BOA-649）。予選中のFの選手（順位なし）と並ぶと食い違って見えるので、
 * 画面は順位の下で断る。予選の締めが分からない節は空。
 *
 * @param {Array<Object>} starts 本番STの行（`flyingRacerIdsInMeet` と同じ形）
 * @param {Array<Object>} entries 出走表の行
 * @param {string|null} prelimEndRaceId `prelimEndRaceIdOf` の値
 * @returns {number[]} racer_id
 */
export function postPrelimFlyingRacerIds(starts, entries, prelimEndRaceId) {
  if (!prelimEndRaceId) return [];
  return flyingRacerIdsInMeet(
    (starts ?? []).filter((r) => r.race_id > prelimEndRaceId),
    entries,
  );
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
 * 順位の対象から外した選手を、理由ごとにまとめる（純関数、BOA-697）。
 *
 * 人数の行（「…5人を除く」）だけでは誰が外れたかが分からず、予選の後に順位が
 * 動いた理由もその場で読めなかった。公式の得点率一覧が備考欄で一人ずつ見せるのに
 * 近い形で、名前を理由ごとに並べる。並びは 今節F → 賞典除外（公式の備考）→
 * 途中帰郷 → 欠場。公式の備考による途中帰郷も「途中帰郷」にまとめる。
 *
 * @param {Array<{racerId: number, playerName: string, withdrawn?: boolean,
 *   excludedReason?: string|null}>} ranking `buildMeetRanking` の行
 * @param {Array<{racerId: number, playerName: string}>} absentOnly 全部の走が欠場の選手
 * @returns {Array<{reason: "flying"|"awardExcluded"|"withdrawn"|"absent",
 *   names: string[]}>} 該当者がいる理由だけ
 */
export function groupExcludedRacers(ranking, absentOnly) {
  const order = ["flying", "awardExcluded", "withdrawn", "absent"];
  const byReason = new Map(order.map((r) => [r, []]));
  const nameOf = (r) => String(r.playerName ?? "").replace(/\s+/g, "");
  for (const r of ranking ?? []) {
    if (!r.withdrawn) continue;
    const reason =
      r.excludedReason === "flying" || r.excludedReason === "awardExcluded"
        ? r.excludedReason
        : "withdrawn";
    byReason.get(reason).push(nameOf(r));
  }
  for (const r of absentOnly ?? []) byReason.get("absent").push(nameOf(r));
  return order
    .map((reason) => ({ reason, names: byReason.get(reason) }))
    .filter((g) => g.names.length > 0);
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
 * 順位の母集団の出走表。男女Ｗ優勝戦の節では同じシリーズの選手だけにする。
 * @param {Object|null|undefined} scoreboard
 * @returns {Array<Object>}
 */
function seriesEntriesOf(scoreboard) {
  const all = scoreboard?.entries;
  if (!Array.isArray(all) || all.length === 0) return [];
  // **男女Ｗ優勝戦の節では、同じシリーズの選手だけを母集団にする**（BOA-511）。
  // 1つの節に独立した2シリーズが同居する開催があり、混ぜて順位を振ると
  // 節内順位・出場人数・準優の目安が実際の勝ち上がり争いとズレる。
  // どのシリーズを見せるかはサービス層が決める（表示中の6艇が属するほう）
  const seriesRacerIds = scoreboard?.seriesRacerIds ?? null;
  const inSeries = seriesRacerIds ? new Set(seriesRacerIds) : null;
  return inSeries ? all.filter((e) => inSeries.has(e.racerId)) : all;
}

/** 出走表を選手ごとにまとめる（初出の順を保つ）。 */
function groupEntriesByRacer(entries) {
  const byRacer = new Map();
  entries.forEach((e) => {
    if (!byRacer.has(e.racerId))
      byRacer.set(e.racerId, { playerName: e.playerName, rows: [] });
    byRacer.get(e.racerId).rows.push(e);
  });
  return byRacer;
}

/** 予選中に当社計算へ公式の前夜の減点を足す（BOA-782）。 */
function withPenalty(score, penalty) {
  return penalty > 0 && score.runs > 0
    ? {
        ...score,
        points: score.points - penalty,
        rate: (score.points - penalty) / score.runs,
      }
    : score;
}

/**
 * 1人ぶんの行（公式の値か当社計算か）。
 * @param {number} racerId
 * @param {{playerName: string, rows: Array<Object>}} racer
 * @param {{officialByRacer: Object|null, penaltyByRacer: Object,
 *   prelimEndRaceId: string|null}} ctx
 */
function meetRankingRow(racerId, { playerName, rows: runs }, ctx) {
  const { officialByRacer, penaltyByRacer, prelimEndRaceId } = ctx;
  const official = officialByRacer
    ? officialSeriesScore(officialByRacer[racerId])
    : null;
  // 公式に行が無い選手（予選終了後に乗り込んだ選手等）は当社計算に戻す。
  // 予選を走っていなければ走数0で `rate` が null になり、順位から外れる
  const own = official
    ? null
    : withPenalty(
        computeSeriesScore(runs, { prelimEndRaceId }),
        penaltyByRacer[racerId] ?? 0,
      );
  return {
    racerId,
    playerName,
    points: official ? official.points : own.points,
    runs: official ? official.runs : own.runs,
    rate: official ? official.rate : own.rate,
    // 当社計算に公式の前夜の減点を足したか（BOA-782）
    penaltyFromOfficial: own ? (penaltyByRacer[racerId] ?? 0) : 0,
    finishes: official
      ? official.finishes
      : listSeriesFinishes(runs, { prelimEndRaceId }),
    // この行が公式の値か（画面が出典の注記を出し分ける）
    fromOfficial: Boolean(official),
    awardExcluded: official?.awardExcluded ?? false,
  };
}

/**
 * 得点率の降順の行に順位を付ける。同率は同順位（1,2,2,4…）。公式の得点率一覧と
 * 同じ付け方。離脱者は順位を飛ばさず（母集団から外して）詰める
 */
function assignMeetRanks(rows, withdrawn, reasons) {
  let rank = 0;
  let prev = null;
  let counted = 0;
  return rows.map((r) => {
    if (withdrawn.has(r.racerId) || r.awardExcluded)
      return {
        ...r,
        rank: null,
        withdrawn: true,
        excludedReason:
          reasons[r.racerId] ?? (r.awardExcluded ? "awardExcluded" : "withdrawn"),
      };
    counted += 1;
    if (prev === null || Math.abs(r.rate - prev) > 0.0001) rank = counted;
    prev = r.rate;
    return { ...r, rank, withdrawn: false, excludedReason: null };
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
 *   runs: number, rate: number, rank: number|null, withdrawn: boolean,
 *   excludedReason: "withdrawn"|"awardExcluded"|"flying"|null}>}
 *   得点率の降順。同率は同順位。途中で節を離脱した選手・賞典除外の選手は
 *   `rank: null`（理由は `excludedReason`。無ければ途中帰郷の扱い）
 */
export function buildMeetRanking(scoreboard) {
  const entries = seriesEntriesOf(scoreboard);
  if (entries.length === 0) return [];
  // 途中で節を離脱した選手（途中帰郷）は順位の対象から外す。公式の順位表と
  // 同じ扱い。内部の得点率は数で残し、行は消さない（rank が null になる）
  const withdrawn = new Set(scoreboard?.withdrawnRacerIds ?? []);
  // 順位から外す理由（BOA-587）。賞典除外と途中帰郷で画面の説明が違う
  const reasons = scoreboard?.exclusionReasonByRacer ?? {};
  // 公式の得点率一覧がある開催では、当社計算ではなく公式の値を使う（BOA-475）。
  // **いつ使うかはサービス層が決める**（`officialByRacer` を渡すかどうか）。
  // 公式の行は「予選終了時点」のスナップショットなので、予選中のレースを
  // 開いているときに使うと**まだ走っていない走を含む値**になってしまう
  const ctx = {
    prelimEndRaceId: scoreboard?.prelimEndRaceId ?? null,
    officialByRacer: scoreboard?.officialByRacer ?? null,
    // 予選中に当社計算へ足す公式の前夜の減点（BOA-782、prelimOfficialAdjustments）
    penaltyByRacer: scoreboard?.officialPenaltyByRacer ?? {},
  };
  const rows = [...groupEntriesByRacer(entries).entries()]
    .map(([racerId, racer]) => meetRankingRow(racerId, racer, ctx))
    .filter((r) => r.rate !== null)
    .sort((a, b) => b.rate - a.rate);
  return assignMeetRanks(rows, withdrawn, reasons);
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

export {
  prelimEndDayOf,
  noRaceDaysOf,
  semifinalRaceIdsOf,
  semifinalSlotsOf,
  isAbsentStartRow,
  withdrawnByAbsence,
  officialMarkOf,
  runFinishLabel,
  readOfficialPenalty,
  officialSeriesScore,
  prelimOfficialAdjustments,
  parseOfficialPlacements,
  MEET_SMALL_SAMPLE_RUNS,
  meetRateHidden,
  meetRateBestCandidates,
} from "./seriesPointsParts.js";
