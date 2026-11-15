/**
 * RaceResult の着順の表（列見出し＋着／艇／選手名／ST／タイムの行）。
 * RaceResult.jsx から移しただけで、描く DOM・文言は変えない。
 */
import { BOAT_COLORS, getBoatChipBackground } from "../../utils/colors";
import { FINISH_MARKS } from "../../utils/raceOutcome";

// 選手名は公式の元データで姓と名の間を全角スペースで詰めてある（「丹下」「将」の間に全角スペース3つ）。そのまま出すと
// 375pxで姓だけに切れ、級別も見えなくなるため、空白を1つにまとめる（BOA-559）
function displayName(name) {
  return name ? name.replace(/[\s\u3000]+/g, " ").trim() : name;
}

export function BoatChip({ number }) {
  const color = BOAT_COLORS[number] || BOAT_COLORS[1];
  return (
    <span
      className="rr-boat-chip"
      style={{ background: getBoatChipBackground(number), color: color.text }}
    >
      {number}
    </span>
  );
}

// 着欄の記号の短いラベル（「F（フライング・返還）」等）。記号が分からない返還艇は「返還」、
// 不成立で記号の無い艇は「着順なし（不成立）」。意味は src/utils/raceOutcome.js の FINISH_MARKS
function markLabel(t, row, isNoRace) {
  // 「＿」は不成立のレースにしか出ない記号だが、成立状態が届いていない（109未適用）ときに
  // 「（不成立）」と書くと、同じページの的中表示（成立状態を知らない）と食い違う。そのときは
  // 「着順なし」だけにする（ファン評価 第1周 指摘1）
  if (row.mark === "_" && !isNoRace) return t("result.mark.noPositionPlain");
  const info = row.mark ? FINISH_MARKS[row.mark] : null;
  if (info) return t(`result.mark.${info.key}`);
  if (row.refunded) return t("result.mark.refunded");
  if (isNoRace) return t("result.mark.noPosition");
  return null;
}

// 着欄の表示。「＿」（着順なし）は罫線と見分けにくいので「—」にする
function markSymbol(row) {
  if (row.mark === "_" || row.mark == null) return "—";
  return row.mark;
}

const rowClassName = (position) => {
  if (position == null) return "rr-row is-unranked";
  if (position === 1) return "rr-row is-winner";
  if (position === 2) return "rr-row is-second";
  if (position === 3) return "rr-row is-third";
  return "rr-row";
};

function StartTimingCell({ st, isFastest, t }) {
  return (
    <span className="rr-st-cell">
      {st && st.startTiming != null ? (
        <>
          {/* ST の矢印は外し、数字と「最速」だけ。並びは上のスタート隊形の絵で見る（BOA-811） */}
          <span className="rr-st-value num">
            {/* フライングは公式と同じ「F.01」。選手ページ・直近10走とそろえる（BOA-583） */}
            {st.isFlying
              ? `F${st.startTiming.toFixed(2).replace(/^0/, "")}`
              : st.startTiming.toFixed(2)}
          </span>
          {isFastest && (
            <span className="rr-st-fastest-tag">
              {t("result.fastestStartTag")}
            </span>
          )}
        </>
      ) : (
        <span className="rr-st-value num">—</span>
      )}
    </span>
  );
}

function NameCell({ player, label, st, boat, t }) {
  return (
    <span className="rr-name">
      <span className="rr-name-text" translate="no">
        {displayName(player?.name)}
        {player?.grade && <small>{player.grade}</small>}
      </span>
      {label && <span className="rr-mark-label">{label}</span>}
      {st?.entryCourse != null && (
        <span
          className={`rr-course${st.entryCourse !== boat ? " is-moved" : ""}`}
        >
          {t("result.entryCourseLabel", {
            course: st.entryCourse,
          })}
        </span>
      )}
    </span>
  );
}

function ResultTableRow({ row, player, st, fastestStartTiming, isNoRace, t }) {
  const { position, boat, time } = row;
  const isFastest =
    Boolean(st) &&
    !st.isFlying &&
    fastestStartTiming != null &&
    st.startTiming === fastestStartTiming;
  const label = position == null ? markLabel(t, row, isNoRace) : null;

  return (
    <div className={rowClassName(position)}>
      <span className="rr-pos">
        {position != null ? t(`result.rank${position}`) : markSymbol(row)}
      </span>
      <BoatChip number={boat} />
      <NameCell player={player} label={label} st={st} boat={boat} t={t} />
      <StartTimingCell st={st} isFastest={isFastest} t={t} />
      <span className="rr-time num">{time || "—"}</span>
    </div>
  );
}

function ResultTableHead({ t }) {
  return (
    <div className="rr-row-head" aria-hidden="true">
      <span>{t("result.columns.position")}</span>
      <span>{t("result.columns.boat")}</span>
      <span>{t("result.columns.racer")}</span>
      <span className="rr-head-st">{t("result.columns.start")}</span>
      {/* 768px 以下は列が 2.4〜2.8rem しか無く、「レースタイム」が 15px はみ出して
          カードの外で切れた（race-detail-ui-unify PR5 ファン評価1周目）。短い見出しにする */}
      <span className="rr-head-time">
        <span className="rr-head-time-full">{t("result.columns.time")}</span>
        <span className="rr-head-time-short">
          {t("result.columns.timeShort")}
        </span>
      </span>
    </div>
  );
}

export function RaceResultTable({
  rows,
  players,
  startTimingByBoat,
  fastestStartTiming,
  isNoRace,
  t,
}) {
  const findPlayer = (boat) => players.find((p) => p.number === boat);
  return (
    <div className="rr-table">
      {/* 列見出し。公式の結果ページと同じ「着・枠・ボートレーサー・レースタイム」に、
          スタートの図の「ST」を足す。不成立で全行のタイムが「—」になっても、何の列か分かる */}
      <ResultTableHead t={t} />
      {rows.map((row) => (
        <ResultTableRow
          key={row.key}
          row={row}
          player={findPlayer(row.boat)}
          st={startTimingByBoat.get(row.boat)}
          fastestStartTiming={fastestStartTiming}
          isNoRace={isNoRace}
          t={t}
        />
      ))}
    </div>
  );
}
