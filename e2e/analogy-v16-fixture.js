/**
 * アナロジー・ファインダー v16（BOA-271）の API の固定の応答。例のレース 2026-09-27 若松12R の手元の朝のバッチの出力から
 * scripts/ml/analogy/build-v16-fixture.mjs で作った（analogy-v16-fixture.json.gz）。本番の Storage・DB に依存しない
 * レイアウトの検査用。scenario は VC（若松・6艇ともA1）の範囲だけを持つので、どの範囲の要求にも同じ応答を返す
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(
  zlib.gunzipSync(
    fs.readFileSync(path.join(here, "analogy-v16-fixture.json.gz")),
  ),
);

export const ANALOGY_V16_RACE = "2026-09-27-20-12";

/** facts の固定の応答（若松は波高が風速とほぼ同じ値の会場。wave_mode.use_wave=false）。差し替えの元に使う */
export const analogyV16Facts = () => structuredClone(data.facts);

/** scenario の固定の応答。差し替えの元に使う */
export const analogyV16Scenario = () => structuredClone(data.scenario);

/** similar の固定の応答（stage は racecard か exhibition）。差し替えの元に使う */
export const analogyV16Similar = (stage) =>
  structuredClone(
    data[stage === "exhibition" ? "similar-exhibition" : "similar-racecard"],
  );

/** facts・similar・scenario の API を固定の応答に差し替え、機能フラグの内部確認の印を立てる */
export async function routeAnalogyV16(page, { preview = true } = {}) {
  if (preview)
    await page.addInitScript(() =>
      localStorage.setItem("boatai-user:analogy-finder-preview", "1"),
    );
  await page.route("**/api/analogy/facts/**", (route) =>
    route.fulfill({ json: data.facts }),
  );
  await page.route("**/api/analogy/similar/**", (route) => {
    const stage = new URL(route.request().url()).searchParams.get("stage");
    return route.fulfill({
      json: data[
        stage === "exhibition" ? "similar-exhibition" : "similar-racecard"
      ],
    });
  });
  await page.route("**/api/analogy/scenario/**", (route) =>
    route.fulfill({ json: data.scenario }),
  );
}
