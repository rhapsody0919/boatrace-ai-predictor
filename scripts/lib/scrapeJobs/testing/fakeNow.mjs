// 検証専用: 環境変数 FAKE_NOW_ISO（例: 2026-09-21T05:30:00+09:00）があれば、現在時刻をその時刻に固定する
// （node --import で読み込む。子プロセスの時刻に依存する分岐を、決まった時刻で検証するため）。
const iso = process.env.FAKE_NOW_ISO;
if (iso) {
  const RealDate = Date;
  const fixed = new RealDate(iso).getTime();
  if (Number.isNaN(fixed)) throw new Error(`FAKE_NOW_ISO が不正です: ${iso}`);
  const offset = fixed - RealDate.now();
  globalThis.Date = class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  };
}
