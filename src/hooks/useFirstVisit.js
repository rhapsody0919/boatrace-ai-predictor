import { useEffect, useState } from "react";

const VISITED_KEY = "boatai:visited-before";

export function useFirstVisit() {
  const [isFirstVisit] = useState(
    () => localStorage.getItem(VISITED_KEY) !== "true",
  );

  useEffect(() => {
    localStorage.setItem(VISITED_KEY, "true");
  }, []);

  return isFirstVisit;
}
