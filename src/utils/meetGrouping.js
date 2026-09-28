/**
 * meetGrouping - 節（開催）のグルーピング共通ロジック
 *
 * 節の範囲はrace_idの日付部分の連続性で推定する（モーターは節単位で入れ替わる
 * ため、日付が連続していれば同じ節とみなせる）。racerService.jsのモーター使用
 * 履歴（BOA-265）で最初に実装したロジックを、BOA-304の「今節展示情報」でも
 * 再利用するため共通関数として抜き出した。
 *
 * ## race_conditions.series_day / is_final_day に切り替えない理由
 *
 * 実装当時（2026-09-15）はこの2列が全件nullだったため推定するしかなかったが、
 * **この前提はもう成り立たない**。BOA-226（`update-race-info.js` の
 * `scrapeSeriesDay()`）とBOA-390のバックフィルで、2026-02-01以降
 * **36,607 / 36,629行＝99.94%**が埋まっている（2026-09-28実測。全体では
 * 36,607 / 36,641行＝99.91%）。
 *
 * それでも切り替えない。2026-09-28に本番DBで実測した結果が現状維持を指す。
 *
 * 1. **取得が済むまでnullで、進行中の節を判定できない**。上の残り22行は**すべて
 *    実行日（2026-09-28）の行**で、series_dayはracelistの日程タブから取るため
 *    当日のスクレイプが済むまで入らない（同じ日の測定中にも24行→22行へ減った）。この関数の主な呼び出し元
 *    （`basicInfoStats.buildMeetResults`）は**表示中のレース＝多くは当日**を
 *    アンカーに呼ばれるので、series_dayを主にすると一番使われる経路で判定できない
 * 2. **series_dayは連続日でも1ずつ増えない**。2026-02以降に、暦日が連続している
 *    のにseries_dayの増分が1でない境界が**6箇所**ある（2026-09の津 2→2 / 6→8、
 *    戸田 4→4 / 5→7、江戸川 4→4 / 4→6）。中止順延によるもので、飛ぶ場合と
 *    同じ値で止まる場合の両方が実在する。同値の3箇所は**前後に同じ43〜47人が
 *    出走している**（1節の出場は約48人）ので、顔ぶれが入れ替わっていない＝
 *    節は続いていると分かる。
 *    したがって「series_day == 前日+1 なら同じ節」型の実装はここを切れ目と誤り、
 *    「series_day <= 前日なら新しい節」型は同値の3箇所を誤る。日付の連続性なら
 *    どちらも正しく同じ節として扱える
 * 3. **一致率が100%**。この関数が実際に使われる形で、推定した節とseries_day由来の
 *    正解を突き合わせると**不一致0件**（2026-02以降。判定できないアンカーは除外）
 * 4. **推定が誤る境界に選手が当たらない**。推定が誤りうるのは「節と節の間が
 *    2日以内で2節を繋げてしまう」場合で、2026-02以降に12箇所ある。この12箇所を
 *    **全選手で網羅確認しても、前の節と次の節の両方に出走した選手は0人**だった。
 *    斡旋の間隔として中1〜2日は短すぎるため、同じ会場で連続する2節に同じ選手が
 *    入ることが無い
 *
 *    ただし**「選手は隣接2節に連続出場しない」とまでは言えない**。日数ギャップが
 *    4日あった2026-06-04の江戸川では、前節（05-25〜05-31）と次節（06-04〜）の
 *    両方に出た選手が実在する（選手3653）。この場合は推定が正しく切るので問題に
 *    ならない。当たらないのは**ギャップが2日以内の境界に限った話**
 * 5. **過去側にそもそも行が無い**。`race_conditions` は2025-12が12行・**2026-01が
 *    0行**（`races` は同期間に9,876行ある。
 *    [BOA-498](https://linear.app/boat-ai/issue/BOA-498)）。selectしても
 *    選手の窓の前半は判定材料が無い
 *
 * ### ハイブリッド（series_day主・日付連続性フォールバック）にもしない
 *
 * `scripts/lib/meetBoundaries.js` の `buildMeets()`（BOA-457）が既にその形を
 * 採っているので、同じ形にすれば5は解消する。それでもこちらは採らない。
 * 1のとおり**当日＝主な経路では必ずフォールバック側に落ちる**ため、コードパスを
 * 1本増やして結果は今と同じになる。2の中止順延も、series_day側に
 * 「増分が1でなくても増えていれば同じ節」「同じ値なら順延」といった規則を
 * 足さないと正しく扱えない。`buildMeets()` はscripts側で全期間の全節を列挙する
 * 用途で、当日を含まず、節の境目を跨いだ列挙が目的なので事情が違う。
 *
 * この不変条件は `scripts/maintenance/verify-meet-grouping.js`（tier=manual）が守る。
 *
 * ## 「1選手分に絞って呼ぶ」ことが安全性の前提
 *
 * 上の4が示すとおり、この推定が安全なのは**入力が1選手分に絞られているから**。
 * 呼び出し元3つの絞り方はそれぞれ違う。
 *
 *   - `basicInfoStats.buildMeetResults`: 選手＋**会場**＋表示中レースの目印
 *   - `racerService.getCurrentMeetRaceEntries`: 選手＋**モーター番号**＋直近30走
 *   - `getRacerMeetExhibitionTrendBefore`: 同じ＋表示中レースより前
 *
 * 後者2つは会場ではなくモーター番号で絞る（モーターは会場固有なので実質的に
 * 会場フィルタとして働く）。一致率を実測したのは1つ目の形。
 *
 * これを**会場の全日付に当てると壊れる**。中1日の開催休みで前の節が丸ごと混ざる。
 * `supabaseDataService.getMeetScoreboard` が、この関数を呼ぶ代わりに**同じ
 * ヒューリスティックのインラインな複製**を持っていて、実際にそれで壊れている
 * （[BOA-491](https://linear.app/boat-ai/issue/BOA-491)、2026-09-28 戸田8Rで
 * 節内順位が全員「対象外」になった）。**会場単位で節を切る用途にこの推定を
 * 使ってはいけない**。そちらはseries_dayを使うのが正しい（当日を含む節を扱うが、
 * 節の開始日を求めるだけなら当日のnullは問題にならない）。
 */

/**
 * race_id昇順ソート済みの配列を受け取り、末尾（最新）から遡って日付の間隔が
 * maxGapDays以下の連続区間のみを1節として抜き出す
 * @param {Array<{race_id: string}>} sortedAscEntries - race_id（YYYY-MM-DD-VV-RR）昇順ソート済み
 * @param {number} maxGapDays - この日数を超えて空いたら別節とみなす
 * @returns {Array} 抜き出した節（昇順のまま）
 */
export function groupIntoCurrentMeet(sortedAscEntries, maxGapDays = 2) {
  if (!sortedAscEntries || sortedAscEntries.length === 0) return [];
  const meet = [sortedAscEntries[sortedAscEntries.length - 1]];
  for (let i = sortedAscEntries.length - 2; i >= 0; i--) {
    const currentDate = new Date(meet[0].race_id.slice(0, 10));
    const prevDate = new Date(sortedAscEntries[i].race_id.slice(0, 10));
    const diffDays = (currentDate - prevDate) / (1000 * 60 * 60 * 24);
    if (diffDays > maxGapDays) break;
    meet.unshift(sortedAscEntries[i]);
  }
  return meet;
}

/**
 * `series_day` から「表示中の日を含む節の初日」を求める（純関数、BOA-508）。
 *
 * 上の `groupIntoCurrentMeet` は**1選手分**に絞って使う前提のヒューリスティックで、
 * **会場の全日付に当てると壊れる**（中1日の開催休みで前の節が丸ごと混ざる）。
 * 会場単位で節を切るときはこちらを使う。
 *
 * ## 切り方（`verify-meet-grouping.js` が「正解」としているものと同じ規則）
 *
 * 開催日を昇順に見て、次のどれかで新しい節が始まったとみなす。
 *
 *   - `series_day === 1`      … 節の初日
 *   - `series_day < 直前の値`  … 初日の行が無いだけ（`series_day=2` から始まる実例がある）
 *   - 前の開催日から**2日以上空いた** … `series_day` が無い期間（2026-02より前）の保険
 *
 * 逆に**同じ値の連続（4→4）と飛び（5→7）は同じ節の続き**として扱う。中止順延で
 * 実際に起きる（2026-09に同値3箇所・飛びの実例あり）。ここを厳しくすると節の
 * 途中で切れる。
 *
 * ## 日付だけで切ってはいけない
 *
 * 節と節の間が中1日空くと、連続する開催日の差が2日になる。旧実装は
 * 「2日を**超えたら**別の節」だったため1日の休みを跨いでしまい、前の節が丸ごと
 * 混ざっていた（BOA-491: 2026-09-28 戸田8Rで節内順位が6艇とも「対象外」になり、
 * 出場人数・準優の目安・必要得点が前の節の値になった）。
 * 実測では中1日の休み12箇所が**すべて**節の境目（前日が `is_final_day`）で、
 * 節の中に休みが入る例は0件だった。
 *
 * @param {Array<{date: string, seriesDay: number|null}>} days 会場の開催日
 * @param {string} targetDate 表示中のレースの日（`YYYY-MM-DD`）
 * @returns {string|null} 節の初日。`days` が空なら null
 */
export function findMeetStartDate(days, targetDate) {
  if (!Array.isArray(days) || days.length === 0) return null;
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));

  let meetStart = sorted[0].date;
  let prevSeriesDay = null;
  let prevDate = null;
  let answer = null;

  for (const d of sorted) {
    const gapDays =
      prevDate === null
        ? 0
        : (new Date(`${d.date}T00:00:00Z`) - new Date(`${prevDate}T00:00:00Z`)) /
          86400000;
    const startsByGap = prevDate !== null && gapDays >= 2;
    const startsBySeriesDay =
      d.seriesDay != null &&
      (d.seriesDay === 1 ||
        (prevSeriesDay != null && d.seriesDay < prevSeriesDay));
    if (startsByGap || startsBySeriesDay) meetStart = d.date;
    // 表示日以前で最後に見た節の初日が答え。表示日の行が無くても遡れる
    if (d.date <= targetDate) answer = meetStart;
    // 当日の `series_day` は取得前で null のことがある。null は「続き」とみなす
    if (d.seriesDay != null) prevSeriesDay = d.seriesDay;
    prevDate = d.date;
  }
  return answer ?? meetStart;
}
