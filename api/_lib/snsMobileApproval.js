// 送る前の保留の理由（sendHolds）の本体は scripts/lib/sns/sendHolds.js（auto-plan の runner が api/ を読まないため）。ここは同じ名の再 export

export { mobileVersion } from './snsXSend.js';

export { sendHolds, mobileHolds } from "../../scripts/lib/sns/sendHolds.js";
