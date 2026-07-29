import { useCallback, useEffect, useRef, type ReactNode } from 'react';

/** How far the sheet has to travel before letting go dismisses it, as a share of its own
 *  height — a tall sheet should not be dismissable by a 120px nudge. */
const DISMISS_RATIO = 0.26;
const DISMISS_MAX = 130;
/** A downward flick this fast dismisses regardless of distance, the way iOS sheets do. */
const FLING_VELOCITY = 0.5; // px/ms
const CLOSE_MS = 250;

interface Props {
  /** Accessible name for the dialog. */
  label: string;
  /** While true the sheet refuses to close — a write is in flight. */
  locked?: boolean;
  onClose: () => void;
  /** Header content. This whole strip is the drag handle. */
  head: ReactNode;
  /** Pinned action bar. Never scrolls away. */
  foot?: ReactNode;
  /** Scrollable content. */
  children: ReactNode;
}

/**
 * A bottom sheet you can throw away with your thumb.
 *
 * The gesture is written against raw touch events rather than React's synthetic ones for
 * one reason: the sheet has to be draggable *out of its own scrolling content*, and that
 * only works if `touchmove` can call `preventDefault()` before the browser commits to a
 * scroll — which requires a listener registered with `{ passive: false }`. Everything
 * else follows from that:
 *
 * - the header strip always drags;
 * - the body only hands the gesture over when it is already scrolled to the top and the
 *   finger is heading down, so a half-read note still scrolls normally;
 * - text fields keep their own gestures, or selecting a word would fling the sheet away;
 * - dragging up meets a square-root rubber band instead of a wall;
 * - release dismisses on distance *or* on velocity, so a fast flick works even from 30px.
 *
 * Position is written straight to the node during the drag. Routing 60 frames a second
 * through React state would re-render the whole form under your thumb for no reason.
 *
 * Above 600px the sheet becomes a centred dialog and the whole gesture switches off —
 * there is no bottom edge to throw it at with a mouse.
 */
export default function Sheet({ label, locked = false, onClose, head, foot, children }: Props) {
  const scrimRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const grabRef = useRef<HTMLDivElement>(null);

  // Read by the touch handlers, which are registered once and never see fresh props.
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /** Animate out, then unmount. Both the gesture and the buttons come through here. */
  const dismiss = useCallback(() => {
    if (closingRef.current || lockedRef.current) return;
    closingRef.current = true;

    const sheet = sheetRef.current;
    const scrim = scrimRef.current;
    if (!sheet || !scrim) {
      onCloseRef.current();
      return;
    }

    sheet.style.transition = `transform ${CLOSE_MS}ms var(--ease)`;
    sheet.style.transform = `translate3d(0, ${sheet.offsetHeight + 48}px, 0)`;
    scrim.style.transition = `opacity ${CLOSE_MS}ms linear`;
    scrim.style.opacity = '0';
    window.setTimeout(() => onCloseRef.current(), CLOSE_MS);
  }, []);

  /* ─────────────────────────────── the gesture ─────────────────────────────── */
  useEffect(() => {
    const sheet = sheetRef.current;
    const scrim = scrimRef.current;
    if (!sheet || !scrim) return;

    // Checked live rather than captured, so rotating a phone into landscape does not
    // leave a centred dialog with a phantom drag handle.
    const wide = window.matchMedia('(min-width: 600px)');

    let phase: 'idle' | 'watching' | 'dragging' = 'idle';
    let originY = 0;
    let originX = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let fromHandle = false;

    const paint = (y: number) => {
      sheet.style.transform = y === 0 ? '' : `translate3d(0, ${y}px, 0)`;
      // The backdrop lifts with the sheet, so a half-committed drag already shows you
      // the list you are heading back to.
      const travel = Math.min(Math.max(y, 0) / (sheet.offsetHeight || 1), 1);
      scrim.style.opacity = String(1 - travel * 0.9);
    };

    const release = () => {
      sheet.style.transition = 'transform 0.36s var(--ease)';
      scrim.style.transition = 'opacity 0.36s var(--ease)';
      sheet.style.transform = '';
      scrim.style.opacity = '';
      window.setTimeout(() => {
        sheet.style.transition = '';
        scrim.style.transition = '';
      }, 380);
    };

    const onStart = (e: TouchEvent) => {
      if (closingRef.current || lockedRef.current || wide.matches) return;
      if (e.touches.length !== 1) return;

      const touch = e.touches[0];
      const target = e.target as HTMLElement | null;

      // A drag that begins inside a text field belongs to the field: caret placement and
      // word selection both look exactly like the start of a downward swipe.
      fromHandle = !!grabRef.current?.contains(target);
      if (!fromHandle && target?.closest('input, textarea, select')) return;

      originY = lastY = touch.clientY;
      originX = touch.clientX;
      lastT = e.timeStamp;
      velocity = 0;
      phase = 'watching';
      sheet.style.transition = '';
      scrim.style.transition = '';
    };

    const onMove = (e: TouchEvent) => {
      if (phase === 'idle') return;
      const touch = e.touches[0];
      const dy = touch.clientY - originY;
      const dx = touch.clientX - originX;

      if (phase === 'watching') {
        // Wait out the first few pixels: below this, a tap and a swipe look identical.
        if (Math.abs(dy) < 5 && Math.abs(dx) < 5) return;

        const atTop = (bodyRef.current?.scrollTop ?? 0) <= 0;
        const vertical = Math.abs(dy) > Math.abs(dx);
        const engage = fromHandle ? vertical : dy > 0 && atTop && vertical;
        if (!engage) {
          phase = 'idle';
          return;
        }

        phase = 'dragging';
        sheet.dataset.dragging = 'true';
        // A running animation outranks an inline transform, so grabbing the sheet before
        // it has finished rising would leave it stuck under a moving thumb. The gesture
        // cancels the entrance and takes the sheet where it already is.
        sheet.style.animation = 'none';
        // Re-zero on the current finger position so the sheet does not jump by the five
        // pixels spent deciding what this gesture was.
        originY = lastY = touch.clientY;
        lastT = e.timeStamp;
        if (e.cancelable) e.preventDefault();
        return;
      }

      if (e.cancelable) e.preventDefault();

      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = (touch.clientY - lastY) / dt;
      lastY = touch.clientY;
      lastT = e.timeStamp;

      // Down follows the finger exactly; up gives progressively less, so the top of the
      // travel feels like a limit rather than a broken sheet.
      paint(dy > 0 ? dy : -Math.min(34, Math.sqrt(-dy) * 3.2));
    };

    const onEnd = () => {
      if (phase !== 'dragging') {
        phase = 'idle';
        return;
      }
      phase = 'idle';
      delete sheet.dataset.dragging;

      const travelled = lastY - originY;
      const threshold = Math.min(DISMISS_MAX, sheet.offsetHeight * DISMISS_RATIO);
      const flung = velocity > FLING_VELOCITY && travelled > 24;

      if (!lockedRef.current && (travelled > threshold || flung)) dismiss();
      else release();
    };

    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: false });
    sheet.addEventListener('touchend', onEnd);
    sheet.addEventListener('touchcancel', onEnd);

    return () => {
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onEnd);
    };
  }, [dismiss]);

  /* ───────────────────────────── keyboard & scroll ───────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismiss]);

  // The sheet owns the viewport while it is up; the roster must not scroll behind it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheetRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      ref={scrimRef}
      className="sheet-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <div ref={grabRef} className="sheet-grab">
          <span className="sheet-grip" aria-hidden="true" />
          <div className="sheet-head">{head}</div>
        </div>

        <div ref={bodyRef} className="sheet-body">
          {children}
        </div>

        {foot && <div className="sheet-foot">{foot}</div>}
      </div>
    </div>
  );
}
