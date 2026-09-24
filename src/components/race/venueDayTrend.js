/**
 * 「この日の水面傾向」の1行要約を組み立てる純関数（phase a FR-5 / T4-4）
 *
 * 設計: docs/design/analysis-visualization-upgrade/screens.md §3.5
 *
 * ## 二値判定（傾向どおり／傾向から外れた1本）にしない理由
 *
 * 2026-09-24の実装前レビューを受けて実データで測り直した結果、初版の
 * 「その日の最頻の決まり手と一致すれば傾向どおり、違えば傾向から外れた1本」
 * という判定は次の3点で成立しないと分かったため、**回数を並べる形**にした。
 *
 * - 直近90日1,200 venue-day・14,309レースの実測で、最頻の決まり手と一致する
 *   レースは56.5%。つまり**43.5%に「傾向から外れた」が付く**。しかも最頻以外も
 *   複数本あるのが普通なので「1本」が虚偽になる（桐生2026-09-23は逃げ6・
 *   まくり4・差し2で、まくりの回は「外れた1本」だが実際は4本目）
 * - **首位が同数タイの日が8.3%**（3値以上タイ1.2%）。`techniqueCounts` は
 *   挿入順に依存し、`fetchAllByIn` は `.order()` を付けないため行順が未規定で、
 *   判定が実行ごとに反転しうる
 * - 当日の午前は確定レースが1〜3本しかない会場が多く、二値の断定が無意味になる
 *   （回数を出す形なら n=2 でも「確定2Rで まくり1・まくり差し1」と事実しか
 *   言わない）
 *
 * ## 1着艇の実進入コースは当日出せない
 *
 * `actual_course_*` のバックフィルは会場×日単位でオール・オア・ナッシングに
 * 入るため、**当日のレースは100%NULL**（2026-09-24実測: 当日の有効34レースで
 * 充足0.0%、前日・前々日は100.0%）。結果タブを最も見るのは当日なので、
 * コース抜きで文が成立する形にしてある。`courseOfBoat()` のように艇番を
 * 暫定コースとみなす代替はしない（「3コースまくり」と誤って断定する）。
 */

/**
 * 1行要約には**その日に出た決まり手をすべて**並べる。
 *
 * 当初は上位3件で打ち切っていたが、実測（直近90日1,201 venue-day）で
 * **4種類以上の日が76.2%**（種類数の分布: 1種類1日 / 2種類37 / 3種類248 /
 * 4種類535 / 5種類356 / 6種類24）あり、平均1.63レース分・最大4レース分が
 * 黙って落ちて「確定12Rの決まり手は 逃げ4・差し3・まくり2」＝合計9 という
 * 不整合になっていた（しかも折りたたみを開くと全種類のバッジが出るので、
 * 同じカードの中で数字が食い違って見える）。決まり手は全6種類
 * （逃げ / 差し / まくり / まくり差し / 抜き / 恵まれ）しか無く、
 * 並べても1〜2行に収まるため打ち切らない。
 */

/**
 * 決まり手別回数を多い順に並べる。
 *
 * @param {Object} techniqueCounts `getVenueDaySummary` の戻り値
 * @returns {Array<{technique: string, count: number}>} 多い順
 */
export function sortTechniqueCounts(techniqueCounts) {
  return Object.entries(techniqueCounts ?? {})
    .map(([technique, count]) => ({ technique, count }))
    .sort(
      (a, b) => b.count - a.count || a.technique.localeCompare(b.technique),
    );
}

/**
 * 当該レースの決まり手が、その日の同じ決まり手の何本目かを求める。
 *
 * `byRace` は race_id をキーに持つので、当該レースより前のレース（race_id が
 * 辞書順で小さい＝レース番号が小さい）のうち同じ決まり手の件数 + 1 を返す。
 * race_id は `YYYY-MM-DD-VV-RR` の固定長なので辞書順＝レース番号順になる。
 *
 * @param {Object} byRace `getVenueDaySummary().byRace`
 * @param {string} raceId 当該レース
 * @returns {number|null} 1始まりの順番。決まり手が取れない場合はnull
 */
export function techniqueOrdinal(byRace, raceId) {
  const self = byRace?.[raceId];
  if (!self?.winningTechnique) return null;
  let ordinal = 1;
  for (const [id, row] of Object.entries(byRace)) {
    if (id >= raceId) continue;
    if (row?.winningTechnique === self.winningTechnique) ordinal += 1;
  }
  return ordinal;
}

/**
 * 1行要約に必要な素材を組み立てる（文字列の組み立ては i18n 側で行う）。
 *
 * @param {Object} summary `getVenueDaySummary` の戻り値
 * @param {string|null} raceId 当該レース。null なら「このレース」の節を出さない
 * @returns {{
 *   raceCount: number,
 *   nigeRate: number|null,
 *   techniques: Array<{technique: string, count: number}>,
 *   thisRace: {technique: string, course: number|null, ordinal: number}|null
 * }}
 */
export function buildDayTrend(summary, raceId = null) {
  const raceCount = summary?.raceCount ?? 0;
  const techniques = sortTechniqueCounts(summary?.techniqueCounts);

  let thisRace = null;
  if (raceId) {
    const row = summary?.byRace?.[raceId];
    const ordinal = techniqueOrdinal(summary?.byRace, raceId);
    if (row?.winningTechnique && ordinal !== null) {
      thisRace = {
        technique: row.winningTechnique,
        // 当日・未バックフィル日はnull。呼び出し側はコースを省いた文にする
        course: row.winnerCourse ?? null,
        ordinal,
      };
    }
  }

  // 決まり手が判明しているレース数。確定レース数と一致しないことがある
  // （当日は結果が入った直後に決まり手だけ遅れて埋まる。2026-09-24実測で
  // 当日の充足率91.2%、前日以前は約100%）。一致しないまま
  // 「確定3Rの決まり手は まくり1・逃げ1」と出すと合計が合わず読み手が混乱するため、
  // 呼び出し側が文を出し分けられるように両方返す
  const techniqueTotal = Object.values(summary?.techniqueCounts ?? {}).reduce(
    (acc, n) => acc + n,
    0,
  );

  return {
    raceCount,
    techniqueTotal,
    nigeRate: summary?.nigeRate ?? null,
    techniques,
    thisRace,
  };
}
