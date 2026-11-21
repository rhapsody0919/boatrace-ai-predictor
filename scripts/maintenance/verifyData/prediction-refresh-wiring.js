/**
 * prediction-refresh-wiring.js - verify-prediction-refresh.js の (h) 配線の確かめ（verify の部品）。製品の本文の字は読まず、
 * 入口を偽の import で回して見る:
 *   - scrape-scheduled.js（import で main が動く）: scrape-scheduled-run.js で偽の取得・偽のスケジュールのもと main を回し、mainRefresh の引数で見る
 *   - preRaceHandlers.js: cron-entry-probe.js で予測の再計算・従来の展示の本を偽にして読み込み、読まれた偽と export で見る。
 *     runSlotsWithRefresh は偽の runJob（スロットの中で onChanged を呼ぶ）と偽の refresh で回し、呼んだ順と引数で見る
 *   - api/cron/exhibition.js・race-info.js: cron-entry-probe.js の cronEntry で、本体の作り手を呼ぶ本と読まれた偽で見る
 * ワークフロー（.yml）は製品のコードでないので字で見る。DB・公式には繋がない。check・show は呼ぶ verify の物。
 */
import fs from "node:fs";
import { raceAt, runScheduled, UPDATED } from "./scrape-scheduled-run.js";
import { cronEntry, preRaceRefresh } from "./cron-entry-probe.js";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 発走 61分前＝レース情報（60分前）とオッズ、30分前＝オッズと展示、5分前＝オッズだけ（窓は本物の判定。scrape-scheduled-scenes.js と同じ）
const RACES = [raceAt("I61", 61), raceAt("E30", 30), raceAt("O5", 5)];
const ALL_UPDATED = { raceInfo: UPDATED, odds: UPDATED, exhibition: UPDATED };

async function scheduledRefresh({ check, show }) {
  const runs = {};
  for (const [key, env] of [
    ["byDefault", {}],
    ["skipOddsRefresh", { SKIP_ODDS_REFRESH_ON_GHA: "true" }],
  ]) {
    const r = await runScheduled({ env, races: RACES, updated: ALL_UPDATED });
    runs[key] = r.refreshes.map(([a]) => ({
      keys: Object.keys(a ?? {}).sort(),
      ids: [...(a?.specificRaceIds ?? [])].sort(),
    }));
  }
  check(
    "scrape-scheduled.js: オッズ起点の除外は SKIP_ODDS_REFRESH_ON_GHA で決まる。既定はレース情報・オッズ・展示の起点を全部入れて mainRefresh を1回呼び、true ならオッズだけの起点（5分前）を外す",
    same(
      runs.byDefault.map((x) => x.ids),
      [["E30", "I61", "O5"]],
    ) &&
      runs.skipOddsRefresh.length === 1 &&
      !runs.skipOddsRefresh[0].ids.includes("O5"),
    show(runs),
  );
  check(
    "scrape-scheduled.js: オッズ・レース情報・展示の各起点を別々の集合に集めている（オッズ起点だけを外せる）。オッズと同時に展示（30分前）・レース情報（61分前）でも更新したレースは外さない",
    same(
      runs.skipOddsRefresh.map((x) => x.ids),
      [["E30", "I61"]],
    ),
    show(runs),
  );
  check(
    "scrape-scheduled.js: 書き込み方式を指定しない（mainRefresh の引数は isDryRun・specificRaceIds だけ。既定の upsert。replace は BOA-628 で廃止）",
    [...runs.byDefault, ...runs.skipOddsRefresh].every((x) =>
      same(x.keys, ["isDryRun", "specificRaceIds"]),
    ),
    show(runs),
  );
}

async function preRaceWiring({ check, show }) {
  // 動的 import の先は振る舞いで見る: 読み込みの直後は予測の再計算の偽が読まれず、既定の refresh を1回呼ぶと読まれ、その mainRefresh に引数がそのまま渡る
  const refreshArgs = { isDryRun: false, specificRaceIds: ["probe-race"] };
  const probe = await preRaceRefresh(refreshArgs);
  check(
    "preRaceHandlers.js: mainRefresh は有効なときだけ動的 import する（無効なときは同じモジュール読み込み）。展示の従来の経路（runLegacyExhibition）は消した（scraping-load-budget spec の P0）",
    !("runLegacyExhibition" in probe.module) &&
      !probe.loadedAfter.includes("legacyExhibition") &&
      probe.status === 200 &&
      !probe.loadedAtImport.includes("predictions") &&
      probe.loadedAfter.includes("predictions") &&
      probe.refreshes.length === 1 &&
      probe.refreshes[0][0] === refreshArgs,
    show({
      status: probe.status,
      loadedAtImport: probe.loadedAtImport,
      loadedAfter: probe.loadedAfter,
      refreshes: probe.refreshes.length,
    }),
  );
  // 全スロットの完了後に、変更を書いたレースについて日付ごとに1回 refreshAfterChange（→ refresh）を呼ぶ
  const order = [];
  let collector = null;
  // refreshAfterChange の案内（console.log）は verify の出力に混ぜない
  const log = console.log;
  console.log = () => {};
  const out = await probe.module
    .runSlotsWithRefresh({
      job: "exhibition",
      createHandleSlot: (c) => {
        collector = c;
        return async () => {};
      },
      refresh: async (args) =>
        order.push(["refresh", args.date, args.specificRaceIds]),
      client: { fake: true },
      store: { fake: true },
      env: { REFRESH_ON_VERCEL: "true" },
      runJob: async () => {
        order.push(["slots"]);
        collector.onChanged("2026-09-20", "R1");
        collector.onChanged("2026-09-20", "R2");
        collector.onChanged("2026-09-20", "R1");
        collector.onChanged("2026-09-21", "R3");
        order.push(["slotsDone"]);
        return { status: 200, body: { success: true } };
      },
    })
    .finally(() => {
      console.log = log;
    });
  check(
    "preRaceHandlers.js: レース情報・展示のスロットの経路は、全スロットの完了後に、変更を書いたレースについて refreshAfterChange を呼ぶ（スロットのリースの外）",
    same(order, [
      ["slots"],
      ["slotsDone"],
      ["refresh", "2026-09-20", ["R1", "R2"]],
      ["refresh", "2026-09-21", ["R3"]],
    ]) &&
      out.status === 200 &&
      out.body?.refresh?.length === 2,
    show({ order, body: out.body }),
  );
}

async function cronEntries({ check, show }) {
  for (const file of ["exhibition", "race-info"]) {
    const e = await cronEntry(file);
    check(
      `api/cron/${file}.js: 本体は preRaceHandlers.js（mainRefresh を静的 import しない）`,
      e.made.length === 1 &&
        e.made[0].m === "preRaceHandlers" &&
        e.handler === e.made[0].handler &&
        !e.loaded.includes("predictions"),
      show({ made: e.made.map((m) => [m.m, m.name]), loaded: e.loaded }),
    );
  }
}

/** (h) 配線の確かめ一式 */
export async function checkRefreshWiring({ check, show }) {
  await scheduledRefresh({ check, show });
  const workflow = fs.readFileSync(
    new URL("../../../.github/workflows/scrape-scheduled.yml", import.meta.url),
    "utf8",
  );
  check(
    "scrape-scheduled.yml: SKIP_ODDS_REFRESH_ON_GHA を、リポジトリ変数（vars）から環境に渡す（未設定なら空＝off）",
    /SKIP_ODDS_REFRESH_ON_GHA: \$\{\{ vars\.SKIP_ODDS_REFRESH_ON_GHA \}\}/.test(
      workflow,
    ),
  );
  await preRaceWiring({ check, show });
  await cronEntries({ check, show });
}
