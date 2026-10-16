/** 選手ページの「STの推移」のアンカー（BOA-879） */
export const ST_TREND_ID = "st-trend";

/** 選手ページ（ja 専用）へのパス。section="stTrend" で「STの推移」へ直接移る */
export const racerPagePath = (racerId, section) =>
  `/racer/${racerId}${section === "stTrend" ? `#${ST_TREND_ID}` : ""}`;
