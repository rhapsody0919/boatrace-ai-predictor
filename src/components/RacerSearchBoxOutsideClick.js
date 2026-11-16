import { useEffect } from "react";

// 開いている間だけ、ルート要素の外のクリックで closeSearch を呼ぶ
export default function useCloseOnOutsideClick(isOpen, rootRef, closeSearch) {
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        closeSearch();
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [isOpen]);
}
