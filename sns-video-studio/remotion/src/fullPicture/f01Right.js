/**
 * 型 f01 の右の列（章の札・範囲・答えの数字）と冒頭の棒の、選手名と級の付け方と、字の大きさ・折り返しの決め方（純関数）。
 * 作る側（scripts/full-picture/f01.mjs・f01-build.mjs）が行と字の大きさを決めて props に入れ、F01.jsx はその行を並べるだけ
 * （描く側で測って縮めると、収まるかを作る側の検査で確かめられない）。
 * オーナーの恒久の決まり（2026-11-01）「SNS の型で選手を出す画面には、必ず名前と級（race_entries.grade）を入れる」。
 * 声は艇番だけ（読み仮名がデータに無い）。
 */

/** 名前と級の区切り（折り返さない空白）。「3号艇 品川二千翔 A1」をひとまとまりで扱う */
export const NB = " ";
export const GRADES = ["A1", "A2", "B1", "B2"];
/**
 * 字の小ささの線（縮めた後の最小の字の高さ px）。左の画面（f01-build.mjs）・右の列（f01.mjs の f01RacerCheck）で同じ線。
 * 24px はオーナー 2026-11-02「22.4px の章は2カットに分けて」（22.4px の着順の流れ・形の札を2カットにし、24px 以上を線にした）。
 * 左の画面の根拠は f01-build.mjs の説明を見る
 */
export const MIN_FONT_PX = 24;

/** 出走表の名前（「篠崎」と「仁志」の間に全角の空白）→ フルネーム（空白を詰める。JS の \s は全角の空白も含む） */
export const fullName = (name) => String(name ?? "").replace(/\s+/g, "");

/**
 * 材料の出走表（m.api.races の対象レースの entries。元は race_entries.player_name・grade）→ 艇番ごとの名前と級。
 * 欠けた艇があれば missing に艇番を入れる（黙って空にしない）
 * @param {{api?: {races?: {raceId: string, entries?: {number: number, name?: string, grade?: string}[]}[]|null}, raceId: string}} m
 */
export function racersOf(m) {
  const entries =
    m.api?.races?.find((r) => r.raceId === m.raceId)?.entries ?? [];
  const racers = {};
  const missing = [];
  for (const b of [1, 2, 3, 4, 5, 6]) {
    const e = entries.find((x) => Number(x.number) === b);
    const name = fullName(e?.name);
    const grade = e?.grade ?? null;
    if (!name || !GRADES.includes(grade)) missing.push(b);
    else racers[b] = { name, grade };
  }
  return { racers, missing };
}

/** 「3号艇 品川二千翔 A1」（折り返さない空白でつなぐ）。今日の6艇の属性（c1・c5 の項目の数）に使う */
export const boatWho = (racers, b) =>
  `${b}号艇${NB}${racers[b].name}${NB}${racers[b].grade}`;

/**
 * 過去の集計（枠ごとの件数・割合）の艇。「3号艇（今日は品川二千翔 A1）」。数字の主語は艇番（枠）で、名前は今日その枠にいる選手と分かるように
 * 括弧の小さい字（SMALL 倍・薄い色）にする（x-channel・youtube-channel の評価、#2079。名前の隣の件数が選手個人の成績に読まれた）
 */
export const TODAY = "（今日は";
export const SMALL = 0.7;
export const boatToday = (racers, b) =>
  `${b}号艇${TODAY}${racers[b].name}${NB}${racers[b].grade}）`;
/** 括弧の小さい字の部分（「（今日は名前 級）」）。描く側（F01.jsx）・幅の見積り・検査で同じ形を使う */
export const TODAY_RE = /（今日は[^）]*）/g;

/**
 * 字の幅（em）の見積り。Noto Sans JP の実測より広めに取る（狭く見積もると右の列からはみ出す）:
 * 全角1、英数 0.66、% 0.9、空白・句読の半角 0.3、その他の半角 0.6
 */
export function emWidth(text) {
  // 括弧の小さい字の部分は SMALL 倍
  const small = [...text.matchAll(TODAY_RE)].map((m) => m[0]);
  const rest = text.replace(TODAY_RE, "");
  return charsEm(rest) + small.reduce((w, x) => w + charsEm(x) * SMALL, 0);
}
export function charsEm(text) {
  let w = 0;
  for (const c of text) {
    if (c === " " || c === NB || c === "," || c === ".") w += 0.3;
    else if (c === "%") w += 0.9;
    else if (/[0-9A-Za-z]/.test(c)) w += 0.66;
    else if (/[\x21-\x7e]/.test(c)) w += 0.6;
    else w += 1;
  }
  return w;
}

/**
 * 1つの欄を幅に折り返す。改行は「\n」で必ず、ほかは半角の空白か「・」の後ろでだけ（「・」で切ったら行末の「・」は消す）。
 * 折り返せない塊（名前と級のひとまとまり等）が幅を越えたら null
 * @param {string} text @param {number} size px @param {number} width px
 */
export function wrapText(text, size, width) {
  const lines = [];
  for (const para of text.split("\n")) {
    let cur = "";
    for (const tok of para.split(/(?<=[ ・])/)) {
      if (cur && emWidth((cur + tok).replace(/[ ・]$/, "")) * size > width) {
        lines.push(cur.replace(/[ ・]$/, ""));
        cur = tok;
      } else cur += tok;
    }
    lines.push(cur.replace(/ $/, ""));
  }
  return lines.every((l) => emWidth(l) * size <= width) ? lines : null;
}

/** 右の列（F01.jsx の RIGHT と同じ）。x1240〜1872、頭は y32 */
export const RIGHT = { x: 1240, w: 632, top: 32 };
/** 右の列の下の線: 「自分で見るなら」（y774）・「このレースのページは」（y600）の16px 上 */
export const RIGHT_BOTTOM = { path: 774 - 16, foot: 600 - 16, none: 870 };
const GAP = 22;
const SPACER = 40;
const TAG = { size: 32, h: 32 * 1.4 + 12 + 4 };
/** 欄ごとの字の大きさの候補（大きい順）と行の高さ */
export const FIELD = {
  scope: { sizes: [32], lh: 1.4 },
  answer: { sizes: [64, 48, 40], lh: 1.3 },
  answer2: { sizes: [36, 32], lh: 1.4 },
};

/**
 * 右の列の行と字の大きさ。答え・答え2を大きい順に試し、幅にも下の線にも収まる最初の組を使う。
 * 収まらなければ ok=false と理由（検査 f01RacerCheck で落とし、その日の完全版を作らない）
 * @param {{tag?: string|null, scope?: string|null, answer?: string|null, answer2?: string|null, path?: string|null, foot?: string|null}} c
 */
export function layoutRight(c) {
  const bottom = c.path
    ? RIGHT_BOTTOM.path
    : c.foot
      ? RIGHT_BOTTOM.foot
      : RIGHT_BOTTOM.none;
  if (c.tag && emWidth(c.tag) * TAG.size + 36 > RIGHT.w)
    return { ok: false, reason: `章の札「${c.tag}」が幅を越える` };
  const scope = c.scope ? wrapText(c.scope, FIELD.scope.sizes[0], RIGHT.w) : [];
  if (!scope)
    return { ok: false, reason: `範囲「${c.scope}」の塊が幅を越える` };
  const heads = [
    c.tag ? TAG.h : null,
    scope.length ? scope.length * FIELD.scope.sizes[0] * FIELD.scope.lh : null,
    SPACER,
  ].filter((x) => x !== null);
  let why = "幅を越える";
  for (const a of c.answer ? FIELD.answer.sizes : [0]) {
    const al = c.answer ? wrapText(c.answer, a, RIGHT.w) : [];
    if (!al) continue;
    for (const a2 of c.answer2 ? FIELD.answer2.sizes : [0]) {
      const a2l = c.answer2 ? wrapText(c.answer2, a2, RIGHT.w) : [];
      if (!a2l) continue;
      const parts = [
        ...heads,
        al.length ? al.length * a * FIELD.answer.lh : null,
        a2l.length ? a2l.length * a2 * FIELD.answer2.lh : null,
      ].filter((x) => x !== null);
      const height =
        parts.reduce((s, x) => s + x, 0) + GAP * (parts.length - 1);
      if (RIGHT.top + height <= bottom) {
        const sizes = [
          c.tag ? TAG.size : null,
          scope.length ? FIELD.scope.sizes[0] : null,
          al.length ? a : null,
          a2l.length ? a2 : null,
        ].filter(Boolean);
        return {
          ok: true,
          scope: { size: FIELD.scope.sizes[0], lines: scope },
          answer: { size: a, lines: al },
          answer2: { size: a2, lines: a2l },
          bottom: Math.round(RIGHT.top + height),
          limit: bottom,
          // 括弧の小さい字があれば、その欄の SMALL 倍が最小
          minFontPx: Math.min(
            ...sizes,
            ...[
              [scope, FIELD.scope.sizes[0]],
              [al, a],
              [a2l, a2],
            ]
              .filter(([ls]) => ls.some((l) => l.includes(TODAY)))
              .map(([, z]) => z * SMALL),
          ),
        };
      }
      why = `下の線（y${bottom}）を越える（y${Math.round(RIGHT.top + height)}）`;
    }
  }
  return { ok: false, reason: `答えが${why}` };
}

/** 冒頭の棒（F01.jsx の Open と同じ寸法）。艇の札60・号艇52px・「（今日は名前 級）」34px（薄い色）・件数58px */
export const OPEN = {
  badge: 60,
  gap: 14,
  boatSize: 52,
  nameSize: 34,
  nameGap: 16,
  countSize: 58,
  barMax: 820,
  barMin: 360,
  margin: 72,
};

/** 冒頭の棒の名前と級（過去の件数の隣なので、今日その枠にいる選手と分かる形） */
export const openName = (b) => `${TODAY}${b.name}${NB}${b.grade}）`;

/**
 * 冒頭の棒の行の幅（名前と級の列の幅と、棒の長さの上限）。棒が barMin より短くなるなら ok=false
 * @param {{boat: number, count: number, name: string, grade: string}[]} bars
 */
export function layoutOpen(bars) {
  const o = OPEN;
  const labelW = Math.ceil(
    o.badge +
      o.gap +
      emWidth("号艇") * o.boatSize +
      o.nameGap +
      Math.max(0, ...bars.map((b) => charsEm(openName(b)))) *
        o.nameSize,
  );
  const countW = Math.ceil(
    Math.max(
      0,
      ...bars.map((b) => emWidth(`${b.count.toLocaleString("ja-JP")}件`)),
    ) * o.countSize,
  );
  const bar = Math.min(
    o.barMax,
    1920 - 2 * o.margin - labelW - 24 - 24 - countW,
  );
  if (bar < o.barMin)
    return {
      ok: false,
      reason: `冒頭の棒が ${bar}px（線 ${o.barMin}px）`,
      labelW,
      countW,
      bar,
    };
  return {
    ok: true,
    labelW,
    countW,
    bar,
    left: Math.round((1920 - (labelW + 24 + bar + 24 + countW)) / 2),
    minFontPx: o.nameSize,
  };
}
