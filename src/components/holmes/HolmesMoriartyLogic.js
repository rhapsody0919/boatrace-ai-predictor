export function getStage(totalBets) {
  if (totalBets < 30) return "starting";
  if (totalBets < 100) return "gathering";
  if (totalBets < 300) return "growing";
  return "mature";
}
