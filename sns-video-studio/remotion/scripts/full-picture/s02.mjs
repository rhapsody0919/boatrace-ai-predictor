/**
 * 型 s02-loss-breakdown-card（Shorts・X の冒頭の札・題・本文の差し替え）の数字と文（純関数）。
 * 台本: docs/design/full-picture-type-gate/candidates/s02-loss-breakdown-card/script.md（オーナー可 2026-10-27）。
 * 数字は冒頭の答え（answer.mjs）と同じセル（形を問わない `forms.any`）から作る。N はこのセルの件数で、3連単の件数の和と一致する
 * （3連単が成立したレースだけ。M＝N−K は「1着が1号艇でない件」）。順位の語は使わない（艇ごとの件数は艇番の順）。
 */
import { ANSWER_RULE } from "./answer.mjs";

/** 札の秒（台本 0〜1.5秒）と、艇ごとの件数の札を答えの頁に重ねる秒 */
export const S02_CARD_SECONDS = 3.5;
export const S02_CHIPS_UNTIL = 8;
/** 艇ごとの件数の札の下端（Shorts の下部の題・チャンネル名の表示を避ける。youtube-channel 試作の審査 P1） */
export const S02_CHIPS_BOTTOM = 1500;
/** 札の主の文字の毎秒の上限（video-composition.md「毎秒8字」） */
export const S02_CHARS_PER_SEC = 8;
/** 札・字幕・題・本文に使わない順位の語 */
export const S02_RANK_WORDS = /最多|最も多|次が|次は|一番|1位|2番目/;

/**
 * @param {{cells?: {waku?: {forms?: {any?: {n: number, tri?: Record<string, number>}}}}, period?: string[]}} sc 材料の api.scenario.scenario
 * @returns {{ok: true, n: number, k: number, m: number, p: number, by: {boat: number, count: number}[], period: string[]|null} | {ok: false, kind: string, reason: string}}
 */
export function s02Facts(sc) {
  const cell = sc?.cells?.waku?.forms?.any ?? null;
  const n = cell?.n ?? 0;
  if (n < ANSWER_RULE.minN) return { ok: false, kind: "thin_data", reason: `この組み合わせの過去が${n}件（${ANSWER_RULE.minN}件未満）` };
  const first = [0, 0, 0, 0, 0, 0];
  for (const [k, c] of Object.entries(cell.tri ?? {})) first[Number(k.split("-")[0]) - 1] += c;
  const sum = first.reduce((a, b) => a + b, 0);
  // 件数の定義がずれる日（3連単の和が n と合わない）は作らない（札・字幕・本文で同じ N・K・M を使うため）
  if (sum !== n) return { ok: false, kind: "count_mismatch", reason: `件数${n}と3連単の和${sum}が合わない` };
  const k = first[0];
  const m = n - k;
  if (m <= 0) return { ok: false, kind: "no_loss", reason: "1号艇が負けた件が無い" };
  return {
    ok: true,
    n,
    k,
    m,
    p: Math.round((k / n) * 1000) / 10,
    by: [2, 3, 4, 5, 6].map((b) => ({ boat: b, count: first[b - 1] })),
    // 負けた件で1着の多い艇を強調するのは、2位との差が線を通った日だけ（BOA-1157 の rankOf と同じ式: (c1−c2)/√(c1+c2)>=1.96、c1+c2>=10）。
    // rankOf は #1973（scenes/diff.mjs）で入る。マージ後はそちらを使う
    top: (() => {
      const [a, b] = [2, 3, 4, 5, 6].map((x) => ({ boat: x, count: first[x - 1] })).sort((p, q) => q.count - p.count);
      return a.count + b.count >= 10 && (a.count - b.count) / Math.sqrt(a.count + b.count) >= 1.96 ? a.boat : null;
    })(),
    period: sc?.period?.[0] && sc?.period?.[1] ? [sc.period[0], sc.period[1]] : null,
  };
}

const ymd = (d) => `${Number(d.slice(0, 4))}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/**
 * 札・艇ごとの件数の札・題・X の本文
 * @param {ReturnType<typeof s02Facts> & {ok: true}} f
 * @param {{race: string, date: string, deadline?: string|null, url: string}} r race は「大村10R 準優勝戦」、date は「10/26」
 */
export function s02Text(f, r) {
  const span = f.period ? `${ymd(f.period[0])}〜${ymd(f.period[1])}` : null;
  return {
    card: {
      head: `${r.race}（${r.date}）`,
      // 冒頭は結論から（オーナー 10/11）。答え（1号艇の1着は約X割）を先に、問いは負けた側（伏せた比較 1周目で「冒頭が結論でない」）
      lines: [`過去の1号艇の1着は約${Math.round((f.k / f.n) * 10)}割`, `負けた${f.m.toLocaleString("ja-JP")}件、勝ったのは？`],
      band: { win: f.k, loss: f.m },
      // 範囲と期間は別の行（期間の途中で折り返さない）
      scope: ["全国・級の並びが同じ・枠なり", span].filter(Boolean),
    },
    chips: { title: f.top ? `負けた${f.m.toLocaleString("ja-JP")}件の内訳（最多は${f.top}号艇）` : `負けた${f.m.toLocaleString("ja-JP")}件の内訳`, by: f.by, top: f.top },
    // 競技の名を題に（検索・おすすめで判別する手掛かり。youtube-channel 試作の審査 P2）
    shortsTitle: `${r.race}（${r.date}）｜過去の1号艇が負けた${f.m.toLocaleString("ja-JP")}件、勝ったのは何号艇？｜ボートレース`,
    xText: [
      `${r.race}（${r.date}${r.deadline ? ` ${r.deadline}締切` : ""}）`,
      `全国で6艇の級の並びがこのレースと同じ、進入が枠なりの過去${f.n.toLocaleString("ja-JP")}件中${span ? `（${span}）` : ""}、1号艇の1着は${f.k.toLocaleString("ja-JP")}件（${f.p.toFixed(1)}%）。`,
      `その${f.m.toLocaleString("ja-JP")}件で、勝ったのは何号艇？ 内訳は動画の中で。`,
      `このレースのデータ: ${r.url}`,
      "過去の割合で、今日の結果を示すものではありません。",
      "#ボートレース",
    ].join("\n"),
  };
}

/**
 * 機械の検査（台本「機械の検査」）。落ちた理由の一覧（空なら合格）
 * @param {ReturnType<typeof s02Facts> & {ok: true}} f @param {ReturnType<typeof s02Text>} tx @param {number} seconds 札をつないだ後の尺
 */
export function s02Check(f, tx, seconds) {
  const why = [];
  const sum = f.by.reduce((a, x) => a + x.count, 0);
  if (sum !== f.m) why.push(`内訳の和${sum}が負けた件数${f.m}と違う`);
  if (f.k + f.m !== f.n) why.push("N＝K＋M にならない");
  // 札の主の文字は札の秒で毎秒8字以内（問いを答えの頁に重ねると本編の問い「1号艇は堅い？」と2つ並ぶので、札を延ばす。試作の審査 P2）
  const chars = tx.card.lines.join("").replace(/,/g, "").length; // 桁区切りのカンマは読む字に数えない
  if (chars / S02_CARD_SECONDS > S02_CHARS_PER_SEC) why.push(`札の主の文字が${chars}字（${S02_CARD_SECONDS}秒で毎秒${S02_CHARS_PER_SEC}字を越える）`);
  if (tx.card.lines.some((l) => l.length > 16)) why.push("札の主の文字の1行が16字を越える");
  // 順位の語は線を通った日の件数の札の見出しだけ（f.top）。ほかは使わない
  for (const s of [tx.card.head, ...tx.card.lines, ...(f.top ? [] : [tx.chips.title]), tx.shortsTitle, tx.xText]) if (S02_RANK_WORDS.test(s)) why.push(`順位の語: ${s.split("\n")[0]}`);
  if (!/過去/.test(tx.xText) || !/全国/.test(tx.xText)) why.push("本文に「過去」「全国」が無い");
  if (!/\d{4}\/\d+\/\d+〜\d{4}\/\d+\/\d+/.test(tx.xText)) why.push("本文の期間に終わりの日が無い");
  if (seconds > 59) why.push(`尺が${seconds.toFixed(1)}秒（59秒を越える）`);
  const by = f.by.map((x) => x.boat);
  if (by.join() !== [...by].sort((a, b) => a - b).join()) why.push("艇ごとの件数が艇番の順でない");
  return why;
}
