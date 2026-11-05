/**
 * 1号艇の1コースでの まくられ・差され（spec §1.8、BOA-1331）。
 * 値は親（RaceWakuInfoTab）が持つ、レースより前の本人の走（records）から作る。追加の取得はしない。
 * records: undefined＝取得中、null＝取得失敗、配列＝取得済み。失敗を「0走」に倒さない。
 * 期間は当社データの全期間で、6艇の表の「直近3期／当地」の切り替えに連動しない。
 */
import { useTranslation } from "react-i18next";
import BoatBadge from "./BoatBadge";
import { buildCourse1LossBreakdown } from "./courseGridStats";
import { getDaysAgoJST } from "../../utils/dateUtils";
import { RACE_PAGE_FROM } from "../../utils/analogySimilarDisplay";
import "./Course1LossCard.css";

const slash = (date) => date.replaceAll("-", "/");

export default function Course1LossCard({ player, records, now, sixBoatPeriod }) {
  const { t } = useTranslation();
  if (!player) return null;
  const text = (key, options) => t(`wakuInfo.course1Loss.${key}`, options);
  const body = () => {
    if (records === undefined)
      return <p className="rwit-loading">{t("wakuInfo.loading")}</p>;
    if (records === null)
      return (
        <p className="rwit-empty" role="alert">
          {text("fetchError")}
        </p>
      );
    const b = buildCourse1LossBreakdown(records, { now });
    // 0走のときは期間の端が走から決まらないので、当社データの開始日とレースの前日を出す
    const range = {
      from: slash(b.from ?? RACE_PAGE_FROM),
      to: slash(b.to ?? getDaysAgoJST(1, now)),
    };
    if (b.n === 0)
      return <p className="course1-loss-sub">{text("empty", range)}</p>;
    const rows = [
      ["rowMakurare", b.makurare, b.makurarePct],
      ["rowSashi", b.sashi, b.sashiPct],
    ];
    return (
      <>
        <p className="course1-loss-sub">
          {text(b.reliable ? "sub" : "subSmall", { n: b.n, ...range })}
        </p>
        <dl className="course1-loss-rows">
          {rows.map(([key, count, pct]) => (
            <div key={key} className="course1-loss-row">
              <dt>{text(key)}</dt>
              <dd>
                {text("value", { n: b.n, count })}
                {b.reliable && <small>{text("valuePct", { pct })}</small>}
              </dd>
            </div>
          ))}
        </dl>
        <div className="course1-loss-notes">
          <p>{text("note1")}</p>
          <p>{text(sixBoatPeriod === "local" ? "note2Local" : "note2", range)}</p>
        </div>
      </>
    );
  };
  return (
    <section className="rwit-card course1-loss" data-testid="course1-loss">
      <h3 className="rwit-card-title">{text("title")}</h3>
      <p className="course1-loss-who">
        <BoatBadge n={1} size="xs" />
        <span className="course1-loss-name" translate="no">
          {player.name?.replace(/\s+/g, "")}
        </span>
        {player.grade && (
          <span className="course1-loss-grade">{player.grade}</span>
        )}
      </p>
      {body()}
    </section>
  );
}
