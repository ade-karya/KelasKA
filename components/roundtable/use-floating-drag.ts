'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface FloatingDragOffset {
  x: number;
  y: number;
}

const VIEWPORT_MARGIN = 8;
/**
 * A press only becomes a drag after travelling this far — plain clicks and
 * button presses pass through untouched, so the pill looks and behaves
 * exactly as before until the user actually drags it.
 */
const DRAG_THRESHOLD_PX = 6;

/** Keep the whole pill inside the viewport with a small margin. */
function clampOffsetToViewport(
  raw: FloatingDragOffset,
  originLeft: number,
  originTop: number,
  width: number,
  height: number,
): FloatingDragOffset {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  // Pill edges if this offset were applied: left = originLeft + x.
  // The whole pill must stay in [MARGIN, viewport - size - MARGIN].
  const loX = VIEWPORT_MARGIN - originLeft;
  const hiX = vw - VIEWPORT_MARGIN - width - originLeft;
  const loY = VIEWPORT_MARGIN - originTop;
  const hiY = vh - VIEWPORT_MARGIN - height - originTop;
  // When the pill is larger than the viewport the range inverts;
  // pin to the top-left margin instead of hanging off-screen.
  const x = hiX < loX ? VIEWPORT_MARGIN - originLeft : Math.min(Math.max(raw.x, loX), hiX);
  const y = hiY < loY ? VIEWPORT_MARGIN - originTop : Math.min(Math.max(raw.y, loY), hiY);
  return { x, y };
}

/** Drags never start on controls — only on the pill's own background. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest(
    'button, a, input, textarea, select, [contenteditable="true"], [data-no-drag]',
  );
}

/**
 * useFloatingDrag — makes a floating pill (presentation toolbar / dock)
 * draggable WITHOUT changing its appearance: no handle, no extra chrome.
 *
 * A press on the pill's background becomes a drag once it travels past a
 * small threshold; anything shorter stays a normal click, and presses that
 * start on a button/input never drag at all. The click that ends a drag is
 * swallowed so releasing over a button can't mis-fire it. Offset is applied
 * as an inline `transform` on the pill itself (the outer fixed wrapper keeps
 * its centering/bottom anchoring), persisted to localStorage, and clamped so
 * the pill can never leave the viewport. Double-clicking the pill background
 * resets to the docked position.
 */
export function useFloatingDrag(storageKey: string) {
  const [offset, setOffset] = useState<FloatingDragOffset>({ x: 0, y: 0 });
  const nodeRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    rectLeft: number;
    rectTop: number;
    rectWidth: number;
    rectHeight: number;
    dragging: boolean;
  } | null>(null);
  const offsetRef = useRef(offset);
  /** Set when a drag ends; consumed by the click that immediately follows it. */
  const justDraggedRef = useRef(false);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  // Restore the saved position once (client-only).
  useEffect(() => {
    let next: FloatingDragOffset | null = null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<FloatingDragOffset>;
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          const x = Math.max(-2000, Math.min(2000, parsed.x));
          const y = Math.max(-2000, Math.min(2000, parsed.y));
          if (x !== 0 || y !== 0) next = { x, y };
        }
      }
    } catch {
      /* corrupted storage — stay docked */
    }
    /* eslint-disable react-hooks/set-state-in-effect -- mount-only restore of the persisted drag offset */
    if (next) setOffset(next);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [storageKey]);

  // Pull a dragged pill back inside when the viewport resizes.
  useEffect(() => {
    const onResize = () => {
      const node = nodeRef.current;
      if (!node) return;
      const prev = offsetRef.current;
      if (prev.x === 0 && prev.y === 0) return;
      const rect = node.getBoundingClientRect();
      const originLeft = rect.left - prev.x;
      const originTop = rect.top - prev.y;
      const next = clampOffsetToViewport(prev, originLeft, originTop, rect.width, rect.height);
      if (next.x !== prev.x || next.y !== prev.y) setOffset(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    justDraggedRef.current = false;
    // Only the primary button starts a potential drag.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Presses on controls belong to the controls.
    if (isInteractiveTarget(e.target)) return;
    const node = nodeRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: offsetRef.current.x,
      origY: offsetRef.current.y,
      rectLeft: rect.left,
      rectTop: rect.top,
      rectWidth: rect.width,
      rectHeight: rect.height,
      dragging: false,
    };
    // Deliberately no capture / preventDefault here: until the threshold is
    // crossed this is still an ordinary click.
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      justDraggedRef.current = true;
      try {
        nodeRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* best effort */
      }
      document.body.style.cursor = 'grabbing';
    }
    // The undocked origin stays fixed for the gesture (measured at down).
    const originLeft = drag.rectLeft - drag.origX;
    const originTop = drag.rectTop - drag.origY;
    setOffset(
      clampOffsetToViewport(
        { x: drag.origX + dx, y: drag.origY + dy },
        originLeft,
        originTop,
        drag.rectWidth,
        drag.rectHeight,
      ),
    );
    // Don't select text while dragging.
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const endDrag = useCallback(
    (e?: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (document.body.style.cursor === 'grabbing') document.body.style.cursor = '';
      if (!drag.dragging) return;
      try {
        const next = offsetRef.current;
        if (next.x === 0 && next.y === 0) window.localStorage.removeItem(storageKey);
        else window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* storage full / private mode — position just won't persist */
      }
      e?.stopPropagation();
    },
    [storageKey],
  );

  /** Swallow the click that ends a drag (release over a button must not fire it). */
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!justDraggedRef.current) return;
    justDraggedRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /** Double-clicking the pill background docks it back; controls are exempt. */
  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isInteractiveTarget(e.target)) return;
      dragRef.current = null;
      justDraggedRef.current = false;
      setOffset({ x: 0, y: 0 });
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  return {
    offset,
    /** Attach to the floating pill element (measured + transformed). */
    setNodeRef: useCallback((node: HTMLElement | null) => {
      nodeRef.current = node;
    }, []),
    /** Spread onto the pill: appearance untouched, only pointer behaviour added. */
    pillProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onClickCapture,
      onDoubleClick,
    },
    style: {
      transform:
        offset.x === 0 && offset.y === 0 ? undefined : `translate3d(${offset.x}px, ${offset.y}px, 0)`,
    } as React.CSSProperties,
  };
}
