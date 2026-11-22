// A call on every screen frame. This is how core frame data is read: bypassing React state (spec section 9.1).
import { useEffect, useRef } from "react";

export function useFrame(draw: () => void): void {
  const latest = useRef(draw);
  useEffect(() => {
    latest.current = draw;
  });
  useEffect(() => {
    let handle = requestAnimationFrame(function tick() {
      latest.current();
      handle = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(handle);
    };
  }, []);
}
