// 選手の今期の事故率（目安）の計算（BOA-327、docs/design/racer-accident-rate/APPROVED.md）。純関数のみ。
//
// 公式の定義（boatrace.jp 用語辞典「事故率」の配点表）: 事故率 = 事故点の合計 ÷ 出走回数。0.70 を超えると B2 級。
//   優勝戦の F・L 30点 / それ以外の F・L 20点 / 妨害失格 15点 / 選手責任の失格・欠場 10点 / 選手責任外 0点 /
//   不良航法・待機行動違反 2点（成績ファイルに無いので含めない。そのため公式の値より低いことがある）
// 2025-05-01 以降: 期内2本目以降の F に +10点（優勝戦なら +20点）（選手級別決定基準の改正。スポニチ 2025-04-02）
// 事故率は小数第2位で切り捨てて判定する（2025-2期に 40÷57=0.7018 の選手2人がB1だった実測）。
//
// 入力は RPC get_racer_accident_records（マイグレーション126）の1行: 出走回数と、事故の走（F・L1・K1・S1・S2）の一覧。
import { isFinalStage } from "../constants/raceStageConfig.js";
import { periodsEndedBefore } from "../components/race/basicInfoStats.js";

/** B2 級になる事故率の上限（これを超えると B2） */
export const ACCIDENT_RATE_LINE = 0.7;
/** 「ライン付近」の残り点数の基本（F・出遅れ1本＝20点。今期すでにFを切っていれば次のFは30点） */
export const ACCIDENT_NEAR_POINTS = 20;
/**
 * 選手の行に目印を出す最少の出走回数。F1本（20点）だけで 0.70 を超えるのは出走28走以下のとき
 * （20÷28=0.714、20÷29=0.689）。期の初めに「F1本だけで超え」の目印が大量に出るのを避ける
 * （2026-06-30 時点で10走以上なら超え120人・付近284人、30走以上なら超え20人・付近225人。
 *  10/02 時点では30走以上で超え26人・付近106人＝全1,625人の約8%）。開いた欄は、未満のうちは事故率と内訳だけを出し、
 *  超え・残り点は出さない
 */
export const ACCIDENT_BADGE_MIN_STARTS = 30;

/** 2回目以降の F の加点が始まった日（この日以降の期の F に加点する） */
const SECOND_FLYING_RULE_FROM = "2025-05-01";

/**
 * 表示中のレースの日から、今期の期間を返す（純関数）。
 * 今期 = 直前に終わった期の翌日から。to は表示中のレースの日（その日の走は含めない）
 * @param {string} raceDate `YYYY-MM-DD`
 * @returns {{from: string, to: string}|null}
 */
export function currentPeriodRange(raceDate) {
  const [prev] = periodsEndedBefore(raceDate, 1);
  if (!prev) return null;
  const end = new Date(`${prev.calcTo}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { from: end.toISOString().slice(0, 10), to: raceDate };
}

/**
 * 1選手の今期の事故率（純関数）。
 * @param {{starts: number, incidents: Array<{race_id: string, code: string, stage: string|null}>}|null|undefined} row
 * @param {{from: string}} range currentPeriodRange の戻り値（2本目以降の F の加点の有無に使う）
 * @returns {{starts: number, points: number, rate: number|null, need: number,
 *            counts: {F: number, L1: number, K1: number, S1: number, S2: number},
 *            status: "over"|"near"|null, settled: boolean, showBadge: boolean}}
 *   rate は小数第2位で切り捨てた値。need は今の出走数のまま 0.70 を超える（0.71以上になる）までの点数（0以上）。
 *   status は over（超え）・near（事故点1点以上で、次の F・出遅れ1本で超える。F持ちは30点、それ以外は20点以内）・null。
 *   settled は出走が ACCIDENT_BADGE_MIN_STARTS 以上か。未満のうちは1本の事故で大きく動くので、
 *   画面は超え・残り点を出さない（期の序盤に無事故の選手へ「あと8点」と出していた。PR #1219 ファン評価1周目）。
 *   showBadge は選手の行に目印を出すか（status があり、settled）
 */
export function computeAccidentStats(row, range) {
  const starts = row?.starts ?? 0;
  const incidents = [...(row?.incidents ?? [])].sort((a, b) =>
    String(a.race_id).localeCompare(String(b.race_id)),
  );
  const counts = { F: 0, L1: 0, K1: 0, S1: 0, S2: 0 };
  const secondFlyingRule = (range?.from ?? "") >= SECOND_FLYING_RULE_FROM;
  let points = 0;
  for (const inc of incidents) {
    if (!(inc.code in counts)) continue;
    counts[inc.code] += 1;
    const final = isFinalStage(inc.stage);
    if (inc.code === "F") {
      points += final ? 30 : 20;
      if (secondFlyingRule && counts.F >= 2) points += final ? 20 : 10;
    } else if (inc.code === "L1") points += final ? 30 : 20;
    else if (inc.code === "S2") points += 15;
    else points += 10; // S1・K1
  }
  // 浮動小数の誤差（0.70 が 0.69999… になる等）を避けるため、百分率の整数で比べる
  const rate = starts > 0 ? Math.floor((points * 100) / starts) / 100 : null;
  const need =
    starts > 0 ? Math.max(0, Math.ceil((71 * starts) / 100) - points) : 0;
  const over = rate !== null && rate > ACCIDENT_RATE_LINE;
  // 「ライン付近」は、次の F・出遅れ1本で超える選手。今期すでにFを切っている選手は、次のFが
  // 2本目以降の加点込みで30点になる（PR #1219 ファン評価2周目: F1の選手が「あと24点」で目印から外れていた）
  const nextFlyingPoints =
    ACCIDENT_NEAR_POINTS + (secondFlyingRule && counts.F >= 1 ? 10 : 0);
  const near = !over && points > 0 && starts > 0 && need <= nextFlyingPoints;
  const status = over ? "over" : near ? "near" : null;
  return {
    starts,
    points,
    rate,
    need,
    counts,
    status,
    settled: starts >= ACCIDENT_BADGE_MIN_STARTS,
    showBadge: status !== null && starts >= ACCIDENT_BADGE_MIN_STARTS,
  };
}
