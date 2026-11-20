// push-research-image.js から移した、型ごとの取り込みの決まり PUSH_RULES（import は時刻の定数だけ）
import {
  AS_OF,
  SEND_TIME_EARLIEST,
  SEND_TIME_LATEST,
} from "./researchSchedule.js";
/**
 * 型ごとの取り込みの決まり。結果の1行の札（tag）・送る時刻の幅・機械の検査の P0 の要否・集計の時刻の書き方。
 * 節の機力: 送る時刻は 21:30 だけ（hq config/setsu-kiryoku.json の send_time、正本 hq drafts/x-setsu-kiryoku-20261031.md）。
 *   hq の作り手は review を出さない（関門は setsu_sheet.py の verify が作る前に見る）ので、review は有れば P0 が0件であることだけを見る。
 *   source_observed_at は時差つきの ISO か、hq の集計の as_of（「YYYY-MM-DD NR まで」、日は date と同じ）。as_of のときは
 *   時刻を持たないので、その日の 00:00 JST（いちばん古い見積り）を集計の時刻として DB の鮮度の照合（24時間）に渡し、as_of の文字列は
 *   下書きに残す（受け取った時刻にすると、作り直しのたびに新しく見え、鮮度の照合が名前だけになる。/code-review の指摘）。
 *   選手（racers）は必ず名前と級（setsuRacerReasons、オーナー 2026-11-01）。dryRunAhead: --dry-run で今日でない束を送る時刻の時計で通す
 *   （hq の見本を前の日に試すため。数字で見たらは今までどおり今日の束だけ）。extraSource: 下書きの source_data に足す欄
 */
export const PUSH_RULES = {
  research_image: {
    tag: "RESEARCH_RESULT",
    earliest: SEND_TIME_EARLIEST,
    latest: SEND_TIME_LATEST,
    requireReview: true,
    allowAsOf: false,
    dryRunAhead: false,
    extraSource: () => ({}),
  },
  setsu_kiryoku: {
    tag: "SETSU_RESULT",
    earliest: "21:30",
    latest: "21:30",
    requireReview: false,
    allowAsOf: true,
    dryRunAhead: true,
    // 画像の材料の選手（名前と級。送る直前の読み直しが見る）と節・ネタ・集計の as_of
    extraSource: (bundle) => ({
      meet_id: bundle.meet_id ?? null,
      neta: bundle.neta ?? null,
      racers: bundle.racers,
      // hq 33bd771 からは as_of の欄（「YYYY-MM-DD NR まで」）を別に出す。古い束は source_observed_at が as_of の形
      as_of:
        typeof bundle.as_of === "string"
          ? bundle.as_of
          : AS_OF.test(bundle.source_observed_at ?? "")
            ? bundle.source_observed_at
            : null,
    }),
  },
};
