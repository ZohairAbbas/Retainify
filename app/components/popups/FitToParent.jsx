import { useLayoutEffect, useRef, useState } from "react";

export default function FitToParent({ children, naturalWidth, naturalHeight, fillFactor = 0.94 }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0.4);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const sx = w / naturalWidth;
      const sy = h / naturalHeight;
      setScale(Math.min(sx, sy, 1) * fillFactor);
    };
    measure();
    let ro;
    try {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    } catch {}
    window.addEventListener("resize", measure);
    return () => {
      ro && ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [naturalWidth, naturalHeight, fillFactor]);

  return (
    <div ref={wrapRef} className="rt-pop-fit">
      <div
        className="rt-pop-fit-inner"
        style={{
          transform: `scale(${scale})`,
          width: naturalWidth,
          height: naturalHeight,
          position: "relative",
        }}
      >
        {children}
      </div>
    </div>
  );
}
