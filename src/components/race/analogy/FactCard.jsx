import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import { SCOPE_LINE } from "./analogyColors";
import { fmtCount, fmtFactValue, fmtPct } from "../../../utils/analogyFormat";
import {
  FACT_ITEMS,
  rateOf,
  todayLine,
  todayValueRank,
  usualOf,
} from "../../../utils/analogyFacts";

const k = "aiPredictionTab.analogy.facts";

/** 「6.67〜8.67」「23〜50%」 */
function fmtRange(a, b) {
  return a.endsWith("%") && b.endsWith("%")
    ? `${a.slice(0, -1)}〜${b}`
    : `${a}〜${b}`;
}

/**
 * 今日の一文（spec A-7）。今日の値が無い・件数0は null
 */
function TodaySentence({ row, values, boat, scopeFacts, target }) {
  const { t } = useTranslation();
  const line = todayLine(row, values, boat, scopeFacts, target);
  if (!line) return null;
  const words = (w) => t(`${k}.words.${w}`);
  const where =
    line.bucket === 1
      ? t(`${k}.where.best`, { word: words(row.good) })
      : line.bucket === 6
        ? t(`${k}.where.worst`, { word: words(row.bad) })
        : t(`${k}.where.middle`, { word: words(row.good), rank: line.bucket });
  const inner = [
    line.same > 1 ? t(`${k}.sameValue`, { n: line.same }) : null,
    t(`${k}.todayRange`, {
      value: fmtFactValue(row.key, line.value),
      range: fmtRange(
        fmtFactValue(row.key, line.min),
        fmtFactValue(row.key, line.max),
      ),
    }),
  ]
    .filter(Boolean)
    .join(t("aiPredictionTab.analogy.sentenceSep"));
  return (
    <p className="af-today">
      {t(`${k}.todayLine`, {
        boat,
        item: t(`${k}.items.${row.key}.label`),
        where,
        inner: t(`${k}.paren`, { inner }),
        rate: fmtPct(line.rate),
        finish: t(`aiPredictionTab.analogy.targets.${target}`),
        hits: fmtCount(line.hit[0]),
        n: fmtCount(line.hit[1]),
        lo: Math.round(line.lo * 100),
        hi: Math.round(line.hi * 100),
      })}
    </p>
  );
}

/**
 * 項目ごとのカード（spec A-7）。<article> に見出し・判定・一番良い/悪いときの率・6つの順位の棒・今日の一文
 * @param {{row: object, boat: number, compareBoat: number|null, scopeFacts: object, values: (number|null)[]|null,
 *   compareValues?: (number|null)[]|null, target: 1|2|3, todayPos: number|null, hideLine: boolean, note: string|null}} props
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
}) {
  const { t } = useTranslation();
  const word = (w) => t(`${k}.words.${w}`);
  const rateName = t(`aiPredictionTab.analogy.rateName.${target}`);
  const usual = rateOf(usualOf(scopeFacts, boat, target));
  const [best, worst] = [row.all[0], row.all[5]];
  const weak = row.judge.level === "unclear" || row.judge.level === "none";
  const max =
    Math.max(...row.rates.filter((p) => p !== null), usual ?? 0, 0.01) * 1.12;
  const label = t(`${k}.items.${row.key}.label`);
  const stripAria = t(`${k}.stripLabel`, {
    item: label,
    rate: rateName,
    list: row.rates
      .map((p, i) => `${t(`${k}.stripRank`, { rank: i + 1 })} ${fmtPct(p)}`)
      .join(t("aiPredictionTab.analogy.listSeparator")),
  });
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
            rate: rateName,
            usual: fmtPct(rateOf(usualOf(scopeFacts, compareBoat, target))),
          })}
        </p>
        {!hideLine && (
          <TodaySentence
            row={row}
            values={values}
            boat={compareBoat}
            scopeFacts={scopeFacts}
            target={target}
          />
        )}
      </>
    );
  }
  return (
    <article className={`af-card${weak ? " is-weak" : ""}`}>
      <div className="af-card-head">
        <h4>{label}</h4>
        <small className="af-card-desc">
          {t(`${k}.items.${row.key}.desc`, { venue: venueName })}
        </small>
        <span className="af-card-judge">
          {t(`${k}.judge.${row.judge.level}`)}
          {row.judge.reversed && t(`${k}.reversed`, { word: word(row.bad) })}
        </span>
      </div>
      {[boat, compareBoat].filter(Boolean).map((b) => {
        // 選んだ艇の今日の値と6艇中の順位（棒の強調・今日の一文を出さない日も出す。2026-10-06 ユーザー指摘）
        const r = todayValueRank(
          values,
          FACT_ITEMS.find((it) => it.key === row.key).hib,
          b,
        );
        return (
          <p key={b} className="af-card-today">
            <BoatBadge n={b} size="xs" />{" "}
            {t(`${k}.todayValue`, {
              boat: b,
              value: r
                ? `${fmtFactValue(row.key, r.value)}${t(`${k}.units.${row.key}`, "")}`
                : "—",
              rank: !r
                ? t(`${k}.noToday`)
                : r.from === r.to
                  ? t(`${k}.rankOf6`, { n: r.from })
                  : t(`${k}.rankOf6Tie`, {
                      from: r.from,
                      to: r.to,
                      same: r.same,
                    }),
            })}
          </p>
        );
      })}
      <div className="af-pair">
        {[
          [best, row.rates[0], row.good],
          [worst, row.rates[5], row.bad],
        ].map(([pair, p, w]) => (
          <div key={w}>
            <span>{t(`${k}.best`, { word: word(w) })}</span>
            <b>{fmtPct(p)}</b>
            <small>
              {pair ? `${fmtCount(pair[0])}/${fmtCount(pair[1])}` : "—"}
            </small>
          </div>
        ))}
      </div>
      {/* 棒は6艇ではなく「この艇が6艇中何位だったか」の6区分。どの艇の棒かを上に書く（2026-10-06 ユーザー指摘） */}
      <p className="af-strip-title">
        <BoatBadge n={boat} size="xs" />{" "}
        {t(`${k}.stripTitle`, { boat, item: label, rate: rateName })}
      </p>
      <div className="af-strip" role="img" aria-label={stripAria}>
        {row.rates.map((p, i) => {
          const on = todayPos === i + 1;
          return (
            <div
              key={i}
              className={`af-strip-col${on ? " is-today" : ""}`}
              title={row.all[i] ? `${row.all[i][0]}/${row.all[i][1]}` : ""}
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
      <p className="af-foot">
        {/* 今日の位置の枠が無いとき（優勝戦の日の今節の平均着順点・今日の値が無い）は「枠で囲んだ棒…」を言わない（BOA-778） */}
        {t(todayPos ? `${k}.stripCap` : `${k}.stripCapNoToday`, {
          word: word(row.good),
          usual: fmtPct(usual, 1),
        })}
      </p>
      {!hideLine && (
        <TodaySentence
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
    </article>
  );
}
