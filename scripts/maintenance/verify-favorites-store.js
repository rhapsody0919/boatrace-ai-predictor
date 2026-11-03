import {
  FAVORITES_KEY, RACER_LIMIT, parseFavorites, serializeFavorites,
  toggleRacer, toggleVenue,
} from "../../src/pure/favorites.js";

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failures.push(label);
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const empty = { racers: [], venues: [], error: null };
check("保存キーと上限", FAVORITES_KEY === "boatai-user:favorites:v1" && RACER_LIMIT === 30);
check("未保存は空", equal(parseFavorites(null), empty));
for (const raw of ["{bad", "null", "[]", "{}", '{"racers":[],"venues":1}']) {
  const parsed = parseFavorites(raw);
  check(`壊れた値は空と理由: ${raw}`, equal(parsed.racers, []) &&
    equal(parsed.venues, []) && typeof parsed.error === "string" && parsed.error.length > 0);
}
check("整数・会場範囲・重複を検査", equal(
  parseFavorites('{"racers":[4320,"x",4320,1.5],"venues":[12,0,25,12]}'),
  { racers: [4320], venues: [12], error: null },
));
const ids = Array.from({ length: 31 }, (_, i) => 4000 + i);
check("31人は先頭30人", equal(parseFavorites(JSON.stringify({ racers: ids, venues: [] })).racers, ids.slice(0, 30)));
const state = Object.freeze({ racers: Object.freeze(ids.slice(0, 29)), venues: Object.freeze([12]) });
const added = toggleRacer(state, 9999);
check("29人から末尾へ追加", added.result === "added" && equal(added.state.racers, [...state.racers, 9999]));
const full = Object.freeze({ ...added.state, racers: Object.freeze(added.state.racers) });
const limited = toggleRacer(full, 8888);
check("30人では追加しない", limited.result === "limit" && equal(limited.state, full));
const removed = toggleRacer(full, 9999);
check("30人でも外せる", removed.result === "removed" && equal(removed.state.racers, state.racers));
check("引数を変えず新しいオブジェクト", added.state !== state && removed.state !== full && limited.state !== full && state.racers.length === 29);
let venues = { racers: [], venues: [] };
for (let code = 1; code <= 24; code++) {
  const before = JSON.stringify(venues);
  const next = toggleVenue(venues, code);
  check(`会場${code}を追加`, next.result === "added" && next.state.venues.length === code && JSON.stringify(venues) === before && next.state !== venues);
  venues = next.state;
}
const before = JSON.stringify(venues);
const venueRemoved = toggleVenue(venues, 12);
check("会場を外す・元を変えない", venueRemoved.result === "removed" && venueRemoved.state.venues.length === 23 && !venueRemoved.state.venues.includes(12) && JSON.stringify(venues) === before);
check("保存は2つの配列だけ・往復できる", equal(JSON.parse(serializeFavorites({ ...venues, error: "ignored" })), venues) && equal(parseFavorites(serializeFavorites(venues)), { ...venues, error: null }));
process.exitCode = failures.length ? 1 : 0;
