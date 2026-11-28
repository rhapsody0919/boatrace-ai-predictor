/**
 * 選手の推移の線の下の段（レーン B の after B、オーナー 2026-11-25 承認のモック mock-motor-trend/mock.html の afterB）。
 * 選んだ艇の節ごとに、その選手が乗ったモーターの号機と、その節の初日の公式2連率を出す。節を押すと、その節の会場の出走表の中の
 * 位置（上から何%。src/pure/racerMeetMotors.js）を出す。位置で色や「上・中・下」の字は付けない（1つの節の上下は偶然の幅を
 * 超えたと言えない。読み方は「?」の中。plan.md §14、オーナー 2026-11-28）。
 * 推移の図（TrendChart）の renderBelow で描き、図と同じ横の座標 x(i, len) と同じ viewBox の幅で横をそろえる。
 * データは自分で取らず props で受け取る（取りの hook は入口の RaceBasicInfoTab、plan.md §13）。
 * 見た目は RacerMotorBand.css（rmb- のクラス）
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import TermHintButton from "../TermHintButton";
import "./RacerMotorBand.css";

const ROW = 16;
const BAND_H = ROW * 2 + 12;
// 号機・2連率の字を出す最小の幅（これより狭い節は枠だけ。1〜2走の節で字が重ならない）
const MIN_TEXT_W = 13;

// 2連率が付いているか（0 は初下ろし等でまだ無い。racerMeetMotors の isRate と同じ線）
const hasRate = (meet) => typeof meet.motor2Rate === "number" && meet.motor2Rate > 0;
const md = (date) => `${Number(date.slice(5, 7))}/${date.slice(8, 10)}`;

function Segment({ meet, x0, x1, picked, onPick }) {
  const w = Math.max(1, x1 - x0 - 1.5);
  const cx = (x0 + x1) / 2;
  const showText = w >= MIN_TEXT_W;
  return (
    <g
      className={`rmb-seg${hasRate(meet) ? "" : " rmb-seg--none"}${picked ? " is-picked" : ""}`}
    >
      <rect
        x={x0 + 0.5}
        y={2}
        width={w}
        height={ROW}
        rx={3}
        className="rmb-box"
      />
      {showText && hasRate(meet) && (
        <text x={cx} y={14} textAnchor="middle" className="rmb-tier">
          {meet.motor2Rate.toFixed(1)}
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

// 押した節の中身の1行（号機は会場ごとの番号なので会場と期間を添える。ファン評価 11/27）。検査が直に描くので export
export function PickedLine({ meet }) {
  const { t } = useTranslation();
  const args = {
    range: `${md(meet.start)}〜${md(meet.end)}`,
    venue: t(`venues.${meet.venue}`),
    no: meet.motorNumber ?? "-",
    rate: hasRate(meet) ? meet.motor2Rate.toFixed(1) : "",
    // 上から何%（pct は下からのパーセンタイル。いちばん上でも 0% と出さず 1% にする）
    top: meet.pct == null ? "" : Math.max(1, Math.round((1 - meet.pct) * 100)),
  };
  return (
    <p className="rmb-pick">
      {t(
        hasRate(meet) && meet.pct != null
          ? "basicInfo.trend.motorBand.tipRate"
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
        aria-label={t("basicInfo.trend.motorBand.labelRate")}
      >
        <text x={pad.l - 4} y={14} textAnchor="end" className="rmb-head">
          {t("basicInfo.trend.motorBand.rate")}
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
      <p className="rmb-note">
        <TermHintButton termKey="racerMotorBand" />
      </p>
    </>
  );
}

export default RacerMotorBandView;
