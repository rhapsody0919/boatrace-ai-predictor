/**
 * 送信の道（scripts/sns/push-full-picture.js）に渡す bundle.json の中身（純粋関数）。
 * 2026-10-20 オーケストレーターの分担（a・b・c の文型）と、送信レーンとの Shorts の契約（bundle_version 2）:
 * - x_text: 入口版の本文＋このレースの URL をちょうど1つ（X には入口版 full-x.mp4）
 * - youtube_full: 完全版（通常の動画、full-youtube.mp4）の題名・説明文（要点・URL・章・免責）
 * - youtube_shorts: 入口版を Shorts に出す題名・説明文。説明文に完全版の URL の置き場所 `{full_url}` をちょうど1つ（送信側が置き換える）
 * - qa.machine: run-full の機械の検査（全部 true のときだけ bundle を出す）
 * review（評価役の P0）は入れない（hq の側。機械の検査だけにするかはオーナーの判断）。
 * 文は文型で固定（LLM を使わない）。数値は場面の facts（字幕と同じ値）から取り、動画に出る数字だけを書く。
 * 題名・説明文は wording-editor・youtube-channel（2026-10-20）を通した。Shorts の題名の「同じ並び」は、入口版の結論の問い
 * 「同じ並びの過去は、どう決まった？」（2026-10-20 オーナー決定）にそろえている。
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
const d1 = (v) => Number(v).toFixed(1);
/** 完全版を通常の動画にする尺の下限（縦で3分以下は Shorts として扱われる。youtube-channel 2026-10-20 P1） */
export const FULL_MIN_SECONDS = 185;
/** 「約3分半」の形 */
const aboutMinutes = (sec) => {
  const half = Math.round(sec / 30) / 2;
  return `約${Math.floor(half)}分${half % 1 ? "半" : ""}`;
};
/** 章の行（「0:00 条件」）→ 章の名前 */
export const chapterNames = (text) => (text ?? "").split("\n").map((l) => l.replace(/^\d+:\d{2}\s+/, "").trim()).filter(Boolean);
/** 章の行 → 秒 */
export const chapterStarts = (text) =>
  (text ?? "").split("\n").map((l) => l.match(/^(\d+):(\d{2})\s/)).filter(Boolean).map((x) => Number(x[1]) * 60 + Number(x[2]));
/** 章が YouTube の自動チャプターの条件（0:00 から・3つ以上・昇順・各章10秒以上）を満たすか */
export function chaptersOk(text, durationSec) {
  const st = chapterStarts(text);
  if (st.length < 3 || st[0] !== 0) return false;
  const ends = [...st.slice(1), durationSec];
  return st.every((t, i) => ends[i] - t >= 10);
}

/**
 * 送信の道の文は、動画の字幕より詳しく書く（母数・期間・条件を省かない。wording-editor 2026-10-20 P1・P2）。
 * 数値は場面の facts（字幕と同じ値）から
 */
function lines({ venue90, overview, conclusion }) {
  const diff = (f, base) => (f.diffPt === null || f.diffPt === undefined ? "" : f.diffPt < 1 ? `、${base}との差は1ポイント未満` : `、${base}より${f.diffPt}ポイント${f.direction}`);
  return {
    venue: venue90
      ? `${venue90.venue}の1号艇の1着率は過去90日の${venue90.races.toLocaleString("ja-JP")}レースで${d1(venue90.rate)}%${diff(venue90, `全国の同じ期間の${d1(venue90.national)}%`)}`
      : null,
    // 題名の後半（その日の向き）
    venueHead:
      venue90 && venue90.diffPt !== null && venue90.diffPt !== undefined
        ? `${venue90.venue}の1着率は全国${venue90.diffPt < 1 ? "との差は1ポイント未満" : `より${venue90.direction}`}`
        : null,
    overview: overview
      ? `6艇比較の${overview.axesCount}項目で2位以内に入った数は、${overview.leaders.join("・")}号艇の${overview.maxTop2}が最多${overview.runner ? `、次は${overview.runner.boats.join("・")}号艇の${overview.runner.count}` : ""}`
      : null,
    conclusion: conclusion
      ? `スタートの形が${conclusion.form}だった過去${conclusion.n.toLocaleString("ja-JP")}件中、1着最多は${conclusion.boat}号艇で${conclusion.count.toLocaleString("ja-JP")}件（${conclusion.pct}%）`
      : null,
  };
}

/**
 * @param {{raceId: string, venue: string, raceNo: number, month: number, day: number,
 *   facts: {venue90?: object|null, overview?: object|null, conclusion?: object|null},
 *   entryFirstQuestion: string, chapters: string, fullSeconds: number, qa: Record<string, boolean>}} p
 */
export function buildBundle({ raceId, venue, raceNo, month, day, facts, entryFirstQuestion, chapters, fullSeconds, qa }) {
  const label = `${venue}${raceNo}R`;
  const date = `${month}/${day}`;
  const url = raceUrl(raceId);
  const L = lines(facts ?? {});
  const order = chapterNames(chapters);
  const x_text = join([entryFirstQuestion, L.venue, L.conclusion, `このレースのデータは龍神レーダーで: ${url}`, "結果を保証するものではありません。", HASHTAG]);
  const youtube_full = {
    // 会場・R・日付・「ボートレース」を前に、問いとその日の向き（youtube-channel P2-1）。Shorts の題名とは別の文
    title: `【${label}・${date} ボートレース】1号艇は堅い？ ${L.venueHead ?? "6艇の比較と展開の傾向"}`,
    description: join([
      // 1行目に「ボートレース」とその日の発見（モバイルで折りたたむ前に見える。youtube-channel P2-2）
      `ボートレース ${label}（${date}）: ${L.venue ?? "6艇の比較と展開の傾向"}`,
      L.overview,
      L.conclusion,
      "",
      // 実際に作った章の名前から（章の無い場面を書かない。wording-editor・youtube-channel P2）
      order.length ? `${order.join("・")}の順に見る動画です。` : null,
      `このレースのデータ（龍神レーダー）: ${url}`,
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
      L.venue,
      L.conclusion,
      "",
      `完全版の動画（${aboutMinutes(fullSeconds)}）: ${FULL_URL_SLOT}`,
      `このレースのデータ（龍神レーダー）: ${url}`,
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
