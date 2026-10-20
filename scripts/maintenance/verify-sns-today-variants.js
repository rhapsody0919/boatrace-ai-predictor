// /today の X 投稿の見出しの日替わり（config/today-variants.json、scripts/lib/snsTodayVariants.js、2026-10-20）の再現テスト。外部接続なし
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TODAY_HEADING_BUILTIN,
  loadTodayVariants,
  normalizeTodayVariants,
  pickTodayHeading,
  renderTodayHeading,
} from "../lib/snsTodayVariants.js";

const config = {
  default: "本日のデータ一覧（{date}）",
  variants: [
    { id: "a", uuid: null, heading: "案A（{date}）" },
    {
      id: "b",
      uuid: "11111111-2222-4333-8444-555555555555",
      heading: "案B（{date}）",
    },
  ],
};
const days = (from, n) =>
  Array.from({ length: n }, (_, i) =>
    new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400000)
      .toISOString()
      .slice(0, 10),
  );

test("月曜はじまりの週の中では日替わりに交互、週ごとに順を逆にする（同じ曜日に同じ案が続かない）", () => {
  // 2026-10-19 は月曜
  const ids = days("2026-10-19", 14).map(
    (d) => pickTodayHeading(config, d).variant.id,
  );
  for (let i = 1; i < 7; i++) assert.notEqual(ids[i], ids[i - 1]);
  // 翌週の同じ曜日は逆の案
  for (let i = 0; i < 7; i++) assert.notEqual(ids[i + 7], ids[i]);
  // 2週で両方の案がちょうど7回ずつ
  assert.equal(ids.filter((id) => id === "a").length, 7);
});

test("案の札: uuid が入っていればそのまま、空・null なら null", () => {
  const all = days("2026-10-19", 4).map(
    (d) => pickTodayHeading(config, d).variant,
  );
  assert.ok(
    all.some(
      (v) => v.id === "b" && v.uuid === "11111111-2222-4333-8444-555555555555",
    ),
  );
  assert.ok(all.some((v) => v.id === "a" && v.uuid === null));
  const empty = normalizeTodayVariants({
    ...config,
    variants: config.variants.map((v) => ({ ...v, uuid: "" })),
  });
  assert.ok(empty.variants.every((v) => v.uuid === null));
});

test("見出しに {date} が無い案は使わない（日付が消えるため。x-channel の指摘）", () => {
  const noDate = {
    default: "既定（{date}）",
    variants: [
      config.variants[0],
      { ...config.variants[1], heading: "日付なしの見出し" },
    ],
  };
  assert.equal(pickTodayHeading(noDate, "2026-10-20").variant.id, "default");
  assert.equal(
    pickTodayHeading({ default: "日付なし", variants: [] }, "2026-10-20")
      .heading,
    TODAY_HEADING_BUILTIN,
  );
});

test("設定が無い・壊れているときは既定の文（id default）に戻す", () => {
  const def = {
    heading: "本日のデータ一覧（{date}）",
    variant: { id: "default", uuid: null },
  };
  assert.deepEqual(pickTodayHeading(null, "2026-10-20"), {
    heading: TODAY_HEADING_BUILTIN,
    variant: { id: "default", uuid: null },
  });
  for (const broken of [
    { default: "既定（{date}）", variants: [config.variants[0]] }, // 1案だけ
    {
      default: "既定（{date}）",
      variants: [config.variants[0], { ...config.variants[1], id: "a" }],
    }, // 同じ id
    {
      default: "既定（{date}）",
      variants: [
        config.variants[0],
        { ...config.variants[1], heading: "改行\nあり" },
      ],
    },
    {
      default: "既定（{date}）",
      variants: [
        config.variants[0],
        { ...config.variants[1], uuid: "not-uuid" },
      ],
    },
  ])
    assert.equal(pickTodayHeading(broken, "2026-10-20").variant.id, "default");
  assert.equal(
    pickTodayHeading({ default: "", variants: [] }, "2026-10-20").heading,
    def.heading,
  );
  // ファイルが読めない・JSON でない
  assert.equal(
    loadTodayVariants(() => {
      throw new Error("ENOENT");
    }),
    null,
  );
  assert.equal(
    loadTodayVariants(() => "{"),
    null,
  );
});

test("リポジトリの config/today-variants.json は読めて、2案と既定の文がそろう", () => {
  const loaded = loadTodayVariants();
  const n = normalizeTodayVariants(loaded);
  assert.equal(n.variants.length, 2);
  assert.ok(n.fallback.length > 0);
});

test("見出しへの日付の差し込み", () => {
  assert.equal(
    renderTodayHeading("案A（{date}）", "10月20日（火）"),
    "案A（10月20日（火））",
  );
  assert.equal(renderTodayHeading("日付なし", "10月20日（火）"), "日付なし");
});
