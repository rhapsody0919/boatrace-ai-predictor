import { finishPositionOf } from "./finishPosition.js";

/**
 * 予選が終わった日が節の「何日目」か（公式の「◯日目12R終了時点」の日目、BOA-578）。
 *
 * **開催日を数えてはいけない**。丸一日中止の日も番組（出走表・種別）は残るので、
 * 日付を数えると中止の日を1日に数えて公式より1日進む（津 2026-09-21〜28 の節:
 * 9/22 が丸一日中止、公式は 9/26 を5日目とするが、日付を数えると6日目）。
 * 公式は中止の翌日に同じ日目を振り直す。
 *
 * 1. 予選最終日の `series_day`（公式の出走表ページから読んだ値）を使う
 * 2. 無ければ、結果が1つでも出た日だけを数える（丸一日中止の日を飛ばす）
 *
 * @param {string|null} prelimEndRaceId `prelimEndRaceIdOf` の値
 * @param {Array<{race_id: string, series_day?: number|null}>} conditions 節の種別の行
 * @param {Iterable<string>} meetRaceIds 節の全レースの race_id（出走表）
 * @param {Set<string>} ranRaceIds 結果があるレース
 * @returns {number|null}
 */
export function prelimEndDayOf(
  prelimEndRaceId,
  conditions,
  meetRaceIds,
  ranRaceIds,
) {
  if (!prelimEndRaceId) return null;
  const endDate = prelimEndRaceId.slice(0, 10);
  const seriesDays = (Array.isArray(conditions) ? conditions : [])
    .filter((c) => c.race_id.slice(0, 10) === endDate && c.series_day != null)
    .map((c) => Number(c.series_day));
  if (seriesDays.length > 0) return Math.min(...seriesDays);
  const ranDates = new Set(
    [...(ranRaceIds ?? [])].map((id) => String(id).slice(0, 10)),
  );
  const dates = [
    ...new Set([...(meetRaceIds ?? [])].map((id) => String(id).slice(0, 10))),
  ].filter((d) => d < endDate && ranDates.has(d));
  return dates.length + 1;
}

/**
 * 節の中で**丸一日レースが無かった日**（全レースが中止・順延）を返す（純関数、BOA-636）。
 *
 * 公式は丸一日中止の翌日に同じ日目を振り直すので、日付を数えると日目が合わない
 * （津 2026-09-22、戸田・江戸川 2026-09-21）。画面がその日を断るのに使う。
 * 一部のレースだけ成立した日（津 9/21 は4Rまで成立）は含めない。
 *
 * @param {Iterable<string>} raceIds 節の全レースの race_id（出走表）
 * @param {Set<string>} cancelledRaceIds 中止が確定したレース（`isRaceCancelled`）
 * @returns {string[]} 日付（YYYY-MM-DD）昇順
 */
export function noRaceDaysOf(raceIds, cancelledRaceIds) {
  const byDate = new Map();
  for (const id of raceIds ?? []) {
    const d = String(id).slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(id);
  }
  return [...byDate.entries()]
    .filter(([, ids]) => ids.every((id) => cancelledRaceIds?.has(id)))
    .map(([d]) => d)
    .sort();
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
 * **途中帰郷とみなす選手**（純関数）。前の日まで走っていたのに、表示日に1走も
 * 組まれていない選手。
 *
 * 予選中でも予選の後でも、その日から外す。公式の得点率一覧・会場の公式サイト・
 * ボートレース日和も、予選中・予選後とも途中帰郷を順位から外している（BOA-649）。
 * 以前は「最終日に出走が無い」でしか外さず、予選中に帰った選手が最終日まで順位にも
 * 準優の目安の計算にも残っていた（桐生 2026-09-20〜25: 北川・田中が 9/22 で帰郷）。
 *
 * **出走表は表示日まで（当日の番組を含む）を渡す**。2026-06〜の288節で、この判定で
 * 外した選手がその後に走った例は0人（表示日の種類ごと: 予選の途中 447日・204人、
 * 予選の最終日 285日・329人、予選の後で最終日より前 277日・544人、最終日 288日・671人）。
 * 表示日の出走表がその会場に1件も無い（当日の番組の取得が遅れた）ときは、全員を
 * 外してしまうので判定しない。
 *
 * @param {Array<{race_id: string, racer_id: number}>} entries 節の出走表（表示日まで）
 * @param {string} date 表示日（YYYY-MM-DD）
 * @returns {number[]} racer_id
 */
export function withdrawnByAbsence(entries, date) {
  const rows = (entries ?? []).filter(
    (e) => e.racer_id !== null && e.racer_id !== undefined,
  );
  if (!rows.some((e) => e.race_id.slice(0, 10) === date)) return [];
  const before = new Set();
  const onOrAfter = new Set();
  for (const e of rows) {
    if (e.race_id.slice(0, 10) < date) before.add(e.racer_id);
    else onOrAfter.add(e.racer_id);
  }
  return [...before].filter((id) => !onOrAfter.has(id));
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
/**
 * 本番STの着順欄の値が、着順でない公式の記号（転・落・妨・エ・不・L・沈 など）か
 * （純関数、BOA-537）。数字・空・null は記号ではない。欠場（「欠」）もここでは
 * 記号として返すので、欠場の扱いは呼び出し側で先に済ませる
 */
export function officialMarkOf(mark) {
  return typeof mark === "string" && mark !== "" && !/^[0-9０-９]$/u.test(mark)
    ? mark
    : null;
}

export function runFinishLabel(result, boatNumber, stRow, raceHasSt) {
  if (stRow?.is_flying) return "F";
  if (isAbsentStartRow(stRow) || (!stRow && raceHasSt && result)) return "欠";
  if (!result) return null;
  const pos = finishPositionOf({ ...result, boatNumber });
  if (pos !== null) return pos;
  return officialMarkOf(stRow?.finish_mark);
}

/**
 * 公式の減点欄を賞典除外の印と引く点に分ける。
 * 109を99（印）＋10（減点）と読むのは推測（確度 中、BOA-1053）。
 */
export function readOfficialPenalty(penalty) {
  return {
    awardExcluded: penalty >= 99,
    deduct: penalty >= 99 ? penalty - 99 : penalty,
  };
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
 * ## 賞典除外の印99と減点を分ける
 *
 * `penalty_points = 99` は**賞典除外の印**で、実際に引く点数ではない
 * （マイグレーション064のCOMMENT）。99以上は印を除いた減点だけ引く。
 *
 * @param {{placements: string|null, total_points: number|null,
 *   penalty_points: number|null}} row
 * @returns {{points: number, runs: number, rate: number,
 *   finishes: Array<number|null>, awardExcluded: boolean}|null} 読み替えられなければ null
 */
export function officialSeriesScore(row) {
  if (!row) return null;
  if (row.total_points === null || row.total_points === undefined) return null;
  const finishes = parseOfficialPlacements(row.placements);
  const runs = finishes.length;
  if (runs === 0) return null;
  const { awardExcluded, deduct } = readOfficialPenalty(row.penalty_points ?? 0);
  const points = row.total_points - deduct;
  return { points, runs, rate: points / runs, finishes, awardExcluded };
}

/**
 * 予選中の今節タブに足す、公式の得点率一覧の**減点と途中帰郷だけ**（純関数、BOA-782）。
 *
 * 予選中の得点率・順位は当社計算のまま（当日の走を数えるため）。当社は減点と公式の
 * 備考を持たず、三国G1 10/6 に白井英治（公式14位・減点10）を2位と出し、公式で途中帰郷の
 * 安河内将を順位に残した。そこで前夜の取得分から、この2つだけを借りる
 * （オーナー決定 2026-10-13）。
 *
 * **表の時点が表示中のレースの日より前のときだけ**使う。公式の行は節に1行で、取得の
 * たびに上書きされる。過去の日のレースを後から開くと、その日より後の減点・帰郷が
 * 入った行になる（後出し。児島G1 10/1 の丸野一樹を予選中に外した PR #1149 と同じ型）。
 *
 * @param {Array<{racer_id: number, remarks: string|null,
 *   penalty_points: number|null}>} officialRows 節の公式の行
 * @param {string|null} asOf 表の時点 YYYY-MM-DD（`officialAsOfDate`）
 * @param {string} raceDate 表示中のレースの日付 YYYY-MM-DD
 * @returns {{asOf: string, penaltyByRacer: Record<number, number>,
 *   withdrawnRacerIds: Array<number>}|null} 使えなければ null
 */
export function prelimOfficialAdjustments(officialRows, asOf, raceDate) {
  const rows = Array.isArray(officialRows) ? officialRows : [];
  if (rows.length === 0 || !asOf || !raceDate || asOf >= raceDate) return null;
  const penaltyByRacer = {};
  for (const r of rows) {
    const { deduct } = readOfficialPenalty(r.penalty_points ?? 0);
    if (deduct > 0) penaltyByRacer[r.racer_id] = deduct;
  }
  const withdrawnRacerIds = rows
    .filter((r) => r.remarks?.includes("途中帰郷"))
    .map((r) => r.racer_id);
  return { asOf, penaltyByRacer, withdrawnRacerIds };
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
      // 着順でない記号（妨・落 など）はそのまま返す。画面は記号のまま出す
      // （推移の点の下・日別の表と表記をそろえる。BOA-537）
      return /^[1-6]$/u.test(half) ? Number(half) : half;
    });
}

/**
 * 得点率に小標本の印を付ける走数の下限。
 *
 * 節の予選は6走前後で、2走以下だと1走の着順で得点率が2点近く動く
 * （2走2勝なら10.00、そこから6着を1つ挟むと7.00）。条件別タブの
 * `SMALL_SAMPLE_THRESHOLD`（n<6）は全期間の集計向けで、節には大きすぎるため別に持つ
 */
export const MEET_SMALL_SAMPLE_RUNS = 3;

/** 公式が得点率を出さない理由の行は、内部の数値を画面に出さない。 */
export const meetRateHidden = (row) =>
  row.excludedReason === "officialWithdrawn" || row.excludedReason === "awardExcluded";

/**
 * 今節タブの得点率の最良（金枠）を決める `bestOf` の候補（BOA-872）。
 *
 * - 公式の途中帰郷・賞典除外は得点率を「—」で出すので、候補から外す。
 *   比べる値に残すと、「—」のセルが最良として光るか、本来の最良の艇に金枠が付かない
 * - 走数が少ない（⚠）艇は比べるが光らせない（`hidden`、`bestOf` の説明を参照）
 *
 * @param {Array<{boat: number, row: {rate: number, runs: number, excludedReason?: string|null}}>} compareRows
 * @returns {Array<{boat: number, value: number|null, hidden: boolean}>}
 */
export const meetRateBestCandidates = (compareRows) =>
  compareRows.map(({ boat, row }) => ({
    boat,
    value: meetRateHidden(row) ? null : row.rate,
    hidden: row.runs < MEET_SMALL_SAMPLE_RUNS,
  }));
