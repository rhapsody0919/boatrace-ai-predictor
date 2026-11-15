import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { signedText as signed } from "../../utils/inCautionLevel";

/** 姓だけ（承認モックの「1号艇 澤崎（B1）」の形。全角・半角の空白の前） */
const surnameOf = (name) => (name ?? "").trim().split(/\s+/)[0] ?? "";

/** 右（理由・導線・免責） */
export default function InCautionCardSide({
  ic,
  players,
  raceId,
  onOpenSonar,
  sendClick,
}) {
  const { t, i18n } = useTranslation();
  const byNumber = (n) => players?.find((p) => p.number === n) ?? null;
  const boat1 = byNumber(1);
  const top = byNumber(ic.topOtherBoat);
  return (
    <div className="in-caution-card-side">
      <div className="in-caution-card-reason">
        <h4>{t("inCaution.reasonHeading")}</h4>
        <dl>
          <div>
            <dt>
              {t("inCaution.reasonBoat1")}{" "}
              <span translate="no">{surnameOf(boat1?.name)}</span>
              {boat1?.grade ? `（${boat1.grade}）` : ""}
            </dt>
            <dd>{ic.boat1WinRate.toFixed(2)}</dd>
          </div>
          <div>
            <dt>
              {t("inCaution.reasonTop", { boat: ic.topOtherBoat })}{" "}
              <span translate="no">{surnameOf(top?.name)}</span>
              {top?.grade ? `（${top.grade}）` : ""}
            </dt>
            <dd>{ic.topOtherWinRate.toFixed(2)}</dd>
          </div>
          <div>
            <dt>{t("inCaution.reasonDiff")}</dt>
            <dd>{signed(ic.gapCents / 100, 2)}</dd>
          </div>
        </dl>
        <p className="in-caution-card-note">{t("inCaution.otherMaterial")}</p>
      </div>

      <p className="in-caution-card-note in-caution-card-disclaimer">
        {t("inCaution.disclaimer")}
      </p>

      <div className="in-caution-card-links">
        {onOpenSonar && (
          // 行き先を URL で表せる導線なのでリンクにする（新しいタブでも開ける）。ふつうに押したときは同じ画面の中で切り替える
          <a
            className="in-caution-card-link"
            href={`/race/${raceId}?tab=sonar&sonar=similar`}
            onClick={(e) => {
              sendClick("sonar");
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                return;
              e.preventDefault();
              onOpenSonar();
            }}
          >
            <span>{t("inCaution.sonarButton")}</span>
            <span className="in-caution-card-link-go">
              {t("inCaution.sonarGo")} ›
            </span>
          </a>
        )}
        {i18n.language === "ja" && (
          <Link
            className="in-caution-card-link"
            to={`/race/${raceId}/assist`}
            onClick={() => sendClick("assist")}
          >
            <span>{t("inCaution.assistButton")}</span>
            <span className="in-caution-card-link-go">
              {t("inCaution.assistGo")} ›
            </span>
          </Link>
        )}
      </div>
      <Link
        className="in-caution-card-accuracy"
        to="/accuracy"
        onClick={() => sendClick("accuracy")}
      >
        {t("inCaution.accuracyLink")} ›
      </Link>
    </div>
  );
}
