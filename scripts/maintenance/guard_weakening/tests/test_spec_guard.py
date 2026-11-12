#!/usr/bin/env python3
"""spec_guard.py（e2e の spec の比較）の試験。純関数だけ。`python3 scripts/maintenance/guard_weakening/tests/test_spec_guard.py`"""
import sys
from pathlib import Path

W = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(W))
import spec_guard as sg  # noqa: E402

ok = []


def check(name, cond, got=""):
    ok.append(bool(cond))
    print(f"   {'OK' if cond else 'NG'} {name}" + ("" if cond else f" → {str(got)[:600]}"))


P = "e2e/sample.spec.js"
BASE = """import { test, expect } from "./fixtures.js";
// test("コメントの中の名前は数えない", () => { expect(1) });
/* test.skip("塊のコメントも数えない") */
test.describe("会場ページ", () => {
  test("見出しが出る", async ({ page }) => {
    await page.goto("/venue/1");
    await expect(page.getByRole("heading")).toBeVisible();
    await expect(page).toHaveURL(/\\/venue\\/1$/);
  });
  test(`375px で ${"崩れない"}`, async ({ page }) => {
    expect.soft(await page.title()).toContain("//");
    await expect.poll(() => 1).toBe(1);
  });
});
"""


def run(base, head, status="M", ns=None, path=P):
    return sg.judge({path: status}, lambda p: base, lambda p: head, ns or {})


print("数え上げ")
f = sg.facts(BASE)
check("試験名は describe 1・test 2（コメントの中は数えない）", f.titles == {("describe", "会場ページ"): 1, ("test", "見出しが出る"): 1, ("test", '375px で ${"崩れない"}'): 1}, f.titles)
check("expect は4（expect・expect.soft・expect.poll。文字列の // はコメントでない）", f.expects == 4, f.expects)
check("skip・fixme・only は0", sum(f.markers.values()) == 0, f.markers)
check("正規表現の中の / と引用符で崩れない", sg.facts('test("a", () => { expect(x).toMatch(/[/"]/); expect(y).toBe(1); });').expects == 2)
check("割り算の / は正規表現にしない", sg.facts('const a = b / 2; const c = d / 3; test("t", () => expect(a).toBe(1));').expects == 1)
check("test.step・beforeEach・describe.configure は名前に数えない",
      sg.facts('test.describe.configure({ mode: "serial" }); test.beforeEach(async () => {}); test("t", async () => { await test.step("s", async () => {}); });').titles == {("test", "t"): 1})

print("赤になる（弱める）")
v = run(BASE, BASE.replace('    await expect(page).toHaveURL(/\\/venue\\/1$/);\n', ""))
check("expect を1つ減らす: 赤", any("expect が減った（変えた spec の合計 4 → 3" in e for e in v.errors), v.errors)
v = run(BASE, BASE.replace('test("見出しが出る"', 'test.skip("見出しが出る"'))
check("test を test.skip にする: 赤（skip が増えた）", any("skip が増えた" in e for e in v.errors), v.errors)
v = run(BASE, BASE.replace('    await page.goto("/venue/1");\n', '    test.skip(process.env.CI, "CI では飛ばす");\n    await page.goto("/venue/1");\n'))
check("中に test.skip(cond, 理由) を足す: 赤", any("skip が増えた" in e for e in v.errors) and not any("試験名" in e for e in v.errors), v.errors)
v = run(BASE, BASE.replace('test("見出しが出る"', 'test.fixme("見出しが出る"'))
check("fixme を足す: 赤", any("fixme が増えた" in e for e in v.errors), v.errors)
v = run(BASE, BASE.replace('test.describe("会場ページ"', 'test.describe.only("会場ページ"'))
check("only を足す: 赤", any("only が増えた" in e for e in v.errors), v.errors)
v = run(BASE, BASE.replace('test("見出しが出る"', 'test("見出しが出る（改）"'))
check("試験名を変える: 赤（消えた扱い）", any("試験名が消えた" in e for e in v.errors), v.errors)
v = run(BASE, None, status="D")
check("spec を消す: 赤", any("spec を消した" in e for e in v.errors), v.errors)
v = run("test('a, () => {});\n", BASE)
check("base が閉じない文字列: 赤（読めない）", any("読めない" in e for e in v.errors), v.errors)
v = run(BASE, BASE + "\n/* 閉じない")
check("head が閉じないコメント: 赤（読めない）", any("読めない" in e for e in v.errors), v.errors)
v = run(None, BASE)
check("版が読めない: 赤", any("読めない" in e for e in v.errors), v.errors)

print("抜け道（審査 P0-2・3）")
v = run(BASE, BASE.replace('await expect(page).toHaveURL(/\\/venue\\/1$/);', 'await expect(page);'))
check("比べを消して expect(x) だけ残す: 赤", any("expect が減った" in e for e in v.errors), v.errors)
v = run(BASE, BASE.replace('    await expect(page).toHaveURL(/\\/venue\\/1$/);\n', '    const s = "expect(a).toBe(1)";\n'))
check("文字列の中の expect で数を埋める: 赤", any("expect が減った" in e for e in v.errors), v.errors)
for name, inj in [("testInfo.skip()", "testInfo.skip();"), ("test.info().skip()", "test.info().skip();"), ("test.fail()", "test.fail();")]:
    v = run(BASE, BASE.replace('    await page.goto("/venue/1");\n', f'    {inj}\n    await page.goto("/venue/1");\n'))
    check(f"{name} を足す: 赤", any("が増えた" in e for e in v.errors), v.errors)
H = "e2e/helpers/check.js"
v = sg.judge({H: "M"}, {H: "export const ok = (l) => expect(l).toBeVisible();"}.get, {H: "export const ok = (l) => l;"}.get, {})
check("e2e の補助の expect を減らす: 赤", any("expect が減った" in e for e in v.errors), v.errors)

print("緑（弱めない）")
stab = BASE.replace('    await page.goto("/venue/1");\n', '    await page.goto("/venue/1");\n    await page.waitForLoadState("networkidle");\n')
v = run(BASE, stab, ns={P: (1, 0)})
check("安定化（待ちを足す）: 緑", not v.errors and not v.warnings, v.errors)
stab2 = BASE.replace("    await expect(page.getByRole(\"heading\")).toBeVisible();\n",
                     "    const h = page.getByRole(\"heading\");\n    await h.waitFor();\n    await expect(h).toBeVisible();\n    await expect(h).toHaveText(/会場/);\n")
v = run(BASE, stab2)
check("expect を増やす（#2382 型の点を待つ形）: 緑", not v.errors, v.errors)
v = run(None, BASE, status="A")
check("spec の新規の追加: 対象外（緑）", not v.errors)
v = sg.judge({"e2e/old.spec.js": "D", "e2e/new.spec.js": "A"}, {"e2e/old.spec.js": BASE}.get, {"e2e/new.spec.js": BASE}.get, {})
check("付け替え（中身が同じ）: 緑", not v.errors, v.errors)
v = sg.judge({"e2e/old.spec.js": "D", "e2e/new.spec.js": "A"}, {"e2e/old.spec.js": BASE}.get, {"e2e/new.spec.js": BASE.replace("expect.soft", "void ")}.get, {})
check("付け替えで expect を減らす: 赤", any("expect が減った" in e and "e2e/old.spec.js 4→0" in e for e in v.errors), v.errors)
v = run("const x = 1;\n", "const x = 2;\n", path="e2e/helpers/util.js")
check("spec でないファイルは見ない", not v.errors)

SPLIT_A = BASE.split("  test(`375px")[0] + "});\n"
SPLIT_B = 'import { test, expect } from "./fixtures.js";\ntest.describe("会場ページ", () => {\n  test(`375px' + BASE.split("  test(`375px")[1]
v = sg.judge({P: "D", "e2e/a.spec.js": "A", "e2e/b.spec.js": "A"}, {P: BASE}.get, {"e2e/a.spec.js": SPLIT_A, "e2e/b.spec.js": SPLIT_B}.get, {})
check("spec を2本に割る（試験名・expect が移っただけ）: 緑", not v.errors, v.errors)
v = sg.judge({P: "D", "e2e/a.spec.js": "A"}, {P: BASE}.get, {"e2e/a.spec.js": SPLIT_A}.get, {})
check("割った片方を落とす: 赤（消えた名前は元の spec に付く）", any(e.startswith(f"SPEC {P}: spec を消した（1 件") for e in v.errors), v.errors)

print("警告")
v = run(BASE, BASE, ns={P: (3, 40)})
check("削除行が多い（追加3・削除40）: 警告だけ（赤にしない）", not v.errors and v.warnings, (v.errors, v.warnings))
v = run(BASE, BASE, ns={P: (30, 40)})
check("削除が追加の2倍以下: 警告なし", not v.warnings, v.warnings)

print(f"\n{sum(ok)}/{len(ok)} OK")
sys.exit(0 if all(ok) else 1)
