/**
 * 段（STEP）で進む場面の描画（場面1・2b・3〜8）。材料の build（scripts/full-picture/scenes/*.mjs）が作った段の並びを、
 * 決まった手順で描く: 頁を縦スクロールで送る → 押す（あれば。指＋波紋、押した後に表が開く）→ 0.5秒 → 枠（複数なら順に移す）→ 答え。
 * 上帯の問いは段ごと（同じ問いが続くあいだは出し直さない）。答えは次の段で頁を送り終えるまで残す。
 */
import { interpolate, useCurrentFrame } from "remotion";
import { PAGE, answerOf, clamp, ease } from "./parts.js";
import { Bubble, Finger, Frame, Note, QuestionBand } from "./parts.jsx";
import { BarsPage, DeepPage, SummaryPage, FollowersPage, SankeyPage, SlitPage, SonarPage, StatsPage, TablePage, TrifectaPage } from "./pages.jsx";
import { BAND, H, W } from "./scene2Layout.js";
import {
  scrollPages,
  stepAnswerWindows,
  stepAt,
  stepTimeline,
} from "./stepTimeline.js";

const PAGES = { bars: BarsPage, table: TablePage, stats: StatsPage, sonar: SonarPage, sankey: SankeyPage, trifecta: TrifectaPage, slit: SlitPage, followers: FollowersPage, deep: DeepPage, summary: SummaryPage };
const BG_TOP = "#12233a";

/** その段の頁（押す段は、押した後に中身が出る） */
function StepPage({ step, t, active }) {
  const Page = PAGES[step.page.kind];
  if (!Page) throw new Error(`頁の種類が無い: ${step.page.kind}`);
  const shown =
    step.press && step.revealOnPress
      ? active
        ? interpolate(t, [step.times.press, step.times.changed], [0, 1], clamp)
        : 1
      : 1;
  return <Page {...step.page} shown={shown} t={t - step.times.changed} />;
}

export function StepScene({ scene, frameOffset = 0 }) {
  const frame = useCurrentFrame() - frameOffset;
  const { beats } = stepTimeline(scene);
  if (!beats.length) return null;
  const steps = scene.steps.map((s, i) => ({ ...s, times: beats[i].times }));
  const beat = stepAt(beats, frame);
  const t = frame - beat.from;
  const step = steps[beat.index];
  const scroll = scrollPages(beats, frame, (x) => ease(x)) * PAGE;

  // 問い: 前の段と違うときだけ、頁を送る間に入れ替える
  const prevQ = beat.index > 0 ? steps[beat.index - 1].question : null;
  const changing =
    prevQ !== null && prevQ !== step.question && t < step.times.scroll;
  const qOpacity = changing
    ? interpolate(
        t,
        [0, step.times.scroll / 2, step.times.scroll],
        [1, 0, 1],
        clamp,
      )
    : 1;
  const question =
    changing && t < step.times.scroll / 2 ? prevQ : step.question;

  const windows = stepAnswerWindows(beats).filter(
    (w) => frame >= w.start && frame < w.end,
  );
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: W,
        height: H,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: -scroll,
          width: W,
          height: PAGE * steps.length,
        }}
      >
        {steps.map((s, i) => {
          const active = i === beat.index;
          const st = active ? t : s.times.len;
          return (
            <div
              key={s.id}
              style={{
                position: "absolute",
                left: 0,
                top: PAGE * i,
                width: W,
                height: H,
              }}
            >
              <StepPage step={s} t={st} active={active} />
              {active &&
                s.frames.map((box, k) => {
                  // 枠を順に移す: 次の枠が出たら前の枠は消す
                  const at = s.times.frames[k];
                  const next = s.times.frames[k + 1];
                  if (next !== undefined && next > at && t >= next) return null;
                  return <Frame key={k} box={box} t={t - at} />;
                })}
              {windows
                // 答えの無い段（重点でない艇は枠だけ移す）は吹き出しを出さない
                .filter((w) => w.index === i && answerOf(scene, s.id, s.lines)?.length)
                .map((w) => (
                  <Bubble
                    key={s.id}
                    lines={answerOf(scene, s.id, s.lines)}
                    t={frame - w.start}
                    tail={s.tail}
                  />
                ))}
              {s.note && <Note lines={s.note} />}
              {active && s.press && (
                <Finger
                  x={s.press.x}
                  y={s.press.y}
                  t={t - (s.times.press - 8)}
                  from={s.press.from ?? { x: 860, y: 1320 }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: W,
          height: BAND,
          background: `linear-gradient(180deg, ${BG_TOP} 85%, rgba(18,35,58,0))`,
        }}
      />
      <QuestionBand text={question} opacity={qOpacity} />
    </div>
  );
}
