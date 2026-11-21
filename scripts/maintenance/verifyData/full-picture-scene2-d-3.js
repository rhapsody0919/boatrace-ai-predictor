/**
 * verify-full-picture-scene2.js の後半の場面（3/6）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { bannedIn, templateText, allBeats } from "../../../sns-video-studio/remotion/scripts/full-picture/scene2-text.mjs";
import { bundleOf, checkBundleB439, checkFullPicture, BUNDLE_VERSION, FULL_URL_SLOT, jaWidth, raceHeader, utmUrl, load, buildBundleB439, CH, qaAll } from "./full-picture-scene2-d-2.js";

let buildAll, entryScenes, fixtures, riskRules;
export let b0;

// for (const f of …) の中身の 1/2（分ける前と同じ文・順。後へ渡す名前を返す）
const bundleOfFixtureA = (f) => {
  const b = bundleOf(f);
  assert.deepEqual(checkBundleB439(b), [], `${f}: bundle の形`);
  // 送信の道の受け取りの検査をそのまま通る（評価役の P0 は hq が足す。ここでは 0 を入れて確かめる）
  assert.deepEqual(
    checkFullPicture({ ...b, review: { p0_count: 0 } }, riskRules),
    [],
    `${f}: push-full-picture の検査を通る`,
  );
  assert.equal(b.bundle_version, BUNDLE_VERSION);
  assert.equal(
    b.youtube_shorts.description.split(FULL_URL_SLOT).length - 1,
    1,
    `${f}: Shorts の説明文に完全版の URL の置き場所が1つ`,
  );
  assert.notEqual(
    b.youtube_full.title,
    b.youtube_shorts.title,
    `${f}: 完全版と Shorts の題名は別の文`,
  );
  assert.ok(
    b.youtube_full.description.includes("結果を保証するものではありません"),
    `${f}: 説明文に免責`,
  );
  assert.ok(
    /^0:00 /m.test(b.youtube_full.description),
    `${f}: 説明文に章（0:00 から）`,
  );
  for (const txt of [
    b.x_text,
    b.youtube_full.title,
    b.youtube_full.description,
    b.youtube_shorts.title,
    b.youtube_shorts.description,
  ]) {
    assert.deepEqual(bannedIn(txt), [], `${f}: 禁止表現が無い`);
    assert.ok(!/null|undefined|NaN/.test(txt), `${f}: 欠けた値が無い`);
    assert.ok(!/ほぼ|多い|少ない/.test(txt), `${f}: ぼかし語が無い`);
  }
  // wording-editor P1: 会場の1着率に期間と件数。P2: 結論に条件と「N件中」。X にも免責
  assert.match(
    b.x_text,
    /過去90日の[\d,]+レースで/,
    `${f}: 会場の1着率に期間と件数`,
  );
  assert.match(
    b.x_text,
    /スタートの形が.+だった過去[\d,]+件中、1着最多は/,
    `${f}: 結論に条件と N件中`,
  );
  assert.ok(
    b.x_text.includes("結果を保証するものではありません"),
    `${f}: X にも免責`,
  );
  // youtube-channel P2: 題名・説明文の1行目に「ボートレース」とその日の向き、章の名前は実際の章から
  assert.match(
    b.youtube_full.title,
    /^【(?:(?:SG|G[123]) )?.+\d+R(?: .+)?｜\d+\/\d+】1号艇は堅い？ /,
    `${f}: 完全版の題名（hq 2026-10-21 の形）`,
  );
  // BOA-995: X・YouTube のリンクに UTM（X は x、YouTube は youtube と utm_term）
  assert.ok(
    b.x_text.includes(
      `?utm_source=x&utm_medium=social&utm_campaign=race-full&utm_content=${b.race_id}`,
    ),
    `${f}: X の URL に UTM`,
  );
  assert.ok(
    b.youtube_full.description.includes(
      `?utm_source=youtube&utm_medium=social&utm_campaign=race-full&utm_content=${b.race_id}&utm_term=full`,
    ),
    `${f}: 完全版の説明文の URL に UTM`,
  );
  assert.ok(
    b.youtube_shorts.description.includes(
      `?utm_source=youtube&utm_medium=social&utm_campaign=race-full&utm_content=${b.race_id}&utm_term=shorts`,
    ),
    `${f}: Shorts の説明文の URL に UTM`,
  );
  return { b };
};

// for (const f of …) の中身の 2/2（分ける前と同じ文・順）
const bundleOfFixtureB = (f, { b }) => {
  // BOA-989: X の1行目は完全版の題名と同じ頭、X・説明文にレースの日時（曜日）とレース名
  const xHead = b.x_text.split("\n")[0];
  assert.ok(
    b.youtube_full.title.startsWith(xHead.slice(0, xHead.indexOf("】") + 1)),
    `${f}: X の1行目は題名と同じ頭`,
  );
  for (const txt of [
    b.youtube_full.description,
    b.youtube_shorts.description,
  ])
    assert.match(
      txt,
      /\d+\/\d+（[日月火水木金土]）.+\d+R/,
      `${f}: 日付・曜日・会場・R`,
    );
  assert.match(
    b.x_text.split("\n")[1],
    /^\d+\/\d+（[日月火水木金土]）(締切\d{1,2}:\d{2})?$/,
    `${f}: X の2行目は日付・曜日・締切だけ（hq 2026-10-23）`,
  );
  // C1（hq 契約 10/24）: 1行目に結論の数字と「（ボートレース {見出し}）」、2・3行目に龍神ソナー・思考アシストへの導線、タグ
  const fl = b.youtube_full.description.split("\n");
  // C3: 1行目は「{結論の数字}｜ボートレース {会場}{R}」で全角換算40字以内、4行目に日付・締切の見出し
  assert.match(
    fl[0],
    /^(.+｜)?ボートレース .+\d+R$/,
    `${f}: 説明文の1行目: ${fl[0]}`,
  );
  assert.ok(
    jaWidth(fl[0]) <= 40,
    `${f}: 1行目は40字以内（${jaWidth(fl[0])}）`,
  );
  assert.match(
    fl[3],
    /^ボートレース \d+\/\d+（[日月火水木金土]）.+\d+R/,
    `${f}: 4行目に見出し: ${fl[3]}`,
  );
  assert.ok(
    fl[1].startsWith(
      "類似レースの着順の流れは龍神ソナー: https://www.boat-ai.jp/race/",
    ) &&
      fl[1].includes(
        `?tab=sonar&utm_source=youtube&utm_medium=social&utm_campaign=race-full&utm_content=${b.race_id}/sonar&utm_term=full`,
      ),
    `${f}: 2行目にソナー: ${fl[1]}`,
  );
  assert.ok(
    fl[2].startsWith("軸・相手を自分で読むなら思考アシスト: ") &&
      fl[2].endsWith(
        `/race/${b.race_id}/assist?utm_source=youtube&utm_medium=social&utm_campaign=race-full&utm_content=${b.race_id}/assist&utm_term=full`,
      ),
    `${f}: 3行目に思考アシスト: ${fl[2]}`,
  );
  assert.deepEqual(
    b.youtube_full.tags,
    ["ボートレース", "龍神ソナー", "思考アシスト"],
    `${f}: 完全版のタグ`,
  );
  assert.ok(
    b.youtube_full.description.endsWith(
      "#ボートレース #龍神ソナー #思考アシスト",
    ),
    `${f}: 末尾のハッシュタグ`,
  );
  assert.ok(
    b.youtube_full.description.includes(
      "条件・6艇比較・類似レース・展開の順に見る動画です。",
    ),
    `${f}: 章の名前から作った順`,
  );
  assert.ok(
    b.youtube_shorts.description.includes("完全版の動画（約3分半）"),
    `${f}: 完全版の長さ`,
  );
};

function scene1() {
  for (const f of fixtures) bundleOfFixtureB(f, bundleOfFixtureA(f));
  // BOA-989: レース名（round）・グレード・締切。固定の材料 0 は桐生12R 優勝戦（G1 を足した）、round=other は名前を書かない
  {
    const b = bundleOf(fixtures[0]);
    assert.equal(b.race_id, "2026-10-12-01-12");
    assert.ok(
      b.youtube_full.title.startsWith(
        "【G1 桐生12R 優勝戦｜10/12】1号艇は堅い？ ",
      ),
      b.youtube_full.title,
    );
    assert.ok(
      b.youtube_shorts.title.startsWith("桐生12R 優勝戦（10/12）1号艇は堅い？"),
      b.youtube_shorts.title,
    );
    for (const txt of [
      b.youtube_full.description,
      b.youtube_shorts.description,
    ])
      assert.ok(txt.includes("10/12（月）桐生12R 優勝戦 締切16:40"), txt);
    assert.ok(
      b.x_text.startsWith(
        "【G1 桐生12R 優勝戦｜10/12】1号艇は堅い？\n10/12（月）締切16:40\n",
      ),
      b.x_text,
    );
    const other = bundleOf(
      fixtures.find((f) => f.startsWith("2026-10-15-15-10")),
    );
    assert.ok(
      other.youtube_full.title.startsWith("【丸亀10R｜10/15】"),
      `round=other・一般は名前もグレードも書かない: ${other.youtube_full.title}`,
    );
    assert.ok(
      other.x_text.includes("\n10/15（木）\n"),
      "締切が無ければ書かない",
    );
    assert.equal(
      raceHeader({
        year: 2026,
        month: 10,
        day: 22,
        venue: "児島",
        raceNo: 12,
        round: "junyu",
        deadline: "16:44:00",
        short: true,
      }),
      "10/22（木）締切16:44",
    );
    const junyu = bundleOf(
      fixtures.find((f) => f.startsWith("2026-10-19-19-10")),
    );
    assert.ok(
      junyu.youtube_full.title.startsWith("【下関10R 準優勝戦｜10/19】"),
      junyu.youtube_full.title,
    );
    assert.equal(
      raceHeader({
        year: 2026,
        month: 10,
        day: 22,
        venue: "児島",
        raceNo: 12,
        round: "junyu",
        deadline: "16:44:00",
      }),
      "10/22（木）児島12R 準優勝戦 締切16:44",
    );
    assert.equal(
      raceHeader({
        year: 2026,
        month: 10,
        day: 22,
        venue: "児島",
        raceNo: 12,
        round: "nazo",
        deadline: null,
      }),
      "10/22（木）児島12R",
      "対応に無い値は書かない",
    );
    assert.equal(
      utmUrl("2026-10-22-16-12", "youtube", "shorts"),
      "https://www.boat-ai.jp/race/2026-10-22-16-12?utm_source=youtube&utm_medium=social&utm_campaign=race-full&utm_content=2026-10-22-16-12&utm_term=shorts",
    );
  }
}

function scene2() {
  // 入口版 v2: Shorts の題は「レース名＋問い＋冒頭の数字」（冒頭の数字と同じ値）
  {
    const m = load(fixtures[0]);
    const scenes = buildAll(m);
    const e = entryScenes(scenes, templateText(allBeats(scenes)).answers, {
      race: "桐生12R",
    });
    assert.ok(e.hero, "前提: 冒頭の数字がある");
    const b = buildBundleB439({
      raceId: m.raceId,
      venue: "桐生",
      raceNo: 12,
      month: 10,
      day: 12,
      round: "yusho",
      facts: { venue90: null, overview: null, conclusion: null, hero: e.hero },
      chapters: CH,
      fullSeconds: 211,
      qa: qaAll,
    });
    assert.equal(
      b.youtube_shorts.title,
      `桐生12R 優勝戦（10/12）1号艇は堅い？ ${e.hero.title}`,
    );
    assert.ok(
      b.youtube_shorts.title.includes(e.hero.value),
      "題の数字は冒頭の数字と同じ値",
    );
    assert.deepEqual(
      checkBundleB439(b),
      [],
      "v2 の題でも束の形を通る（100字以内）",
    );
    assert.equal(
      b.youtube_full.description.split("\n")[0],
      `${e.hero.title}｜ボートレース 桐生12R`,
      "完全版の1行目は冒頭の数字の文（C3）",
    );
  }
  b0 = bundleOf(fixtures[0]);
}

/** verify から呼ぶ入口。env は verify 側の束縛（buildAll・entryScenes・fixtures・riskRules） */
export function runFullPictureScene2D5(env) {
  ({ buildAll, entryScenes, fixtures, riskRules } = env);
  scene1();
  scene2();
}
