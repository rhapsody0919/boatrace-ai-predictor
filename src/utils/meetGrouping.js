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
 * `scrapeSeriesDay()`）とBOA-390のバックフィルで、2026-02以降は100%、全体で
 * 99.8%が埋まっている（2026-09-28実測、36,641行）。
 *
 * それでも切り替えない。2026-09-28に本番DBで実測した結果が3つとも現状維持を指す。
 *
 * 1. **一致率が100%**。この関数が実際に使われる形（選手1人・会場1つに絞った
 *    出走履歴）で、推定した節と `series_day` 由来の正解を突き合わせると、
 *    **40,048アンカー中の不一致0件**（2026-02以降。判定できない862件＝データ
 *    開始境界で節の先頭に遡れないものは除外）
 * 2. **推定が誤る境界に選手が当たらない**。推定が誤りうるのは「節と節の間が中1日
 *    （境界の日数ギャップが2日）で2節を繋げてしまう」場合だけで、2026-02以降に
 *    12箇所ある。この12箇所すべてを**全選手で網羅確認しても、前の節と次の節の
 *    両方に出走した選手は0人**だった。斡旋の間隔として中1日は短すぎるため、
 *    同じ会場で連続する2節に同じ選手が入ることが無い
 *
 *    ただし**「選手は隣接2節に連続出場しない」とまでは言えない**。日数ギャップが
 *    4日あった2026-06-04の江戸川では、前節（05-25〜05-31）と次節（06-04〜）の
 *    両方に出た選手が実在する（選手3653）。この場合は推定が正しく切るので問題に
 *    ならない。当たらないのは**ギャップが2日の境界に限った話**
 * 3. **切り替えると過去側が死ぬ**。`race_conditions` は2025-12が12行・**2026-01が
 *    0行**で、この2ヶ月はそもそも行が無い（`races` は同期間に9,876行ある。
 *    [BOA-498](https://linear.app/boat-ai/issue/BOA-498)）。選手の過去2年窓の
 *    前半が丸ごと判定不能になる。日付の連続性なら動く。
 *    `series_day` 側にも穴がある: 2026-06-04の江戸川・蒲郡は `series_day=2` から
 *    始まっていて、節の初日の行が `races` ごと欠けている。`series_day=1` を節の
 *    先頭とみなす実装は、この手の欠落で節の先頭に遡れなくなる
 *
 * 加えて、呼び出し元のうち `racerService.getCurrentMeetRaceEntries` と
 * `getRacerMeetExhibitionTrendBefore` は `race_conditions` を引いていないため、
 * 切り替えるとクエリが増える。
 *
 * この不変条件は `scripts/maintenance/verify-meet-grouping.js`（tier=manual）が守る。
 *
 * ## 「選手1人分に絞って呼ぶ」ことが安全性の前提
 *
 * 上の2が示すとおり、この推定が安全なのは**入力が1選手分に絞られているから**。
 * 同じ推定を会場の全日付に当てると、中1日の開催休みで前の節が丸ごと混ざる。
 * 実際に `supabaseDataService.getMeetScoreboard` が会場の全日付で節を切っていて
 * 壊れている（[BOA-491](https://linear.app/boat-ai/issue/BOA-491)、2026-09-28
 * 戸田8Rで節内順位が全員「対象外」になった）。**会場単位で節を切る用途に
 * この関数を流用してはいけない**。そちらは `series_day` を使うのが正しい。
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
