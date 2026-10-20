/**
 * 送信の道（scripts/sns/push-full-picture.js）に渡す bundle.json の中身（純粋関数）。
 * 2026-10-21 オーケストレーターの分担（a・b・c の文型）と、送信レーンとの Shorts の契約（bundle_version 2）:
 * - x_text: 入口版の本文＋このレースの URL をちょうど1つ（X には入口版 full-x.mp4）
 * - youtube_full: 完全版（通常の動画、full-youtube.mp4）の題名・説明文（要点・URL・章・免責）
 * - youtube_shorts: 入口版を Shorts に出す題名・説明文。説明文に完全版の URL の置き場所 `{full_url}` をちょうど1つ（送信側が置き換える）
 * - qa.machine: run-full の機械の検査（全部 true のときだけ bundle を出す）
 * review（評価役の P0）は入れない（hq の側。機械の検査だけにするかはオーナーの判断）。
 * 文は文型で固定（LLM を使わない）。数値は場面の文型の答えから取り、動画に出る数字だけを書く。
 */
export const BUNDLE_VERSION = 2;
export const SITE = "https://www.boat-ai.jp";
export const FULL_URL_SLOT = "{full_url}";
/** 置き場所を完全版の URL（https://youtu.be/<id>）に置き換えたときに増える字数の上限の見込み */
export const FULL_URL_GROWTH = 40;
export const LIMITS = { title: 100, description: 5000 };
export const DISCLAIMER = "過去のレースを集計した参考の値です。結果を保証するものではありません。";
export const HASHTAG = "#ボートレース";

const raceUrl = (raceId) => `${SITE}/race/${raceId}`;
const join = (lines) => lines.filter((l) => l !== null && l !== undefined).join("\n");
const one = (lines) => (lines?.length ? lines.join("、") : null);

/**
 * @param {{raceId: string, venue: string, raceNo: number, month: number, day: number,
 *   answers: Record<string, string[]>, entryFirstQuestion: string, chapters: string, qa: Record<string, boolean>}} p
 *   answers: 文型の版の答え（場面の拍の id → 行）。入口版の結論 s4-conclusion を含める
 */
export function buildBundle({ raceId, venue, raceNo, month, day, answers, entryFirstQuestion, chapters, qa }) {
  const label = `${venue}${raceNo}R`;
  const date = `${month}/${day}`;
  const url = raceUrl(raceId);
  const venueLine = one(answers["s1-venue90"]);
  const conclusion = one(answers["s4-conclusion"]);
  const overview = one(answers["overview"]);
  const x_text = join([entryFirstQuestion, venueLine, conclusion, `データは龍神レーダーで ${url}`, HASHTAG]);
  const youtube_full = {
    // 会場・R・日付を前に、発見を1つ（会場の1号艇の1着率）。Shorts の題名とは別の文
    title: `【${label}・${date}】${venue}の1号艇の1着率と6艇の比較・展開の傾向`,
    description: join([
      `${label}（${date}）のデータを、条件・6艇の比較・類似レース・軸・展開・相手・機力と調子の順に見る動画です。`,
      venueLine,
      overview,
      "",
      `このレースのデータ: ${url}`,
      "",
      chapters?.trim() || null,
      "",
      DISCLAIMER,
      HASHTAG,
    ]).replace(/\n{3,}/g, "\n\n"),
  };
  const youtube_shorts = {
    title: `${label}（${date}）1号艇は堅い？ 同じ並びの過去の着順`,
    description: join([
      entryFirstQuestion,
      venueLine,
      conclusion,
      "",
      `全場面の動画（完全版）: ${FULL_URL_SLOT}`,
      `このレースのデータ: ${url}`,
      "",
      DISCLAIMER,
      HASHTAG,
    ]).replace(/\n{3,}/g, "\n\n"),
  };
  return { bundle_version: BUNDLE_VERSION, format: "full_picture", race_id: raceId, x_text, youtube_full, youtube_shorts, qa: { machine: qa, bannedWords: [] } };
}

/**
 * bundle の形の検査（送信の道の受け取りより手前で止める）。落ちた理由の一覧（空なら合格）
 * @param {ReturnType<typeof buildBundle>} b
 */
export function checkBundle(b) {
  const why = [];
  for (const [k, v] of [["youtube_full", b.youtube_full], ["youtube_shorts", b.youtube_shorts]]) {
    if (!v?.title || v.title.length > LIMITS.title || v.title.includes("\n")) why.push(`${k}.title が無い・100字を超える・改行がある`);
    if (!v?.description || v.description.length > LIMITS.description) why.push(`${k}.description が無い・5000字を超える`);
  }
  if (b.youtube_full?.title === b.youtube_shorts?.title) why.push("完全版と Shorts の題名が同じ");
  const slots = b.youtube_shorts?.description?.split(FULL_URL_SLOT).length - 1;
  if (slots !== 1) why.push(`Shorts の説明文に ${FULL_URL_SLOT} がちょうど1つ無い（${slots}）`);
  else if (b.youtube_shorts.description.length - FULL_URL_SLOT.length + FULL_URL_GROWTH > LIMITS.description) why.push("完全版の URL に置き換えると5000字を超える");
  const urls = b.x_text.match(/https?:\/\/\S+/g) ?? [];
  if (urls.length !== 1 || urls[0] !== raceUrl(b.race_id)) why.push("x_text にこのレースの URL がちょうど1つ無い");
  if (!Object.values(b.qa?.machine ?? {}).every((v) => v === true) || !Object.keys(b.qa?.machine ?? {}).length) why.push("機械の検査が全部通っていない");
  return why;
}
