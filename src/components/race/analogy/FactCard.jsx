import { useState } from "react";
import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import { SCOPE_LINE } from "./analogyColors";
import { fmtCount, fmtFactValue, fmtPct } from "../../../utils/analogyFormat";
import {
  FACT_ITEMS,
  MIN_RATE_N,
  judgeLabelKey,
  rateOf,
  todayLine,
  todayPosition,
  todayValueRank,
  usualOf,
} from "../../../utils/analogyFacts";

const k = "aiPredictionTab.analogy.facts";

/** 「6.67〜8.67点」「23〜50%」（単位は後ろにだけ付ける） */
function fmtRange(a, b, unit) {
  const strip = (s, u) => (u && s.endsWith(u) ? s.slice(0, -u.length) : s);
  if (a.endsWith("%") && b.endsWith("%")) return `${a.slice(0, -1)}〜${b}`;
  return `${strip(a, unit)}〜${b}`;
}

/**
 * 今日の棒の下の1行（承認モック sonar-tab v3）。以前の「今日の一文」を、棒・札・今日の値と重ならない
 * 部分（件数とぶれ幅）だけに分けて、今日の棒の下に置く。今日の値が無い・件数0は null
 */
function TodayHit({ row, values, boat, scopeFacts, target, withBadge }) {
  const { t } = useTranslation();
  const line = todayLine(row, values, boat, scopeFacts, target);
  if (!line) return null;
  return (
    <p className="af-today-hit" data-testid="analogy-today-hit">
      {withBadge && (
        <>
          <BoatBadge n={boat} size="xs" />{" "}
        </>
      )}
      {t(`${k}.todayHit`, {
        rank: line.bucket,
        rate: fmtPct(line.rate),
        hits: fmtCount(line.hit[0]),
        n: fmtCount(line.hit[1]),
        lo: Math.round(line.lo * 100),
        hi: Math.round(line.hi * 100),
      })}
    </p>
  );
}

/** 今日の値（単位つき）と6艇中の順位。値が無ければ value は "—" */
function useTodayValue(row, values) {
  const { t } = useTranslation();
  const unit = t(`${k}.units.${row.key}`, "");
  const hib = FACT_ITEMS.find((it) => it.key === row.key).hib;
  const withUnit = (v) => {
    const s = fmtFactValue(row.key, v);
    return s === "—" || s.endsWith("%") ? s : `${s}${unit}`;
  };
  const of = (b) => {
    const r = todayValueRank(values, hib, b);
    const rank = !r
      ? t(`${k}.noToday${row.key === "loc_win" ? "Local" : ""}`)
      : r.from === r.to
        ? t(`${k}.rankOf6`, { n: r.from })
        : t(`${k}.rankOf6Tie`, { from: r.from, to: r.to, same: r.same });
    const rankShort = !r
      ? "—"
      : r.from === r.to
        ? t(`${k}.stripRank`, { rank: r.from })
        : t(`${k}.stripRankTie`, { from: r.from, to: r.to });
    return { r, rank, rankShort, value: r ? withUnit(r.value) : "—" };
  };
  return { of, withUnit, unit, hib };
}

/**
 * 項目ごとのカード（spec A-7、承認モック sonar-tab v3）。閉じた状態は1行の要約（項目名・判定・今日の順位・
 * 一番良い/悪いときの率）、開くと今日の値と6艇の範囲・一番良い/悪いときの率と件数・6つの順位の棒・今日の棒の
 * 件数とぶれ幅。「差が大きい」のカードだけ最初から開く（2026-10-08 ユーザー決定）。
 * 棒の見方は節の上に凡例で1回だけ出す（カードごとに繰り返さない）
 * @param {{row: object, boat: number, compareBoat: number|null, scopeFacts: object, values: (number|null)[]|null,
 *   target: 1|2|3, todayPos: number|null, hideLine: boolean, note: string|null, scope: string}} props
 */
export default function FactCard({
  venueName,
  row,
  boat,
  compareBoat,
  scopeFacts,
  values,
  target,
  todayPos,
  hideLine,
  note,
  scope,
}) {
  const { t } = useTranslation();
  const judgeKey = judgeLabelKey(row.judge, row.all[0], row.all[5]);
  const [open, setOpen] = useState(judgeKey === "large");
  const [showDesc, setShowDesc] = useState(false);
  const word = (w) => t(`${k}.words.${w}`);
  const rateName = t(`aiPredictionTab.analogy.rateName.${target}`);
  const usual = rateOf(usualOf(scopeFacts, boat, target));
  const [best, worst] = [row.all[0], row.all[5]];
  const weak = row.judge.level === "unclear" || row.judge.level === "none";
  const max =
    Math.max(...row.rates.filter((p) => p !== null), usual ?? 0, 0.01) * 1.12;
  const label = t(`${k}.items.${row.key}.label`);
  const { of: todayOf, withUnit, unit, hib } = useTodayValue(row, values);
  const stripAria = t(`${k}.stripLabel`, {
    item: label,
    rate: rateName,
    list: row.rates
      .map((p, i) => `${t(`${k}.stripRank`, { rank: i + 1 })} ${fmtPct(p)}`)
      .join(t("aiPredictionTab.analogy.listSeparator")),
  });
  const me = todayOf(boat);
  const pairCount = (pair) =>
    pair
      ? t(`${k}.pairCount`, {
          hits: fmtCount(pair[0]),
          n: fmtCount(pair[1]),
        })
      : "—";

  let compare = null;
  if (compareBoat) {
    const by = scopeFacts?.by?.[String(compareBoat)]?.[row.key];
    const tk = { 1: "win", 2: "top2", 3: "top3" }[target];
    const cb = rateOf(by?.["1"]?.[tk]);
    const cw = rateOf(by?.["6"]?.[tk]);
    compare = (
      <>
        <p className="af-sub">
          {t(`${k}.compareLine`, {
            boat: compareBoat,
            good: word(row.good),
            bad: word(row.bad),
            best: fmtPct(cb),
            worst: fmtPct(cw),
            scope,
            usual: fmtPct(rateOf(usualOf(scopeFacts, compareBoat, target))),
          })}
        </p>
        {!hideLine && (
          <TodayHit
            row={row}
            values={values}
            boat={compareBoat}
            scopeFacts={scopeFacts}
            target={target}
            withBadge
          />
        )}
      </>
    );
  }
  // 6艇の今日の値の範囲（「6艇は1.00〜10.00点」）
  const pos = values ? todayPosition(values, hib, boat) : null;
  const range =
    pos && Number.isFinite(pos.min) && Number.isFinite(pos.max)
      ? fmtRange(withUnit(pos.min), withUnit(pos.max), unit)
      : null;

  return (
    <details
      className={`af-card${weak ? " is-weak" : ""}`}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      data-testid="analogy-fact-card"
    >
      <summary className="af-card-sum">
        <span className="af-card-head">
          <span className="af-card-name">{label}</span>
          <button
            type="button"
            className="af-q"
            aria-expanded={showDesc}
            aria-label={t(`${k}.whatIs`, { item: label })}
            onClick={(e) => {
              // summary の中のボタンなので、押してもカードの開閉にしない
              e.preventDefault();
              e.stopPropagation();
              setOpen(true);
              setShowDesc((v) => !v);
            }}
          >
            ?
          </button>
          <span className="af-card-judge">
            {t(`${k}.judge.${judgeKey}`)}
            {row.judge.reversed && t(`${k}.reversed`, { word: word(row.bad) })}
          </span>
        </span>
        <span className="af-card-chev" aria-hidden="true" />
        <span className="af-card-brief af-num">
          <span>
            {t(`${k}.briefToday`, {
              rank: me.r ? me.rank : "—",
              value: me.value,
            })}
          </span>
          <span>
            {t(`${k}.briefBest`, { word: word(row.good) })}{" "}
            <b>{fmtPct(row.rates[0])}</b>
          </span>
          <span>
            {t(`${k}.briefBest`, { word: word(row.bad) })}{" "}
            <b>{fmtPct(row.rates[5])}</b>
          </span>
        </span>
      </summary>
      <div className="af-card-body">
        {showDesc && (
          <p className="af-card-desc">
            {t(`${k}.items.${row.key}.desc`, { venue: venueName })}
          </p>
        )}
        {[boat, compareBoat].filter(Boolean).map((b) => {
          // 選んだ艇の今日の値と6艇中の順位（棒の強調を出さない日も出す。2026-10-06 ユーザー指摘）
          const v = todayOf(b);
          return (
            <div key={b}>
              <p className="af-card-today">
                <BoatBadge n={b} size="xs" />{" "}
                {t(`${k}.todayValue`, {
                  boat: b,
                  value: v.value,
                  rank: v.rank,
                })}
              </p>
              {b === boat && range && (
                <p className="af-card-range">
                  {t(`${k}.todayRangeOf6`, { range })}
                </p>
              )}
            </div>
          );
        })}
        <div className="af-pair">
          {[
            [best, row.rates[0], row.good],
            [worst, row.rates[5], row.bad],
          ].map(([pair, p, w]) => (
            <div
              key={w}
              className={pair && pair[1] < MIN_RATE_N ? "is-few" : undefined}
            >
              <span>{t(`${k}.best`, { word: word(w) })}</span>
              <b>{fmtPct(p)}</b>
              <small>
                {pairCount(pair)}
                {pair && pair[1] < MIN_RATE_N && ` ${t(`${k}.few`)}`}
              </small>
            </div>
          ))}
        </div>
        {/* 棒は6艇ではなく「この艇が6艇中何位だったか」の6区分（2026-10-06 ユーザー指摘） */}
        <p className="af-strip-title">
          <BoatBadge n={boat} size="xs" />{" "}
          {t(`${k}.stripTitleShort`, { rate: rateName })}
        </p>
        <div className="af-strip" role="img" aria-label={stripAria}>
          {row.rates.map((p, i) => {
            const on = todayPos === i + 1;
            return (
              <div
                key={i}
                className={`af-strip-col${on ? " is-today" : ""}${row.all[i] && row.all[i][1] < MIN_RATE_N ? " is-few" : ""}`}
                title={row.all[i] ? pairCount(row.all[i]) : ""}
              >
                <span className="af-num">
                  {p === null ? "—" : `${Math.round(p * 100)}%`}
                </span>
                <span className="af-strip-plot">
                  <span
                    className="af-strip-bar"
                    style={{
                      height: `${p === null ? 0 : (p / max) * 100}%`,
                      background: SCOPE_LINE[boat],
                    }}
                  />
                  {usual !== null && (
                    <span
                      className="af-strip-usual"
                      style={{ bottom: `${(usual / max) * 100}%` }}
                    />
                  )}
                </span>
                <span className="af-strip-rank">
                  {i === 0
                    ? t(`${k}.stripTop`, { word: word(row.good) }).replace(
                        /^(.+?)(（.+）)$/,
                        "$1\n$2",
                      )
                    : i === 5
                      ? t(`${k}.stripBottom`, { word: word(row.bad) }).replace(
                          /^(.+?)(（.+）)$/,
                          "$1\n$2",
                        )
                      : t(`${k}.stripRank`, { rank: i + 1 })}
                </span>
              </div>
            );
          })}
        </div>
        {!hideLine && todayPos && (
          <TodayHit
            row={row}
            values={values}
            boat={boat}
            scopeFacts={scopeFacts}
            target={target}
          />
        )}
        {note && (
          <p className="af-sub">
            {t(`${k}.${note === "final" ? "noteFinal" : "noteEarly"}`)}
          </p>
        )}
        {compare}
      </div>
    </details>
  );
}
