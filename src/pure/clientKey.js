/**
 * ブラウザごとの匿名の識別番号（乱数の uuid v4）。個人と結びつけず、匿名の声の重複除外と連投の制限だけに使う
 * （龍神ソナーの声 analogy_feedback・ご意見ボックス site_feedback の client_key）。
 */

/** crypto.randomUUID が無い古いブラウザでも、DB の uuid 型に合う v4 の形で作る */
export function newUuidV4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * 保存してある識別番号を返す。無ければ作って保存する。
 * 保存できない環境（プライベートブラウズ等で localStorage が投げる）では、呼ぶたびに新しい値になる
 * （呼ぶ側が表示中だけ持つ。連投の制限が効きにくくなるだけ）。
 * @param {string} storageKey キャッシュ全削除（boatai: 接頭辞）で消えないよう boatai-user: で始める
 * @param {() => Storage} getStorage 試験で差し替える
 */
export function readOrCreateClientKey(
  storageKey,
  getStorage = () => globalThis.localStorage,
) {
  try {
    const storage = getStorage();
    const saved = storage.getItem(storageKey);
    if (saved) return saved;
    const key = newUuidV4();
    storage.setItem(storageKey, key);
    return key;
  } catch {
    return newUuidV4();
  }
}
