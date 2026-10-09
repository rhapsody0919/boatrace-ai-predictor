/**
 * 思考アシスト（BOA-430）の受け入れ E2E 用の固定の応答。例のレース 2026-10-06 徳山10R（準優勝戦・1号艇B1）の
 * 本番の v16 API（facts・similar・scenario）を 2026-10-07 に取ったもの（thinking-assist-fixture.json.gz）。
 * 本番の v16 はこのレースの展示後の段を持たない（status=exhibition_missing）。facts・similar は stage を問わず
 * 出走表の段の値を返し、similar の stage=exhibition は status と n_layer だけを返す（本番の応答のまま）
 *
 * scenario は1号艇の範囲キーのうち NC・NCR（準優勝戦）・VA・NA を持つ。本番の API と同じく、ほかのキーは 400 を返す
 * 値の例: NC 3,276件・1号艇の1着 1,074・万舟 713、NCR 112件・65・23、類似レース 63件・万舟 11件
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(
  zlib.gunzipSync(
    fs.readFileSync(path.join(here, "thinking-assist-fixture.json.gz")),
  ),
);

export const THINKING_ASSIST_RACE = data.race;

/** 1号艇の範囲キー（NC・NCR・VA・NA） */
export const thinkingAssistScopeKeys = () =>
  structuredClone(data.facts.today.scope_keys["1"]);

/** facts の固定の応答。差し替えの元に使う */
export const thinkingAssistFacts = () => structuredClone(data.facts);

/** similar の固定の応答（stage は racecard か exhibition） */
export const thinkingAssistSimilar = (stage) =>
  structuredClone(
    data[stage === "exhibition" ? "similar-exhibition" : "similar-racecard"],
  );

/** scenario の固定の応答（範囲キーで引く。無いキーは undefined） */
export const thinkingAssistScenario = (scope) =>
  structuredClone(data.scenario[scope]);

/**
 * facts・similar・scenario の API を固定の応答に差し替え、思考アシストの機能フラグの内部確認の印を立てる。
 * overrides で各 API の応答を差し替えられる（例: { facts: (body) => ({ ...body, status: "ok" }) }）
 */
export async function routeThinkingAssistV16(
  page,
  { preview = true, overrides = {} } = {},
) {
  const apply = (name, body) =>
    overrides[name] ? overrides[name](structuredClone(body)) : body;
  if (preview)
    await page.addInitScript(() =>
      localStorage.setItem("boatai-user:thinking-assist-preview", "1"),
    );
  await page.route("**/api/analogy/facts/**", (route) =>
    route.fulfill({ json: apply("facts", data.facts) }),
  );
  await page.route("**/api/analogy/similar/**", (route) => {
    const stage = new URL(route.request().url()).searchParams.get("stage");
    return route.fulfill({
      json: apply("similar", thinkingAssistSimilar(stage)),
    });
  });
  await page.route("**/api/analogy/scenario/**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const scope = params.get("scope");
    // 思考アシストは2〜6号艇の範囲（boats=1、龍神ソナーの③④用。BOA-806）を取らない。取ったら落とす
    if (params.has("boats"))
      return route.fulfill({
        status: 400,
        json: { error: "思考アシストは boats を取らない" },
      });
    const body = data.scenario[scope ?? data.facts.today.scope_keys["1"].NC];
    if (!body)
      return route.fulfill({
        status: 400,
        json: { error: `scope ${scope} は固定データに無い` },
      });
    return route.fulfill({ json: apply("scenario", body) });
  });
}

/**
 * 展示がまだ無い状態（展示前）を作る。DB の展示（RPC get_race_exhibition_trend と、その代わりの exhibition_data）を空にする。
 * 実装が展示を別の口から読むようになったら、ここも合わせて直す（受け入れ E2E が実装の取り方に依存する唯一の箇所）
 */
export async function routeNoExhibition(page) {
  await page.route("**/rest/v1/rpc/get_race_exhibition_trend*", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/rest/v1/exhibition_data*", (route) =>
    route.fulfill({ json: [] }),
  );
}

/** オッズがまだ無い状態（発売前）を作る。DB のオッズのスナップショット（race_odds）を空にする */
export async function routeNoOdds(page) {
  await page.route("**/rest/v1/race_odds*", (route) =>
    route.fulfill({ json: [] }),
  );
}
