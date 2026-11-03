/**
 * EntryCourseDistributionCard - 直前情報タブ「この枠からの進入コース」（BOA-485）
 *
 * 旧「平均進入順」の行（全枠を混ぜた平均。1号艇でも3.16になる）を置き換える。
 * 艇ごとに「今回と同じ枠番で出たとき、本番で何コースに入ったか」を1本の横棒で
 * 出し、右に枠なり%・前づけ%・走数を添える。6艇×セルに棒を詰めると375pxで
 * 読めないため、表の行ではなく表の下のカードにする（ユーザー承認の案A、2026-09-28）。
 *
 * データは直前情報タブが既に取得している getRacerScopedRaceStats の生データを
 * 集計し直すだけで、追加のクエリは無い（BOA-357）。
 *
 * イン屋の札（2026-11-03、docs/design/inya-racer/）: このレースより前の1年の4〜6号艇の走で判定
 * （src/utils/frontTaking.js）。「イン屋」はファンの呼び名で対訳が無いので ja だけに出す。
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import {
  computeFrameEntryDistribution,
  SMALL_SAMPLE_THRESHOLD,
} from "./basicInfoStats";
import InlineFetchError from "../InlineFetchError";
import TermHintButton from "./TermHintButton";
import { computeFrontTaking } from "../../utils/frontTaking";
import "./EntryCourseDistributionCard.css";

// 前づけ%を目立たせる下限。これ未満は「たまに動く」程度として通常表示にする
const MOVED_IN_EMPHASIS_RATE = 10;
// 棒の中にコース番号を書く最小幅（%）。狭い区間に数字を詰めると潰れる
const SEGMENT_LABEL_MIN_RATE = 12;

function EntryCourseDistributionCard({
  raceId,
  players,
  statsByRacer,
  failed,
  onRetry,
}) {
  const { t, i18n } = useTranslation();
  // ja だけ。レースの日を「今日」として、このレースより前の走で判定する（過去のレースでも当時の判定）
  const isJa = i18n.language === "ja";
  const inyaBoats = useMemo(
    () =>
      new Set(
        isJa && /^\d{4}-\d{2}-\d{2}-/.test(raceId ?? "")
          ? players
              .filter((p) => {
                const records = p.racerId ? statsByRacer[p.racerId] : null;
                return (
                  Array.isArray(records) &&
                  computeFrontTaking(records, {
                    today: raceId.slice(0, 10),
                    beforeRaceId: raceId,
                  }).status === "inya"
                );
              })
              .map((p) => p.number)
          : [],
      ),
    [isJa, raceId, players, statsByRacer],
  );

  return (
    <section className="rbi-card ecd-card" data-testid="entry-course-dist">
      <h3 className="rbi-heading">
        {t("beforeInfo.entryDistTitle")}
        <TermHintButton termKey="entryCourseDistribution" />
      </h3>
      <p className="ecd-note">{t("beforeInfo.entryDistNote")}</p>
      {inyaBoats.size > 0 && (
        <p
          className="ecd-inya-legend"
          data-testid="entry-course-dist-inya-legend"
        >
          <span className="ecd-inya">イン屋</span>
          <span>
            4〜6号艇で出ても、前付けで1〜3コースを取りに行く選手（ファンの呼び名）。直近1年の4〜6号艇の走で判定。詳しくは選手ページ
          </span>
        </p>
      )}
      {failed && <InlineFetchError onRetry={onRetry} />}
      <ul className="ecd-list">
        {players.map((p) => {
          const color = BOAT_COLORS[p.number] || {};
          const records = p.racerId ? statsByRacer[p.racerId] : null;
          // 艇ごとの状態だけで決める（undefined＝取得中 / null＝失敗 / 配列＝取得済み）。
          // レース単位の failed を混ぜると、1艇が先に失敗しただけで取得中の他艇まで
          // 「—」になり、失敗・データなしと見分けがつかなくなる（/code-review 指摘）
          const loading = Boolean(p.racerId) && records === undefined;
          const dist = records
            ? computeFrameEntryDistribution(records, p.number, raceId)
            : null;
          const smallSample =
            dist !== null && dist.n > 0 && dist.n < SMALL_SAMPLE_THRESHOLD;
          const movedInEmphasis =
            dist?.inwardRate !== null &&
            dist?.inwardRate !== undefined &&
            dist.inwardRate >= MOVED_IN_EMPHASIS_RATE;
          return (
            <li
              key={p.number}
              className={`ecd-row${smallSample ? " ecd-small-sample" : ""}`}
              data-testid={`entry-course-dist-${p.number}`}
            >
              <span
                className="ecd-badge"
                style={{ background: color.bg, color: color.text }}
              >
                {p.number}
              </span>
              {loading ? (
                <span className="drt-skeleton ecd-bar" aria-hidden="true" />
              ) : dist && dist.n > 0 ? (
                <span
                  className="ecd-bar"
                  role="img"
                  aria-label={dist.counts
                    .map((count, i) =>
                      count > 0
                        ? t("beforeInfo.entryDistSegmentAria", {
                            course: i + 1,
                            count,
                          })
                        : null,
                    )
                    .filter(Boolean)
                    .join(", ")}
                >
                  {dist.counts.map((count, i) => {
                    if (count === 0) return null;
                    const course = i + 1;
                    const rate = (count / dist.n) * 100;
                    const segColor = BOAT_COLORS[course] || {};
                    return (
                      <span
                        key={course}
                        className="ecd-seg"
                        style={{
                          width: `${rate}%`,
                          background: segColor.bg,
                          color: segColor.text,
                        }}
                      >
                        {rate >= SEGMENT_LABEL_MIN_RATE ? course : ""}
                      </span>
                    );
                  })}
                </span>
              ) : (
                <span className="ecd-bar ecd-bar-empty">
                  {/* 取得失敗・選手ID不明は「—」。取得できて0走のときだけ
                      「出走なし」と言う（失敗を「データなし」に化けさせない） */}
                  {dist ? t("beforeInfo.entryDistNoRuns") : "—"}
                </span>
              )}
              <span className="ecd-summary">
                {inyaBoats.has(p.number) && (
                  <span
                    className="ecd-inya"
                    title="ファンの呼び名です。公式の用語ではありません"
                    data-testid={`entry-course-dist-inya-${p.number}`}
                  >
                    イン屋
                  </span>
                )}
                {dist && dist.n > 0 && (
                  <>
                    <span>
                      {t("beforeInfo.entryDistWaku", {
                        rate: dist.wakuRate.toFixed(0),
                      })}
                    </span>
                    {dist.inwardRate > 0 && (
                      <span
                        className={
                          movedInEmphasis ? "ecd-moved-in" : "ecd-moved-in-low"
                        }
                      >
                        {t("beforeInfo.entryDistMovedIn", {
                          rate: dist.inwardRate.toFixed(0),
                        })}
                      </span>
                    )}
                    <span
                      className={`ecd-runs${smallSample ? " drt-n-small-sample" : ""}`}
                    >
                      {t("beforeInfo.entryDistRuns", {
                        frame: p.number,
                        n: dist.n,
                      })}
                    </span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="ecd-legend" aria-hidden="true">
        {[1, 2, 3, 4, 5, 6].map((course) => (
          <span key={course} className="ecd-legend-item">
            <span
              className="ecd-legend-swatch"
              style={{ background: BOAT_COLORS[course]?.bg }}
            />
            {t("dataTable.prevResultCourse", { course })}
          </span>
        ))}
      </div>
    </section>
  );
}

export default EntryCourseDistributionCard;
