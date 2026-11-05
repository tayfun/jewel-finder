import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";

/** Loads data on mount and whenever deps change; `reload` refetches without clearing. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const run = useCallback(load, deps);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const result = await run();
      if (mine === seq.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(e as Error);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [run]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, setData, error, loading, reload };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Horizontal swipes on touch screens: `onSwipe(1)` for a swipe to the left (next), `-1` to the right.
 * Mostly-vertical moves stay page scrolls, and pinches (two fingers) are ignored.
 */
export function useSwipe(onSwipe: (direction: -1 | 1) => void, minDistance = 40) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const handlers = {
    onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      start.current = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
      swiped.current = false;
    },
    onTouchEnd(e: TouchEvent) {
      const s = start.current;
      const t = e.changedTouches[0];
      start.current = null;
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < minDistance || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
      swiped.current = true;
      onSwipe(dx < 0 ? 1 : -1);
    },
    onTouchCancel() {
      start.current = null;
    },
  };
  /** True once right after a swipe, so a click that follows it can be ignored. */
  const justSwiped = () => {
    const was = swiped.current;
    swiped.current = false;
    return was;
  };
  return { handlers, justSwiped };
}
