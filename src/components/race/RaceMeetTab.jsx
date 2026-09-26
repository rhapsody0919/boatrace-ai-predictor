/**
 * RaceMeetTab - レース詳細ページ「今節」タブ（phase a FR-3）
 *
 * ## なぜ独立タブにしたか（2026-09-26、熱血ファン視点の議論の結論）
 *
 * 当初は基本情報タブのバー展開（選手を1人選んでから開く）の中に置いていたが、
 * **中身の主役が「6艇横断」＝レース単位の情報**になった時点で置き場所が合わなくなった。
 *
 * - 勝負駆けは「この6人の中で誰が一番欲しがっているか」でしか読めない。
 *   選手を1人選んでから見るものではなく、レースを開いたら最初に見るもの
 * - バー展開の中に置くと、どの艇を開いても同じ6艇リストが出る（6回同じものを見る）
 * - 基本情報タブの展開部分が836pxまで伸び、主役（データ出走表・バー）と競合していた
 * - ボートレース日和も「今節成績」を独立タブ（モータ情報の隣）に置いている。
 *   同じ位置に置けば、日和から来た読み手の学習コストが無い
 *
 * ## 構成
 *
 * 1. **6艇の今節**（レース単位）: 得点率順に並べ、節内順位・前検順位を添える
 * 2. **選んだ1艇の詳細**（選手単位）: 得点率と早見・ST・前検・展示順位・日別の走り
 *
 * データは `getMeetScoreboard`（節の全選手、+3本）と
 * `getRacerScopedRaceStats`（選んだ選手の走、既存キャッシュ）だけで、
 * 節の全選手分の個別履歴は引かない。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { supabaseDataService } from "../../services/supabaseDataService";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import {
  buildMeetResults,
  buildMeetTrend,
  getRecentRaces,
  MEET_ST_DIFF_THRESHOLD,
  MEET_EXHIBITION_DIFF_THRESHOLD,
} from "./basicInfoStats";
import {
  buildMeetRanking,
  forecastSeriesScore,
  SEMIFINAL_DEFAULT_SLOTS,
  MEET_SMALL_SAMPLE_RUNS,
} from "./seriesPoints";
import RaceHistoryTable from "./RaceHistoryTable";
import "./RaceMeetTab.css";

function RaceMeetTab({ raceId, venueCode, players }) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const sortedPlayers = [...(players ?? [])].sort((a, b) => a.number - b.number);

  const [board, setBoard] = useState(undefined);
  const [records, setRecords] = useState(undefined);
  const [selectedBoat, setSelectedBoat] = useState(
    () => sortedPlayers[0]?.number ?? null,
  );

  useEffect(() => {
    if (!raceId || venueCode === null || venueCode === undefined)
      return undefined;
    let cancelled = false;
    supabaseDataService
      .getMeetScoreboard(raceId, venueCode)
      .then((data) => {
        if (!cancelled) setBoard(data);
      })
      .catch((err) => {
        console.error("今節の取得エラー:", err?.message ?? String(err));
        if (!cancelled) setBoard(null);
      });
    return () => {
      cancelled = true;
    };
  }, [raceId, venueCode]);

  const selectedPlayer =
    sortedPlayers.find((p) => p.number === selectedBoat) ?? sortedPlayers[0];

  useEffect(() => {
    const racerId = selectedPlayer?.racerId;
    if (!racerId) return undefined;
    let cancelled = false;
    // setRecords(undefined) を同期で呼ぶと連鎖レンダーになるため、
    // 取得結果が来たときだけ更新する（切替中は前の選手の表が一瞬残るが、
    // 下のチップで誰を見ているかは分かる）
    supabaseDataService
      .getRacerScopedRaceStats(racerId)
      .then((data) => {
        if (!cancelled) setRecords(data);
      })
      .catch((err) => {
        console.error("今節（選手履歴）の取得エラー:", err?.message);
        if (!cancelled) setRecords(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPlayer?.racerId]);

  if (sortedPlayers.length === 0) return null;

  const ranking = buildMeetRanking(board);
  const slots = board?.semifinalSlots ?? SEMIFINAL_DEFAULT_SLOTS;
  const stage = board?.currentStage ?? "";
  const isAfterPrelim = stage.includes("準優") || stage.includes("優勝戦");
  const pretestOf = (racerId) => board?.pretestByRacer?.[racerId] ?? null;
  // 同率が何人いるか。節の序盤は得点率の刻みが粗く（3走なら0.33刻み）
  // 「11位」が3人並ぶ。順位だけ見せると分解能を過信させる
  const tiedCount = (rank) => ranking.filter((r) => r.rank === rank).length;

  const mine = ranking.find((r) => r.racerId === selectedPlayer?.racerId);
  const border = ranking[slots - 1]?.rate;
  // 表のボーダー表示は「節全体の順位」なので、選んだ選手の走数に依存しない
  const showBorderBadge = !isAfterPrelim && border !== undefined;
  const showBorder =
    !isAfterPrelim && mine && mine.runs >= MEET_SMALL_SAMPLE_RUNS;

  const meet = buildMeetResults(records ?? [], { raceId, venueCode });
  const trend = buildMeetTrend(meet, records ?? []);
  const st = trend.st;
  const ex = trend.exhibition;
  const pre = pretestOf(selectedPlayer?.racerId);
  // 展示タイムが同じなのに順位が動いた場合（6.78→6.78で「1つ下向き」）は、
  // 数字だけ見ると誤植に見える。周りが動いた結果だと書き分ける
  const exSameTime =
    ex.firstTime !== null &&
    ex.lastTime !== null &&
    Math.abs(ex.firstTime - ex.lastTime) < 0.005;

  return (
    <div className="race-meet-tab">
      <p className="rmt-note">{t("meetTab.note")}</p>

      {/* 1. 6艇横断。レースを開いて最初に見るもの */}
      {ranking.length > 0 && (
        <div className="rmt-card">
          <h3 className="rmt-card-title">{t("meetTab.compareTitle")}</h3>
          <table className="rmt-compare">
            <thead>
              <tr>
                <th scope="col">{t("meetTab.colBoat")}</th>
                <th scope="col">{t("meetTab.colScore")}</th>
                <th scope="col">{t("meetTab.colRank")}</th>
                <th scope="col">{t("meetTab.colPretest")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedPlayers
                .map((p) => ({ player: p, row: ranking.find((r) => r.racerId === p.racerId) }))
                .filter((x) => x.row)
                .sort((a, b) => b.row.rate - a.row.rate)
                .map(({ player: p, row }, i, arr) => {
                  const color = BOAT_COLORS[p.number] || {};
                  const tied = tiedCount(row.rank);
                  const pt = pretestOf(p.racerId);
                  const inBorder = showBorderBadge && row.rank <= slots;
                  // 目安内の最後の行に太い罫線を引く。「誰が線の上か」は
                  // 数字を突き合わせないと分からず、実際に読み落とされた
                  const borderEdge =
                    inBorder &&
                    !(arr[i + 1] && arr[i + 1].row.rank <= slots);
                  return (
                    <tr
                      key={p.number}
                      className={[
                        p.number === selectedBoat ? "is-current" : "",
                        // 「目安内」をセル内のバッジで出すと、390pxで
                        // 前検の列が card の外へ押し出されて切れた。
                        // 行の左帯＋点線＋注記に置き換える
                        inBorder ? "is-in-border" : "",
                        borderEdge ? "is-border-edge" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      // 行＝選手なので、行をタップしたら下の詳細が切り替わる。
                      // 下のチップまで指を動かさせない（表は横スクロールしない
                      // ためスワイプ誤爆の懸念も無い）
                      onClick={() => setSelectedBoat(p.number)}
                    >
                      <th scope="row">
                        <button
                          type="button"
                          className="rmt-row-select"
                          onClick={() => setSelectedBoat(p.number)}
                          aria-pressed={p.number === selectedBoat}
                        >
                          <span
                            className="rmt-boat-chip"
                            style={{ background: color.bg, color: color.text }}
                          >
                            {p.number}
                          </span>
                          <span className="rmt-name" translate="no">
                            {p.name?.replace(/\s+/g, "")}
                          </span>
                          {pt?.racer_class && (
                            <span
                              className="rmt-class"
                              title={t("meetTab.classTitle")}
                            >
                              {pt.racer_class}
                            </span>
                          )}
                        </button>
                        {/* 得点率は平均なので「1着→6着」と「3着→3着」が
                            同じ5.00になる。次をどう見るかは並びで変わる */}
                        {row.finishes.length > 0 && (
                          <span className="rmt-finishes">
                            <span className="rmt-finishes-label">
                              {t("meetTab.finishLabel")}
                            </span>
                            {row.finishes.map((f, i2) => (
                              <span key={i2}>
                                {i2 > 0 && t("meetTab.finishSeparator")}
                                {/* 1着だけ強く出す。勝負駆けは「勝ちがあるか」で
                                    見え方が変わり、並びの中で一番探される数字 */}
                                <span className={f === 1 ? "is-win" : undefined}>
                                  {f ?? t("meetTab.finishDq")}
                                </span>
                              </span>
                            ))}
                          </span>
                        )}
                      </th>
                      <td className="rmt-rate">
                        {row.runs < MEET_SMALL_SAMPLE_RUNS && (
                          <span
                            className="rmt-warn"
                            title={t("basicInfo.smallSampleTitle")}
                          >
                            ⚠
                          </span>
                        )}
                        {row.rate.toFixed(2)}
                      </td>
                      <td className="rmt-rank">
                        {tied > 1 ? (
                          <span title={t("meetTab.rankTiedTitle", { tied })}>
                            {t("meetTab.rankTied", { rank: row.rank })}
                          </span>
                        ) : (
                          t("meetTab.rankPlain", { rank: row.rank })
                        )}
                      </td>
                      {/* 前検は「何位か」より「何秒か」で水面を読む数字。
                          順位だけでは会場の出方が分からない */}
                      <td className="rmt-pretest">
                        {pt?.pretest_time !== null &&
                        pt?.pretest_time !== undefined
                          ? pt.pretest_rank
                            ? t("meetTab.pretestCell", {
                                time: Number(pt.pretest_time).toFixed(2),
                                rank: pt.pretest_rank,
                              })
                            : Number(pt.pretest_time).toFixed(2)
                          : pt?.pretest_rank
                            ? t("meetTab.pretestRank", { rank: pt.pretest_rank })
                            : "—"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <p className="rmt-hint">{t("meetTab.rowHint")}</p>
          <p className="rmt-sub">
            {ranking.some((r) => r.runs < MEET_SMALL_SAMPLE_RUNS) && (
              <>{t("meetTab.smallSampleLegend")} </>
            )}
            {t("meetTab.compareSub", { total: ranking.length })}
            {showBorderBadge && (
              <>
                {" "}
                {t("meetTab.borderLine", { slots, rate: border.toFixed(2) })}
                {" "}
                {t("meetTab.borderNote")}
              </>
            )}
          </p>
          <p className="rmt-source">{t("basicInfo.meetPretestSource")}</p>
        </div>
      )}

      {board === undefined && <p className="rmt-loading">{t("basicInfo.loading")}</p>}
      {board !== undefined && ranking.length === 0 && (
        <p className="rmt-empty">{t("basicInfo.meetEmpty")}</p>
      )}

      {/* 2. 選んだ1艇の詳細 */}
      <div
        className="rmt-chip-row"
        role="group"
        aria-label={t("wakuInfo.boatLabel")}
      >
        {sortedPlayers.map((p) => {
          const color = BOAT_COLORS[p.number] || {};
          const active = selectedPlayer?.number === p.number;
          return (
            <button
              key={p.number}
              type="button"
              className={`rmt-select-chip${active ? " is-active" : ""}`}
              style={active ? { background: color.bg, color: color.text } : undefined}
              onClick={() => setSelectedBoat(p.number)}
              aria-pressed={active}
            >
              <span>{p.number}</span>
              <span translate="no">{p.name?.replace(/\s+/g, "")}</span>
            </button>
          );
        })}
      </div>

      <div className="rmt-card">
        {mine && (
          <p className="rmt-detail-score">
            {t("basicInfo.meetScore", {
              rate: mine.rate.toFixed(2),
              n: mine.runs,
            })}
            {showBorder && border !== undefined && (
              <span className="rmt-detail-border">
                {mine.rank <= slots
                  ? t("basicInfo.meetBorderIn", { slots })
                  : t("basicInfo.meetBorder", {
                      slots,
                      rate: border.toFixed(2),
                      diff: (border - mine.rate).toFixed(2),
                    })}
              </span>
            )}
          </p>
        )}
        {mine &&
          (isAfterPrelim ? (
            <p className="rmt-forecast">
              {t("basicInfo.meetScoreNoForecast", { stage })}
            </p>
          ) : (
            // 1行に「1着 3.50 / 2着 3.00 / …」と並べると390pxで折り返し、
            // 着順ごとに縦へ比べられない。着順を列にして畳む
            <div className="rmt-forecast">
              <span className="rmt-forecast-title">
                {t("basicInfo.meetScoreForecastTitle")}
              </span>
              <ul className="rmt-forecast-list">
                {forecastSeriesScore(mine).map((f) => (
                  <li key={f.rank}>
                    {t("basicInfo.meetScoreForecastItem", {
                      rank: f.rank,
                      rate: f.rate.toFixed(2),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          ))}

        {records === undefined ? (
          <p className="rmt-loading">{t("basicInfo.loading")}</p>
        ) : meet.length === 0 ? (
          <p className="rmt-empty">{t("basicInfo.meetEmpty")}</p>
        ) : (
          <>
            <p className="rmt-trend">
              {st.diff !== null && (
                <span>
                  {t("basicInfo.meetTrendSt", {
                    meet: st.meetAvg.toFixed(2),
                    n: st.meetN,
                    base: st.baseAvg === null ? "—" : st.baseAvg.toFixed(2),
                  })}{" "}
                  <span className="rmt-verdict">
                    {st.diff <= -MEET_ST_DIFF_THRESHOLD
                      ? t("basicInfo.meetTrendStPush", {
                          diff: Math.abs(st.diff).toFixed(2),
                        })
                      : st.diff >= MEET_ST_DIFF_THRESHOLD
                        ? t("basicInfo.meetTrendStCareful", {
                            diff: st.diff.toFixed(2),
                          })
                        : t("basicInfo.meetTrendStFlat")}
                  </span>
                </span>
              )}
              {pre?.pretest_time !== null && pre?.pretest_time !== undefined && (
                <span>
                  {t("basicInfo.meetPretest", {
                    time: Number(pre.pretest_time).toFixed(2),
                    rank: pre.pretest_rank ?? "—",
                  })}
                </span>
              )}
              {ex.diff !== null && (
                <span>
                  {t("basicInfo.meetTrendExhibition", {
                    first: ex.first,
                    last: ex.last,
                    firstTime: ex.firstTime === null ? "—" : ex.firstTime.toFixed(2),
                    lastTime: ex.lastTime === null ? "—" : ex.lastTime.toFixed(2),
                    n: ex.n,
                  })}{" "}
                  <span className="rmt-verdict">
                    {ex.diff <= -MEET_EXHIBITION_DIFF_THRESHOLD
                      ? t(
                          exSameTime
                            ? "basicInfo.meetTrendExhibitionUpSameTime"
                            : "basicInfo.meetTrendExhibitionUp",
                          { diff: Math.abs(ex.diff) },
                        )
                      : ex.diff >= MEET_EXHIBITION_DIFF_THRESHOLD
                        ? t(
                            exSameTime
                              ? "basicInfo.meetTrendExhibitionDownSameTime"
                              : "basicInfo.meetTrendExhibitionDown",
                            { diff: ex.diff },
                          )
                        : t("basicInfo.meetTrendExhibitionFlat")}
                  </span>
                </span>
              )}
            </p>
            <RaceHistoryTable
              rows={getRecentRaces(meet, meet.length)}
              showEntryCourse
              compactDate
              omitColumns={["venue", "raceTitle", "grade", "stage"]}
              buildRaceHref={(id) => localize(`/race/${id}`)}
            />
            <details className="rmt-how">
              <summary>{t("basicInfo.conditionsHowToRead")}</summary>
              <p className="rmt-caveat">{t("basicInfo.meetScoreNote")}</p>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

export default RaceMeetTab;
