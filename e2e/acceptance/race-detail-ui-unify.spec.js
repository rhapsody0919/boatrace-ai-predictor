// 受け入れE2E: レース詳細ページのスマホ幅・色分け統一
// 入力: docs/design/race-detail-ui-unify/spec.md・screens.md のみ（plan/tasks/src は読んでいない）
//
// 段階的に実装されるため、FR ごとに test.describe を分けている。
// 未実装の FR は PENDING に入れておくと describe ごと fixme になる。
// 実装された FR を PENDING から外して有効にする。
import { test, expect } from "../fixtures.js";

const PENDING = new Set(["FR-1", "FR-3", "FR-7"]);
const describeFR = (fr, title, body) =>
  (PENDING.has(fr) ? test.describe.fixme : test.describe)(
    `[${fr}] ${title}`,
    body,
  );

// ---------------------------------------------------------------------------
// 導線
// ---------------------------------------------------------------------------

// spec はレース詳細のURL（/race/:raceId）だけを示し、そこへの導線は書いていない。
// 本番Supabase（録画）に依存するのでレースIDを固定せず、トップページのレースへのリンク
// （「◯R」を含むリンク）から辿る。
async function openRaceDetail(page) {
  await page.goto("/");
  const raceLink = page.getByRole("link", { name: /\d{1,2}\s*R/ }).first();
  const found = await raceLink
    .waitFor({ state: "visible", timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  test.skip(
    !found,
    "トップページにレースへのリンクが無い（開催データが無い日）",
  );
  await raceLink.click();
  await expect(page).toHaveURL(/\/race\//);
}

// spec のタブ名をそのまま使う。tab ロールで無い実装（ボタン）も許容する
function tabLocator(page, name) {
  return page
    .getByRole("tab", { name, exact: true })
    .or(page.getByRole("button", { name, exact: true }))
    .first();
}

async function openTab(page, name) {
  const tab = tabLocator(page, name);
  const found = await tab
    .waitFor({ state: "visible", timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!found, `このレースに「${name}」タブが無い`);
  await tab.click();
  // タブの中身の読み込みを待つ（表が1つでも出るか、待ち切ったら先へ）
  await page
    .getByRole("table")
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// 画面内で使う判定（色はトークンの実際の値と比べる。CSSクラス名には依存しない）
// ---------------------------------------------------------------------------

async function installHelpers(page) {
  await page.evaluate(() => {
    if (window.__acc) return;
    const probe = (cssColor) => {
      const el = document.createElement("span");
      el.style.color = cssColor;
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    };
    const parseColors = (str) => {
      const out = [];
      if (!str) return out;
      for (const m of str.matchAll(/rgba?\(([^)]+)\)/g)) {
        const p = m[1]
          .split(/[,\s/]+/)
          .filter(Boolean)
          .map(Number);
        out.push({ r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 });
      }
      for (const m of str.matchAll(/color\(srgb\s+([^)]+)\)/g)) {
        const p = m[1]
          .split(/[\s/]+/)
          .filter(Boolean)
          .map(Number);
        out.push({
          r: p[0] * 255,
          g: p[1] * 255,
          b: p[2] * 255,
          a: p.length > 3 ? p[3] : 1,
        });
      }
      return out;
    };
    const hsl = ({ r, g, b }) => {
      const R = r / 255,
        G = g / 255,
        B = b / 255;
      const max = Math.max(R, G, B),
        min = Math.min(R, G, B);
      const l = (max + min) / 2;
      const d = max - min;
      if (d === 0) return { h: 0, s: 0, l };
      const s = d / (1 - Math.abs(2 * l - 1));
      let h;
      if (max === R) h = 60 * (((G - B) / d) % 6);
      else if (max === G) h = 60 * ((B - R) / d + 2);
      else h = 60 * ((R - G) / d + 4);
      return { h: (h + 360) % 360, s, l };
    };
    const tokenColor = (name) => parseColors(probe(`var(${name})`))[0];
    const near = (a, b) =>
      a &&
      b &&
      Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 24;

    const gold = () => hsl(tokenColor("--brand-accent-primary"));
    const isGoldish = (c) => {
      if (!c || c.a < 0.15) return false;
      const g = gold();
      const x = hsl(c);
      const dh = Math.min(Math.abs(x.h - g.h), 360 - Math.abs(x.h - g.h));
      return dh <= 14 && x.s >= 0.15;
    };
    // トークンの値を、その要素の上で（テーマ等の上書きを含めて）色にする
    const tokenColorOn = (el, name) => {
      const sp = document.createElement("span");
      sp.style.color = `var(${name})`;
      el.appendChild(sp);
      const c = getComputedStyle(sp).color;
      sp.remove();
      return parseColors(c)[0];
    };
    const hasGoldFrame = (el) => {
      const cs = getComputedStyle(el);
      // 表の通常の罫線（--border-hairline）は金寄りの色でも金枠として扱わない
      const hairline = tokenColorOn(el, "--border-hairline");
      const isFrameGold = (c) => isGoldish(c) && !near(c, hairline);
      const borders = ["Top", "Right", "Bottom", "Left"].some(
        (s) =>
          parseFloat(cs[`border${s}Width`]) > 0 &&
          cs[`border${s}Style`] !== "none" &&
          parseColors(cs[`border${s}Color`]).some(isFrameGold),
      );
      const outline =
        parseFloat(cs.outlineWidth) > 0 &&
        cs.outlineStyle !== "none" &&
        parseColors(cs.outlineColor).some(isFrameGold);
      const shadow =
        cs.boxShadow !== "none" && parseColors(cs.boxShadow).some(isFrameGold);
      return borders || outline || shadow;
    };
    const isBold = (el) => Number(getComputedStyle(el).fontWeight) >= 600;
    // セルの値の文字を持つ要素（最初に主要な数値を含むテキストの親）。
    // 級別（A1等）・F/L回数（F1等）だけのバッジは値ではないので飛ばす
    const valueElement = (cell) => {
      const w = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = n.textContent
          .replace(/[０-９]/g, (c) =>
            String.fromCharCode(c.charCodeAt(0) - 0xfee0),
          )
          .replace(/(^|[^A-Za-z0-9])(?:[AB][12]|[FL]\d+)(?![0-9.])/g, "$1 ");
        if (/\d/.test(t)) return n.parentElement;
      }
      return null;
    };
    const subtree = (el) => [el, ...el.querySelectorAll("*")];
    const textColors = (el) =>
      subtree(el)
        .filter((x) =>
          [...x.childNodes].some(
            (n) => n.nodeType === 3 && n.textContent.trim(),
          ),
        )
        .map((x) => parseColors(getComputedStyle(x).color)[0]);

    window.__acc = {
      tokenColor,
      // R1: 金の枠線＋太字。太字は枠を持つ要素そのものか、セルの値の文字に限る
      // （バッジ等の子要素の太字は強調とみなさない）
      isBest: (el) => {
        const frames = subtree(el).filter(hasGoldFrame);
        if (frames.length === 0) return false;
        const v = valueElement(el);
        return frames.some(isBold) || (v !== null && isBold(v));
      },
      // R2: 良い＝緑・悪い＝赤（文字色）
      isGood: (el) =>
        textColors(el).some((c) => near(c, tokenColor("--color-success-text"))),
      isBad: (el) =>
        textColors(el).some((c) => near(c, tokenColor("--color-error-text"))),
      inspect: (el) => ({
        text: (el.innerText || el.textContent || "").trim(),
        best: window.__acc.isBest(el),
        good: window.__acc.isGood(el),
        bad: window.__acc.isBad(el),
      }),
      contrast: (el) => {
        const lum = ({ r, g, b }) => {
          const f = (v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const fg = parseColors(getComputedStyle(el).color)[0];
        let bg = null;
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
          const c = parseColors(getComputedStyle(n).backgroundColor)[0];
          if (c && c.a > 0.5) {
            bg = c;
            break;
          }
        }
        if (!bg)
          bg = parseColors(
            getComputedStyle(document.body).backgroundColor,
          )[0] || { r: 255, g: 255, b: 255 };
        const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        return (a + 0.05) / (b + 0.05);
      },
    };
  });
}

// セルの値＝セルの最初に現れる主要な数値。
// - 級別（A1/A2/B1/B2）・F/L回数（F1・L1）の英字＋数字は値ではないので除く（「B1 F1 4.27」は 4.27）
// - 補助の数字（「86%\n36/42」の分母等）は後ろにあるので、最初の数値だけを読む
// - ↑/＋/+ は正、↓/−/－/- は負の符号として反映する（「↓0.56」は −0.56）
function parseNum(text) {
  const t = text
    .replace(/[０-９．＋]/g, (c) =>
      c === "．" ? "." : String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/(^|[^A-Za-z0-9])(?:[AB][12]|[FL]\d+)(?![0-9.])/g, "$1 ")
    // 「1着 43%」「2連対 60%」の着順・連対は率の見出しなので値にしない
    .replace(/\d+(?:着|連対|連率)\s*(?=[↑↓+\-−－]?\d+(?:\.\d+)?\s*%)/g, " ");
  const m = t.match(/([↑↓+\-−－]?)\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = Number(m[2]);
  return /[↓\-−－]/.test(m[1]) ? -v : v;
}

// 見えている表を「6艇を並べた列（行）」の集まりに分解する。
// - 6行の表（1行＝1艇）は列ごとに6艇
// - それ以外で7セル以上の行（見出し＋6艇）は行の末尾6セルが6艇
async function collectBoatLines(page) {
  await installHelpers(page);
  const lines = [];
  const tables = page.getByRole("table");
  const tableCount = await tables.count();
  for (let t = 0; t < tableCount; t++) {
    const table = tables.nth(t);
    if (!(await table.isVisible())) continue;
    const rows = table.getByRole("row");
    const rowCount = await rows.count();
    const matrix = [];
    for (let r = 0; r < rowCount; r++) {
      // 行見出しを <th scope="row"> で持つ表（ST考察等の「見出し＋6艇」）は、
      // getByRole("cell") だと見出しが落ちて6セルになり、6艇の行と認識されなかった。
      // 行見出しも1セルとして数える
      const cells = await rows
        .nth(r)
        .locator(':scope > th[scope="row"], :scope > td')
        .evaluateAll((els) => els.map((e) => window.__acc.inspect(e)));
      if (cells.length > 0) matrix.push(cells);
    }
    if (
      matrix.length === 6 &&
      matrix.every((row) => row.length === matrix[0].length)
    ) {
      // 列の名前は列見出しの文字（「前検」等で列を選べるように）。無ければ番号
      const heads = await table
        .locator("thead tr")
        .first()
        .locator(":scope > th")
        .allTextContents()
        .catch(() => []);
      for (let c = 0; c < matrix[0].length; c++) {
        lines.push({
          table: t,
          label: heads[c]?.trim() || `列${c + 1}`,
          cells: matrix.map((row) => row[c]),
        });
      }
    } else {
      for (const row of matrix) {
        if (row.length < 7) continue;
        lines.push({
          table: t,
          label: row[0].text.slice(0, 20),
          cells: row.slice(-6),
        });
      }
    }
  }
  return lines;
}

// R1 の不変条件を1列（行）について確かめ、破っていれば理由を返す
function bestViolation(line) {
  const vals = line.cells.map((c) => parseNum(c.text));
  const nums = vals.filter((v) => v !== null);
  const bestIdx = line.cells
    .map((c, i) => (c.best ? i : -1))
    .filter((i) => i >= 0);
  const where = `表${line.table + 1}「${line.label}」 値=${JSON.stringify(vals)} 強調=${JSON.stringify(bestIdx)}`;
  if (bestIdx.length === 0) return null;
  if (nums.length === 0) return `値のある艇が無いのに強調がある: ${where}`;
  if (nums.every((v) => v === nums[0]))
    return `全艇同値なのに強調がある: ${where}`;
  const v = vals[bestIdx[0]];
  if (bestIdx.some((i) => vals[i] === null || vals[i] !== v))
    return `値の違うセルが同時に強調されている: ${where}`;
  if (v !== Math.max(...nums) && v !== Math.min(...nums))
    return `強調された値が最大でも最小でもない: ${where}`;
  const tied = vals.map((x, i) => (x === v ? i : -1)).filter((i) => i >= 0);
  if (tied.length !== bestIdx.length)
    return `同値の最良が一部しか強調されていない: ${where}`;
  return null;
}

async function expectBestRuleHolds(page) {
  const lines = await collectBoatLines(page);
  const violations = lines.map(bestViolation).filter(Boolean);
  expect(violations, violations.join("\n")).toEqual([]);
  return lines;
}

// R2: 緑・赤は記号（↑↓・＋−）付きでのみ使う。
// 低いほど良い指標（出遅率等）は「＋」が悪い＝赤、「−」が良い＝緑になるので、
// 記号の向きは問わず「記号があるか」だけを見る（モックの ST考察の出遅率 +0.1 が赤）。
// 着順の列は R2 の対象外。spec FR-4 が「1着＝金、5・6着＝赤」（直近の走の帯と同じ）と
// 明示している（基準との差ではなく着順そのものの色）
function signViolations(lines) {
  const out = [];
  for (const line of lines) {
    for (const c of line.cells) {
      if (/^着/.test(c.col ?? "")) continue;
      if (
        c.good &&
        !/[↑▲+＋↓▼\-−－]/.test(c.text) &&
        !(parseNum(c.text) >= 100 && /%/.test(c.text))
      )
        out.push(
          `記号の無い緑: 表${line.table + 1}「${line.label}」 "${c.text}"`,
        );
      if (c.bad && !/[↓▼\-−－↑▲+＋]/.test(c.text))
        out.push(
          `記号の無い赤: 表${line.table + 1}「${line.label}」 "${c.text}"`,
        );
    }
  }
  return out;
}

// 表の全セル（6艇に分解できない表も含む）を調べる
async function collectAllCells(page) {
  await installHelpers(page);
  const out = [];
  const tables = page.getByRole("table");
  const n = await tables.count();
  for (let t = 0; t < n; t++) {
    const table = tables.nth(t);
    if (!(await table.isVisible())) continue;
    // 列見出しの文字を添える（着順の列を R2 の検査から外すため。下の signViolations）
    const cells = await table.getByRole("cell").evaluateAll((els) =>
      els.map((e) => {
        const head = e.closest("table")?.querySelector("thead tr");
        const th = head?.children[e.cellIndex];
        return {
          ...window.__acc.inspect(e),
          col: (th?.textContent ?? "").trim(),
        };
      }),
    );
    out.push({ table: t, label: "全セル", cells });
  }
  return out;
}

// 6艇比較が載っている表 = データ出走表（spec が「調子」「機力」をこの表の行として挙げている）
function dataRaceTable(page) {
  return page
    .getByRole("table")
    .filter({ hasText: "調子" })
    .filter({ hasText: "機力" })
    .first();
}

// ===========================================================================
// FR-2 色分けの共通部品（R1 の判定の一本化・同値・全艇同値・R5 一律緑の除去）
// ===========================================================================

describeFR("FR-2", "色分けの共通部品", () => {
  test("[spec FR-2 / R1] 基本情報のすべての6艇比較で、最良の強調は最良値のセルだけに付く", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "基本情報");
    const lines = await expectBestRuleHolds(page);
    test.skip(lines.length === 0, "6艇を並べた表が表示されていない");
  });

  test("[spec FR-2 / R1] データ出走表で最良の値が金の枠線＋太字で強調される", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "基本情報");
    const table = dataRaceTable(page);
    await expect(table).toBeVisible();
    const lines = (await collectBoatLines(page)).filter(
      (l) => l.cells.filter((c) => parseNum(c.text) !== null).length >= 2,
    );
    const withSpread = lines.filter((l) => {
      const nums = l.cells
        .map((c) => parseNum(c.text))
        .filter((v) => v !== null);
      return new Set(nums).size > 1;
    });
    test.skip(withSpread.length === 0, "値に差がある6艇比較の行が無い");
    expect(lines.some((l) => l.cells.some((c) => c.best))).toBe(true);
  });

  test("[spec FR-2 受入基準1] 全艇同値の列・行には最良の強調が出ない", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "基本情報");
    const lines = await collectBoatLines(page);
    const allEqual = lines.filter((l) => {
      const nums = l.cells
        .map((c) => parseNum(c.text))
        .filter((v) => v !== null);
      return nums.length >= 2 && nums.every((v) => v === nums[0]);
    });
    test.skip(allEqual.length === 0, "このレースに全艇同値の行が無い");
    for (const l of allEqual) {
      expect(
        l.cells.filter((c) => c.best).length,
        `全艇同値の「${l.label}」に強調が出ている`,
      ).toBe(0);
    }
  });

  test("[spec FR-2 受入基準2] 同値で並んだ最良は全部に強調が出る", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "基本情報");
    const lines = await collectBoatLines(page);
    // 強調されたセルと同じ値を持つセルが2つ以上ある行
    const tied = lines.filter((l) => {
      const vals = l.cells.map((c) => parseNum(c.text));
      const b = l.cells.findIndex((c) => c.best);
      if (b < 0 || vals[b] === null) return false;
      return vals.filter((v) => v === vals[b]).length >= 2;
    });
    test.skip(tied.length === 0, "このレースに最良が同値で並んだ行が無い");
    for (const l of tied) {
      const vals = l.cells.map((c) => parseNum(c.text));
      const v = vals[l.cells.findIndex((c) => c.best)];
      l.cells.forEach((c, i) => {
        if (vals[i] === v)
          expect(
            c.best,
            `「${l.label}」の${i + 1}艇目（${v}）が強調されていない`,
          ).toBe(true);
      });
    }
  });

  test("[spec FR-2 受入基準3] 強調に使う色トークンがライト・ダークの両方で定義されている", async ({
    page,
  }) => {
    await openRaceDetail(page);
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      const values = await page.evaluate(() =>
        [
          "--brand-accent-primary",
          "--color-success-text",
          "--color-error-text",
        ].map((n) => [
          n,
          getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
        ]),
      );
      for (const [name, value] of values) {
        expect(value, `${scheme} で ${name} が未定義`).not.toBe("");
      }
    }
  });

  test("[spec FR-2 / R1・FR-5] モータ情報の表でも最良の判定が同じ規則（全艇同値は強調なし・同値は全部）になる", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "モータ情報");
    const lines = await expectBestRuleHolds(page);
    test.skip(lines.length === 0, "モータ情報に6艇を並べた表が無い");
  });

  test("[spec R5 / FR-3 受入基準] 基本情報の表で、記号の無い値が緑にならない（一律の緑を外す）", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "基本情報");
    const cells = await collectAllCells(page);
    test.skip(cells.length === 0, "表が表示されていない");
    const v = signViolations(cells);
    expect(v, v.join("\n")).toEqual([]);
  });

  test("[spec R5 / FR-5] モータ情報の表で、前検タイムや件数のセルが緑にならない", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "モータ情報");
    const cells = await collectAllCells(page);
    test.skip(cells.length === 0, "モータ情報に表が無い");
    const v = signViolations(cells);
    expect(v, v.join("\n")).toEqual([]);
  });
});

// ===========================================================================
// FR-1 スマホの横幅
// ===========================================================================

const NARROW_TABS = [
  "今節",
  "直前情報",
  "枠別情報",
  "AI予想",
  "オッズ一覧",
  "結果",
  "モータ情報",
];

describeFR("FR-1", "スマホの横幅", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const tabName of NARROW_TABS) {
    test(`[spec FR-1 受入基準1・2] 375pxの${tabName}タブで、カードの外側余白が左右8px・表の幅が357px`, async ({
      page,
    }) => {
      await openRaceDetail(page);
      await openTab(page, tabName);
      const tables = page.getByRole("table");
      const n = await tables.count();
      const measured = [];
      for (let i = 0; i < n; i++) {
        const t = tables.nth(i);
        if (!(await t.isVisible())) continue;
        // カードは役割で特定できないため、表から外側へ辿って最初に枠線を持つ祖先をカードとみなす
        const m = await t.evaluate((el) => {
          const box = el.getBoundingClientRect();
          let card = null;
          for (
            let n = el.parentElement;
            n && n !== document.body;
            n = n.parentElement
          ) {
            const cs = getComputedStyle(n);
            if (
              parseFloat(cs.borderLeftWidth) > 0 &&
              cs.borderLeftStyle !== "none"
            ) {
              card = n.getBoundingClientRect();
              break;
            }
          }
          return {
            left: box.left,
            width: box.width,
            cardLeft: card ? card.left : null,
            cardRight: card ? window.innerWidth - card.right : null,
          };
        });
        measured.push(m);
      }
      test.skip(measured.length === 0, `${tabName}タブに表が表示されていない`);
      for (const m of measured) {
        expect(m.cardLeft, "カードの左の外側余白").not.toBeNull();
        expect(Math.abs(m.cardLeft - 8)).toBeLessThanOrEqual(1);
        expect(Math.abs(m.cardRight - 8)).toBeLessThanOrEqual(1);
        expect(Math.abs(m.left - 9)).toBeLessThanOrEqual(1);
        // 横スクロールする表は表そのものが広いので、幅は狭い側だけを確かめる
        expect(m.width).toBeGreaterThanOrEqual(356);
      }
    });
  }

  test("[spec FR-1] 375pxでデータ出走表は画面端まで（幅367px）のまま", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "基本情報");
    const table = dataRaceTable(page);
    await expect(table).toBeVisible();
    const box = await table.boundingBox();
    expect(Math.abs(box.width - 367)).toBeLessThanOrEqual(1);
  });

  for (const width of [320, 375, 414, 480]) {
    test(`[spec FR-1 受入基準3] ${width}pxで全タブにページの横スクロールが出ない`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 812 });
      await openRaceDetail(page);
      for (const name of ["基本情報", ...NARROW_TABS]) {
        const tab = tabLocator(page, name);
        if (!(await tab.isVisible().catch(() => false))) continue;
        await tab.click();
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow, `${name}タブで横スクロール`).toBeLessThanOrEqual(0);
      }
    });
  }
});

// ===========================================================================
// FR-3 基本情報タブ
// ===========================================================================

describeFR("FR-3", "基本情報タブ", () => {
  test("[spec FR-3 受入基準] 調子が上がった艇の矢印は緑で「↑」付き、下がった艇は赤で「↓」付き", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "基本情報");
    await installHelpers(page);
    const row = dataRaceTable(page)
      .getByRole("row")
      .filter({ hasText: "調子" })
      .first();
    await expect(row).toBeVisible();
    const cells = await row
      .getByRole("cell")
      .evaluateAll((els) => els.map((e) => window.__acc.inspect(e)));
    const ups = cells.filter((c) => c.text.includes("↑"));
    const downs = cells.filter((c) => c.text.includes("↓"));
    test.skip(
      ups.length + downs.length === 0,
      "このレースに調子の矢印が出ている艇が無い",
    );
    for (const c of ups) {
      expect(c.good, `↑ が緑でない: "${c.text}"`).toBe(true);
      expect(c.bad).toBe(false);
    }
    for (const c of downs) {
      expect(c.bad, `↓ が赤でない: "${c.text}"`).toBe(true);
      expect(c.good).toBe(false);
    }
  });

  test("[spec R3] 向きの無い値（進入・チルト・体重・調整重量）には最良・緑・赤が付かない", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "基本情報");
    const lines = await collectBoatLines(page);
    const neutral = lines.filter((l) =>
      /進入|チルト|体重|調整重量/.test(l.label),
    );
    test.skip(neutral.length === 0, "向きの無い値の行が表示されていない");
    for (const l of neutral) {
      for (const c of l.cells) {
        expect(
          c.best || c.good || c.bad,
          `「${l.label}」"${c.text}" に良し悪しの色`,
        ).toBe(false);
      }
    }
  });

  test("[spec R2 / やらないこと] 赤は記号（↓・−）付きの値だけで、最下位の値を赤くしない", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "基本情報");
    const cells = await collectAllCells(page);
    test.skip(cells.length === 0, "表が表示されていない");
    const v = signViolations(cells).filter((s) => s.startsWith("記号の無い赤"));
    expect(v, v.join("\n")).toEqual([]);
  });
});

// ===========================================================================
// FR-4 今節・枠別情報タブ
// ===========================================================================

describeFR("FR-4", "今節・枠別情報タブ", () => {
  for (const tabName of ["今節", "枠別情報"]) {
    test(`[spec FR-4 受入基準] ${tabName}タブの各表で最良の値（同値なら全部）だけが金枠になり、全艇同値なら出ない`, async ({
      page,
    }) => {
      await openRaceDetail(page);
      await openTab(page, tabName);
      const lines = await expectBestRuleHolds(page);
      // 枠別情報は金枠を付ける6艇比較が無い（ST考察は平均との差で示す。コース別成績は
      // 1艇の表。plan §6）。規則の破れが無いことだけを確かめる
      if (tabName === "枠別情報") return;
      const withSpread = lines.filter((l) => {
        const nums = l.cells
          .map((c) => parseNum(c.text))
          .filter((v) => v !== null);
        return new Set(nums).size > 1;
      });
      test.skip(
        withSpread.length === 0,
        `${tabName}タブに値に差がある6艇比較が無い`,
      );
      expect(
        lines.some((l) => l.cells.some((c) => c.best)),
        `${tabName}タブに最良の強調が1つも無い`,
      ).toBe(true);
    });
  }

  test("[spec FR-4] 今節の前検タイムで最良の艇が強調される", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "今節");
    const lines = (await collectBoatLines(page)).filter((l) =>
      /前検/.test(l.label),
    );
    const withSpread = lines.filter((l) => {
      const nums = l.cells
        .map((c) => parseNum(c.text))
        .filter((v) => v !== null);
      return new Set(nums).size > 1;
    });
    test.skip(withSpread.length === 0, "前検タイムに差がある行が見つからない");
    for (const l of withSpread) {
      expect(
        l.cells.some((c) => c.best),
        `前検タイム「${l.label}」に強調が無い`,
      ).toBe(true);
    }
  });

  // PR #1187 ファン評価2周目: 選択中の行（押されている行）の最良は、行の塗りと混ざって
  // 灰色の箱に見えていた。枠の線は不透明の金（--brand-accent-primary）であること
  test("[plan §6] 今節の選択中の行でも、最良の枠は不透明の金の線", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "今節");
    await installHelpers(page);
    const table = page.getByRole("table").first();
    // 最良のセルがある行を押して選択中にする
    const idx = await table.evaluate((t) =>
      [...t.querySelectorAll("tbody tr")].findIndex((tr) =>
        [...tr.querySelectorAll("td")].some((td) => window.__acc.isBest(td)),
      ),
    );
    test.skip(idx < 0, "6艇の今節の表に最良のセルが無い");
    await table
      .locator("tbody tr")
      .nth(idx)
      .getByRole("button")
      .first()
      .click();
    const rings = await table.evaluate((table) => {
      const gold = window.__acc.tokenColor("--brand-accent-primary");
      const row = [...table.querySelectorAll("tbody tr")].find((tr) =>
        tr.querySelector('[aria-pressed="true"]'),
      );
      if (!row) return null;
      return [...row.querySelectorAll("td")]
        .filter((td) => window.__acc.isBest(td))
        .map((td) => {
          const m = getComputedStyle(td).boxShadow.match(/rgba?\(([^)]+)\)/);
          const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).map(Number);
          return (
            a >= 0.99 &&
            Math.abs(r - gold.r) + Math.abs(g - gold.g) + Math.abs(b - gold.b) <
              24
          );
        });
    });
    test.skip(!rings || rings.length === 0, "選択中の行に最良のセルが無い");
    expect(rings.every(Boolean), JSON.stringify(rings)).toBe(true);
  });

  // PR #1187 ファン評価3周目: 得点率・順位のセルは右の余白が0で、数字が金枠の線に接していた
  test("[plan §6] 今節の最良の数字が金枠の線に接しない", async ({ page }) => {
    await openRaceDetail(page);
    await openTab(page, "今節");
    await installHelpers(page);
    const gaps = await page
      .getByRole("table")
      .first()
      .evaluate((table) =>
        [...table.querySelectorAll("tbody td")]
          .filter((td) => window.__acc.isBest(td))
          .map((td) => {
            const range = document.createRange();
            range.selectNodeContents(td);
            const text = range.getBoundingClientRect();
            const cell = td.getBoundingClientRect();
            return Math.round((cell.right - text.right) * 10) / 10;
          }),
      );
    test.skip(gaps.length === 0, "6艇の今節の表に最良のセルが無い");
    expect(
      gaps.every((g) => g >= 2),
      JSON.stringify(gaps),
    ).toBe(true);
  });

  // PR #1187 ファン評価3周目: 凡例の「走数が少ない⚠の艇には色を付けない」の⚠が表に無かった
  test("[plan §6] ST考察の走数が少ない艇は走数に⚠が付き、差に緑・赤が付かない", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "枠別情報");
    const all = await collectBoatLines(page);
    // コース別成績の表にも「走数」の列があるので、安定率の行と同じ表に絞る
    const stable = all.find((l) => /安定率/.test(l.label));
    test.skip(!stable, "ST考察の表が見つからない");
    const lines = all.filter((l) => l.table === stable.table);
    const runs = lines.find((l) => /走数/.test(l.label));
    test.skip(!runs, "ST考察の走数の行が見つからない");
    const smallIdx = runs.cells
      .map((c, i) => {
        const n = parseNum(c.text.replace("⚠", ""));
        return n !== null && n > 0 && n < 6 ? i : -1;
      })
      .filter((i) => i >= 0);
    test.skip(smallIdx.length === 0, "走数が少ない艇がいない");
    for (const i of smallIdx) {
      expect(runs.cells[i].text, "走数に⚠が無い").toContain("⚠");
      for (const l of lines.filter((x) => /安定率|抜出|出遅率/.test(x.label))) {
        const c = l.cells[i];
        expect(
          c.good || c.bad,
          `ST考察「${l.label}」の走数が少ない艇に色: ${c.text}`,
        ).toBe(false);
      }
    }
  });

  // plan §6（PR #1187 ファン評価1周目 P1）: ST考察の指標はコースで水準が違い、生の値の
  // 最良はほぼ内側の艇に付く。カードの見方は「同コース・同級別の平均との差」なので金枠を付けない
  test("[plan §6] 枠別情報のST考察には最良の金枠を付けない", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "枠別情報");
    const lines = (await collectBoatLines(page)).filter((l) =>
      /安定率|抜出|出遅率/.test(l.label),
    );
    test.skip(lines.length === 0, "ST考察の表が見つからない");
    for (const l of lines) {
      expect(
        l.cells.some((c) => c.best),
        `ST考察「${l.label}」に金枠がある`,
      ).toBe(false);
    }
  });

  for (const tabName of ["今節", "枠別情報"]) {
    test(`[spec R2] ${tabName}タブの緑・赤は記号（↑↓・＋−）付き`, async ({
      page,
    }) => {
      await openRaceDetail(page);
      await openTab(page, tabName);
      const cells = await collectAllCells(page);
      test.skip(cells.length === 0, `${tabName}タブに表が無い`);
      const v = signViolations(cells);
      expect(v, v.join("\n")).toEqual([]);
    });
  }
});

// ===========================================================================
// FR-5 モータ情報・直前情報タブ
// ===========================================================================

describeFR("FR-5", "モータ情報・直前情報タブ", () => {
  test("[spec FR-5 受入基準 / R4] 直前情報の展示タイムで最速の艇に「最速」の印が出る", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "直前情報");
    const hasExhibition = await page
      .getByText(/展示タイム/)
      .first()
      .isVisible()
      .catch(() => false);
    test.skip(!hasExhibition, "展示タイムがまだ出ていない");
    await expect(page.getByText("最速", { exact: true }).first()).toBeVisible();
  });

  test("[spec FR-5] 展示情報の「展示タイム1位勝率」「今節の展示」の行に最良の規則が当たる", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "直前情報");
    const lines = (await collectBoatLines(page)).filter((l) =>
      /展示タイム1位勝率|今節の展示/.test(l.label),
    );
    test.skip(lines.length === 0, "展示情報の該当行が表示されていない");
    const violations = lines.map(bestViolation).filter(Boolean);
    expect(violations, violations.join("\n")).toEqual([]);
    const withSpread = lines.filter((l) => {
      const nums = l.cells
        .map((c) => parseNum(c.text))
        .filter((v) => v !== null);
      return new Set(nums).size > 1;
    });
    // ⚠（件数が少ない参考値）の艇がいる行は、⚠ が最良だと金枠をどの艇にも付けない
    // （plan §7、注記に記載）ので「強調が1つはある」を求めない
    for (const l of withSpread.filter(
      (x) => !x.cells.some((c) => c.text.includes("⚠")),
    )) {
      expect(
        l.cells.some((c) => c.best),
        `「${l.label}」に強調が無い`,
      ).toBe(true);
    }
  });

  // PR #1193 ファン評価1周目: セル全体に金枠を付けると、比べていない平均・2連対率まで
  // 太字の金枠に入り「平均でも最良」と読まれた。金枠は比べた値（前走・1着率）だけ
  test("[plan §7] 展示情報の「展示1位率」「今節展示」の金枠は、比べた値だけを囲む", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "直前情報");
    await installHelpers(page);
    // 選手ごとの集計は後から読み込まれる
    await page
      .getByText(/前走/)
      .first()
      .waitFor({ state: "visible", timeout: 20000 })
      .catch(() => {});
    const framed = await page.evaluate(() =>
      [...document.querySelectorAll("tr")]
        .filter((tr) =>
          /展示タイム1位|展示1位|今節展示|今節の展示/.test(
            tr.cells[0]?.textContent ?? "",
          ),
        )
        .flatMap((tr) => [...tr.querySelectorAll("td *")])
        .filter(
          (el) =>
            window.__acc.isBest(el) &&
            ![...el.children].some((c) => window.__acc.isBest(c)),
        )
        .map((el) => el.textContent.trim()),
    );
    test.skip(framed.length === 0, "該当行に金枠が無い");
    for (const text of framed) {
      expect(text, `比べていない値まで金枠に入っている: ${text}`).not.toMatch(
        /平均|2連対|3連対/,
      );
    }
  });

  // PR #1193 ファン評価1周目: 2号艇の黒い棒がダークの背景に溶けた。1号艇（白）と同じく輪郭を付ける
  test("[plan §7] 展示タイムの棒は1号艇と2号艇に輪郭がある", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "直前情報");
    await page
      .locator("path.recharts-rectangle")
      .first()
      .waitFor({ state: "visible", timeout: 20000 })
      .catch(() => {});
    const strokes = await page
      .locator("path.recharts-rectangle")
      .evaluateAll((els) => els.map((e) => e.getAttribute("stroke")));
    test.skip(strokes.length < 2, "展示タイムの棒が出ていない");
    expect(strokes[0]).not.toBe("none");
    expect(strokes[1]).not.toBe("none");
  });

  test("[spec FR-5] 直前情報タブの各表で最良の規則（同値は全部・全艇同値は無し）が守られる", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "直前情報");
    const lines = await expectBestRuleHolds(page);
    test.skip(lines.length === 0, "直前情報に6艇を並べた表が無い");
  });
});

// ===========================================================================
// FR-6 AI予想・オッズ一覧・結果タブ
// ===========================================================================

describeFR("FR-6", "AI予想・オッズ一覧・結果タブ", () => {
  test("[spec FR-6 決定事項] AI予想の展開予測の最も高い確率に金枠を付けない", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "AI予想");
    await installHelpers(page);
    const section = page.getByText(/展開予測/).first();
    const visible = await section.isVisible().catch(() => false);
    test.skip(!visible, "展開予測が表示されていない");
    // AI予想タブには R1 を付ける表示が無い（spec FR-6）ので、タブ内の表に金枠が無いことを確かめる
    const cells = await collectAllCells(page);
    const golds = cells.flatMap((l) =>
      l.cells.filter((c) => c.best).map((c) => c.text),
    );
    expect(golds, `AI予想タブに金枠: ${golds.join(", ")}`).toEqual([]);
  });

  test("[spec FR-6 受入基準] ダークテーマでイン崩れ注意度の文字が背景と同化しない（4.5:1以上）", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openRaceDetail(page);
    await openTab(page, "AI予想");
    await installHelpers(page);
    const label = page.getByText(/イン崩れ注意度/).first();
    const visible = await label.isVisible().catch(() => false);
    test.skip(!visible, "イン崩れ注意度が表示されていない");
    // 見出しを含むまとまり（見出しの親）の中の文字をすべて測る
    const ratios = await label.evaluate((el) => {
      const root = el.parentElement || el;
      return [root, ...root.querySelectorAll("*")]
        .filter((x) =>
          [...x.childNodes].some(
            (n) => n.nodeType === 3 && n.textContent.trim(),
          ),
        )
        .filter((x) => x.getBoundingClientRect().width > 0)
        .map((x) => ({
          text: x.textContent.trim().slice(0, 20),
          ratio: window.__acc.contrast(x),
        }));
    });
    const low = ratios.filter((r) => r.ratio < 4.5);
    expect(low, JSON.stringify(low)).toEqual([]);
  });

  // PR #1209 ファン評価1周目: 段階ラベルの文字が、薄い色を重ねた地の上で 3.5〜3.8:1 だった。
  // ライト・ダークとも 4.5:1 以上で、アイコンの波紋より前面にあること
  for (const scheme of ["light", "dark"]) {
    test(`[plan §10] イン崩れ注意度の段階ラベルは ${scheme} で4.5:1以上、波紋より前面`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openRaceDetail(page);
      await openTab(page, "AI予想");
      await installHelpers(page);
      const card = page.locator(".volatility-display").first();
      const visible = await card
        .waitFor({ state: "visible", timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      test.skip(!visible, "イン崩れ注意度（発走前）が表示されていない");
      const r = await card.evaluate((el) => {
        const badge = [...el.querySelectorAll("span")].find(
          (s) => getComputedStyle(s).borderRadius === "12px",
        );
        return {
          ratio: window.__acc.contrast(badge),
          z: getComputedStyle(badge).zIndex,
        };
      });
      expect(r.ratio).toBeGreaterThanOrEqual(4.5);
      expect(Number(r.z)).toBeGreaterThanOrEqual(1);
    });
  }

  test("[spec FR-6 / R3] オッズ一覧には良し悪しの色（緑・赤・金枠）を付けない", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "オッズ一覧");
    const cells = await collectAllCells(page);
    test.skip(cells.length === 0, "オッズの表がまだ出ていない");
    const colored = cells.flatMap((l) =>
      l.cells.filter((c) => c.best || c.good || c.bad).map((c) => c.text),
    );
    expect(
      colored,
      `オッズに良し悪しの色: ${colored.slice(0, 10).join(", ")}`,
    ).toEqual([]);
  });

  test("[spec FR-6 / R2] AI予想の確定後の検証で、的中・不的中が緑・赤で示される", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "AI予想");
    await installHelpers(page);
    // spec に検証の表示文言が無いため「的中」「不的中」の語で特定する
    const hit = page.getByText(/^的中/).first();
    const miss = page.getByText(/^不的中/).first();
    const hasHit = await hit.isVisible().catch(() => false);
    const hasMiss = await miss.isVisible().catch(() => false);
    test.skip(
      !hasHit && !hasMiss,
      "確定後の検証が表示されていない（レース確定前）",
    );
    if (hasHit)
      expect(await hit.evaluate((el) => window.__acc.isGood(el))).toBe(true);
    if (hasMiss)
      expect(await miss.evaluate((el) => window.__acc.isBad(el))).toBe(true);
  });
});

// ===========================================================================
// FR-7 多言語
// ===========================================================================

describeFR("FR-7", "多言語", () => {
  test("[spec FR-7] 日本語版で新しい文言「最速」が表示される", async ({
    page,
  }) => {
    await openRaceDetail(page);
    await openTab(page, "直前情報");
    const hasExhibition = await page
      .getByText(/展示タイム/)
      .first()
      .isVisible()
      .catch(() => false);
    test.skip(!hasExhibition, "展示タイムがまだ出ていない");
    await expect(page.getByText("最速", { exact: true }).first()).toBeVisible();
    // en / zh-TW / ko の文言と各言語版のURLは spec・screens に無いため検証できない（報告に記載）
  });
});
