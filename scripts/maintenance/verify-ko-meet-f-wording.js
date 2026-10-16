#!/usr/bin/env node
// BOA-734: 取り込み時に verify-registry.json の ci へ登録する。
import { readFileSync } from "node:fs";

const ko = JSON.parse(
  readFileSync(
    new URL("../../src/locales/ko/common.json", import.meta.url),
    "utf8",
  ),
);
const expected = {
  "meetTab.flyingExcluded": "출전 제외(F)",
  "meetTab.flyingExcludedTitle": "이번 시리즈에서 플라잉(F)을 해 준결승전·우승전 출전 제외입니다. 공식과 마찬가지로 순위에서 제외합니다. 당사 판정입니다(공식 득점률 일람은 예선이 끝난 뒤에 반영합니다)",
  "meetTab.awardExcludedTitle": "공식 득점률 일람의 비고에 따라 준결승전·우승전 출전 제외입니다. 공식과 마찬가지로 순위에서 제외합니다",
  "flyingBadge.legend": "F＝출주표의 이번 기 플라잉 횟수(금색 1회, 빨간색 2회). '이번 시리즈'는 그중 이번 시리즈 첫날부터 전날까지 나온 것이 있다는 뜻입니다(당일 플라잉은 제외). 그 선수는 이번 시리즈의 남은 레이스에는 출주하지만 이번 시리즈의 준결승전·우승전에 나갈 수 없습니다. L＝이번 기 출발 지연 횟수",
  "flyingBadge.titleCurrentMeet": "출주표에 실린 이번 기 플라잉 {{n}}회. 이번 시리즈 첫날부터 전날까지의 레이스에서 나온 것을 포함(당일 플라잉은 제외). 플라잉 후에도 이번 시리즈의 남은 레이스에는 출주하지만, 이번 시리즈의 준결승전·우승전에 나갈 수 없습니다. 기(5월 1일·11월 1일)가 바뀌면 0으로 돌아갑니다",
  "termHints.flyingCount": "급별은 이 경주 출주표의 값입니다. F는 이번 기의 플라잉 횟수(금색 1회, 빨간색 2회)로, 5월 1일과 11월 1일에 0으로 돌아갑니다. \"이번 시리즈\"가 붙은 선수는 이번 시리즈 첫날부터 전날까지 플라잉을 범한 선수로, 시리즈의 남은 경주는 달리지만 이번 시리즈의 준결승전·우승전에 나갈 수 없습니다(당일 F는 포함하지 않음). L은 출발 지연 횟수로, 아래 출발지연률과는 다릅니다. 안정률, 출발지연률은 플라잉한 경주를 빼고 셉니다"
};
expected["meetTab.excludedReason_flying"] = "준결승전·우승전 출전 제외(이번 시리즈 F)";
const failures = [];
for (const [key, value] of Object.entries(expected)) {
  const actual = key.split(".").reduce((obj, part) => obj?.[part], ko);
  if (actual !== value) failures.push(`${key}: 期待値と一致しません`);
}
function inspect(value, key = "") {
  if (typeof value === "string") {
    for (const old of [
      "나갈 수 없습니다(준결승전·우승전 출전 제외",
      "예선이 끝난 뒤에 씁니다",
    ]) {
      if (value.includes(old)) failures.push(`${key}: 旧表現が残っています`);
    }
  } else if (value && typeof value === "object") {
    for (const [part, child] of Object.entries(value)) {
      inspect(child, key ? `${key}.${part}` : part);
    }
  }
}
inspect(ko);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("OK: ko の今節・F の6キーと一覧の全文、旧表現の不在を確認");
