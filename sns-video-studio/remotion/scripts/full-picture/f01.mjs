/**
 * 型 f01-landscape-voice-full（完全版を横 16:9＋声に）の試作の台本（純関数）。関門の段4。
 * 台本: docs/design/full-picture-type-gate/candidates/f01-landscape-voice-full/script.md（オーナー可 2026-10-27）、
 * 仕様の正本は hq drafts/fp-youtube-type-20261027.md の6節（仕様 v2）・7節（台本 v3）・7b節（締め）。
 * 型の表（type-spec.mjs の TYPE_IMPL）には載せない（オーナーが試作を見て可と言うまで。毎日の生成にもつながない）。
 *
 * 数字は材料 JSON（fetch-materials.mjs）と、今の場面の作り手（build-all.mjs）が出す値だけから作る。
 * 順位・比べの言い方（「最も多い」「入れ替わる」）は rankOf（1位が2位より多いとき、diff.mjs。|z| の線は 2026-11-01 に外した）だけ。同数なら件数を並べるだけ。
 * 選手名は声で読まない（読み仮名がデータに無い）。右の列と冒頭の棒は、艇番の隣に「フルネーム 級」を付ける（オーナーの恒久の決まり 2026-11-01、
 * 名前と級は材料の出走表 m.api.races の entries ＝ race_entries.player_name・grade。欠けたら作らない）。声の文（voice）と字幕（sub）は同じ文で、声だけ辞書で読みを直す（VOICE_DICT）。
 */
import { buildAll } from "./build-all.mjs";
import { answerOf } from "./answer.mjs";
import { DISCLAIMER, FEATURES, FULL_TAGS, LIMITS, ROUND_NAME, SITE, WEEKDAY, featureUrl, fullLine1, utmUrl } from "./bundle.mjs";
import { rankOf } from "./scenes/diff.mjs";
import { bannedIn } from "./scene2-text.mjs";
import { venueName } from "./scenes/common.mjs";
import { MIN_FONT_PX, NB, TODAY, boatToday, boatWho, charsEm, layoutOpen, layoutRight, racersOf } from "../../src/fullPicture/f01Right.js";
import { SERIES_TITLE_GRADES } from "../../../../src/utils/raceSeriesText.js";

/** 大会名の行の字の大きさ px（サムネ・冒頭）。長い名前は幅に収まるまで詰め、min を下回るなら作らない（f01TitleThumbCheck）。
 * 2025-11〜2026-11 の SG・G1 の大会名は最長25字（「第14回クイーンズクライマックス／G3QCシリーズ」）で、サムネ 32px のまま収まる */
export const SERIES_LINE = { thumb: 32, open: 32, min: 24, openWidth: 1800 };
/** 大会名の行の字の大きさ（幅 width px に収まる大きさ。big を越えない）。サムネは右上の締切の札と高さが重なるので、札の分を除いた幅で測る */
export const seriesSize = (text, big, width) => Math.min(big, Math.floor(width / Math.max(charsEm(text), 1)));
/** サムネの大会名の行に使える幅 px（上の帯と同じく、右上の締切の札＝44px＋左右の余白 22×2 と間 32 を除く） */
export const thumbSeriesWidth = (deadline) => THUMB.width - 32 - charsEm(`締切${deadline}`) * 44 - 44;

/**
 * 日目と大会名。材料の race（/2、BOA-1310）の seriesDayText・raceTitle をそのまま使う。作るのは共通の部品
 * （scripts/lib/raceSeriesLabels.js・src/utils/raceSeriesText.js、BOA-1309）で、規則は画面と同じ: 同じ会場で補う（BOA-509）・
 * 丸一日中止の日は出さない（BOA-658）・どれか1レースでも最終日なら最終日・文言は初日・N日目・最終日。大会名は SG・G1 だけ（NFKC）。
 * 欠けたら作らない（締切と同じ）。/1 の材料には無いので作らない
 * @param {object} m 材料 JSON
 * @returns {{ok: true, day: string, series: string|null} | {ok: false, kind: string, reason: string}}
 */
export function seriesOf(m) {
  const day = m.race?.seriesDayText ?? null;
  if (!day) return { ok: false, kind: "series_day", reason: "材料に何日目（race.seriesDayText）が無い（題・サムネ・冒頭の見出し・説明欄に日目を出す、オーナー 11/4）" };
  const series = m.race?.raceTitle ?? null;
  // グレードが SG・G1 なのに大会名が無い日は作らない（黙って大会名なしで出さない）。グレードは race.grade（races だけ）か、
  // 材料の取得が節の grade でも判定して残した missing の race.raceTitle
  const noTitle = m.missing?.find((x) => x.source === "race.raceTitle");
  if (!series && noTitle) return { ok: false, kind: "series_title", reason: noTitle.reason };
  if (!series && SERIES_TITLE_GRADES.includes(m.race?.grade)) return { ok: false, kind: "series_title", reason: `${m.race.grade} なのに材料に大会名（race.raceTitle）が無い` };
  return { ok: true, day, series };
}

export const F01_VERSION = "f01-proto-1";
export const VOICE = { speaker: "青山龍星", speedScale: 1.1, credit: "VOICEVOX:青山龍星" };
/** 字幕1行の字数の上限（1920 幅・44px で約40字。句読点で区切る） */
export const SUB_MAX = 34;
/** 順位の語（線を通ったときだけ使う） */
export const RANK_WORDS = /最も多|最多|次が|次は|2番目|一番(?!上)|入れ替わ/;
/**
 * 声の読みの辞書（9b節: 「313件」がサンビャクジュウサンゲン、「今節」がコンフシ）。声の文だけ置き換え、字幕は元の字のまま。
 * bad は audio_query の kana に出たら落とす読み（機械の照合）
 */
export const VOICE_DICT = [
  { word: "件", say: "けん", bad: /ゲン/ },
  { word: "今節", say: "こんせつ", bad: /コンフシ|イマフシ/ },
  { word: "2連率", say: "にれんりつ", bad: null },
];

const BOATS = [1, 2, 3, 4, 5, 6];
/** 件数（字幕は 11,160、声は「1万1160」） */
const cnt = (n) => n.toLocaleString("ja-JP");
const wari = (k, n) => Math.round((k / n) * 10);
/**
 * サムネ（F01Thumb、1280x720）の大きさ。大きな文言は2行で1行9字まで（オーナー 11/4）。9字の全角の幅までは big px、
 * それより長い行（長い名前）は幅に収まるよう字を詰め、min px を下回るなら作らない（f01Check）。
 * 幅は f01Right.js の charsEm（右の列と同じ見積り、Noto Sans JP の実測より広め）。116px の全角9字が 1,044px で、左右の余白72の内の 1,136px に入る。
 * 11月の出走表の名前は最長6字（大久保信一郎・安河内鈴之介・堀之内紀代子）で、「大久保信一郎 A1」は 7.6字分（116px のまま）
 */
export const THUMB = { width: 1136, big: 116, min: 80, maxChars: 9, foot: 40, number: 120 };
/** サムネの大きな文言の1行の字の大きさ px */
export const thumbSize = (t) => Math.min(THUMB.big, Math.floor((THUMB.big * THUMB.maxChars) / Math.max(charsEm(t), 1)));
/** サムネの下の行（「同じ並び 過去N回 1号艇の1着」＋大きな「X割」、間 24px）の幅の目安 px */
export const thumbFootWidth = (foot, number) => charsEm(foot) * THUMB.foot + 24 + charsEm(number) * THUMB.number;
const stepOf = (scenes, sid, id) => scenes.find((s) => s.id === sid)?.data?.steps?.find((x) => x.id === id) ?? null;
/** sankey の links（[段, a, b, 件]）→ 1着が a のときの2着の件数（艇番の順） */
const secondOf = (links, a) => BOATS.map((b) => links.filter((l) => l[0] === 0 && l[1] === a && l[2] === b).reduce((s, l) => s + l[3], 0));
const firstOf = (links) => BOATS.map((a) => links.filter((l) => l[0] === 0 && l[1] === a).reduce((s, l) => s + l[3], 0));
/** 件数の多い順（同数は艇番の順）。0件は除く */
const desc = (counts, except = []) =>
  BOATS.filter((b) => counts[b - 1] > 0 && !except.includes(b)).sort((x, y) => counts[y - 1] - counts[x - 1] || x - y);
/** 「2号艇24件、4号艇17件、…」。順位の語は付けない */
const listCounts = (counts, order, unit = "件") => order.map((b) => `${b}号艇${cnt(counts[b - 1])}${unit}`).join("、");

/**
 * 1文を字幕の行に分ける（句点で切り、長い文は読点で SUB_MAX 字以内に詰める）
 * @param {string} text
 */
export function splitSubs(text) {
  const out = [];
  for (const sent of text.split(/(?<=。)/).map((s) => s.trim()).filter(Boolean)) {
    if (sent.length <= SUB_MAX) {
      out.push(sent);
      continue;
    }
    let cur = "";
    for (const part of sent.split(/(?<=、)/)) {
      if (cur && (cur + part).length > SUB_MAX) {
        out.push(cur);
        cur = part;
      } else cur += part;
    }
    if (cur) out.push(cur);
  }
  return out;
}
/** 声の文（字幕の字 → 読み。桁区切りを外し、「37.0%」は「37パーセント」、辞書で読みを置き換える） */
export const voiceText = (sub) =>
  VOICE_DICT.reduce(
    (s, d) => s.split(d.word).join(d.say),
    sub
      .replace(/(\d),(?=\d{3})/g, "$1")
      .replace(/(\d+)\.0%/g, "$1%")
      .replace(/%/g, "パーセント"),
  );

/**
 * 材料 → 章の並び（声・字幕・右の列・左の画面の撮り方）。作れない章は omitted に理由を書いて省く
 * @param {object} m 材料 JSON
 */
export function f01Script(m) {
  const scenes = buildAll(m);
  const omitted = [];
  const [y, mo, d, vc, rn] = m.raceId.split("-").map(Number);
  const venue = venueName(vc);
  const round = ROUND_NAME[m.api.facts?.today?.round] ?? null;
  const raceName = `${venue}${rn}R${round ? ` ${round}` : ""}`;
  const sayRace = `${venue}${rn}レース${round ? `、${round}` : ""}`;
  const date = `${mo}/${d}`;
  // 名前と級（race_entries）。欠けたら作らない（黙って艇番だけにしない）
  const { racers, missing } = racersOf(m);
  if (missing.length) return { ok: false, kind: "racer_name_grade", reason: `出走表に名前か級が無い艇: ${missing.map((b) => `${b}号艇`).join("・")}（race_entries.player_name・grade）` };
  const who = (b) => boatWho(racers, b);
  // 艇と、その艇の数字は同じ行に置く（間で折り返すと、次の行の数字が別の艇の数字に読める）
  const withN = (b, n) => `${who(b)}${NB}${n}`;
  // 過去の集計（枠ごとの件数・割合）の艇は「3号艇（今日は名前 級）」。数字の主語は艇番（枠）にし、範囲の行には名前を入れない
  // （x-channel P0・youtube-channel P1、#2079: 「3号艇 梶原正 B1が1着 1,998件」が本人の通算に読まれた）
  const past = (b) => boatToday(racers, b);
  const pastN = (b, n) => `${past(b)}${NB}${n}`;

  // 冒頭: 1号艇が負けた件の内訳（answer.mjs と同じセル forms.any）
  const sc = m.api.scenario?.scenario;
  const ans = answerOf(sc, null);
  if (!ans.ok) return { ok: false, kind: ans.kind, reason: ans.reason };
  const tri = sc.cells.waku.forms.any.tri ?? {};
  const first = BOATS.map((b) => Object.entries(tri).filter(([k]) => Number(k.split("-")[0]) === b).reduce((s, [, c]) => s + c, 0));
  const n0 = ans.n0;
  const k0 = ans.k0;
  const lossN = n0 - k0;
  const lossOrder = desc(first, [1]);
  const local = String(m.api.scenario.scope ?? "").startsWith("VC:");
  const where = local ? venue : "全国";
  const ym = (s) => `${Number(s.slice(0, 4))}/${Number(s.slice(5, 7))}`;
  const span = sc.period?.[0] ? `${ym(sc.period[0])}〜` : "";
  const scopeTag = `${where}・6艇の級の並びが同じ・枠なり ${span} ${cnt(n0)}件`;
  const question = "1号艇を崩す材料はどの艇に？";
  // 締切（説明欄の raceHeader と同じ値 m.race.startTime）。題・サムネ・冒頭の見出しに出す（オーナー 11/4「全ての動画に締め切り時刻も記載すること」）。
  // 無い日は作らない（締切の無い題で出さない）
  const deadline = /^\d{1,2}:\d{2}/.exec(m.race?.startTime ?? "")?.[0] ?? null;
  if (!deadline) return { ok: false, kind: "deadline", reason: "材料に締切（race.startTime）が無い（題・サムネ・冒頭の見出しに締切を出す、オーナー 11/4）" };
  const dateW = `${date}(${WEEKDAY[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]})`;
  // 何日目と、SG・G1 の大会名（オーナー 11/4「全ての SNS に日付・何日目・レース名・締切の時刻を記載」）。欠けたら作らない（締切と同じ）
  const sr = seriesOf(m);
  if (!sr.ok) return sr;
  const { day, series } = sr;
  // 題の頭と説明欄の4行目（同じ文）
  const lead = (withSeries) => `ボートレース${venue}${withSeries && series ? ` ${series}` : ""} ${rn}R${round ? ` ${round}` : ""} ${dateW} ${day} 締切${deadline}`;
  const r1 = racers[1];
  // 1号艇の1着の割合。冒頭の声「1号艇がX割勝つ」と同じ丸め（k0/n0 の10倍を四捨五入）。n0・k0 は answer.mjs の forms.any
  // （同じ級の並び・枠なりの過去。冒頭の範囲の札「6艇の級の並びが同じ・枠なり N件」と同じ数）
  const win1 = `${wari(k0, n0)}割`;
  // サムネ（オーナー 11/4 承認）: 上の帯「{会場}{R}R {レース名} {M/D}({曜}) {日目}」（SG・G1 は下に大会名）・右上の札「締切{HH:MM}」・大きな2行「{名前} {級}」「逃げ切れる？」・
  // 下「同じ並び 過去{n0}回 1号艇の1着 {X}割」
  const thumb = {
    head: `${raceName} ${dateW} ${day}`,
    // SG・G1 は上の帯の下に大会名を小さく1行（長い名前は詰める。線を下回るなら作らない）
    series: series ? { text: series, size: seriesSize(series, SERIES_LINE.thumb, thumbSeriesWidth(deadline)) } : null,
    deadline: `締切${deadline}`,
    lines: [`${r1.name}${NB}${r1.grade}`, "逃げ切れる？"].map((text) => ({ text, size: thumbSize(text) })),
    foot: `同じ並び 過去${cnt(n0)}回\u30001号艇の1着`,
    number: win1,
  };
  const chapters = [];
  chapters.push({
    id: "open",
    name: "冒頭",
    voice: `${sayRace}。1号艇が${wari(k0, n0)}割勝つ組み合わせで、崩すならどの艇か。${where}で、6艇の級の並びが同じ、枠なりの過去${cnt(n0)}件。1号艇が負けた${cnt(lossN)}件の内訳は、${listCounts(first, lossOrder)}。`,
    open: {
      head: `${raceName}  ${dateW}  ${day}  締切${deadline}`,
      series: series ? { text: series, size: seriesSize(series, SERIES_LINE.open, SERIES_LINE.openWidth) } : null,
      title: `1号艇が負けた${lossN}回、勝ったのは？`,
      bars: lossOrder.map((b) => ({ boat: b, count: first[b - 1], name: racers[b].name, grade: racers[b].grade })),
      note: `${scopeTag}（1号艇の1着 ${cnt(k0)}件 ${ans.p0.toFixed(1)}%）`,
    },
    // 字幕は外す（見本の「最も多く勝ったのは…次が…」は 24 対 17 で z≈1.10。統合役の指示 10/27）。冒頭は声だけ
    noSubs: true,
    facts: { n0, k0, lossN, first, rank: rankOf(first[lossOrder[0] - 1], first[lossOrder[1] - 1] ?? 0) },
  });

  // ① 差がつく材料（今日の6艇。標本からの推定でない記述）
  const s2 = scenes.find((s) => s.id === "scene2")?.data;
  const axes = s2?.radar?.axes ?? [];
  const top2 = Object.fromEntries((s2?.radar?.boats ?? []).map((b) => [b.boat, b.top2]));
  if (!axes.length) omitted.push({ chapter: "c1", reason: "差がつく材料が無い" });
  else {
    const max = Math.max(...Object.values(top2));
    const leaders = BOATS.filter((b) => top2[b] === max);
    const label = (a) => a.label.replace("直近30走1着率", "直近30走の1着率").replace("平均ST", "平均スタート");
    chapters.push({
      id: "c1",
      name: "6艇の差",
      tag: "龍神ソナー ＞ 差がつく材料",
      scope: `今日の6艇・${axes.length}項目`,
      answer: `${leaders.map(who).join("・")}\n${leaders.length > 1 ? "それぞれ " : ""}${max}項目`,
      answer2: `${axes.length}項目のうち2位以内に入った数`,
      path: "ソナー → 差がつく材料",
      voice: `まず龍神ソナーの、差がつく材料。${axes.map(label).join("、")}の${axes.length}項目で、2位以内に入ったのは、${leaders.map((b) => `${b}号艇`).join("と")}が${leaders.length > 1 ? "それぞれ" : ""}${max}項目。`,
      shot: { page: "sonar", tab: "差がつく材料", cut: "radar", cut2: "rows", gold: [] },
      expect: axes.map((a) => a.label),
      expect2: leaders.map((b) => `5項目中 ${top2[b]} 項目で2位以内`.replace("5項目", `${axes.length}項目`)),
      facts: { top2, leaders, max },
    });
  }

  // ② 類似レース（1着の件数と、1着の多い艇が勝ったときの2着）
  const sonar = stepOf(scenes, "scene2b", "s2b-sonar");
  const flow = stepOf(scenes, "scene2b", "s2b-flow-1");
  if (!sonar) omitted.push({ chapter: "c2", reason: "類似レースの材料が無い" });
  else {
    const n = sonar.facts.n;
    // 1着の件数は画面（龍神ソナーの「どの艇が勝った？」）と同じ数え方: 1〜3着がそろった類似レースだけ（analogyAggregate の aggregateNeighbors）。
    // 着順の流れの元（ag.tri）から数える。sonar.page.counts は着順の欠けたレースも数え、画面と2件ずれた（10/30 児島10R 293 対 291）
    const counts = flow ? firstOf(flow.page.links) : sonar.page.counts;
    const order = desc(counts).slice(0, 3);
    const fb = order[0];
    const sec = flow ? secondOf(flow.page.links, fb) : null;
    const secOrder = sec ? desc(sec) : [];
    const secRank = sec && secOrder.length ? rankOf(sec[secOrder[0] - 1], sec[secOrder[1] - 1] ?? 0) : null;
    const lines = [`次に、類似レースのタブ。条件がそろう類似レースを${n}件集めると、1着は${order.map((b, i) => (i === 0 ? `${b}号艇が${cnt(counts[b - 1])}件` : `${b}号艇${cnt(counts[b - 1])}件`)).join("、")}。`];
    if (sec)
      lines.push(
        secRank.rankSig
          ? `${fb}号艇が勝った${cnt(counts[fb - 1])}件では、2着は${secOrder[0]}号艇が${cnt(sec[secOrder[0] - 1])}件で最も多い。`
          : `${fb}号艇が勝った${cnt(counts[fb - 1])}件の2着は、${listCounts(sec, secOrder.slice(0, 3))}と割れる。`,
      );
    chapters.push({
      id: "c2",
      name: "類似レース",
      tag: "龍神ソナー ＞ 類似レース",
      scope: `出走表の類似度の高い順 ${n}件`,
      answer: `${past(fb)}\n類似レースで1着 ${cnt(counts[fb - 1])}件`,
      // 2着の1位が線を通らない日は、上から3艇の件数を並べる（1艇だけ出すと「2着は◯号艇」と読める）
      answer2: !sec
        ? null
        : secRank.rankSig
          ? `${fb}号艇が1着のとき\n2着${NB}${pastN(secOrder[0], `${cnt(sec[secOrder[0] - 1])}件`)}`
          : `${fb}号艇が1着のとき\n2着${NB}${secOrder.slice(0, 3).map((b) => pastN(b, `${sec[b - 1]}件`)).join("・")}`,
      path: "ソナー → 類似レース",
      voice: lines.join(""),
      shot: { page: "sonar", tab: "類似レース", cut: "similarBars", cut2: sec ? "similarFlow" : null, firstBoat: fb },
      expect: [`${cnt(counts[fb - 1])}件`],
      expect2: sec ? [`${cnt(sec[secOrder[0] - 1])}件`] : [],
      facts: { n, counts, fb, sec, secRank },
    });
  }

  // ③ 展開（今日のスタートの形と、その形の過去）
  const slit = stepOf(scenes, "scene4", "s4-slit-course");
  const cflow = stepOf(scenes, "scene4", "s4-course-flow-1");
  if (!slit || slit.facts.fallback || !cflow) omitted.push({ chapter: "c3", reason: "今日の6艇が当てはまるスタートの形が無い（または形の件数の材料が無い）" });
  else {
    const form = slit.facts.form;
    const fc = firstOf(cflow.page.links);
    const nForm = cflow.page.n;
    const fb = desc(fc)[0];
    const sec = secondOf(cflow.page.links, fb);
    const secOrder = desc(sec);
    const secRank = rankOf(sec[secOrder[0] - 1], sec[secOrder[1] - 1] ?? 0);
    const lines = [
      `展開のタブでは、スタートの形を見る。今日の6艇は、コース別の平均スタートで${form}形。`,
      `${cnt(n0)}件のうち、この形の${cnt(nForm)}件で、1着は${fb}号艇が${cnt(fc[fb - 1])}件。`,
      secRank.rankSig
        ? `${fb}号艇が勝った${cnt(fc[fb - 1])}件の2着は、${secOrder[0]}号艇が${cnt(sec[secOrder[0] - 1])}件で最も多い。`
        : `${fb}号艇が勝った${cnt(fc[fb - 1])}件の2着は、${listCounts(sec, secOrder.slice(0, 3))}と割れる。`,
    ];
    chapters.push({
      id: "c3",
      name: "スタートの形",
      tag: "龍神ソナー ＞ 展開シナリオ",
      scope: `${cnt(n0)}件のうち ${form} ${cnt(nForm)}件`,
      answer: `${past(fb)}\nこの形で1着 ${cnt(fc[fb - 1])}件`,
      answer2: `2着${NB}${secOrder.slice(0, 3).map((b) => pastN(b, `${sec[b - 1]}件`)).join("・")}`,
      path: "ソナー → 展開シナリオ",
      voice: lines.join(""),
      shot: { page: "sonar", tab: "展開シナリオ", cut: "slitForms", cut2: "scenarioFlow", form, firstBoat: fb },
      expect: [form],
      expect2: [`${cnt(fc[fb - 1])}件`],
      facts: { form, nForm, fc, fb, sec, secRank },
    });
  }

  // ④ 思考アシスト＞相手（軸を1号艇から、負けた件の多い艇に変える）
  const ax = (b) => stepOf(scenes, "scene5", `s5-axis-${b}`)?.facts ?? null;
  const ax1 = ax(1);
  // 変える軸: 冒頭の内訳で件数の多い艇のうち、1号艇軸の2着の艇（②・①で触れた艇）でない艇
  const axisK = lossOrder.find((b) => b !== ax1?.second?.boat && ax(b));
  const axK = axisK ? ax(axisK) : null;
  if (!ax1 || !axK) omitted.push({ chapter: "c4", reason: "軸ごとの2着の材料が無い" });
  else {
    const swap = ax1.rankSig && axK.rankSig && ax1.second.boat !== axK.second.boat;
    chapters.push({
      id: "c4",
      name: "相手",
      tag: "思考アシスト ＞ 相手",
      scope: `${ax1.venue}の全期間・全選手 ${axisK}号艇が1着 ${cnt(axK.n)}件`,
      answer: `軸 ${past(axisK)}\n2着${NB}${pastN(axK.second.boat, `${axK.second.rate}%`)}`,
      answer2: `軸 ${past(1)}なら\n2着${NB}${pastN(ax1.second.boat, `${ax1.second.rate}%`)}`,
      path: "アシスト → 相手 → 軸",
      voice:
        `ここからは思考アシスト。軸を選ぶと、相手の割合が出る。${ax1.venue}で1号艇が1着の${cnt(ax1.n)}件では、2着は${ax1.second.boat}号艇が${ax1.second.rate}%。` +
        `軸を${axisK}号艇に変えると、${cnt(axK.n)}件で、2着は${axK.second.boat}号艇が${axK.second.rate}%${swap ? "に入れ替わる" : ""}。`,
      shot: { page: "assist", cut: "follow", axis: 1, axis2: axisK },
      expect: [`2着は${ax1.second.boat}号艇 ${Math.round(Number(ax1.second.rate))}%`],
      expect2: [`2着は${axK.second.boat}号艇 ${Math.round(Number(axK.second.rate))}%`],
      facts: { ax1, axK, axisK, swap },
    });
  }

  // ⑤ 冒頭の問いの答え（負けた件の多い3艇の、差がつく材料の数）
  if (axes.length) {
    const three = lossOrder.slice(0, 3).sort((a, b) => a - b);
    const best = Math.max(...three.map((b) => top2[b]));
    const bests = three.filter((b) => top2[b] === best);
    chapters.push({
      id: "c5",
      name: "冒頭の問いの答え",
      tag: "龍神ソナー ＞ 差がつく材料",
      scope: `今日の6艇・${axes.length}項目`,
      answer: best > 0 ? `項目が多いのは\n${bests.map(who).join("・")}` : "3艇とも項目は少ない",
      answer2: three.map((b) => withN(b, `${top2[b]}項目`)).join("・"),
      path: "ソナー → 差がつく材料",
      voice:
        `では、冒頭の問い。同じ${axes.length}項目で2位以内に入ったのは、${three.map((b, i) => `${b}号艇${i === three.length - 1 ? "は" : "が"}${top2[b]}項目`).join("、")}。` +
        // 今日の6艇の記述（標本からの推定でない）。「材料があるのは」は他の艇に材料が無いと読めるので使わない
        (best > 0 ? `この3艇で項目が多いのは${bests.map((b) => `${b}号艇`).join("と")}。` : "この3艇には、今日の材料が少ない。") +
        "展示の後は、今節の平均より速い展示タイムを出した艇を見る。",
      shot: { page: "sonar", tab: "差がつく材料", cut: "radar", gold: three },
      expect: three.map((b) => `${top2[b]} 項目で2位以内`),
      facts: { three, best, bests },
    });
  }

  // 締め 案B（展示の取得が off の日。BOA-1145 で 403 のあいだ）: まだ押していない軸
  // 声でまだ触れていない艇（1号艇・変えた軸・1号艇軸の2着の艇は除く）
  const used = [1, axisK, ax1?.second?.boat].filter(Boolean);
  const rest = lossOrder.find((b) => !used.includes(b)) ?? null;
  if (rest && axK)
    chapters.push({
      id: "close",
      name: "締め",
      tag: "思考アシスト ＞ 相手",
      voice: `まだ押していない軸がある。もし${rest}号艇を軸にしたら、相手はどう変わるか。思考アシストで、残りの軸もこのレースのまま押せる。ページは、説明欄の一番上に。`,
      shot: { page: "assist", cut: "follow", axis: axisK, goldAxis: rest },
      foot: "説明欄の一番上",
      facts: { rest },
    });
  else omitted.push({ chapter: "close", reason: "押していない軸が無い" });

  for (const c of chapters) {
    c.subs = c.noSubs ? [] : splitSubs(c.voice);
    // 右の列の行と字の大きさ（作る側で決める。F01.jsx は並べるだけ）
    if (c.open) c.open.layout = layoutOpen(c.open.bars);
    else c.right = layoutRight(c);
  }
  const url = `${SITE}/race/${m.raceId}`;
  const titles = [true, false].map((w) => `${lead(w)}｜1号艇 ${r1.name}${r1.grade}は逃げ切れる？ 同じ並びの1着${win1}`);
  return {
    ok: true,
    version: F01_VERSION,
    raceId: m.raceId,
    raceName,
    date,
    question,
    chapters,
    omitted,
    // 題（オーナー 11/4 承認）: 「ボートレース{会場} {大会名} {R}R {レース名} {M/D}({曜}) {日目} 締切{HH:MM}｜1号艇 {名前}{級}は逃げ切れる？ 同じ並びの1着{X}割」。
    // 大会名は SG・G1 だけ。100字を越える日は題からだけ大会名を外す（サムネ・冒頭・説明欄には残す）。外しても越えれば f01TitleThumbCheck で止める
    title: titles.find((t) => t.length <= LIMITS.title) ?? titles[1],
    thumb,
    deadline,
    day,
    series,
    lead: lead(true),
    url,
    place: `${venue}${rn}R`,
    open: { n0, k0, lossN, p0: ans.p0, where },
    racers,
    year: y,
  };
}

/**
 * 説明欄。今の完全版の説明文の約束（hq 契約 10/24 C1・C3、bundle.mjs の checkBundle）に合わせる:
 * 1行目は問いと「ボートレース {会場}{R}」（全角40字以内）、2・3行目に龍神ソナー・思考アシストへの導線、
 * このレースの URL（utm_term=full）、章、クレジット「VOICEVOX:青山龍星」、末尾はハッシュタグ3つまで。
 * 締めの声「ページは、説明欄の一番上に」は、一番上の導線（このレースの龍神ソナー）を指す
 * @param {ReturnType<typeof f01Script>} s @param {string} chapters 章の行（f01-build.mjs の f01Chapters）
 */
export function f01Description(s, chapters) {
  const o = s.open;
  return [
    fullLine1(s.question, s.place),
    `${FEATURES.sonar.line}: ${featureUrl(s.raceId, "sonar")}`,
    `${FEATURES.assist.line}: ${featureUrl(s.raceId, "assist")}`,
    // 4行目は題の頭と同じ文（大会名は題から外した日も残す）
    s.lead,
    "",
    `${o.where}で6艇の級の並びが同じ・枠なりの過去${cnt(o.n0)}件、1号艇の1着は${cnt(o.k0)}件（${o.p0.toFixed(1)}%）。負けた${cnt(o.lossN)}件の内訳から、龍神ソナーと思考アシストの画面で材料を順に見る動画です。`,
    `このレースのデータ（龍神レーダー）: ${utmUrl(s.raceId, "youtube", "full")}`,
    "",
    chapters.trim(),
    "",
    DISCLAIMER,
    `音声: ${VOICE.credit}`,
    FULL_TAGS.map((x) => `#${x}`).join(" "),
  ].join("\n");
}

/** 回収率を出さない（2026-10-20 オーナー決定。収益を連想させる。今の型の場面3③の回収率の拍を外したのと同じ） */
export const NO_RETURN_RATE = /回収率/;
/** 章の中の、画面と声に出る文字（facts・撮り方・照合の期待は除く） */
export function f01Texts(c) {
  const out = [];
  const walk = (v, key) => {
    if (["facts", "shot", "expect", "expect2"].includes(key)) return;
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, null));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(c, null);
  return out;
}

/**
 * 機械の検査（落ちた理由の一覧。空なら合格）
 * @param {ReturnType<typeof f01Script>} s @param {{desc: string, kana: Record<string, string>, shots: Record<string, {text: string}>, names?: string[], racers?: Record<number, {name: string, grade: string}>}} r
 */
export function f01Check(s, r) {
  const why = [];
  if (!r.desc.includes(VOICE.credit)) why.push(`説明欄に「${VOICE.credit}」が無い`);
  // 禁止表現（risk-rules.json、YouTube）と回収率を、題・説明欄・各章の声・字幕・右の列・冒頭の全部に当てる
  // （run-full の checkPost は今の型の題・説明欄にしか当たらず、f01 の文は検査の外だった。Orchestrate 11/2）
  const thumbTexts = s.thumb ? [s.thumb.head, s.thumb.series?.text, s.thumb.deadline, ...s.thumb.lines.map((l) => l.text), s.thumb.foot, s.thumb.number] : [];
  for (const [where, text] of [["題", s.title], ["説明欄", r.desc], ...thumbTexts.map((t) => ["サムネ", t]), ...s.chapters.flatMap((c) => f01Texts(c).map((t) => [c.id, t]))]) {
    if (typeof text !== "string") continue;
    for (const w of bannedIn(text, "youtube")) why.push(`${where}: ${w}`);
    if (NO_RETURN_RATE.test(text)) why.push(`${where}: 回収率を出さない（${text.match(NO_RETURN_RATE)[0]}）`);
  }
  for (const c of s.chapters) {
    // 順位の語は線を通ったときだけ（②・③の「最も多い」、④の「入れ替わる」）
    const sig = c.facts?.secRank?.rankSig || c.facts?.swap;
    if (RANK_WORDS.test(c.voice) && !sig) why.push(`${c.id}: 線を通らない順位の語: ${c.voice.match(RANK_WORDS)[0]}`);
    // 選手名を声で読まない（材料の選手名が声の文に無い）
    for (const name of r.names ?? []) if (name && c.voice.includes(name)) why.push(`${c.id}: 声に選手名「${name}」`);
    // 字幕は1行 SUB_MAX 字以内
    for (const l of c.subs) if (l.length > SUB_MAX + 2) why.push(`${c.id}: 字幕が${l.length}字`);
  }
  why.push(...f01TitleThumbCheck(s));
  // 名前と級（race_entries）: 右の列の艇番の隣に「フルネーム 級」があり、出走表と一致するか。右の列が幅・下の線に収まるか
  if (r.racers) why.push(...f01RacerCheck(s, r.racers));
  // 読みの辞書（audio_query の kana）
  for (const [key, kana] of Object.entries(r.kana)) for (const d of VOICE_DICT) if (d.bad && d.bad.test(kana)) why.push(`読み ${key}: ${d.word} が ${kana.match(d.bad)[0]}`);
  // 左の画面に、右の列・声と同じ数字が写っているか（照合）
  for (const c of s.chapters) {
    for (const [cut, exp] of [["", c.expect], ["2", c.expect2]]) {
      const shot = r.shots[`${c.id}${cut}`];
      if (!exp?.length) continue;
      if (!shot) {
        why.push(`${c.id}${cut}: 左の画面が無い`);
        continue;
      }
      // 空白と桁区切りは比べない（画面は「1,553件」、台本の件数は「1553件」の日があった。11/01 14-10 で止まった）
      const norm = (x) => x.replace(/\s+/g, "").replace(/(\d),(?=\d{3})/g, "$1");
      const flat = norm(shot.text);
      for (const e of exp) if (!flat.includes(norm(e))) why.push(`${c.id}${cut}: 左の画面に「${e}」が無い`);
    }
  }
  return why;
}

/**
 * 題とサムネの検査（純関数。声と撮影の前に buildF01 でも呼ぶ）。題は YouTube の上限 100 字（bundle.mjs の LIMITS.title、
 * push の checkBundle と同じ数え方 length）。サムネは、字を詰めても THUMB.min px を下回る行・下の行と上の帯（右上の締切の札の分を除く）が幅を越えるときは作らない
 * @param {{title?: string, thumb?: {head: string, deadline: string, lines: {text: string, size: number}[], foot: string, number: string}}} s
 * @returns {string[]}
 */
export function f01TitleThumbCheck(s) {
  const why = [];
  if (typeof s.title === "string" && s.title.length > LIMITS.title) why.push(`題が${s.title.length}字（上限 ${LIMITS.title} 字）`);
  const t = s.thumb;
  if (!t) return why;
  for (const l of t.lines) if (l.size < THUMB.min) why.push(`サムネ: 「${l.text}」が ${l.size}px（線 ${THUMB.min}px）`);
  if (thumbFootWidth(t.foot, t.number) > THUMB.width) why.push(`サムネ: 下の行が幅 ${THUMB.width}px を越える`);
  // 上の帯（40px）と右上の札（44px＋左右の余白 22×2、間 32）が重ならない
  if (charsEm(t.head) * 40 + 32 + charsEm(t.deadline) * 44 + 44 > THUMB.width) why.push(`サムネ: 上の帯「${t.head}」が締切の札に重なる`);
  // 大会名の行（SG・G1）: 幅に収まるよう詰めた字が線を下回るなら作らない（名前を切って出さない）
  if (t.series && charsEm(t.series.text) * t.series.size + 32 + charsEm(t.deadline) * 44 + 44 > THUMB.width) why.push(`サムネ: 大会名「${t.series.text}」が締切の札に重なる`);
  if (t.series && t.series.size < SERIES_LINE.min) why.push(`サムネ: 大会名「${t.series.text}」が ${t.series.size}px（線 ${SERIES_LINE.min}px）`);
  const op = s.chapters?.find((c) => c.open)?.open;
  if (op?.series && op.series.size < SERIES_LINE.min) why.push(`open: 大会名「${op.series.text}」が ${op.series.size}px（線 ${SERIES_LINE.min}px）`);
  return why;
}

/** 右の列の欄（範囲・答え・答え2）。章の札と「自分で見るなら」に艇番は出ない */
const RIGHT_KEYS = ["scope", "answer", "answer2"];
/** 字の小ささの線（右の列・冒頭の棒）。左の画面と同じ線（f01Right.js の MIN_FONT_PX）。今の字の大きさの候補（32px 以上）では下回らないが、候補を変えたときに止める */
const RIGHT_MIN_FONT_PX = MIN_FONT_PX;

/**
 * 名前と級の照合（落ちた理由の一覧）。艇番の隣が「 名前 級」でない・出走表と違う・右の列が幅か下の線を越える・字が線より小さい
 * @param {{chapters: object[]}} s @param {Record<number, {name: string, grade: string}>} racers 出走表（race_entries）の艇番ごとの名前と級
 */
export function f01RacerCheck(s, racers) {
  const why = [];
  for (const c of s.chapters) {
    if (c.open) {
      for (const b of c.open.bars) {
        const e = racers[b.boat];
        if (!e || b.name !== e.name || b.grade !== e.grade) why.push(`open: ${b.boat}号艇の名前と級「${b.name ?? ""} ${b.grade ?? ""}」が出走表「${e?.name ?? "なし"} ${e?.grade ?? "なし"}」と違う`);
      }
      const L = c.open.layout;
      if (!L?.ok) why.push(`open: ${L?.reason ?? "冒頭の棒の幅を決めていない"}`);
      else if (L.minFontPx < RIGHT_MIN_FONT_PX) why.push(`open: 字が ${L.minFontPx}px（線 ${RIGHT_MIN_FONT_PX}px）`);
      continue;
    }
    // 範囲の行（scope）には名前を入れない（集計が選手個人の成績に読まれる）。艇番は、同じ章の答えで名前と級を付けていればよい。
    // 答え・答え2の艇番は、すべて隣に「 名前 級」（今日の6艇の属性）か「（今日は名前 級）」（過去の集計）
    const named = new Set();
    const bareScope = new Set();
    for (const k of RIGHT_KEYS) {
      const text = c[k];
      if (!text) continue;
      if (k === "scope") {
        for (const e of Object.values(racers)) if (text.includes(e.name)) why.push(`${c.id}: 範囲の行に選手名「${e.name}」（集計が個人の成績に読まれる）`);
        for (const mm of text.matchAll(/(\d)号艇/g)) bareScope.add(Number(mm[1]));
        continue;
      }
      for (const mm of text.matchAll(/(\d)号艇/g)) {
        const b = Number(mm[1]);
        const e = racers[b];
        const after = text.slice(mm.index + mm[0].length);
        const got = after.match(new RegExp(`^(?:${NB}([^${NB}\\s]+)${NB}([AB][12])|${TODAY}([^${NB}）]+)${NB}([AB][12])）)`));
        if (!got) {
          // 「3号艇が1着のとき」のように、同じ章で既に名前を付けた艇は艇番だけでよい
          if (!named.has(b)) why.push(`${c.id}: ${k} の ${b}号艇の隣に名前と級が無い`);
          continue;
        }
        const [name, grade] = got[1] ? [got[1], got[2]] : [got[3], got[4]];
        if (!e || name !== e.name || grade !== e.grade) why.push(`${c.id}: ${k} の ${b}号艇「${name} ${grade}」が出走表「${e?.name ?? "なし"} ${e?.grade ?? "なし"}」と違う`);
        named.add(b);
      }
    }
    for (const b of bareScope) if (!named.has(b)) why.push(`${c.id}: 範囲の行の ${b}号艇に、答えで名前と級が付いていない`);
    if (RIGHT_KEYS.some((k) => c[k])) {
      if (!c.right?.ok) why.push(`${c.id}: 右の列が収まらない（${c.right?.reason ?? "行を決めていない"}）`);
      else if (c.right.minFontPx < RIGHT_MIN_FONT_PX) why.push(`${c.id}: 右の列の字が ${c.right.minFontPx}px（線 ${RIGHT_MIN_FONT_PX}px）`);
    }
  }
  return why;
}
