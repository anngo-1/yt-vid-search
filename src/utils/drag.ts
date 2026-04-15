/**
 * drag - reusable drag and resize utilities
 */

import type { CenterPosition } from '@/types';
import { MIN_RESIZE_WIDTH } from '@/utils/constants';

/** Extract clientX/clientY from mouse or touch event */
function getPointer(e: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
    if ('touches' in e) {
        const touch = e.touches[0] || e.changedTouches[0];
        return { clientX: touch.clientX, clientY: touch.clientY };
    }
    return { clientX: e.clientX, clientY: e.clientY };
}

/** Type guard: is this a mouse or touch event? */
function isPointerEvent(e: Event): e is MouseEvent | TouchEvent {
    return e instanceof MouseEvent || (typeof TouchEvent !== 'undefined' && e instanceof TouchEvent);
}

/** Create reusable drag listener cleanup (shared by draggable and resizable) */
function createDragCleanup(signal: AbortSignal | null, onAbort?: () => void) {
    let currentMoveHandler: ((e: Event) => void) | null = null;
    let currentUpHandler: (() => void) | null = null;

    const cleanup = () => {
        if (currentMoveHandler) {
            document.removeEventListener('mousemove', currentMoveHandler);
            document.removeEventListener('touchmove', currentMoveHandler);
            currentMoveHandler = null;
        }
        if (currentUpHandler) {
            document.removeEventListener('mouseup', currentUpHandler);
            document.removeEventListener('touchend', currentUpHandler);
            document.removeEventListener('touchcancel', currentUpHandler);
            currentUpHandler = null;
        }
    };

    signal?.addEventListener('abort', () => {
        cleanup();
        onAbort?.();
    });

    const attach = (onMove: (e: Event) => void, onUp: () => void) => {
        currentMoveHandler = onMove;
        currentUpHandler = onUp;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        document.addEventListener('touchcancel', onUp);
    };

    return { cleanup, attach };
}

/** make element draggable with proper cleanup - saves center position for stable resizing */
export function makeDraggable(
    panel: HTMLElement,
    handle: HTMLElement,
    signal: AbortSignal | null,
    onDragEnd?: (pos: CenterPosition) => void,
): void {
    let startX = 0,
        startY = 0,
        startLeft = 0,
        startTop = 0;
    let panelWidth = 0,
        panelHeight = 0;
    let currentDx = 0,
        currentDy = 0;
    let pendingFrame: number | null = null;

    const flushDragFrame = () => {
        if (pendingFrame !== null) {
            cancelAnimationFrame(pendingFrame);
            pendingFrame = null;
        }
    };

    const applyDragTransform = () => {
        pendingFrame = null;
        panel.style.transform = `translate3d(${currentDx}px, ${currentDy}px, 0)`;
    };

    const drag = createDragCleanup(signal, () => {
        flushDragFrame();
        handle.style.cursor = 'grab';
        panel.style.willChange = '';
    });

    const onStart = (e: Event): void => {
        if (!isPointerEvent(e)) return;

        const target =
            'touches' in e ? document.elementFromPoint(getPointer(e).clientX, getPointer(e).clientY) : e.target;
        if (target instanceof HTMLElement) {
            if (target.closest('button')) return;
            if (target.classList.contains('yt-caption-resize')) return;
        }

        handle.style.cursor = 'grabbing';

        const pointer = getPointer(e);
        const rect = panel.getBoundingClientRect();
        startX = pointer.clientX;
        startY = pointer.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        panelWidth = rect.width;
        panelHeight = rect.height;
        currentDx = 0;
        currentDy = 0;

        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = startLeft + 'px';
        panel.style.top = startTop + 'px';
        panel.style.transform = 'translate3d(0, 0, 0)';
        panel.style.willChange = 'transform';
        e.preventDefault();

        drag.attach(
            (e: Event) => {
                if (!isPointerEvent(e)) return;
                if ('touches' in e) e.preventDefault();
                const p = getPointer(e);
                const newLeft = Math.max(0, Math.min(window.innerWidth - panelWidth, startLeft + p.clientX - startX));
                const newTop = Math.max(0, Math.min(window.innerHeight - panelHeight, startTop + p.clientY - startY));
                currentDx = newLeft - startLeft;
                currentDy = newTop - startTop;

                if (pendingFrame === null) {
                    pendingFrame = requestAnimationFrame(applyDragTransform);
                }
            },
            () => {
                flushDragFrame();
                const finalLeft = startLeft + currentDx;
                const finalTop = startTop + currentDy;
                panel.style.left = finalLeft + 'px';
                panel.style.top = finalTop + 'px';
                panel.style.transform = 'none';
                panel.style.willChange = '';
                onDragEnd?.({
                    centerX: finalLeft + panelWidth / 2,
                    centerY: finalTop + panelHeight / 2,
                });
                drag.cleanup();
                handle.style.cursor = 'grab';
            },
        );
    };

    const opts = signal ? { signal } : undefined;
    handle.addEventListener('mousedown', onStart, opts);
    handle.addEventListener('touchstart', onStart, signal ? { signal, passive: false } : { passive: false });
}

/** make element resizable with proper cleanup */
export function makeResizable(
    el: HTMLElement,
    handle: HTMLElement,
    signal: AbortSignal | null,
    onResize?: (size: { width: number; height: number }) => void,
): void {
    let startWidth = 0,
        startX = 0;

    const drag = createDragCleanup(signal);

    const onStart = (e: Event): void => {
        if (!isPointerEvent(e)) return;
        const pointer = getPointer(e);
        startX = pointer.clientX;
        const rect = el.getBoundingClientRect();
        startWidth = rect.width;
        e.preventDefault();
        e.stopPropagation();

        drag.attach(
            (e: Event) => {
                if (!isPointerEvent(e)) return;
                if ('touches' in e) e.preventDefault();
                const p = getPointer(e);
                const width = Math.max(MIN_RESIZE_WIDTH, startWidth + (p.clientX - startX));
                el.style.width = width + 'px';
                el.style.height = 'auto';
                el.classList.add('yt-caption-resized');
                onResize?.({ width, height: 0 });
            },
            () => {
                drag.cleanup();
            },
        );
    };

    const opts = signal ? { signal } : undefined;
    handle.addEventListener('mousedown', onStart, opts);
    handle.addEventListener('touchstart', onStart, signal ? { signal, passive: false } : { passive: false });
}
