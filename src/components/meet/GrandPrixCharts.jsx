import { Link } from "react-router-dom";
import BoatBadge from "../race/BoatBadge";
import BaselineBar from "../race/BaselineBar";
import { formatYenMan } from "../../pure/grandPrixPhase.js";
import "./GrandPrixCharts.css";

// グランプリの特集（/grandprix、BOA-1724）の図。見せ方はオーナーが承認した見本2（visual-designer の案、2026-11-27）。
// データは入口のページが読んで props で渡す。色は SG の紫の濃淡（出場の組）と公式の艇の色（枠番が決まる所だけ）。
// 配当は色で煽らない

const Dots = ({ n, kind }) => (
  <span className="gp-dots" role="img" aria-label={`${n}人`}>
    {Array.from({ length: n }, (_, i) => (
      <span key={i} className={`gp-dot gp-dot--${kind}`} />
    ))}
  </span>
);

/** 勝ち上がり。1人を1つの点で、段ごとに並べる */
export function AdvanceFlow({ stages }) {
  return (
    <ol className="gp-flow">
      {stages.map((s) => (
        <li key={s.name} className="gp-card gp-stage">
          <p className="gp-sub">{s.when}</p>
          <p className="gp-strong">{s.name}</p>
          {s.finalLanes && (
            <p className="gp-flow-line">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <BoatBadge key={n} n={n} />
              ))}
            </p>
          )}
          {s.lines.map((l) => (
            <p key={l.text} className={`gp-flow-line${l.dots.some(([, k]) => k === "out") ? " gp-flow-line--out" : ""}`}>
              {l.dots.map(([n, kind], i) => (
                <Dots key={i} n={n} kind={kind} />
              ))}
              <span>{l.text}</span>
            </p>
          ))}
        </li>
      ))}
    </ol>
  );
}

const pct = (v) => `${v.toFixed(1)}%`;
const TECHNIQUES = [
  ["nige", "逃げ"],
  ["makuri", "まくり"],
  ["sashi", "差し"],
  ["makurizashi", "まくり差し"],
];

/**
 * 会場のコース別1着率と決まり手を、全国と並べる（会場ページの要約と同じ data/venueSummaryStats.js の値）。
 * @param {{venue: object, national: object, period: string, venueName: string}} props
 */
export function VenueVsNational({ venue, national, period, venueName }) {
  const flag = (vs) => vs && <span className="gp-flag">全国より{vs === "higher" ? "高い" : "低い"}</span>;
  const count = (n) => n.toLocaleString("ja-JP");
  return (
    <div className="gp-card gp-water">
      <p className="gp-badges">
        <span>
          {venueName} {count(venue.races)}レース
        </span>
        <span>全国 {count(national.races)}レース</span>
        <span>{period}</span>
        <span>┆ 点線＝全国</span>
      </p>
      <div className="gp-water-cols">
        <div>
          <h3>進入コース別の1着率</h3>
          {venue.courses.map((c, i) => (
            <BaselineBar key={c.course} label={`${c.course}コース`} rate={c.rate / 100} base={national.courses[i].rate / 100}>
              <b>{pct(c.rate)}</b> 全国{pct(national.courses[i].rate)}
              {c.course === 1 && flag(venue.vsNational.course1)}
            </BaselineBar>
          ))}
        </div>
        <div>
          <h3>決まり手（全レースのうちの割合）</h3>
          {TECHNIQUES.map(([k, label]) => (
            <BaselineBar key={k} label={label} rate={venue.techniques[k].rate / 100} base={national.techniques[k].rate / 100}>
              <b>{pct(venue.techniques[k].rate)}</b> 全国{pct(national.techniques[k].rate)}
              {flag(venue.vsNational[k])}
            </BaselineBar>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 過去の優勝戦: 優勝した枠番の帯と1年1枚のカード */
export function PastFinalCards({ finals }) {
  const wins1 = finals.filter((f) => f.lane === 1).length;
  return (
    <>
      <div className="gp-lanes">
        {finals.map((f) => (
          <span key={f.year} className="gp-lane">
            <BoatBadge n={f.lane} />
            <span className="gp-sub">{f.year}</span>
          </span>
        ))}
        <span className="gp-strong">
          1号艇の1着は{finals.length}回中{wins1}回
        </span>
      </div>
      <div className="gp-finals">
        {finals.map((f) => (
          <div key={f.year} className="gp-card gp-final">
            <p className="gp-final-year">
              {f.year}
              <span className="gp-sub">
                {f.venue} {f.date}
              </span>
            </p>
            <p className="gp-final-row">
              <BoatBadge n={f.lane} />
              <b translate="no">{f.winner}</b>
              <span>
                {f.lane}号艇{f.entry ? `（${f.entry}コース）` : ""}・{f.technique}
              </span>
            </p>
            <p className="gp-final-row">
              <span className="gp-sub">3連単</span>
              {f.trifecta ? (
                <>
                  {f.trifecta.map((b, i) => (
                    <BoatBadge key={i} n={b} size="sm" />
                  ))}
                  <span>
                    {f.payout.toLocaleString("ja-JP")}円（{f.popularity}番人気）
                  </span>
                </>
              ) : (
                <span className="gp-sub">不成立</span>
              )}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * 開幕までの日数・開催中の日目・終了の帯。phase は pure/grandPrixPhase.js の grandPrixPhase の返り値
 * @param {{phase: {phase: string, days?: number, day?: number}, openLabel: string}} props
 */
export function Countdown({ phase, openLabel }) {
  const [big, unit, note] =
    phase.phase === "before"
      ? [phase.days, "日", `開幕まで（${openLabel}）`]
      : phase.phase === "during"
        ? [phase.day, "日目", "開催中"]
        : ["", "", "開催は終わりました"];
  return (
    <p className="gp-countdown">
      <span className="gp-countdown-num">{big}</span>
      <span className="gp-countdown-unit">{unit}</span>
      <span>{note}</span>
    </p>
  );
}

/** 獲得賞金の上位18人の横棒。6位と7位の間に線（2ndから／1stから）。名前は選手ページへ */
export function PrizeBars({ racers }) {
  const top = racers[0].yen;
  const row = (r, i) => {
    const w = `${(r.yen / top) * 100}%`;
    return (
      <div key={r.toban} className={`gp-prize-row${i < 6 ? " gp-prize-row--2nd" : ""}`}>
        <span className="gp-prize-rank">{i + 1}</span>
        <Link to={`/racer/${r.toban}`} translate="no">
          {r.name}
        </Link>
        <span className="gp-prize-track">
          <span className="gp-prize-fill" style={{ width: w }} />
          <span className="gp-prize-value" style={{ left: w }}>
            {formatYenMan(r.yen)}
          </span>
        </span>
      </div>
    );
  };
  return (
    <div className="gp-card gp-prize">
      <p className="gp-group">
        <span className="gp-dot gp-dot--2nd" /> トライアル2ndから（賞金1〜6位・6人）
      </p>
      {racers.slice(0, 6).map(row)}
      <p className="gp-group gp-group--cut">
        <span className="gp-dot gp-dot--1st" /> トライアル1stから（賞金7〜18位・12人）
      </p>
      {racers.slice(6, 18).map((r, i) => row(r, i + 6))}
    </div>
  );
}
