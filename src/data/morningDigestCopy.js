/**
 * 「本日のデータ一覧」（/today、BOA-402）の**静的な**文言。
 *
 * 画面（src/pages/MorningDataDigest.jsx）と、AIクローラー向けスナップショット
 * （scripts/generate-ai-snapshots.js）の両方がここを読む。スナップショットは
 * ビルド時生成で日替わりの中身を持てないため、載せられるのは
 * 「ページの目的」と「各指標の定義」だけ（plan.md §5、/winning-technique と同じ方式）。
 *
 * ⚠️ **同じ文言を画面側に直書きしない。** 片方だけ直して食い違うのを防ぐために
 * 切り出してある（ページ本文とSNS下書きが同じ行を読む ADR-0070 と同じ発想）。
 *
 * 日替わりの数値（会場数・レース数・集計期間・各セクションの件数）はここには無い。
 * それらは morning_digest_days / morning_digest_rows から画面が描く。
 */

export const MORNING_DIGEST_META = Object.freeze({
  title: "本日のデータ一覧 | 逃げ・まくりが利く選手と昨日のフライング",
  description:
    "本日の全レースから、逃げが堅い選手・まくりが利く選手・1号艇に逃げられやすい選手を抽出しました。会場と級別の有利不利を除いて比較し、AIのイン崩れ指数と突き合わせて今日の注目レースを1つ選んでいます。昨日のフライングと帰郷選手も掲載。",
  canonical: "https://www.boat-ai.jp/today",
  keywords:
    "ボートレース,逃げ率,まくり率,フライング,帰郷,本日のデータ,データ分析,無料",
  h1: "本日のデータ一覧",
});

/**
 * セクションの見出しと定義。`key` は morning_digest_rows.section と同じ。
 * 並び順は画面の表示順。
 */
export const MORNING_DIGEST_SECTIONS = Object.freeze([
  Object.freeze({
    key: "nige",
    title: "逃げが堅い選手",
    description:
      "全国での実績で、1号艇の選手が1コースに入ったときに逃げ切った割合が70%以上。本日の会場の平均を並べているので、その会場が逃げやすいかどうかと合わせて見てください",
  }),
  Object.freeze({
    key: "makuri",
    title: "まくりが利く選手",
    description:
      "全国での実績で、その選手がそのコースに入ったときに、まくりで1着になった割合が25%以上",
    notice:
      "まくりは全国平均が4〜5%とまれな決まり手のため、該当が0件の日もあります。",
  }),
  Object.freeze({
    key: "nigashi",
    title: "逃がしやすい選手",
    description:
      "全国での実績で、1号艇に逃げ切られる割合が、会場と級別の構成から期待される水準を22ポイント以上上回る",
  }),
  Object.freeze({
    key: "flying",
    title: "昨日のフライング",
    description: "前日にフライングがあった選手",
    emptyMessage: "前日のフライングはありませんでした",
  }),
  Object.freeze({
    key: "returned",
    title: "昨日の帰郷選手",
    description: "節の途中で出走表から外れた選手",
    emptyMessage: "前日に節の途中で帰郷した選手はいませんでした",
  }),
]);

/** key → セクション定義 */
export const MORNING_DIGEST_SECTION_BY_KEY = Object.freeze(
  Object.fromEntries(MORNING_DIGEST_SECTIONS.map((s) => [s.key, s])),
);

/**
 * 「このページの見方」の用語集。
 * `body` は行内の断片の配列で、画面は `strong`/`br` を反映して描き、
 * スナップショットは text を連結する（同じ文言から両方を作るための表現）。
 */
export const MORNING_DIGEST_GLOSSARY_TITLE = "このページの見方";

export const MORNING_DIGEST_GLOSSARY = Object.freeze([
  Object.freeze({
    term: "このページに出る数値について",
    body: Object.freeze([
      Object.freeze({
        text: "すべて過去のレース結果を集計した実際の数値で、AIによる予測値ではありません。",
        strong: true,
      }),
      Object.freeze({
        text: "「このレースで何%になる」という予想は出していません（AIの予測はイン崩れ指数だけで、その旨を明記しています）。",
      }),
    ]),
  }),
  Object.freeze({
    term: "この選手",
    body: Object.freeze([
      Object.freeze({
        text: "その選手が全国のどの会場で走ったぶんも合わせた、実際の率。競合サイトが出しているのもこの数値です。",
      }),
    ]),
  }),
  Object.freeze({
    term: "◯◯の平均",
    body: Object.freeze([
      Object.freeze({
        text: "その会場で、全選手を通した実際の割合。会場によって逃げ率は20ポイント違うため、この基準線と並べないと「戸田での70%」と「尼崎での70%」が同じに見えてしまいます。たとえば戸田は1コースの平均が39.5%と全国で最も低く、大村は約73%あります。",
      }),
      Object.freeze({ br: true }),
      Object.freeze({ text: "「一般戦・全選手」「G1・全選手」とあるのは、" }),
      Object.freeze({ text: "そのレースのグレードに絞った平均", strong: true }),
      Object.freeze({
        text: "です（A1・A2といった選手の級別ではありません）。そのグレードの母数が100走に満たない会場・コースでは、「全グレード・全選手」と書いて全グレードをまとめた平均を使います。",
      }),
    ]),
  }),
  Object.freeze({
    term: "この選手が走ってきた会場の平均",
    body: Object.freeze([
      Object.freeze({
        text: "その選手が実際に走った会場・レースグレードの構成で、全選手を平均した割合。この選手の割合と見比べると、走ってきた条件が楽だったかどうかが分かります。▼で開くと出ます。",
      }),
    ]),
  }),
  Object.freeze({
    term: "イン崩れ指数",
    body: Object.freeze([
      Object.freeze({
        text: "当日の条件からAIが算出した「1号艇が崩れやすさ」。過去実績とは独立した指標です。",
      }),
    ]),
    // 画面はこの後に「この数値は M/D HH:MM 時点のものです。」を足す（日替わりのため
    // スナップショットには入れない）
  }),
]);

export const MORNING_DIGEST_DISCLAIMER =
  "統計値・AI予測は結果を保証するものではありません。舟券の購入はご自身の判断でお願いします。";

/** 用語集の断片を平文に落とす（スナップショット・検証用） */
export function glossaryBodyToText(body) {
  return body
    .filter((f) => !f.br)
    .map((f) => f.text)
    .join("");
}
