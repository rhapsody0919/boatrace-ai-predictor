import { useCallback, useEffect, useState } from "react";
import {
  getAnalogyFacts,
  getAnalogyScenario,
  getAnalogySimilar,
} from "../services/analogyService";

/**
 * アナロジー・ファインダー v16 の取得（BOA-271 T6-3。screens「データ取得」）。
 * 取得の状態の持ち方は思考アシスト（BOA-430）の取得でも使う（export）。
 * @returns {{status: "idle"|"loading"|"ready"|"error", data: object|null, retry: () => void}}
 *   enabled=false の間は取得しない（タブを開いたときに初めて取得する）。
 *   error は取得の失敗（「データなし」に倒さない。.claude/rules/frontend-data-fetch.md）。
 *   条件を変えた直後の読み込み中も、前の条件の結果を data に返す（表示がガタつかないように）
 */
export function useAnalogyResource(key, fetcher, enabled) {
  const [fetched, setFetched] = useState(null);
  const [failedKey, setFailedKey] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    fetcher()
      .then((data) => {
        if (!alive) return;
        setFailedKey((prev) => (prev === key ? null : prev));
        setFetched({ key, data });
      })
      .catch((error) => {
        if (!alive) return;
        console.error("[analogy] 取得に失敗:", key, error);
        setFailedKey(key);
      });
    return () => {
      alive = false;
    };
    // fetcher は key から決まる（key に含めた値だけで取り直す）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, reloadKey]);

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

export const useAnalogyFacts = (raceId, stage, enabled = true) =>
  useAnalogyResource(
    `facts|${raceId}|${stage}`,
    () => getAnalogyFacts(raceId, stage),
    enabled,
  );

export const useAnalogySimilar = (raceId, stage, enabled = true) =>
  useAnalogyResource(
    `similar|${raceId}|${stage}`,
    () => getAnalogySimilar(raceId, stage),
    enabled,
  );

export const useAnalogyScenario = (raceId, scope, stage, enabled = true) =>
  useAnalogyResource(
    `scenario|${raceId}|${scope ?? ""}|${stage}`,
    () => getAnalogyScenario(raceId, scope, stage),
    enabled,
  );
