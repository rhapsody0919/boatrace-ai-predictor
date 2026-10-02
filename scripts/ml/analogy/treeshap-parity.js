/**
 * BOA-271 FR-1b（ADR-0083 決定6）: レースごとの寄与度の JS（TreeSHAP・直前情報8列の作り方）が、
 * 学習側の Python（features.py・LightGBM の pred_contrib）と一致するかを、DB の行の形の固定データで端から端まで検査する。
 *
 * 学習ジョブ（週次）が Storage へのアップロードの前に呼ぶ品質ゲート。一致しなければ版を切り替えない。
 *   node scripts/ml/analogy/treeshap-parity.js out/
 * 終了コード: 0 一致 / 1 不一致 / 2 入力の不備（ファイルが無い・形が違う）
 *
 * ディレクトリに置くもの（学習側が作る。形は ADR-0083「境界の合意」と docs/design/analogy-finder/plan.md）:
 * - per_race_meta.json: { model_version, dtype: "float32", models: { win, win_racecard: {file, feature_names, num_trees, objective} },
 *     live_features, categorical_maps, themes }
 * - models.*.file（dump_model() の JSON。.gz でも可）
 * - parity_fixture.json: { model_version, races: [{ race_id,
 *     racecard_features: [{boat_number, features: [win_racecard の並び、欠損は null]}],
 *     live_raw: { exhibition: [{boat_number, exhibition_time, is_absent}], conditions: {weather, wind_direction, wind_speed, wave_height} },
 *     expected: { win_racecard: {features: [[…]×艇], contrib: [[…, 期待値]×艇]}, win: {同} } }] }
 *   expected の艇は艇番の昇順。features・contrib の欠損は null
 *
 * 合格の条件: 特徴量は完全一致（float32 の値として）、SHAP は最大差 < 1e-9、SHAP の合計と生スコアの差 < 1e-9
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  compileModel,
  contributions,
  predictRaw,
} from "../../../src/utils/analogyTreeShap.js";
import {
  LIVE_FEATURES,
  buildLiveFeatures,
  modelInput,
} from "../../../src/utils/analogyRaceFeatures.js";

export const TOLERANCE = 1e-9;
const MODELS = ["win_racecard", "win"];
const MAX_MESSAGES = 20;

/** 入力の不備（終了コード2） */
export class ParityInputError extends Error {}

const sameFloat = (a, b) =>
  b === null || b === undefined ? Number.isNaN(a) : a === b;

function readJson(path) {
  let buf;
  try {
    buf = readFileSync(path);
  } catch (e) {
    throw new ParityInputError(`${path} を読めません: ${e.message}`);
  }
  const text =
    buf[0] === 0x1f && buf[1] === 0x8b
      ? gunzipSync(buf).toString("utf8")
      : buf.toString("utf8");
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ParityInputError(`${path} が JSON ではありません: ${e.message}`);
  }
}

const sameList = (a, b) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** per_race_meta.json とモデルの JSON の形を確かめ、推論用に変換する */
export function prepareModels(meta, dumps) {
  if (meta?.dtype !== "float32") {
    throw new ParityInputError(
      `per_race_meta.json の dtype が float32 ではありません（${meta?.dtype}）`,
    );
  }
  const live = meta.live_features ?? [];
  if (!sameList([...live].sort(), [...LIVE_FEATURES].sort())) {
    throw new ParityInputError(
      `live_features が JS の直前情報8列と違います: meta=${JSON.stringify(live)} JS=${JSON.stringify(LIVE_FEATURES)}`,
    );
  }
  const out = {};
  for (const name of MODELS) {
    const m = meta.models?.[name];
    if (!m || !Array.isArray(m.feature_names)) {
      throw new ParityInputError(
        `per_race_meta.json に models.${name}.feature_names がありません`,
      );
    }
    const model = compileModel(dumps[name]);
    if (!sameList(model.featureNames, m.feature_names)) {
      throw new ParityInputError(
        `${name}: モデルの feature_names と per_race_meta.json の feature_names が違います`,
      );
    }
    if (model.trees.length !== m.num_trees) {
      throw new ParityInputError(
        `${name}: 木の数 ${model.trees.length} が num_trees ${m.num_trees} と違います`,
      );
    }
    if (model.objective.split(" ")[0] !== String(m.objective).split(" ")[0]) {
      throw new ParityInputError(
        `${name}: objective が違います（モデル ${model.objective}、meta ${m.objective}）`,
      );
    }
    out[name] = { model, featureNames: m.feature_names };
  }
  const racecard = out.win_racecard.featureNames;
  if (racecard.some((f) => LIVE_FEATURES.includes(f))) {
    throw new ParityInputError(
      "win_racecard の feature_names に直前情報の列が入っています",
    );
  }
  const winSet = [...out.win.featureNames].sort();
  if (!sameList(winSet, [...racecard, ...LIVE_FEATURES].sort())) {
    throw new ParityInputError(
      "win の feature_names が「win_racecard の列＋直前情報8列」と一致しません",
    );
  }
  return out;
}

/**
 * 1レースの2本のモデルの入力（艇番の昇順）。推論側の本番の経路と同じ関数で作る
 * @returns {{boatNumbers:number[], inputs: Record<string, Float64Array[]>}}
 */
export function raceInputs(models, race) {
  const rows = [...(race.racecard_features ?? [])].sort(
    (a, b) => a.boat_number - b.boat_number,
  );
  const boatNumbers = rows.map((r) => Number(r.boat_number));
  const racecardNames = models.win_racecard.featureNames;
  const live = buildLiveFeatures({
    boatNumbers,
    exhibition: race.live_raw?.exhibition ?? [],
    conditions: race.live_raw?.conditions ?? {},
  });
  return {
    boatNumbers,
    inputs: {
      win_racecard: rows.map((r) =>
        modelInput(racecardNames, racecardNames, r.features, null),
      ),
      win: rows.map((r, i) =>
        modelInput(models.win.featureNames, racecardNames, r.features, live[i]),
      ),
    },
  };
}

/** 固定データ全体を検査する。返り値の ok が false なら不一致 */
export function checkParity({ meta, dumps, fixture }) {
  const models = prepareModels(meta, dumps);
  if (!Array.isArray(fixture?.races) || fixture.races.length === 0) {
    throw new ParityInputError("parity_fixture.json に races がありません");
  }
  if (
    fixture.model_version !== undefined &&
    fixture.model_version !== meta.model_version
  ) {
    throw new ParityInputError(
      `parity_fixture.json の model_version（${fixture.model_version}）が per_race_meta.json（${meta.model_version}）と違います`,
    );
  }
  const messages = [];
  const note = (m) => {
    if (messages.length < MAX_MESSAGES) messages.push(m);
  };
  const stats = Object.fromEntries(
    MODELS.map((n) => [
      n,
      {
        boats: 0,
        feature_mismatches: 0,
        max_abs_contrib_diff: 0,
        max_abs_sum_minus_raw: 0,
      },
    ]),
  );

  for (const race of fixture.races) {
    const { inputs } = raceInputs(models, race);
    for (const name of MODELS) {
      const exp = race.expected?.[name];
      const s = stats[name];
      const names = models[name].featureNames;
      if (
        !exp ||
        exp.features?.length !== inputs[name].length ||
        exp.contrib?.length !== inputs[name].length
      ) {
        throw new ParityInputError(
          `${race.race_id}: expected.${name} の艇の数が racecard_features と違います`,
        );
      }
      inputs[name].forEach((x, b) => {
        s.boats += 1;
        names.forEach((f, j) => {
          if (!sameFloat(x[j], exp.features[b][j])) {
            s.feature_mismatches += 1;
            note(
              `${race.race_id} 艇${b + 1} ${name}.${f}: JS ${x[j]} / Python ${exp.features[b][j]}`,
            );
          }
        });
        // 特徴量の不一致と SHAP の不一致を分けて見るため、SHAP は Python の特徴量で計算する
        const xPy = Float64Array.from(exp.features[b], (v) =>
          v === null ? NaN : v,
        );
        const phi = contributions(models[name].model, xPy);
        if (exp.contrib[b].length !== phi.length) {
          throw new ParityInputError(
            `${race.race_id}: expected.${name}.contrib の長さ ${exp.contrib[b].length} が ${phi.length} と違います`,
          );
        }
        // 期待値の欠け（null）は不一致として扱う
        const diff = phi.reduce((m, v, j) => {
          const d = Math.abs(v - (exp.contrib[b][j] ?? NaN));
          return Number.isNaN(d) ? Infinity : Math.max(m, d);
        }, 0);
        const sumMinusRaw = Math.abs(
          phi.reduce((a, v) => a + v, 0) - predictRaw(models[name].model, xPy),
        );
        if (diff >= TOLERANCE)
          note(`${race.race_id} 艇${b + 1} ${name}: SHAP の最大差 ${diff}`);
        if (sumMinusRaw >= TOLERANCE)
          note(
            `${race.race_id} 艇${b + 1} ${name}: SHAP の合計と生スコアの差 ${sumMinusRaw}`,
          );
        s.max_abs_contrib_diff = Math.max(s.max_abs_contrib_diff, diff);
        s.max_abs_sum_minus_raw = Math.max(
          s.max_abs_sum_minus_raw,
          sumMinusRaw,
        );
      });
    }
  }
  const ok = MODELS.every(
    (n) =>
      stats[n].feature_mismatches === 0 &&
      stats[n].max_abs_contrib_diff < TOLERANCE &&
      stats[n].max_abs_sum_minus_raw < TOLERANCE,
  );
  return {
    ok,
    model_version: meta.model_version,
    races: fixture.races.length,
    tolerance: TOLERANCE,
    models: stats,
    messages,
  };
}

/** ディレクトリから読み込んで検査する */
export function checkParityDir(dir) {
  const meta = readJson(join(dir, "per_race_meta.json"));
  const dumps = Object.fromEntries(
    MODELS.map((n) => {
      const file = meta?.models?.[n]?.file;
      if (!file)
        throw new ParityInputError(
          `per_race_meta.json に models.${n}.file がありません`,
        );
      return [n, readJson(join(dir, file))];
    }),
  );
  // 学習ジョブは .json、CI の固定データはリポジトリを重くしないよう .json.gz で置く
  const fixturePath = ["parity_fixture.json", "parity_fixture.json.gz"]
    .map((f) => join(dir, f))
    .find((p) => existsSync(p));
  if (!fixturePath) throw new ParityInputError(`${dir} に parity_fixture.json がありません`);
  const fixture = readJson(fixturePath);
  return checkParity({ meta, dumps, fixture });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dir = process.argv[2];
  if (!dir) {
    console.error(
      "使い方: node scripts/ml/analogy/treeshap-parity.js <per_race_meta.json のあるディレクトリ>",
    );
    process.exit(2);
  }
  try {
    const report = checkParityDir(dir);
    console.log(JSON.stringify(report, null, 1));
    if (!report.ok)
      console.error(
        "treeshap-parity: JS と Python が一致しません（上の messages を参照）",
      );
    process.exit(report.ok ? 0 : 1);
  } catch (e) {
    console.error(
      `treeshap-parity: ${e instanceof ParityInputError ? "入力の不備" : "検査の失敗"}: ${e.message}`,
    );
    process.exit(2);
  }
}
