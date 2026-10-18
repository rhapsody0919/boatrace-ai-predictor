import InlineFetchError from "../../InlineFetchError";
import { useAnalogyLayer } from "../../../hooks/useAnalogyV16";
import { usableLayer } from "../../../utils/pastRate/layer.js";

/**
 * BOA-635 の部品を出す前の layer の取得（spec FR-4）。使える layer（ready・ok・race_id 一致・1行以上）のときだけ
 * children(layer) を出す。取得中・not_saved・empty_layer・absent・0行・v16 公開前のレースは何も出さない。
 * 取得に失敗したときは InlineFetchError（そこだけ取り直す）。AI予想タブと結果タブで同じキャッシュを使う
 */
export default function PastRateLayerGate({ raceId, children }) {
  const state = useAnalogyLayer(raceId);
  if (state.status === "error") return <InlineFetchError onRetry={state.retry} />;
  if (!usableLayer(state, raceId)) return null;
  return children(state.data);
}
