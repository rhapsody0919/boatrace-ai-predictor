/**
 * 想定内の未公開（BOA-386）: 「朝の最初のレースの、発走60分前のオッズが、まだ公開されていない」を、
 * 監視の警告・窓内取得率の欠落として数えないための、定義の正本。
 *
 * 背景（2026-09-22の実測）: 各会場のその日の第1レースは、発走60分前のオッズ（±3分）の取得率が81.5%（88/108）で、
 * それ以外の90.6%（1,066/1,177）より低い。第1レースは、発売・公開が、60分前の窓の後に始まることがある
 * （最も早く取れた時点の下位10%点は31.1分前）。この未公開は、後の窓（-30・-15…）で公開が確認できれば、
 * 取得の失敗ではなく公式側の公開の遅れである。毎朝の警告（警告疲れ）と、完了の定義B（窓内取得率98%以上）の
 * 食い潰しになるため、次の条件を全て満たすものだけを「想定内」とする（それ以外は従来どおり）。
 *
 *   1. ジョブ odds の offset_min = -60 のスロット
 *   2. その会場・その日の第1レース（races の最小のレース番号。race_id の末尾には依存しない。
 *      確定中止のレースも含めて最小を決める）
 *   3. 最後の結果が no_values（未公開）。試行が0回（未実行）・error・partial は想定内にしない
 *   4. 同じレースの後続の窓（-30・-15・-10・-5・0）のどれかが、実際に取得できている（後で公開されたことの確認）
 *      - まだ結論が出ていない間（後続の窓が、期限+許容幅に達していない）は「保留」（警告も欠落も数えない）
 *      - 後続の窓が全て過ぎても取れていない（または後続の窓が無い）なら、本当に取れていないため、従来どおり警告する
 *
 * このモジュールは、監視（monitor.js）とレポート（scripts/analysis/data-health-report.js）が共有する
 * （二重実装しない）。監視は scrape_slots の状態で、レポートは race_odds の取得時刻で、同じ条件を判定する。
 */

export const EXPECTED_UNPUBLISHED = Object.freeze({
  job: "odds",
  /** 対象の窓（発走の何分後か。負なら発走前） */
  offsetMin: -60,
  /** 対象の結果（未公開） */
  outcome: "no_values",
  /** 「後で公開された」ことの確認に使う、後続の窓のスロットの結果（データが実際に取れた・既に取れていた） */
  confirmingOutcomes: Object.freeze(["ok", "skipped_have_data"]),
});

/**
 * 後続の窓（対象の窓より発走に近い窓）の offset_min の一覧。レジストリのオッズの窓から導く
 * @param {{offsets: number[]}} oddsDef レジストリの odds 定義
 */
export function laterOffsetsOf(oddsDef) {
  return oddsDef.offsets
    .filter((o) => o > EXPECTED_UNPUBLISHED.offsetMin)
    .sort((a, b) => a - b);
}

/**
 * 会場・日ごとの第1レース（races の最小のレース番号）の race_id の集合。
 * race_number が無い行は無視する。確定中止のレースも、最小の決定には含める
 * （第1レースが中止なら、第2レースを第1レースに繰り上げない。中止のレース自体は、別の除外で扱われる）
 *
 * @param {Array<{race_id: string, race_date: string, venue_code: number, race_number: number|null}>} raceRows
 * @returns {Set<string>}
 */
export function firstRaceIdSet(raceRows) {
  const minByVenueDay = new Map();
  for (const row of raceRows) {
    if (typeof row.race_number !== "number") continue;
    const key = `${row.race_date}|${row.venue_code}`;
    const cur = minByVenueDay.get(key);
    if (!cur || row.race_number < cur.race_number) {
      minByVenueDay.set(key, row);
    }
  }
  return new Set([...minByVenueDay.values()].map((r) => r.race_id));
}

// ---------------------------------------------------------------------------
// SQL（data-health-report.js の窓内取得率のクエリに埋め込む。レースのエイリアス b・発走時刻の式 dl が前提）
// ---------------------------------------------------------------------------

/**
 * 「その会場・その日の第1レース」のSQLの式（races の最小のレース番号。確定中止も含めて最小を決める）
 * @param {string} alias レース（race_date・venue_code・race_number を持つ）のエイリアス
 */
export function firstRaceSql(alias) {
  return `not exists (select 1 from races fr where fr.race_date = ${alias}.race_date and fr.venue_code = ${alias}.venue_code and fr.race_number < ${alias}.race_number)`;
}

/**
 * 「対象の窓より後の、後続の窓のどれかに、オッズが取得できている」のSQLの式
 * （監視の「後続の窓のスロットが done（ok・skipped_have_data）」に対応する。取得できた窓は、
 * 窓の中心（発走の m 分前）±toleranceMin 分に captured_at が入るもの）
 *
 * @param {{raceIdExpr: string, deadlineExpr: string, laterMinutesBefore: number[], toleranceMin: number}} p
 */
export function laterWindowHitSql({
  raceIdExpr,
  deadlineExpr,
  laterMinutesBefore,
  toleranceMin,
}) {
  const windows = laterMinutesBefore
    .map(
      (m) =>
        `o2.captured_at between ${deadlineExpr} - make_interval(mins => ${m + toleranceMin}) and ${deadlineExpr} - make_interval(mins => ${m - toleranceMin})`,
    )
    .join(" or ");
  return `exists (select 1 from race_odds o2 where o2.race_id = ${raceIdExpr} and (${windows}))`;
}
