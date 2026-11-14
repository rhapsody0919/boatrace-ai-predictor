// 測る前の待ち方の共通部品（BOA-1632）。
// 読み込みの再描画・読み込み中の箱の差し替え・スナップの測り直しの最中に1回だけ測ると、
// PR に関係なく揺れる。値が2回続けて同じになってから返す。判定の値は呼び出し側に残し、ここでは変えない。
// measure は毎回 document から要素を引き直し、取れないときは null を返す（古い要素を握らない）。
// timeout まで落ち着かなければ最後の値を返す（常に崩れている状態は、呼び出し側の判定で落ちる）
export const settled = async (measure, { timeout = 15000, interval = 150 } = {}) => {
  const deadline = Date.now() + timeout;
  let prev = null;
  let last = null;
  for (;;) {
    last = await measure();
    const key = last === null ? null : JSON.stringify(last);
    if (key !== null && key === prev) return last;
    prev = key;
    if (Date.now() > deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
};
