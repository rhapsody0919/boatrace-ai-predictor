/**
 * 型 f01-landscape-voice-full（完全版を横 16:9＋声に）の試作の台本（純関数）。関門の段4。
 * 台本: docs/design/full-picture-type-gate/candidates/f01-landscape-voice-full/script.md（オーナー可 2026-10-27）、
 * 仕様の正本は hq drafts/fp-youtube-type-20261027.md の6節（仕様 v2）・7節（台本 v3）・7b節（締め）。
 * 型の表（type-spec.mjs の TYPE_IMPL）には載せない（オーナーが試作を見て可と言うまで。毎日の生成にもつながない）。
 *
 * 数字は材料 JSON（fetch-materials.mjs）と、今の場面の作り手（build-all.mjs）が出す値だけから作る。
 * 順位・比べの言い方（「最も多い」「入れ替わる」）は rankOf（|z|>=1.96、diff.mjs）を通ったときだけ。通らなければ件数を並べるだけ。
 * 選手名は声で読まない（読み仮名がデータに無い）。声の文（voice）と字幕（sub）は同じ文で、声だけ辞書で読みを直す（VOICE_DICT）。
 */
import { buildAll } from "./build-all.mjs";
import { answerOf } from "./answer.mjs";
import { DISCLAIMER, FEATURES, FULL_TAGS, ROUND_NAME, SITE, featureUrl, fullLine1, raceHeader, utmUrl } from "./bundle.mjs";
import { rankOf } from "./scenes/diff.mjs";
import { venueName } from "./scenes/common.mjs";

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
  const chapters = [];
  chapters.push({
    id: "open",
    name: "冒頭",
    voice: `${sayRace}。1号艇が${wari(k0, n0)}割勝つ組み合わせで、崩すならどの艇か。${where}で、6艇の級の並びが同じ、枠なりの過去${cnt(n0)}件。1号艇が負けた${cnt(lossN)}件の内訳は、${listCounts(first, lossOrder)}。`,
    open: {
      head: `${raceName}  ${date}`,
      title: `1号艇が負けた${lossN}回、勝ったのは？`,
      bars: lossOrder.map((b) => ({ boat: b, count: first[b - 1] })),
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
      answer: `${leaders.join("・")}号艇 ${max}項目`,
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
    const counts = sonar.page.counts;
    const order = desc(counts).slice(0, 3);
    const fb = order[0];
    const sec = flow ? secondOf(flow.page.links, fb) : null;
    const secOrder = sec ? desc(sec) : [];
    const secRank = sec && secOrder.length ? rankOf(sec[secOrder[0] - 1], sec[secOrder[1] - 1] ?? 0) : null;
    const lines = [`次に、類似レースのタブ。条件がそろう類似レースを${n}件集めると、1着は${order.map((b, i) => (i === 0 ? `${b}号艇が${counts[b - 1]}件` : `${b}号艇${counts[b - 1]}件`)).join("、")}。`];
    if (sec)
      lines.push(
        secRank.rankSig
          ? `${fb}号艇が勝った${counts[fb - 1]}件では、2着は${secOrder[0]}号艇が${sec[secOrder[0] - 1]}件で最も多い。`
          : `${fb}号艇が勝った${counts[fb - 1]}件の2着は、${listCounts(sec, secOrder.slice(0, 3))}と割れる。`,
      );
    chapters.push({
      id: "c2",
      name: "類似レース",
      tag: "龍神ソナー ＞ 類似レース",
      scope: `出走表の類似度の高い順 ${n}件`,
      answer: `1着 ${fb}号艇 ${counts[fb - 1]}件`,
      // 2着の1位が線を通らない日は、上から3艇の件数を並べる（1艇だけ出すと「2着は◯号艇」と読める）
      answer2: !sec
        ? null
        : secRank.rankSig
          ? `${fb}号艇1着のとき 2着 ${secOrder[0]}号艇 ${sec[secOrder[0] - 1]}件`
          : `${fb}号艇1着のとき 2着 ${secOrder.slice(0, 3).map((b) => `${b}号艇${sec[b - 1]}`).join("・")}`,
      path: "ソナー → 類似レース",
      voice: lines.join(""),
      shot: { page: "sonar", tab: "類似レース", cut: "similarBars", cut2: sec ? "similarFlow" : null, firstBoat: fb },
      expect: [`${counts[fb - 1]}件`],
      expect2: sec ? [`${sec[secOrder[0] - 1]}件`] : [],
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
      `${cnt(n0)}件のうち、この形の${cnt(nForm)}件で、1着は${fb}号艇が${fc[fb - 1]}件。`,
      secRank.rankSig
        ? `${fb}号艇が勝った${fc[fb - 1]}件の2着は、${secOrder[0]}号艇が${sec[secOrder[0] - 1]}件で最も多い。`
        : `${fb}号艇が勝った${fc[fb - 1]}件の2着は、${listCounts(sec, secOrder.slice(0, 3))}と割れる。`,
    ];
    chapters.push({
      id: "c3",
      name: "スタートの形",
      tag: "龍神ソナー ＞ 展開シナリオ",
      scope: `${cnt(n0)}件のうち ${form} ${cnt(nForm)}件`,
      answer: `1着 ${fb}号艇 ${fc[fb - 1]}件`,
      answer2: `2着 ${secOrder.slice(0, 3).map((b) => `${b}号艇${sec[b - 1]}`).join("・")}`,
      path: "ソナー → 展開シナリオ",
      voice: lines.join(""),
      shot: { page: "sonar", tab: "展開シナリオ", cut: "slitForms", cut2: "scenarioFlow", form, firstBoat: fb },
      expect: [form],
      expect2: [`${fc[fb - 1]}件`],
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
      scope: `${ax1.venue}の全期間 ${axisK}号艇1着 ${cnt(axK.n)}件`,
      answer: `2着 ${axK.second.boat}号艇 ${axK.second.rate}%`,
      answer2: `1号艇軸なら 2着は${ax1.second.boat}号艇 ${ax1.second.rate}%`,
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
      answer: best > 0 ? `項目が多いのは ${bests.join("・")}号艇` : "3艇とも項目は少ない",
      answer2: three.map((b) => `${b}号艇 ${top2[b]}項目`).join("・"),
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

  for (const c of chapters) c.subs = c.noSubs ? [] : splitSubs(c.voice);
  const url = `${SITE}/race/${m.raceId}`;
  return {
    ok: true,
    version: F01_VERSION,
    raceId: m.raceId,
    raceName,
    date,
    question,
    chapters,
    omitted,
    title: `ボートレース${raceName} ${date}｜${question}`,
    url,
    header: raceHeader({ year: y, month: mo, day: d, venue, raceNo: rn, round: m.api.facts?.today?.round ?? null, deadline: m.race?.startTime ?? null }),
    place: `${venue}${rn}R`,
    open: { n0, k0, lossN, p0: ans.p0, where },
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
    `ボートレース ${s.header}`,
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

/**
 * 機械の検査（落ちた理由の一覧。空なら合格）
 * @param {ReturnType<typeof f01Script>} s @param {{desc: string, kana: Record<string, string>, shots: Record<string, {text: string}>}} r
 */
export function f01Check(s, r) {
  const why = [];
  if (!r.desc.includes(VOICE.credit)) why.push(`説明欄に「${VOICE.credit}」が無い`);
  for (const c of s.chapters) {
    // 順位の語は線を通ったときだけ（②・③の「最も多い」、④の「入れ替わる」）
    const sig = c.facts?.secRank?.rankSig || c.facts?.swap;
    if (RANK_WORDS.test(c.voice) && !sig) why.push(`${c.id}: 線を通らない順位の語: ${c.voice.match(RANK_WORDS)[0]}`);
    // 選手名を声で読まない（材料の選手名が声の文に無い）
    for (const name of r.names ?? []) if (name && c.voice.includes(name)) why.push(`${c.id}: 声に選手名「${name}」`);
    // 字幕は1行 SUB_MAX 字以内
    for (const l of c.subs) if (l.length > SUB_MAX + 2) why.push(`${c.id}: 字幕が${l.length}字`);
  }
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
      const flat = shot.text.replace(/\s+/g, "");
      for (const e of exp) if (!flat.includes(e.replace(/\s+/g, ""))) why.push(`${c.id}${cut}: 左の画面に「${e}」が無い`);
    }
  }
  return why;
}
