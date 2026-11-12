/**
 * RaceBeforeInfoTab の展示タイム棒グラフのカード。
 * RaceBeforeInfoTab.jsx から移しただけ（出力は変えない）。
 */
import { useTranslation } from "react-i18next";
import {
  BarChart,
  Bar,
  Cell,
  LabelList,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import BandWrapAxisTick from "../BandWrapAxisTick";
import { BOAT_COLORS } from "../../utils/colors";
import { toNumber } from "./raceIndicators";
import { bestOf } from "../../utils/bestOf";

// 展示タイム棒グラフ用データ（艇番順、未取得艇はnullのままバーを描かない）
function buildExhibitionChartData(sortedPlayers, exhibitionTime, t) {
  const exhibitionByBoat = new Map(
    (exhibitionTime ?? []).map((r) => [r.boat_number, r]),
  );
  return sortedPlayers.map((p) => {
    const row = exhibitionByBoat.get(p.number);
    return {
      boat: p.number,
      name: t("analysis.boatN", { n: p.number }),
      time: row?.exhibition_time != null ? toNumber(row.exhibition_time) : null,
    };
  });
}

function buildExhibitionLeadData(exhibitionChartData) {
  // 展示タイムは**小さいほど速い**のに、素の値で棒を立てると
  // 「棒が高い＝いい」と読まれる（一番高い棒が実は一番遅い艇）。
  // 2026-09-27のファン視点レビューで実害として挙がったので、
  // 棒の長さを「最も遅い艇との差」にして**長いほど速い**に直した。
  // 数字は各棒の上に実タイムを出すので、読み取れる情報は減らない。
  const exhibitionTimes = exhibitionChartData
    .map((d) => d.time)
    .filter((v) => v !== null);
  const slowestExhibition =
    exhibitionTimes.length > 0 ? Math.max(...exhibitionTimes) : null;
  // 最速の艇（同値は全部、表示の2桁で比べる。全艇同値なら無し）に「最速」の印と
  // 金枠を付ける。棒は艇色のまま、良し悪しは値のラベルで示す（race-detail-ui-unify R4・FR-5）
  const fastestBoats = bestOf(
    exhibitionChartData.map((d) => ({ boat: d.boat, value: d.time })),
    "min",
    { digits: 2 },
  );
  const exhibitionLeadData = exhibitionChartData.map((d) => ({
    ...d,
    // 最も遅い艇は差が0で棒が消えるため、最小の下駄（0.01秒相当）を履かせる。
    // ラベルは実タイムなので数字は歪まない
    lead: d.time === null ? null : slowestExhibition - d.time + 0.01,
    timeLabel: d.time === null ? "" : d.time.toFixed(2),
  }));
  return { exhibitionLeadData, fastestBoats };
}

// 棒の上の値ラベル。最速の艇だけ金の薄い塗り＋枠（.ind-best と同じトークン）と太字、
// その上に「最速」の文字を重ねる。SVG なので CSS のクラスでなく属性で描く
const makeExhibitionLabelRenderer =
  (exhibitionLeadData, fastestBoats, t) =>
  ({ x, y, width, index }) => {
    const d = exhibitionLeadData[index];
    if (!d || !d.timeLabel) return null;
    const cx = x + width / 2;
    const fastest = fastestBoats.has(d.boat);
    return (
      <g className={fastest ? "rbi-exhibition-fastest" : undefined}>
        {fastest && (
          <rect
            x={cx - 23}
            y={y - 22}
            width={46}
            height={19}
            rx={3}
            fill="var(--ind-best-bg)"
            stroke="var(--ind-best-ring)"
          />
        )}
        {/* recharts の既定のラベルと同じクラスを付ける（e2e の BOA-613 がこれで探す） */}
        <text
          className="recharts-label"
          x={cx}
          y={y - 8}
          textAnchor="middle"
          fontSize={13}
          fontWeight={fastest ? 700 : 400}
          fill="var(--text-primary)"
        >
          {d.timeLabel}
        </text>
        {fastest && (
          <text
            x={cx}
            y={y - 26}
            textAnchor="middle"
            fontSize={11}
            fontWeight={700}
            fill="var(--brand-accent-primary)"
          >
            {t("beforeInfo.exhibitionFastestMark")}
          </text>
        )}
      </g>
    );
  };

function ExhibitionBarChart({ t, exhibitionLeadData, renderExhibitionLabel }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={exhibitionLeadData}
        // 上の余白は「最速」の印と値の枠のぶん（以前は 20）
        margin={{ top: 36, right: 16, left: 0, bottom: 5 }}
      >
        {/* 横の補助線は出さない。縦軸の数字が無く（下の YAxis hide）意味を持たず、
            「最速」の印に重なっていた（PR #1193 ファン評価1周目） */}
        <XAxis
          dataKey="name"
          interval={0}
          tick={(props) => <BandWrapAxisTick {...props} fontSize={11} />}
        />
        {/* 縦軸は「最も遅い艇との差」で、目盛りの数字そのものに
            意味が無いので出さない。実タイムは棒の上に出す */}
        <YAxis hide domain={[0, "dataMax + 0.02"]} />
        {/* 項目名は「展示タイム」。以前は dataKey の「lead」がそのまま出ていた（BOA-618） */}
        <Tooltip
          formatter={(value, _name, item) => [
            item?.payload?.time != null
              ? `${item.payload.time.toFixed(2)}${t("beforeInfo.secondsUnit")}`
              : "—",
            t("beforeInfo.exhibitionChartTitle"),
          ]}
        />
        <Bar dataKey="lead" radius={[4, 4, 0, 0]}>
          {/* 数値は 13px。広い画面で棒の幅が約200pxあるのに 11px で釣り合わなかった（BOA-613） */}
          <LabelList dataKey="timeLabel" content={renderExhibitionLabel} />
          {exhibitionLeadData.map((d) => (
            <Cell
              key={d.boat}
              fill={BOAT_COLORS[d.boat]?.bg || "var(--brand-accent-primary)"}
              // 1号艇の白い棒は背景に溶けるので輪郭を付ける（BOA-613）
              // 2号艇の黒い棒もダークの背景に溶けるので同じく輪郭を付ける
              // （PR #1193 ファン評価1周目）
              stroke={
                d.boat === 1 || d.boat === 2 ? "var(--text-secondary)" : "none"
              }
              strokeWidth={d.boat === 1 || d.boat === 2 ? 1 : 0}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function RaceBeforeInfoTabChart({ sortedPlayers, analysis }) {
  const { t } = useTranslation();
  const exhibitionChartData = buildExhibitionChartData(
    sortedPlayers,
    analysis.exhibitionTime,
    t,
  );
  const hasExhibitionChartData = exhibitionChartData.some(
    (d) => d.time !== null,
  );
  const { exhibitionLeadData, fastestBoats } =
    buildExhibitionLeadData(exhibitionChartData);
  const renderExhibitionLabel = makeExhibitionLabelRenderer(
    exhibitionLeadData,
    fastestBoats,
    t,
  );
  return (
    <section className="rbi-card">
      <h3 className="rbi-heading">
        {t("beforeInfo.exhibitionChartTitle")}
        {analysis.loading && (
          <span className="drt-loading-chip">{t("dataTable.loading")}</span>
        )}
      </h3>
      {hasExhibitionChartData ? (
        <>
          <ExhibitionBarChart
            t={t}
            exhibitionLeadData={exhibitionLeadData}
            renderExhibitionLabel={renderExhibitionLabel}
          />
          <p className="rbi-chart-note">
            {t("beforeInfo.exhibitionChartNote")}
          </p>
        </>
      ) : (
        <p className="rbi-empty">{t("beforeInfo.exhibitionChartEmpty")}</p>
      )}
    </section>
  );
}
