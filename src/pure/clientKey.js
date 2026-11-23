/**
 * ブラウザごとの匿名の識別番号（乱数の uuid v4）。個人と結びつけず、匿名の声の重複除外と連投の制限だけに使う
 * （龍神ソナーの声 analogy_feedback・ご意見ボックス site_feedback の client_key）。
 * pure の決まりでブラウザのグローバル（crypto・localStorage）を直接読まないので、呼ぶ側が渡す。
 */

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * randomUUID が無い古いブラウザでも、DB の uuid 型に合う v4 の形で作る
 * @param {Crypto} cryptoApi ブラウザの crypto
 */
export function newUuidV4(cryptoApi) {
  if (cryptoApi.randomUUID) return cryptoApi.randomUUID();
  const b = cryptoApi.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * 保存してある識別番号を返す。無いか uuid v4 の形でなければ作って保存する
 * （壊れた値をそのまま返すと、uuid 列への INSERT が毎回落ちて、そのブラウザから二度と送れなくなる）。
 * 保存できない環境（プライベートブラウズ等で localStorage が投げる）では、呼ぶたびに新しい値になる
 * （呼ぶ側が表示中だけ持つ。連投の制限が効きにくくなるだけ）。
 * @param {string} storageKey キャッシュ全削除（boatai: 接頭辞）で消えないよう boatai-user: で始める
 * @param {() => Storage} getStorage 例: () => localStorage（読むときに投げる環境があるので関数で渡す）
 * @param {Crypto} cryptoApi ブラウザの crypto
 */
export function readOrCreateClientKey(storageKey, getStorage, cryptoApi) {
  try {
    const storage = getStorage();
    const saved = storage.getItem(storageKey);
    if (saved && UUID_V4.test(saved)) return saved;
    const key = newUuidV4(cryptoApi);
    storage.setItem(storageKey, key);
    return key;
  } catch {
    return newUuidV4(cryptoApi);
  }
}
