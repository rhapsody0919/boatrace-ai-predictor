/**
 * digestMetrics - 「本日のデータ一覧」（BOA-402）の指標計算（純関数）
 *
 * 設計: docs/design/morning-data-digest/plan.md §2.2 / docs/adr/0071-venue-adjusted-skill-delta.md
 *
 * 中核の考え方（ADR-0071）:
 *   選手の実績率をそのまま見ても意味がない。会場によって逃げ率は20.3pt開き
 *   （尼崎59.2%〜戸田38.9%）、グレードによっても11.1pt開く（G1 62.2%〜G3 51.1%）。
 *   そこで「その選手が実際に走った会場・グレードの構成で、リーグ平均の選手が
 *   出したはずの率」を期待値とし、実績率との差を **地力（skillDelta）** とする。
 *   本日のレースでの予測は、本日の会場・グレードのベースラインに地力を足し戻す。
 *
 *   ⚠️ 「実績率 − 本日の会場平均」という素朴な差分は使わない。選手の実績率は
 *   過去の全会場を混ぜた値なので、本日の1会場と引き算すると会場構成の偏りが
 *   地力に化ける。実測では符号が反転する例まであった（横川聖志の3コース:
 *   正 −14.0pt / 誤 −0.8pt）。ADR-0071 却下1。
 *
 * 単位の規約:
 *   このモジュールの rate / expected / baseline / delta はすべて **パーセント（0〜100）**。
 *   DBの NUMERIC(5,2) 列と単位を揃えるため。
 *   一方 wilson.js は分数（0〜1）を扱うので、境界で変換する。
 */

import {
  wilsonLowerBound,
  wilsonLowerBoundFromRate,
  isSmallSample,
} from "./wilson.js";

/**
 * 各指標の抽出閾値（パーセント）。小標本フラグの比較対象でもある。
 * **この定数はここ1箇所にだけ置く。** 決まり手の表示名が
 * scripts/lib/winningTechniques.js と src/utils/turnPrediction.js に
 * 二重定義されている先例を繰り返さない。
 */
export const EXTRACTION_THRESHOLDS = {
  nige: 70, // 逃げ率70%以上（競合と同じ土俵で比較されるため絶対閾値を維持）
  makuri: 25, // まくり率25%以上（同上）
  // 逃がしは絶対閾値に選別力が無いため「地力が閾値pt以上」で抽出する。値の単位は pt。
  // 直近14日の日次該当件数の実測（2026-09-24、投入済みテーブルで計測）:
  //   +15pt→平均51.4件 / +20pt→17.8件 / +21pt→13.1件 / **+22pt→9.8件（5〜17）** /
  //   +23pt→8.1件 / +25pt→4.6件（0件の日あり）
  // 目標は5〜15件/日。+22pt が最小5件で空の日が無く、平均も目標帯に収まる
  nigashi: 22,
};

/**
 * 各指標の全国ベースレート（パーセント、2026-09-24 本番実測）。
 * 表示の文脈（「全国平均は◯%」）に使う。**小標本フラグの判定には使わない**
 * （まくりで逆に働くため。wilson.js のコメント参照）。
 */
export const NATIONAL_BASE_RATES = {
  nige: 52.98, // 1コース進入走のうち逃げ決着（n=43,643）
  nigashi: 52.98, // 定義上、逃げ率と同値（各レースに各コースが1艇ずつ存在するため）
  makuriByCourse: { 2: 3.76, 3: 5.08, 4: 4.92, 5: 1.25, 6: 0.62 },
};

/** 抽出の最低母数（地力窓） */
export const MIN_RUNS = 10;

/** ベースラインのセルを採用する最低母数。未満なら race_grade='ALL' 行へフォールバックする */
export const MIN_BASELINE_RUNS = 100;

/** 調子窓（直近90日）でこの母数未満なら率を表示せず走数だけ出す */
export const MIN_RUNS_90D = 5;

/**
 * 小標本フラグの母数の閾値。これ未満なら「母数が少ない」と明示する。
 *
 * ⚠️ 当初は「Wilson95%下限 < 指標のベースレート」、次に独立レビューの指摘H-3を受けて
 * 「Wilson95%下限 < 抽出閾値」としていたが、**どちらも実データで判別力を持たなかった**
 * （2026-09-24 本番実測）。
 *   - まくり: 27行中 **27行（100%）** がフラグ。Wilson95%下限の最大が24.6%で、
 *     1行も閾値25%を上回れない。母数が小さいからではなく（n<20は22%だけ）、
 *     n=16〜40 の範囲では25〜40%の率を「25%超」と証明できないため
 *   - 逃げ: 216行中 193行（89.4%）がフラグ
 * 9割の行に立つフラグは信号にならない。**二値の信頼区間検定をやめ、
 * 「母数が少ない」という直接の事実で判定し、確からしさは下限値そのもので見せる。**
 */
export const MIN_RELIABLE_RUNS = 20;

/**
 * 地力 = 実績率 − 期待値。
 * @param {{rate: number, expected: number}} p いずれもパーセント
 * @returns {number} パーセントポイント
 */
export function computeSkillDelta({ rate, expected }) {
  assertPercent(rate, "rate");
  assertPercent(expected, "expected");
  return round1(rate - expected);
}

/**
 * 本日の会場・グレードでの予測率 = ベースライン + 地力。
 *
 * 加法モデルなので理論上0〜100を外れうる。初版は [0, 100] にクランプし、
 * クランプしたかどうかを呼び出し側に返す（発生率を本番で観測してから
 * ロジット尺度への変更を判断するため。ADR-0071 影響節）。
 *
 * @param {{venueBaseline: number, skillDelta: number}} p
 * @returns {{value: number, clamped: boolean}}
 */
export function computePredicted({ venueBaseline, skillDelta }) {
  assertPercent(venueBaseline, "venueBaseline");
  const raw = venueBaseline + skillDelta;
  const value = Math.min(100, Math.max(0, raw));
  return { value: round1(value), clamped: raw !== value };
}

/**
 * 逸脱のzスコア。「期待値から何σ離れているか」。
 *
 * 「今日の注目レース」の選定で指標をまたいで比較するために使う（plan.md §3.3）。
 * **地力（pt）のまま横断比較してはいけない**: 逃げのベースレートは約53%、
 * まくりは約4%で、同じ+33ptでも統計的な意味がまったく違う。実測では
 * pt比較にすると上位5件中4件が逃げになり、「実績と当日条件が一致している
 * レース」という選定意図が機能しなかった（レビュー指摘C-1）。
 *
 * @param {{rate: number, expected: number, n: number}} p rate/expected はパーセント
 * @returns {number|null} n<=0、または expected が0か100のときは null
 */
export function computeZScore({ rate, expected, n }) {
  assertPercent(rate, "rate");
  assertPercent(expected, "expected");
  if (!Number.isFinite(n) || n <= 0) return null;

  const p = expected / 100;
  if (p <= 0 || p >= 1) return null;

  const se = Math.sqrt((p * (1 - p)) / n);
  if (se === 0) return null;
  return round2(rate / 100 / se - p / se);
}

/**
 * 「今日の注目レース」の方向一致度。
 *
 * 逃げは「イン有利」方向なのでイン崩れ指数が低いほど一致、まくり・逃がしは
 * 「イン不利」方向なので高いほど一致する。
 *
 * @param {"nige"|"makuri"|"nigashi"} metric
 * @param {number} volatilityPercentile イン崩れ指数（**0〜100**。情報源の
 *   predictions.feature_contributions.volatilityPercentile は0〜1なので、
 *   呼び出し側が×100してから渡す）
 * @returns {number|null} 0〜1。volatilityPercentile が無ければ null（候補から外す）
 */
export function computeConsistency(metric, volatilityPercentile) {
  if (!Number.isFinite(volatilityPercentile)) return null;
  assertPercent(volatilityPercentile, "volatilityPercentile");
  const v = volatilityPercentile / 100;
  return metric === "nige" ? 1 - v : v;
}

/**
 * 「今日の注目レース」のスコア。大きいほど注目度が高い。
 * @returns {number|null}
 */
export function computeFeaturedScore({
  metric,
  rate,
  expected,
  n,
  volatilityPercentile,
}) {
  const z = computeZScore({ rate, expected, n });
  const consistency = computeConsistency(metric, volatilityPercentile);
  if (z === null || consistency === null) return null;
  return round2(z * consistency);
}

/**
 * 小標本フラグ。**母数そのもの**で判定する（信頼区間検定ではない。MIN_RELIABLE_RUNS のコメント参照）。
 * @param {number} n 地力窓の母数
 * @returns {boolean}
 */
export function isSmallSampleByRuns(n) {
  return !Number.isFinite(n) || n < MIN_RELIABLE_RUNS;
}

/**
 * その率が統計的に抽出閾値を上回っていると言えるか（Wilson95%下限が閾値を超えるか）。
 *
 * 実測では逃げの10.6%・まくりの0%しか満たさないため、**警告ではなく「確度が高い」側の
 * 任意の目印**として使う想定。初版のUIでは使わない。
 *
 * @param {"nige"|"makuri"} metric
 * @param {number} rate パーセント
 * @param {number} n
 */
export function clearsThresholdWithConfidence(metric, rate, n) {
  const threshold = EXTRACTION_THRESHOLDS[metric];
  if (!Number.isFinite(threshold)) {
    throw new Error(`clearsThresholdWithConfidence: 未知の指標 ${metric}`);
  }
  // 率を整数の成功数に丸め戻さない。n=8・率70% を round(5.6)=6 にすると
  // p̂ が 0.75 にずれて下限が0.409（正しくは0.366）になる
  return !isSmallSample((rate / 100) * n, n, threshold / 100);
}

/** Wilson下限をパーセントで返す（表示用） */
export function wilsonLowerPercent(rate, n) {
  const lower = wilsonLowerBoundFromRate(rate / 100, n);
  return lower === null ? null : round1(lower * 100);
}

/** 成功数の整数が手元にある場合のWilson下限（パーセント）。バッチ側はこちらを使う */
export function wilsonLowerPercentFromCount(successes, n) {
  const lower = wilsonLowerBound(successes, n);
  return lower === null ? null : round1(lower * 100);
}

/**
 * 選手名の表記ゆれを正規化する。
 *
 * race_entries.player_name は公式の固定幅表記で全角スペースが詰められている
 * （例: 姓と名の間に全角スペースが2つ入る）。そのまま morning_digest_rows.racer_name に
 * 入れるとページとSNS本文で不自然に見えるため、連続する空白を全角スペース1つにまとめる。
 * 姓名の区切り自体は残す（詰めてしまうと読みにくいため）。
 *
 * 全角スペースはソースに直接書かない（eslint no-irregular-whitespace。エスケープで書いても
 * フォーマッタが実体に戻すため、文字コードから組み立てる）。JavaScript の `\s` は仕様上
 * U+3000 を含むので、正規表現側は `\s` だけでよい。
 */
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);

export function normalizeRacerName(name) {
  if (typeof name !== "string") return name;
  return name.replace(/\s+/g, IDEOGRAPHIC_SPACE).trim();
}

function assertPercent(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(
      `${label} は0〜100のパーセントである必要があります: ${value}`,
    );
  }
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
