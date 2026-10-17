/**
 * イン崩れ注意度の段ごとの実績（BOA-822 task 24、screens S-5、承認モック mock/3-accuracy-375.png）。
 * /accuracy と /winning-technique?tab=volatility で使う（機能フラグ isInCautionEnabled() の側）。
 * 夜の in_caution_bands.py が書く accuracy_cache.in_caution_accuracy を読むだけ。「公開後」と「公開前の検証」を切り替える
 * （承認）。段ごとに1号艇が1着を逃した割合・件数・ぶれ幅の棒（段の範囲の帯・全レースの点線）。30件未満の段は件数だけ。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import { IN_CAUTION_CONFIG } from "../../constants/inCautionConfig";
import { inCautionAccuracyView, pct1 } from "../../utils/inCautionAccuracy";
import { errorMessageOf } from "../../utils/errorMessage.js";
import "./InCautionAccuracyChart.css";

const [LOW, HIGH] = IN_CAUTION_CONFIG.thresholds;
/** 段の範囲（0〜100 の帯） */
const ZONE = { low: [0, LOW], mid: [LOW, HIGH], high: [HIGH, 100] };

/** "2025-06-01" → "2025/6/1" */
const ymd = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}/${m}/${d}`;
};

/** from〜through の日数（両端を含む） */
const daysBetween = (from, through) =>
  Math.round((Date.parse(through) - Date.parse(from)) / 86400000) + 1;

function LevelRow({ row, baseRate, t }) {
  const name = t(`inCaution.level.${row.level}`);
  const label =
    row.level === "high"
      ? t("accuracy.inCaution.levelHigh", { level: name, p: HIGH })
      : row.level === "low"
        ? t("accuracy.inCaution.levelLow", { level: name, p: LOW })
        : t("accuracy.inCaution.levelMid", { level: name, lo: LOW, hi: HIGH });
  const [zFrom, zTo] = ZONE[row.level];
  return (
    <li className={`ica-row ica-row--${row.level}`}>
      <div className="ica-row-head">
        <span className="ica-row-label">{label}</span>
        <span className="ica-row-rate">
          {row.rate === null ? "—" : `${pct1(row.rate)}%`}
        </span>
      </div>
      <div className="ica-track" aria-hidden="true">
        {row.rate !== null && (
          <span className="ica-fill" style={{ width: `${row.rate * 100}%` }} />
        )}
        {baseRate !== null && (
          <span className="ica-base" style={{ left: `${baseRate * 100}%` }} />
        )}
      </div>
      <div className="ica-zone" aria-hidden="true">
        <span
          style={{ left: `${zFrom}%`, width: `${zTo - zFrom}%` }}
          className="ica-zone-band"
        />
      </div>
      <p className="ica-row-count">
        {row.rate === null
          ? t("accuracy.inCaution.countFew", {
              n: row.n.toLocaleString(),
            })
          : t("accuracy.inCaution.count", {
              n: row.n.toLocaleString(),
              share: Math.round(row.share * 100),
              lo: pct1(row.lo),
              hi: pct1(row.hi),
            })}
      </p>
    </li>
  );
}

function InCautionAccuracyChart() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [chosen, setChosen] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabaseDataService
      .getInCautionAccuracy()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setStatus(d?.prelaunch || d?.postlaunch ? "ready" : "empty");
      })
      .catch((err) => {
        console.error("in_caution_accuracy:", errorMessageOf(err));
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const post = data?.postlaunch ?? null;
  const pre = data?.prelaunch ?? null;
  // 既定は公開後（あれば）。公開前は公開前の検証だけ
  const tab = chosen ?? (post ? "post" : "pre");
  const section = tab === "post" ? post : pre;
  const view = inCautionAccuracyView(section);

  return (
    <section className="ica" aria-labelledby="ica-title">
      <h2 id="ica-title" className="ica-title">
        {t("accuracy.inCaution.title")}
      </h2>
      <p className="ica-lead">{t("accuracy.inCaution.lead")}</p>
      {status === "loading" && (
        <p className="ica-note">{t("accuracy.inCaution.loading")}</p>
      )}
      {status === "error" && (
        <p className="ica-note">{t("accuracy.inCaution.error")}</p>
      )}
      {status === "empty" && (
        <p className="ica-note">{t("accuracy.inCaution.empty")}</p>
      )}
      {status === "ready" && (
        <>
          <div className="ica-switch" role="group">
            <button
              type="button"
              className="ica-switch-btn"
              aria-pressed={tab === "post"}
              disabled={!post}
              onClick={() => setChosen("post")}
            >
              {post
                ? t("accuracy.inCaution.tabPost", { from: ymd(post.from) })
                : t("accuracy.inCaution.tabPostNone")}
            </button>
            <button
              type="button"
              className="ica-switch-btn"
              aria-pressed={tab === "pre"}
              disabled={!pre}
              onClick={() => setChosen("pre")}
            >
              {pre
                ? t("accuracy.inCaution.tabPre", {
                    from: ymd(pre.from),
                    to: ymd(pre.to),
                  })
                : t("accuracy.inCaution.tabPreNone")}
            </button>
          </div>
          {!post && (
            <p className="ica-note">{t("accuracy.inCaution.postNone")}</p>
          )}
          {view && (
            <>
              <p className="ica-note ica-period">
                {tab === "post"
                  ? t("accuracy.inCaution.notePost", {
                      from: ymd(section.from),
                      through: ymd(section.through),
                      n: view.base.n.toLocaleString(),
                    })
                  : t("accuracy.inCaution.notePre", {
                      n: view.base.n.toLocaleString(),
                    })}
              </p>
              <div className="ica-card">
                <h3 className="ica-card-title">
                  {t("accuracy.inCaution.barsTitle")}
                </h3>
                {view.base.rate !== null && (
                  <div className="ica-base-label-row">
                    <span
                      className="ica-base-label"
                      style={{ left: `${view.base.rate * 100}%` }}
                    >
                      {t("inCaution.base", { p: pct1(view.base.rate) })}
                    </span>
                  </div>
                )}
                <ul className="ica-rows">
                  {view.rows.map((row) => (
                    <LevelRow
                      key={row.level}
                      row={row}
                      baseRate={view.base.rate}
                      t={t}
                    />
                  ))}
                </ul>
                <p className="ica-note">{t("accuracy.inCaution.legend")}</p>
                {tab === "post" && view.rows.some((r) => r.rate === null) && (
                  <p className="ica-note">
                    {t("accuracy.inCaution.fewNote", {
                      days: daysBetween(section.from, section.through),
                    })}
                  </p>
                )}
              </div>
            </>
          )}
          <div className="ica-card ica-about">
            <h3 className="ica-card-title">
              {t("accuracy.inCaution.aboutTitle")}
            </h3>
            <p>{t("accuracy.inCaution.about1")}</p>
            <p>{t("accuracy.inCaution.about2")}</p>
            <p className="ica-note">{t("inCaution.disclaimer")}</p>
          </div>
        </>
      )}
    </section>
  );
}

export default InCautionAccuracyChart;
