import { runProbe } from "./_probe.js";

// vercel.json の functions で、リージョンを syd1 に指定している
export const config = { maxDuration: 60 };

export default runProbe;
