/**
 * 選手の推移の線の下の段（レーン B の after B、オーナー 2026-11-25 承認のモック mock-motor-trend/mock.html の afterB）。
 * 選んだ艇の節ごとに、その選手が乗ったモーターの号機と、その節の会場の出走表の中の位置（上・中・下。src/pure/racerMeetMotors.js）を出す。
 * 推移の図（TrendChart）の renderBelow で描き、図と同じ横の座標 x(i, len) と同じ viewBox の幅で横をそろえる。
 * データは自分で取らず props で受け取る（取りの hook は入口の RaceBasicInfoTab、plan.md §13）。
 * 見た目は RacerMotorBand.css（rmb- のクラス）
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import "./RacerMotorBand.css";

const ROW = 16;
const BAND_H = ROW * 2 + 12;
// 号機・区分の字を出す最小の幅（これより狭い節は枠だけ。1〜2走の節で字が重ならない）
const MIN_TEXT_W = 13;

const md = (date) => `${Number(date.slice(5, 7))}/${date.slice(8, 10)}`;

function Segment({ meet, x0, x1, picked, onPick }) {
  const { t } = useTranslation();
  const w = Math.max(1, x1 - x0 - 1.5);
  const cx = (x0 + x1) / 2;
  const showText = w >= MIN_TEXT_W;
  return (
    <g
      className={`rmb-seg rmb-seg--${meet.tier ?? "none"}${picked ? " is-picked" : ""}`}
    >
      <rect
        x={x0 + 0.5}
        y={2}
        width={w}
        height={ROW}
        rx={3}
        className="rmb-box"
      />
      {showText && meet.tier && (
        <text x={cx} y={14} textAnchor="middle" className="rmb-tier">
          {t(`basicInfo.trend.motorBand.tier.${meet.tier}`)}
        </text>
      )}
      {showText && meet.motorNumber != null && (
        <text x={cx} y={ROW + 16} textAnchor="middle" className="rmb-no">
          {meet.motorNumber}
        </text>
      )}
      {/* 押す面は段の高さ全部（細い節も押せる）。押すと下の行に会場・期間・号機・位置 */}
      <rect
        x={x0}
        y={0}
        width={Math.max(1, x1 - x0)}
        height={BAND_H}
        fill="transparent"
        className="rmb-hit"
        onClick={onPick}
      />
    </g>
  );
}

// 押した節の中身の1行（号機は会場ごとの番号なので会場と期間を添える。ファン評価 11/27）
function PickedLine({ meet }) {
  const { t } = useTranslation();
  const args = {
    range: `${md(meet.start)}〜${md(meet.end)}`,
    venue: t(`venues.${meet.venue}`),
    no: meet.motorNumber ?? "-",
    tier: meet.tier ? t(`basicInfo.trend.motorBand.tier.${meet.tier}`) : "",
  };
  return (
    <p className="rmb-pick">
      {t(
        meet.tier
          ? "basicInfo.trend.motorBand.tip"
          : "basicInfo.trend.motorBand.tipNoRank",
        args,
      )}
    </p>
  );
}

/**
 * @param {{x: (i:number, len:number) => number, W: number, pad: {l:number}, sel: Array<{raceId:string}>,
 *   band: ReturnType<import("../../../pure/racerMeetMotors.js").meetMotorBand>|null, failed: boolean}} props
 *   band が null（取得中）でも段の高さと注記を取っておく（下の艇の札が上下に跳ねない。ファン評価 11/27）
 */
export function RacerMotorBandView({ x, W, pad, sel, band, failed }) {
  const { t } = useTranslation();
  const [pickedKey, setPickedKey] = useState(null);
  if (failed)
    return <p className="trc-note">{t("basicInfo.trend.motorBand.failed")}</p>;
  if (band && band.length === 0) return null;
  const n = sel.length;
  const at = (i) => x(Math.min(n - 1, Math.max(0, i)), n);
  const keyOf = (m) => `${m.venue}-${m.start}`;
  const picked = band?.find((m) => keyOf(m) === pickedKey) ?? null;
  return (
    <>
      <svg
        className="rmb-svg"
        viewBox={`0 0 ${W} ${BAND_H}`}
        role="img"
        aria-label={t("basicInfo.trend.motorBand.label")}
      >
        <text x={pad.l - 4} y={14} textAnchor="end" className="rmb-head">
          {t("basicInfo.trend.motorBand.rank")}
        </text>
        <text x={pad.l - 4} y={ROW + 16} textAnchor="end" className="rmb-head">
          {t("basicInfo.trend.motorBand.motor")}
        </text>
        {(band ?? []).map((meet) => (
          <Segment
            key={keyOf(meet)}
            meet={meet}
            x0={at(meet.from - 0.5)}
            x1={at(meet.to + 0.5)}
            picked={meet === picked}
            onPick={() => setPickedKey(meet === picked ? null : keyOf(meet))}
          />
        ))}
      </svg>
      {picked && <PickedLine meet={picked} />}
      <p className="rmb-note">{t("basicInfo.trend.motorBand.note")}</p>
    </>
  );
}

export default RacerMotorBandView;
