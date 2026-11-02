/**
 * YouTube Shorts「節の機力」（縦 1080x1920・15秒（final_gap は17秒）・声なし・BGM）。props は hq の bundle.json そのまま（＋任意の bgm）。
 * 型と章・検査は model.js。描く前に checkBundle を通し、通らなければ描かずに止める（作らない）。
 * 文字は y≤1400・x≤940（Shorts の下の帯と右のボタン列の外）。各コマで DOM の実際の箱を測り、越えたら止める。
 *
 * 描く: npx remotion render src/index.jsx SetsuKiryokuShort out.mp4 --props=bundle.json
 * BGM: props.bgm に public/ からの相対パス（承認曲。hq が置く）。無ければ無音
 */
import { useLayoutEffect, useRef } from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  cancelRender,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { FONT } from "../fonts.js";
import { fitHeadline } from "../textFit.js";
import rules from "../../risk-rules.json";
import { matchRiskRules } from "../../../../scripts/lib/riskRuleMatcher.js";
import {
  BARS,
  CHART,
  CX,
  CENTER_MAX_W,
  LEFT,
  MIN_FONT,
  RIGHT,
  RUNS_TOP,
  SAFE,
  GAP_BARS,
  HERO_RUNS,
  SIX_TABLE,
  barsLayout,
  chartPoints,
  checkBundle,
  closeLayout,
  courseAvg,
  daysLabel,
  fmt2rate1,
  fmtAvg,
  estWidth,
  fmtRate,
  gapBars,
  heroChipFont,
  heroLine,
  heroRunsPitch,
  rankLabel,
  hookLayout,
  runsRowH,
  shortName,
  splitHalves,
  winsOf,
  tagText,
  timeline,
} from "./model.js";

const GOLD = "#d4af37";
const WH = "#ffffff";
const GR = "#96aabe";
const DG = "#465f78";
const NAVY = "#0f2c46";
const BG = "linear-gradient(#123250, #081828)";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };

/** 文字の要素（data-sk で箱の検査の対象にする） */
function T({
  x,
  y,
  size,
  color = WH,
  weight = 900,
  align = "left",
  w = null,
  children,
  style = {},
}) {
  // 実際の字の幅（Chromium の measureText）で1行に収める。36px でも収まらなければ元の大きさのまま描き、箱の検査で止める
  const centered = align === "center" && w == null;
  const maxW = centered ? CENTER_MAX_W : (w ?? SAFE.right - 10 - x);
  const text = typeof children === "string" ? children : null;
  const fit = text
    ? fitHeadline(text, {
        maxWidth: maxW,
        maxLines: 1,
        fontFamily: FONT,
        fontWeight: weight,
        maxFontSize: size,
        minFontSize: Math.min(size, MIN_FONT),
        step: 1,
      })
    : null;
  const fs =
    fit && fit.lines.length === 1 && fit.lines[0] === text
      ? fit.fontSize
      : size;
  const base = {
    position: "absolute",
    top: y,
    fontSize: fs,
    fontWeight: weight,
    color,
    whiteSpace: "nowrap",
    lineHeight: 1.2,
  };
  const pos = centered
    ? {
        left: CX - CENTER_MAX_W / 2,
        width: CENTER_MAX_W,
        textAlign: "center",
      }
    : { left: x, ...(w ? { width: w, textAlign: align } : {}) };
  return (
    <div style={{ ...base, ...pos, ...style }}>
      <span data-sk="">{children}</span>
    </div>
  );
}

const fadeIn = (frame, at, len = 8) =>
  interpolate(frame, [at, at + len], [0, 1], clamp);

function Header({ b }) {
  const tag = tagText(b);
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 60,
          top: 120,
          height: 70,
          padding: "0 24px",
          borderRadius: 16,
          background: GOLD,
          display: "flex",
          alignItems: "center",
        }}
      >
        <span
          data-sk=""
          style={{
            fontSize: 40,
            fontWeight: 900,
            color: NAVY,
            whiteSpace: "nowrap",
          }}
        >
          {tag}
        </span>
      </div>
      <T
        x={RIGHT - 300}
        w={300}
        align="right"
        y={130}
        size={40}
        color={GR}
        weight={700}
      >
        龍神レーダー
      </T>
    </>
  );
}

function Stack({ lines, frame, step = 6 }) {
  return lines.map((l, i) => (
    <T
      key={i}
      align="center"
      y={l.y}
      size={l.size}
      color={l.em ? GOLD : WH}
      style={{ opacity: fadeIn(frame, i * step) }}
    >
      {l.text}
    </T>
  ));
}

function Hook({ b }) {
  const f = useCurrentFrame();
  const { lines, sub } = hookLayout(b);
  return (
    <>
      <Stack lines={lines} frame={f} />
      {sub && (
        <T
          align="center"
          y={sub.y}
          size={sub.size}
          style={{ opacity: fadeIn(f, lines.length * 6) }}
        >
          {sub.text}
        </T>
      )}
    </>
  );
}

function Close({ b }) {
  const f = useCurrentFrame();
  const { lines, tail } = closeLayout(b);
  return (
    <>
      <Stack lines={lines} frame={f} step={8} />
      <T
        align="center"
        y={tail.y}
        size={tail.size}
        color={GR}
        weight={700}
        style={{ opacity: fadeIn(f, lines.length * 8) }}
      >
        {tail.text}
      </T>
    </>
  );
}

/** motor_gap 3〜8秒: 各走の日・コース・順位・展示タイム */
function RunsTable({ b }) {
  const f = useCurrentFrame();
  const h = runsRowH(b.runs.length);
  const box = Math.round(h * 0.79);
  const size = Math.min(56, Math.round(h * 0.4));
  return (
    <>
      <T align="center" y={260} size={44}>
        今節の展示タイム（レースの中の順位）
      </T>
      {[
        ["日", 90],
        ["コース", 230],
        ["順位", 470],
        ["展示タイム", 680],
      ].map(([s, x]) => (
        <T key={s} x={x} y={RUNS_TOP - 64} size={36} color={GR} weight={400}>
          {s}
        </T>
      ))}
      {b.runs.map((r, i) => {
        const y = RUNS_TOP + i * h;
        const o = fadeIn(f, 6 + i * 7, 6);
        const tx = interpolate(o, [0, 1], [-40, 0]);
        return (
          <div key={i} style={{ opacity: o, transform: `translateX(${tx}px)` }}>
            <T
              x={80}
              y={y + (box - 44) / 2 - 4}
              size={44}
              color={GR}
              weight={400}
            >
              {r.day}
            </T>
            <T
              x={230}
              y={y + (box - size) / 2 - 4}
              size={size}
            >{`${r.course}コース`}</T>
            <div
              style={{
                position: "absolute",
                left: 440,
                top: y,
                width: 200,
                height: box,
                borderRadius: 20,
                background: r.rank === 1 ? GOLD : DG,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                data-sk=""
                style={{
                  fontSize: Math.min(72, Math.round(box * 0.65)),
                  fontWeight: 900,
                  color: r.rank === 1 ? NAVY : WH,
                }}
              >{`${r.rank}位`}</span>
            </div>
            <T
              x={700}
              y={y + (box - 52) / 2 - 4}
              size={52}
              weight={400}
            >{`${r.time.toFixed(2)}秒`}</T>
          </div>
        );
      })}
    </>
  );
}

/** motor_gap 8〜12秒: 場の全機の2連率の中の位置 */
function RateBars({ b }) {
  const f = useCurrentFrame();
  const L = barsLayout(b);
  const grow = interpolate(f, [4, 28], [0, 1], {
    ...clamp,
    easing: (t) => 1 - (1 - t) ** 3,
  });
  const lab = fadeIn(f, 30);
  return (
    <>
      <T
        align="center"
        y={260}
        size={52}
      >{`モーター2連率（${b.venue}の${b.motor_2rate.n}機）`}</T>
      {L.bars.map((bar, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: bar.x,
            top: BARS.base - bar.h * grow,
            width: bar.w,
            height: bar.h * grow,
            background: bar.hit ? GOLD : DG,
          }}
        />
      ))}
      <div style={{ opacity: lab }}>
        <T
          x={L.labelX}
          w={L.labelW}
          align="center"
          y={L.labelY}
          size={56}
          color={GOLD}
        >
          {L.label}
        </T>
        <T
          x={L.labelX}
          w={L.labelW}
          align="center"
          y={L.labelY + 70}
          size={40}
          color={GOLD}
        >
          {L.sub}
        </T>
      </div>
      <T align="center" y={BARS.base + 40} size={40} color={GR} weight={400}>
        低い ← → 高い
      </T>
    </>
  );
}

/** motor_up 3〜9秒: 順位の線と各走のコース */
function RankChart({ b }) {
  const f = useCurrentFrame();
  const pts = chartPoints(b.runs);
  const shown = interpolate(
    f,
    [6, 6 + 12 * pts.length],
    [0, pts.length - 1],
    clamp,
  );
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const segLen = pts
    .slice(1)
    .reduce((a, p, i) => a + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
  const k = Math.floor(shown);
  const partial =
    pts
      .slice(1, k + 1)
      .reduce((a, p, i) => a + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0) +
    (k < pts.length - 1
      ? (shown - k) *
        Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].y - pts[k].y)
      : 0);
  // 字は最小36px（video-composition.md）
  const labSize = 36;
  return (
    <>
      <T align="center" y={260} size={48}>
        展示タイムの順位（レースの中）
      </T>
      {[1, 2, 3, 4, 5, 6].map((r) => {
        const y = CHART.y0 + ((r - 1) * (CHART.y1 - CHART.y0)) / 5;
        return (
          <div key={r}>
            <div
              style={{
                position: "absolute",
                left: CHART.x0 - 20,
                top: y - 1,
                width: CHART.x1 - CHART.x0 + 40,
                height: 2,
                background: "#28415a",
              }}
            />
            <T
              x={50}
              y={y - 22}
              size={36}
              color={GR}
              weight={400}
            >{`${r}位`}</T>
          </div>
        );
      })}
      <svg
        width={1080}
        height={1920}
        style={{ position: "absolute", left: 0, top: 0 }}
      >
        <path
          d={path}
          stroke={GOLD}
          strokeWidth={10}
          fill="none"
          strokeLinejoin="round"
          strokeDasharray={segLen}
          strokeDashoffset={segLen - partial}
        />
        {pts.map((p, i) =>
          i <= shown + 0.001 ? (
            <circle key={i} cx={p.x} cy={p.y} r={22} fill={GOLD} />
          ) : null,
        )}
      </svg>
      <T x={40} y={CHART.y1 + 92} size={36} color={GR} weight={400}>
        コース
      </T>
      {pts.map((p, i) => (
        <div key={i} style={{ opacity: i <= shown + 0.001 ? 1 : 0.25 }}>
          <T
            x={p.x - 50}
            w={100}
            align="center"
            y={CHART.y1 + 40}
            size={labSize}
            color={GR}
            weight={400}
          >
            {p.day}
          </T>
          <T
            x={p.x - 50}
            w={100}
            align="center"
            y={CHART.y1 + 86}
            size={40}
          >{`${p.course}C`}</T>
        </div>
      ))}
    </>
  );
}

/** motor_up 9〜12秒: 前半と後半の平均（コースの平均を添える） */
function Halves({ b }) {
  const f = useCurrentFrame();
  const { early, late } = splitHalves(b);
  const rows = [
    { runs: early, h: b.halves.early, color: DG },
    { runs: late, h: b.halves.late, color: GOLD },
  ];
  const ca = rows.map((r) => courseAvg(r.h.courses));
  const note =
    ca[0] === ca[1]
      ? `コースの平均は どちらも ${ca[0].toFixed(1)}`
      : `コースの平均 ${ca[0].toFixed(1)} → ${ca[1].toFixed(1)}`;
  return (
    <>
      <T align="center" y={300} size={60}>
        展示の順位の平均
      </T>
      {rows.map((r, i) => {
        const y = 460 + i * 360;
        return (
          <div key={i} style={{ opacity: fadeIn(f, 4 + i * 14) }}>
            <T x={100} y={y} size={52}>
              {daysLabel(r.runs)}
            </T>
            <T
              x={420}
              y={y + 10}
              size={40}
              color={GR}
              weight={400}
            >{`${r.h.courses.join("・")}コース`}</T>
            <T
              x={100}
              y={y + 80}
              size={150}
              color={r.color}
            >{`${fmtAvg(r.h.avg)}位`}</T>
          </div>
        );
      })}
      <T align="center" y={1240} size={44} style={{ opacity: fadeIn(f, 34) }}>
        {note}
      </T>
    </>
  );
}

/** final_gap 3〜6.5秒: 主役の名前・級・モーター・2連率と、全機の2連率の棒（主役だけ光らせる） */
function HeroBars({ b }) {
  const f = useCurrentFrame();
  const h = b.hero;
  const bars = gapBars(h.motor_2rate);
  const grow = interpolate(f, [4, 28], [0, 1], {
    ...clamp,
    easing: (t) => 1 - (1 - t) ** 3,
  });
  return (
    <>
      <T align="center" y={260} size={56}>
        {heroLine(h)}
      </T>
      <T align="center" y={350} size={72} color={GOLD}>
        {`2連率 ${h.motor_2rate.value.toFixed(2)}%`}
      </T>
      {bars.map((bar, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: bar.x,
            top: GAP_BARS.base - bar.h * grow,
            width: bar.w,
            height: bar.h * grow,
            background: bar.hit ? GOLD : DG,
          }}
        />
      ))}
      <T
        x={GAP_BARS.x0}
        y={GAP_BARS.base + 20}
        size={36}
        color={GR}
        weight={400}
      >
        低い
      </T>
      <T
        x={GAP_BARS.x1 - 200}
        w={200}
        align="right"
        y={GAP_BARS.base + 20}
        size={36}
        color={GR}
        weight={400}
      >
        高い
      </T>
      <T
        align="center"
        y={GAP_BARS.base + 90}
        size={40}
        color={GR}
        weight={400}
        style={{ opacity: fadeIn(f, 20) }}
      >{`${b.venue}の全${h.motor_2rate.n}機の2連率`}</T>
    </>
  );
}

/** final_gap 6.5〜10.5秒: なのに 今節の展示タイムは（各走の順位とコース・N走中K回 1位） */
function HeroRuns({ b }) {
  const f = useCurrentFrame();
  const runs = b.hero.runs;
  const pitch = heroRunsPitch(runs.length);
  const left = CX - (runs.length * pitch) / 2;
  return (
    <>
      <T align="center" y={300} size={56}>
        なのに 今節の展示タイムは
      </T>
      {runs.map((r, j) => {
        const x = left + j * pitch;
        const bg = r.rank === 1 ? GOLD : r.rank === 2 ? "#788ca0" : "#28415a";
        return (
          <div key={j} style={{ opacity: fadeIn(f, 6 + j * 4, 4) }}>
            <div
              style={{
                position: "absolute",
                left: x + 6,
                top: HERO_RUNS.y,
                width: pitch - 12,
                height: HERO_RUNS.chipH,
                borderRadius: 14,
                background: bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                data-sk=""
                style={{
                  fontSize: heroChipFont(pitch),
                  fontWeight: 900,
                  color: r.rank <= 2 ? NAVY : WH,
                }}
              >
                {r.rank}
              </span>
            </div>
            <T
              x={x}
              w={pitch}
              align="center"
              y={HERO_RUNS.y + HERO_RUNS.chipH + 20}
              size={36}
              color={GR}
              weight={400}
            >{`${r.course}C`}</T>
          </div>
        );
      })}
      <T
        align="center"
        y={720}
        size={96}
        color={GOLD}
        style={{ opacity: fadeIn(f, 6 + runs.length * 4) }}
      >{`${runs.length}走中 ${winsOf(runs)}回 1位`}</T>
      <T align="center" y={880} size={36} color={GR} weight={400}>
        数字＝6艇の中の展示タイムの順位
      </T>
    </>
  );
}

/** final_gap 10.5〜15秒: 優勝戦の6人のモーター（名前・級・モーター・2連率と全機の中の順位・展示1位の回数／走数、主役を枠で囲む） */
function SixMotors({ b }) {
  const f = useCurrentFrame();
  const n = b.hero.motor_2rate.n;
  const rows = [...b.six].sort((x, y) => x.motor_2rate - y.motor_2rate);
  const S = SIX_TABLE;
  return (
    <>
      <T align="center" y={250} size={56}>
        優勝戦の6人のモーター
      </T>
      {[
        ["選手", S.name],
        ["級", S.cls],
        ["モーター", S.motor],
        ["2連率", S.rate],
        ["展示1位", S.wins],
      ].map(([s, x]) => (
        <T key={s} x={x} y={S.top - 70} size={36} color={GR} weight={400}>
          {s}
        </T>
      ))}
      {rows.map((r, i) => {
        const y = S.top + i * S.rowH;
        const hero = r.motor === b.hero.motor;
        const col = hero ? GOLD : WH;
        return (
          <div key={r.motor} style={{ opacity: fadeIn(f, 4 + i * 5) }}>
            {hero && (
              <div
                style={{
                  position: "absolute",
                  left: 40,
                  top: y - 14,
                  width: SAFE.right - 10 - 40,
                  height: S.rowH - 8,
                  borderRadius: 16,
                  border: `4px solid ${GOLD}`,
                  boxSizing: "border-box",
                }}
              />
            )}
            <T x={S.name} w={S.nameW} y={y} size={44} color={col}>
              {shortName(r.racer)}
            </T>
            <T x={S.cls} y={y + 6} size={36} color={col}>
              {r.class}
            </T>
            <T x={S.motor} y={y - 2} size={48} color={col}>
              {String(r.motor)}
            </T>
            <T x={S.rate} y={y - 2} size={48} color={col}>
              {`${fmt2rate1(r.motor_2rate)}%`}
            </T>
            <T x={S.rate} y={y + 56} size={36} color={GR} weight={400}>
              {`${n}機中 ${r.rank_in_all}位`}
            </T>
            <T x={S.wins} y={y - 2} size={48} color={col}>
              {`${r.wins}/${r.runs_n}走`}
            </T>
          </div>
        );
      })}
    </>
  );
}

/** border 4〜11秒: ボーダー際の3人の得点率・今日の R と号艇・要る着（見本 hq drafts/shorts-border-person/sheet-border.png） */
function ThreeCards({ b }) {
  const f = useCurrentFrame();
  const line = fmtRate(b.border.line);
  return (
    <>
      <T align="center" y={260} size={52}>{`${line} に並ぶのに 要る着`}</T>
      {b.racers.map((r, i) => {
        const y = 350 + i * 250;
        const o = fadeIn(f, 6 + i * 14, 8);
        return (
          <div key={i} style={{ opacity: o }}>
            <div
              style={{
                position: "absolute",
                left: LEFT,
                top: y,
                width: RIGHT - LEFT,
                height: 220,
                borderRadius: 20,
                background: "#1a3a5c",
              }}
            />
            <T x={90} y={y + 30} size={36} color={GR} weight={400}>
              {rankLabel(r)}
            </T>
            {/* 名前は順位の札の後ろ（「同率20位」で札が長くなっても重ならない） */}
            <T
              x={Math.max(200, 90 + Math.ceil(estWidth(rankLabel(r), 36)) + 24)}
              y={y + 20}
              size={52}
            >
              {shortName(r.racer)}
            </T>
            <T
              x={560}
              w={310}
              align="right"
              y={y + 30}
              size={36}
              color={GR}
              weight={400}
            >{`得点率 ${fmtRate(r.rate)}`}</T>
            <T
              x={90}
              y={y + 128}
              size={40}
              weight={400}
            >{`今日 ${r.race} ${r.boat}号艇`}</T>
            <div
              style={{
                position: "absolute",
                left: 560,
                top: y + 100,
                width: 310,
                height: 96,
                borderRadius: 18,
                background: GOLD,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: fadeIn(f, 14 + i * 14, 6),
              }}
            >
              <span
                data-sk=""
                style={{
                  fontSize: 64,
                  fontWeight: 900,
                  color: NAVY,
                  whiteSpace: "nowrap",
                }}
              >
                {r.need}
              </span>
            </div>
          </div>
        );
      })}
      <T
        x={90}
        y={350 + 3 * 250 + 10}
        size={36}
        color={GR}
        weight={400}
        style={{ opacity: fadeIn(f, 50) }}
      >{`※ 前夜の${b.border.cut}位が動かない場合`}</T>
    </>
  );
}

const CHAPTER_VIEWS = {
  hook: Hook,
  runs: RunsTable,
  rate: RateBars,
  chart: RankChart,
  halves: Halves,
  hero: HeroBars,
  heroRuns: HeroRuns,
  six: SixMotors,
  three: ThreeCards,
  close: Close,
};

/** 文字の箱が SAFE（x≤940・y≤1400）を越えたら描くのを止める（黙ってはみ出さない） */
function useBoundsGuard(ref) {
  const frame = useCurrentFrame();
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const rr = root.getBoundingClientRect();
    const scale = rr.width / 1080 || 1;
    for (const el of root.querySelectorAll("[data-sk]")) {
      const r = el.getBoundingClientRect();
      const right = (r.right - rr.left) / scale;
      const bottom = (r.bottom - rr.top) / scale;
      const left = (r.left - rr.left) / scale;
      // throw だと Remotion が描画を続けることがあるので cancelRender で止める（2026-10-31 実測）
      if (right > SAFE.right + 0.5 || bottom > SAFE.bottom + 0.5 || left < -0.5)
        cancelRender(
          new Error(
            `文字が安全な範囲（x≤${SAFE.right}・y≤${SAFE.bottom}）を越えた（コマ ${frame}、x${Math.round(left)}〜${Math.round(right)}・下端 y${Math.round(bottom)}）: ${el.textContent}`,
          ),
        );
    }
  }, [frame, ref]);
}

export function SetsuKiryokuShort(props) {
  const { bgm = null, ...b } = props;
  const why = checkBundle(b, { rules: rules.rules, matchRiskRules });
  if (why.length)
    cancelRender(
      new Error(
        `節の機力の bundle が検査を通らない（作らない）:\n- ${why.join("\n- ")}`,
      ),
    );
  const ref = useRef(null);
  useBoundsGuard(ref);
  const tl = timeline(b.variant);
  return (
    <AbsoluteFill style={{ background: BG, fontFamily: FONT, color: WH }}>
      {/* 箱の検査の基準（AbsoluteFill は ref を渡さない版がある） */}
      <div
        ref={ref}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1080,
          height: 1920,
        }}
      >
        <Header b={b} />
        {tl.chapters.map((c) => {
          const View = CHAPTER_VIEWS[c.id];
          return (
            <Sequence
              key={c.id}
              from={c.from}
              durationInFrames={c.len}
              layout="none"
            >
              <View b={b} />
            </Sequence>
          );
        })}
      </div>
      {bgm && (
        <Audio
          src={staticFile(bgm)}
          volume={(fr) =>
            0.35 *
            interpolate(
              fr,
              [0, 10, tl.total - 20, tl.total],
              [0, 1, 1, 0],
              clamp,
            )
          }
        />
      )}
    </AbsoluteFill>
  );
}

export const setsuKiryokuMetadata = ({ props }) => ({
  durationInFrames: timeline(props.variant).total,
});
