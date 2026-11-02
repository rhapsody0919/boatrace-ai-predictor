import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAnalogyFacts,
  getAnalogyLayer,
  getAnalogyScenario,
  getAnalogyScenarioRaces,
  getAnalogySimilar,
} from "../services/analogyService";
import { hasLayerDate } from "../utils/pastRate/layer.js";

/**
 * アナロジー・ファインダー v16 の取得（BOA-271 T6-3。screens「データ取得」）。
 * 取得の状態の持ち方は思考アシスト（BOA-430）の取得でも使う（export）。
 * @returns {{status: "idle"|"loading"|"ready"|"error", data: object|null, retry: () => void}}
 *   refreshBeforeExhibition=true の呼び出しだけ展示前の間60秒ごとに取得する。
 *   scheduleRefresh（(data, refresh) => 次に読み直すまでの ms。null なら読み直さない）を渡すと、その時刻に
 *   fetcher(true)（読み直し）を呼ぶ（思考アシストのオッズ。BOA-1180）。関数が変わると読み直して予約し直す
 *   （useCallback で渡す）。読み直しの失敗は前の値を残し、scheduleRefresh が続ける間だけ再試行する。
 *   定期の読み直しが失敗しても前の値を残し、次の60秒で読み直しを続ける（最初の読み込みの失敗は error）。
 *   enabled=false の間は取得しない（タブを開いたときに初めて取得する）。
 *   error は取得の失敗（「データなし」に倒さない。.claude/rules/frontend-data-fetch.md）。
 *   条件を変えた直後の読み込み中も、前の条件の結果を data に返す（表示がガタつかないように）
 */
export function useAnalogyResource(
  key,
  fetcher,
  enabled,
  refreshBeforeExhibition = false,
  scheduleRefresh = null,
) {
  const [fetched, setFetched] = useState(null);
  const [failedKey, setFailedKey] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const pendingRefresh = useRef(null);
  // 最後に読めた値（scheduleRefresh の失敗の再試行と、関数が変わったときの読み直しに使う）
  const shown = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    let timer;
    // refresh=true は定期の読み直し（最初の読み込みではない）。keep=true は失敗しても見えている値を残す
    const load = (refresh = false, keep = false) => {
      // StrictMode の effect 再実行でも、同じ条件の処理中の要求は共有する。
      // 定期更新を有効にしていない思考アシスト等の取得は変えない。
      const request =
        refreshBeforeExhibition && pendingRefresh.current?.key === key
          ? pendingRefresh.current.request
          : fetcher(refresh);
      if (refreshBeforeExhibition) pendingRefresh.current = { key, request };
      const clearPending = () => {
        if (pendingRefresh.current?.request === request)
          pendingRefresh.current = null;
      };
      return request
        .then((data) => {
          clearPending();
          if (!alive) return;
          setFailedKey((prev) => (prev === key ? null : prev));
          setFetched({ key, data });
          shown.current = { key, data };
          // 完了してから次を予約し、遅い応答でも要求を重ねない。
          if (scheduleRefresh) {
            const delay = scheduleRefresh(data, refresh);
            if (delay != null) timer = setTimeout(() => load(true), delay);
            return;
          }
          // 応答の締切後は exhibition_missing。時計で独自に状態を判定しない。
          if (
            refreshBeforeExhibition &&
            (data.status === "before_exhibition" ||
              data.status === "exhibition_reflecting")
          )
            timer = setTimeout(() => load(true), 60_000);
        })
        .catch((error) => {
          clearPending();
          if (!alive) return;
          // 定期の読み直しの失敗は、見えている値をエラー表示に置き換えない。
          // 開いたままのページを壊さないよう前の値を残し、次の60秒で読み直しを続ける
          if (refresh || keep) {
            console.error(
              "[analogy] 定期の読み直しに失敗（前の値を残し再試行）:",
              key,
              error,
            );
            // scheduleRefresh があれば、それが読み直しを続ける間だけ（早くても60秒後に）再試行する
            const next = scheduleRefresh
              ? scheduleRefresh(shown.current?.data ?? null, true)
              : 60_000;
            if (next != null)
              timer = setTimeout(() => load(true), Math.max(next, 60_000));
            return;
          }
          console.error("[analogy] 取得に失敗:", key, error);
          setFailedKey(key);
        });
    };
    // scheduleRefresh が変わって取り直すときは、見えている値を失敗で消さない
    load(false, Boolean(scheduleRefresh) && shown.current?.key === key);
    return () => {
      clearTimeout(timer);
      alive = false;
    };
    // fetcher は key から決まる（key に含めた値だけで取り直す）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, reloadKey, refreshBeforeExhibition, scheduleRefresh]);

  const retry = useCallback(() => {
    setFailedKey(null);
    setReloadKey((k) => k + 1);
  }, []);
  if (!enabled && fetched?.key !== key)
    return { status: "idle", data: fetched?.data ?? null, retry };
  if (failedKey === key) return { status: "error", data: null, retry };
  if (fetched?.key === key)
    return { status: "ready", data: fetched.data, retry };
  return { status: "loading", data: fetched?.data ?? null, retry };
}

export const useAnalogyFacts = (
  raceId,
  stage,
  enabled = true,
  refreshBeforeExhibition = false,
) =>
  useAnalogyResource(
    `facts|${raceId}|${stage}`,
    () => getAnalogyFacts(raceId, stage),
    enabled,
    refreshBeforeExhibition,
  );

export const useAnalogySimilar = (raceId, stage, enabled = true) =>
  useAnalogyResource(
    `similar|${raceId}|${stage}`,
    () => getAnalogySimilar(raceId, stage),
    enabled,
  );

export const useAnalogyScenario = (
  raceId,
  scope,
  stage,
  enabled = true,
  boats = false,
  // 1以上ならキャッシュを使わず読む（展示前に開いたページに展示後の段が届いた後の読み直し）。
  // 値を変えるたびに読み直す
  revision = 0,
) =>
  useAnalogyResource(
    `scenario|${raceId}|${scope ?? ""}|${stage}|${boats ? "boats" : ""}|${revision}`,
    () => getAnalogyScenario(raceId, scope, stage, boats, revision > 0),
    enabled,
  );

/** STEP4 の件数を押したときだけ、範囲の元のレースの一覧を読む（BOA-823）。boat=2〜6 はその艇の範囲（BOA-833） */
export const useAnalogyScenarioRaces = (
  raceId,
  scope,
  stage,
  enabled,
  boat = 1,
) =>
  useAnalogyResource(
    `scenario-races|${raceId}|${scope ?? ""}|${stage}|${boat}`,
    () => getAnalogyScenarioRaces(raceId, scope, stage, boat),
    enabled && Boolean(scope),
  );

/**
 * BOA-635 の比べる相手（layer）。v16 の公開より前のレースは取りに行かない（not_saved は no-store で
 * キャッシュが効かず、確定済みのレースを開くたびに呼ぶことになるため。hasLayerDate）
 */
export const useAnalogyLayer = (raceId, enabled = true) =>
  useAnalogyResource(
    `layer|${raceId}`,
    () => getAnalogyLayer(raceId),
    enabled && hasLayerDate(raceId),
  );
