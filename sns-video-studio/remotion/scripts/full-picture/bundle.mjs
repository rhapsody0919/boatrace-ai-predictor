/**
 * 送信の道（scripts/sns/push-full-picture.js）に渡す bundle.json の中身（純粋関数）。
 * 2026-10-20 オーケストレーターの分担（a・b・c の文型）と、送信レーンとの Shorts の契約（bundle_version 2）:
 * - x_text: 入口版の本文＋このレースの URL（UTM つき）をちょうど1つ（X には入口版 full-x.mp4）
 * - youtube_full: 完全版（通常の動画、full-youtube.mp4）の題名・説明文（要点・URL・章・免責）
 * - youtube_shorts: 入口版を Shorts に出す題名・説明文。説明文に完全版の URL の置き場所 `{full_url}` をちょうど1つ（送信側が置き換える）
 * - qa.machine: run-full の機械の検査（全部 true のときだけ bundle を出す）
 * review（評価役の P0）は入れない（2026-10-20 オーナー決定: 評価役の P0 は使わず機械の検査だけで判定する。.claude の例外は #1729）。
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
/**
 * 投稿のリンクの UTM（BOA-995、2026-10-19 合意 scripts/lib/snsDailyRunner.js の UTM ごとの読み取り）。
 * X は utm_source=x、YouTube は utm_source=youtube と utm_term=full|shorts。utm_content はレース ID
 */
export const utmUrl = (raceId, source, term = null) =>
  `${raceUrl(raceId)}?utm_source=${source}&utm_medium=social&utm_campaign=race-full&utm_content=${raceId}${term ? `&utm_term=${term}` : ""}`;
/**
 * 完全版の説明文の機能への導線（hq 契約 10/24 C1）。ソナーはタブ、思考アシストは別ページへ直接着く。
 * UTM は utmUrl と同じ形で、utm_content を「レース ID/機能」にして機能を分ける（下書きの ID の UTM と同じ「/」の区切り）
 */
export const FEATURES = {
  sonar: { name: "龍神ソナー", path: (id) => `${raceUrl(id)}?tab=sonar&`, line: "類似レースの着順の流れは龍神ソナーで" },
  assist: { name: "思考アシスト", path: (id) => `${raceUrl(id)}/assist?`, line: "軸・相手を自分で読むなら思考アシスト" },
};
export const featureUrl = (raceId, feature, term = "full") =>
  `${FEATURES[feature].path(raceId)}utm_source=youtube&utm_medium=social&utm_campaign=race-full&utm_content=${raceId}/${feature}&utm_term=${term}`;
/** 完全版のタグ（YouTube の snippet.tags に渡す。説明文の末尾のハッシュタグにも同じ語） */
export const FULL_TAGS = ["ボートレース", "龍神ソナー", "思考アシスト"];
/** レース名（materials の facts.today.round → 表示）。対応に無い値・無いときは書かない（hq 2026-10-21、BOA-989）。材料の準優勝戦は junyu */
export const ROUND_NAME = { yusho: "優勝戦", junyu: "準優勝戦", jun_yusho: "準優勝戦", tokusen: "特選", senbatsu: "選抜", yosen: "予選" };
/** 題名の頭に付けるグレード（races.race_grade。一般 ippan は付けない） */
const GRADE_HEAD = ["SG", "G1", "G2", "G3"];
const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];
/**
 * レースの見出し「10/22（木）児島12R 準優勝戦 締切16:44」。冒頭の場面・説明文・X の本文に同じ文を出す。
 * レース名・締切が無いときはその部分を書かない
 * short: 会場・R・レース名を省く（X の2行目。1行目の頭と重ねない、hq 2026-10-23）
 * @param {{year: number, month: number, day: number, venue: string, raceNo: number, round?: string|null, deadline?: string|null, short?: boolean}} p deadline は "HH:MM[:SS]"
 */
export function raceHeader({ year, month, day, venue, raceNo, round = null, deadline = null, short = false }) {
  const wd = WEEKDAY[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const name = ROUND_NAME[round] ?? null;
  const hm = /^\d{1,2}:\d{2}/.exec(deadline ?? "")?.[0] ?? null;
  const race = short ? "" : `${venue}${raceNo}R${name ? ` ${name}` : ""}`;
  return `${month}/${day}（${wd}）${race}${hm ? `${race ? " " : ""}締切${hm}` : ""}`;
}
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
/** 章の名前の末尾の機能名の括弧書き（「6艇比較（龍神ソナー）」）を外した名前 */
export const chapterBase = (name) => name.replace(/（[^（）]*）$/, "");
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
  const diff = (f, base) => (f.diffPt === null || f.diffPt === undefined ? "" : f.diffPt < 1 ? `、${base}との差は1ポイント未満` : `、${base}より${f.diffPt.toFixed(1)}ポイント${f.direction}`);
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
      ? `${conclusion.form ? `スタートの形が${conclusion.form}だった` : "枠なりの"}過去${conclusion.n.toLocaleString("ja-JP")}件中、1着最多は${conclusion.boat}号艇で${conclusion.count.toLocaleString("ja-JP")}件（${conclusion.pct}%）`
      : null,
  };
}

/**
 * @param {{raceId: string, venue: string, raceNo: number, month: number, day: number,
 *   round?: string|null, grade?: string|null, deadline?: string|null,
 *   facts: {venue90?: object|null, overview?: object|null, conclusion?: object|null},
 *   chapters: string, fullSeconds: number, qa: Record<string, boolean>}} p
 */
export function buildBundle({ raceId, venue, raceNo, month, day, round = null, grade = null, deadline = null, facts, chapters, fullSeconds, qa }) {
  const name = ROUND_NAME[round] ?? null;
  const label = `${venue}${raceNo}R${name ? ` ${name}` : ""}`;
  const date = `${month}/${day}`;
  const headerArgs = { year: Number(raceId.slice(0, 4)), month, day, venue, raceNo, round, deadline };
  const header = raceHeader(headerArgs);
  // 完全版の題名と X の1行目の頭（hq 2026-10-21、BOA-989）。SG・G1・G2・G3 は頭にグレード
  const head = `【${GRADE_HEAD.includes(grade) ? `${grade} ` : ""}${label}｜${date}】`;
  const L = lines(facts ?? {});
  const order = chapterNames(chapters);
  const x_text = join([
    `${head}1号艇は堅い？`,
    raceHeader({ ...headerArgs, short: true }),
    L.venue,
    L.conclusion,
    `このレースのデータは龍神レーダーで: ${utmUrl(raceId, "x")}`,
    "結果を保証するものではありません。",
    HASHTAG,
  ]);
  const youtube_full = {
    // レース名・日付を頭に、問いとその日の向き（youtube-channel P2-1）。Shorts の題名とは別の文
    title: `${head}1号艇は堅い？ ${L.venueHead ?? "6艇の比較と展開の傾向"}`,
    // 1行目にその回の結論の数字（入口版の冒頭の数字と同じ値）と「ボートレース」・レースの見出し、2・3行目に機能への導線
    // （折りたたむ前に見える所。hq 契約 10/24 C1、ファン役4人・デザイナー役の審査）
    description: join([
      `${facts?.hero?.title ?? L.conclusion ?? L.venue ?? "6艇の比較と展開の傾向"}（ボートレース ${header}）`,
      `${FEATURES.sonar.line}: ${featureUrl(raceId, "sonar")}`,
      `${FEATURES.assist.line}: ${featureUrl(raceId, "assist")}`,
      "",
      L.venue,
      L.overview,
      L.conclusion,
      "",
      // 実際に作った章の名前から（章の無い場面を書かない。wording-editor・youtube-channel P2）
      order.length ? `${order.map(chapterBase).join("・")}の順に見る動画です。` : null,
      `このレースのデータ（龍神レーダー）: ${utmUrl(raceId, "youtube", "full")}`,
      "",
      chapters?.trim() || null,
      "",
      DISCLAIMER,
      FULL_TAGS.map((x) => `#${x}`).join(" "),
    ]).replace(/\n{3,}/g, "\n\n"),
    tags: FULL_TAGS,
  };
  const youtube_shorts = {
    // レース名＋問い＋その日の数字（冒頭の数字と同じ値。hq 契約 10/24 v2。「〜で読み解く展開」型はやめる）
    title: `${label}（${date}）1号艇は堅い？ ${facts?.hero?.title ?? "同じ並びの過去の着順"}`,
    description: join([
      `ボートレース ${header} 1号艇は堅い？`,
      L.venue,
      L.conclusion,
      "",
      `完全版の動画（${aboutMinutes(fullSeconds)}）: ${FULL_URL_SLOT}`,
      `このレースのデータ（龍神レーダー）: ${utmUrl(raceId, "youtube", "shorts")}`,
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
  if (urls.length !== 1 || urls[0] !== utmUrl(b.race_id, "x")) why.push("x_text にこのレースの URL がちょうど1つ無い（UTM つき）");
  const fullLines = b.youtube_full?.description?.split("\n") ?? [];
  for (const [i, f] of [[1, "sonar"], [2, "assist"]])
    if (!fullLines[i]?.endsWith(featureUrl(b.race_id, f))) why.push(`youtube_full.description の${i + 1}行目に${FEATURES[f].name}への導線（UTM つき）が無い`);
  for (const [k, term] of [["youtube_full", "full"], ["youtube_shorts", "shorts"]])
    if (!b[k]?.description?.includes(utmUrl(b.race_id, "youtube", term))) why.push(`${k}.description にこのレースの URL（UTM つき）が無い`);
  if (!Object.values(b.qa?.machine ?? {}).every((v) => v === true) || !Object.keys(b.qa?.machine ?? {}).length) why.push("機械の検査が全部通っていない");
  return why;
}
