import { runProbe } from "./_probe.js";

// リージョンを指定しない場合の、現在の既定のリージョンの確認用（?site=0 で取得先へは送らない）
export const config = { maxDuration: 60 };

export default runProbe;
