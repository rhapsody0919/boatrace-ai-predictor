#!/usr/bin/env node
// verify:ci の入口。トークンのコントラスト検査（ADR 0017）は check-token-contrast.js が持ち、
// import すると検査が走って AA 未満なら exit 1 で落ちる。ここは中身を写さない。
import "./check-token-contrast.js";
