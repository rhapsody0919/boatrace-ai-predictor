// ScenarioTab の選択の操作（状態の setter を束ねるだけ。ScenarioTab から移した）
export function scenarioHandlers({
  setEntry,
  setSlit,
  setFirst,
  setSlitOpen,
  slit,
}) {
  const pick = (setter) => (v) => {
    setter(v);
    setFirst(null);
  };
  const chooseEntry = (e) => {
    setEntry(e);
    setSlit("any");
    setFirst(null);
  };
  // ②の見出しへ戻し、押したボタンが消えても次に押す所へフォーカスを移す（畳む・開くで画面の位置が跳ばないように。
  // ③が②のすぐ下に来る。レビュー指摘: 押したボタンごと消えてフォーカスが失われていた）
  const toSlit = (focusId) =>
    requestAnimationFrame(() => {
      document
        .getElementById("af-scn-s2")
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
      document.getElementById(focusId)?.focus({ preventScroll: true });
    });
  const chooseForm = (f) => {
    setSlit(f);
    setFirst(null);
    setSlitOpen(false);
    // 「どの形でも」は畳まないので、画面を動かさない
    if (f !== "any") toSlit("af-slit-change");
  };
  const openSlit = () => {
    setSlitOpen(true);
    toSlit(`af-pat-${slit}`);
  };
  return { pick, chooseEntry, toSlit, chooseForm, openSlit };
}
