// prep8（＋あれば prep8b）から D.scn を作る
const fs = require('fs');
const P = require('../prep/prep8.json');
const B = fs.existsSync(__dirname + '/../prep/prep8b.json') ? require('../prep/prep8b.json') : null;
const keep = ['n', 'first_boat', 'second_boat', 'third_boat', 'technique', 'manshu', 'payout_known', 'b1_win'];
const scopes = {};
const P9 = fs.existsSync(__dirname + '/../prep/prep9b.json') ? require('../prep/prep9b.json') : null;
for (const [sk, s] of Object.entries(P.scopes)) {
  scopes[sk] = { cells: {} };
  for (const [ek, e] of Object.entries(s.cells)) {
    scopes[sk].cells[ek] = { forms: {} };
    for (const [fk, f] of Object.entries(e.forms)) {
      const o = Object.fromEntries(keep.map(k => [k, f[k]]));
      if (f.n < 30) o.races = f.races;
      const bx = B && B.scopes[sk].cells[ek].forms[fk];
      if (bx) { o.tri = bx.tri; o.win_tech = bx.win_tech; }
      scopes[sk].cells[ek].forms[fk] = o;
    }
  }
}
const P10 = fs.existsSync(__dirname + '/../prep/prep10.json') ? require('../prep/prep10.json') : null;
for (const PX of [P9, P10]) if (PX) for (const [sk, s] of Object.entries(PX.scopes)) {
  scopes[sk] = { cells: {} };
  for (const [ek, e] of Object.entries(s.cells)) {
    scopes[sk].cells[ek] = { forms: {} };
    for (const [fk, f] of Object.entries(e.forms)) {
      const o = Object.fromEntries(keep.map(k => [k, f[k]]));
      if (f.n < 30) o.races = f.races;
      o.tri = f.tri; o.win_tech = f.win_tech;
      scopes[sk].cells[ek].forms[fk] = o;
    }
  }
}
const ex = P.example;
const waku = ex.boats.every(b => b.exhibition_course === b.boat);
const scn = { period: ['2019-04-01', '2026-09-26'], scopes, example: { entry_type: waku ? 'waku' : null, boats: ex.boats.map(b => ({ boat: b.boat, exhibition_course: b.exhibition_course })) } };
fs.writeFileSync(__dirname + '/scn.js', 'D.scn=' + JSON.stringify(scn) + ';\n');
console.log('scn.js', fs.statSync(__dirname + '/scn.js').size, 'tri:', !!B, 'entry', scn.example.entry_type);
