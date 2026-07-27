import { useSyncExternalStore } from "react";

/**
 * Reaktif terhadap CSS media query. Dipakai untuk memilih layout desktop vs
 * mobile/tablet tanpa library tambahan.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false, // fallback (SSR / no window)
  );
}

/**
 * Breakpoint mobile-shell PalmWatch. ≤ 860px → HP & tablet portrait mendapat
 * layout peta-penuh + bottom-sheet; di atas itu memakai workspace panel desktop.
 */
export const MOBILE_BREAKPOINT = "(max-width: 860px)";
export const useIsMobile = () => useMediaQuery(MOBILE_BREAKPOINT);
