import { useEffect, useState } from 'react';

export function useResizeObserver<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [rect, setRect] = useState<{ width: number; height: number }>({ width: 300, height: 300 });

  useEffect(() => {
    if (!node) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect;
        setRect({ width: cr.width, height: cr.height });
      }
    });
    ro.observe(node);
    setRect({ width: node.clientWidth, height: node.clientHeight });
    return () => ro.disconnect();
  }, [node]);

  return { ref: setNode, size: rect } as const;
}

