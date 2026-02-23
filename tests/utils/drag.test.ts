import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { stubChrome } from '../helpers/chrome-mock';
import { makeDraggable, makeResizable } from '../../src/utils/drag';
import { MIN_RESIZE_WIDTH } from '../../src/utils/constants';

stubChrome();

// jsdom doesn't have TouchEvent, so create a minimal mock
class MockTouchEvent extends Event {
    touches: { clientX: number; clientY: number }[];
    changedTouches: { clientX: number; clientY: number }[];
    constructor(
        type: string,
        init: EventInit & {
            touches?: { clientX: number; clientY: number }[];
            changedTouches?: { clientX: number; clientY: number }[];
        } = {},
    ) {
        super(type, init);
        this.touches = init.touches ?? [];
        this.changedTouches = init.changedTouches ?? [];
    }
}

// Register MockTouchEvent globally so `typeof TouchEvent !== 'undefined'` check passes
// and `instanceof TouchEvent` works
vi.stubGlobal('TouchEvent', MockTouchEvent);

function makeBoundingRect(overrides: Partial<DOMRect> = {}): DOMRect {
    const defaults: DOMRect = {
        left: 100,
        top: 100,
        width: 400,
        height: 300,
        right: 500,
        bottom: 400,
        x: 100,
        y: 100,
        toJSON: () => ({}),
    };
    return { ...defaults, ...overrides };
}

describe('makeDraggable', () => {
    let panel: HTMLElement;
    let handle: HTMLElement;
    let controller: AbortController;

    beforeEach(() => {
        panel = document.createElement('div');
        handle = document.createElement('div');
        panel.appendChild(handle);
        document.body.appendChild(panel);
        controller = new AbortController();

        panel.getBoundingClientRect = () => makeBoundingRect();

        // jsdom does not implement elementFromPoint; mock it to return the handle by default
        document.elementFromPoint = vi.fn().mockReturnValue(handle);

        // Set viewport size since jsdom defaults to 0
        Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 1080, writable: true, configurable: true });
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('mousedown + mousemove updates panel position', () => {
        makeDraggable(panel, handle, controller.signal);

        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 150, bubbles: true }));

        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 250, bubbles: true }));

        // startLeft=100, startTop=100, dx=200-150=50, dy=250-150=100
        expect(panel.style.left).toBe('150px');
        expect(panel.style.top).toBe('200px');
        expect(panel.style.right).toBe('auto');
        expect(panel.style.bottom).toBe('auto');
        expect(panel.style.transform).toBe('none');
    });

    it('mousedown + mousemove clamps to viewport boundaries', () => {
        makeDraggable(panel, handle, controller.signal);

        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 150, bubbles: true }));

        // Move far to the left (negative) - should clamp left to 0
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: -500, clientY: -500, bubbles: true }));

        expect(panel.style.left).toBe('0px');
        expect(panel.style.top).toBe('0px');
    });

    it('mousedown + mousemove clamps to right/bottom viewport edge', () => {
        makeDraggable(panel, handle, controller.signal);

        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 150, bubbles: true }));

        // Move far to the right - should clamp to innerWidth - rect.width
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5000, clientY: 5000, bubbles: true }));

        // Max left = 1920 - 400 = 1520, max top = 1080 - 300 = 780
        expect(panel.style.left).toBe('1520px');
        expect(panel.style.top).toBe('780px');
    });

    it('mouseup calls onDragEnd with center position and cleans up listeners', () => {
        const onDragEnd = vi.fn();
        makeDraggable(panel, handle, controller.signal, onDragEnd);

        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 150, bubbles: true }));

        // Move panel
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true }));

        // After drag, getBoundingClientRect returns the "final" position
        panel.getBoundingClientRect = () => makeBoundingRect({ left: 150, top: 150, right: 550, bottom: 450 });

        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        expect(onDragEnd).toHaveBeenCalledOnce();
        expect(onDragEnd).toHaveBeenCalledWith({
            centerX: 150 + 400 / 2, // 350
            centerY: 150 + 300 / 2, // 300
        });

        // Handle cursor should be restored
        expect(handle.style.cursor).toBe('grab');

        // Further mousemove should not update panel (listeners cleaned up)
        panel.style.left = '999px';
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 300, bubbles: true }));
        expect(panel.style.left).toBe('999px');
    });

    it('ignores clicks on buttons within handle', () => {
        makeDraggable(panel, handle, controller.signal);

        const button = document.createElement('button');
        handle.appendChild(button);

        // Dispatch mousedown with target = button
        button.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 150, bubbles: true }));

        // mousemove should not update position since the drag never started
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true }));

        // Panel should not have been styled
        expect(panel.style.left).toBe('');
    });

    it('ignores clicks on .yt-caption-resize elements', () => {
        makeDraggable(panel, handle, controller.signal);

        const resizeEl = document.createElement('div');
        resizeEl.classList.add('yt-caption-resize');
        handle.appendChild(resizeEl);

        resizeEl.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 150, bubbles: true }));

        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true }));

        expect(panel.style.left).toBe('');
    });

    it('abort signal cleans up all listeners', () => {
        const onDragEnd = vi.fn();
        makeDraggable(panel, handle, controller.signal, onDragEnd);

        // Start a drag
        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 150, bubbles: true }));

        // Abort mid-drag
        controller.abort();

        // mousemove should be a no-op now
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 300, bubbles: true }));
        // panel position was set during mousedown to startLeft/startTop, but mousemove after abort should not update
        // The mousedown set left=100, top=100. After abort, mousemove shouldn't change it.
        expect(panel.style.left).toBe('100px');
        expect(panel.style.top).toBe('100px');

        // Cursor should be restored
        expect(handle.style.cursor).toBe('grab');

        // New mousedown should not work because the handle listener was removed via signal
        panel.style.left = '';
        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 150, bubbles: true }));
        expect(panel.style.left).toBe('');

        // onDragEnd should never have been called
        expect(onDragEnd).not.toHaveBeenCalled();
    });

    it('touch events (touchstart + touchmove + touchend) work the same as mouse', () => {
        const onDragEnd = vi.fn();
        makeDraggable(panel, handle, controller.signal, onDragEnd);

        handle.dispatchEvent(
            new MockTouchEvent('touchstart', {
                cancelable: true,
                bubbles: true,
                touches: [{ clientX: 150, clientY: 150 }],
                changedTouches: [{ clientX: 150, clientY: 150 }],
            }),
        );

        expect(handle.style.cursor).toBe('grabbing');

        document.dispatchEvent(
            new MockTouchEvent('touchmove', {
                cancelable: true,
                bubbles: true,
                touches: [{ clientX: 200, clientY: 250 }],
                changedTouches: [{ clientX: 200, clientY: 250 }],
            }),
        );

        // startLeft=100, startTop=100, dx=50, dy=100
        expect(panel.style.left).toBe('150px');
        expect(panel.style.top).toBe('200px');

        panel.getBoundingClientRect = () => makeBoundingRect({ left: 150, top: 200, right: 550, bottom: 500 });

        document.dispatchEvent(
            new MockTouchEvent('touchend', { bubbles: true, changedTouches: [{ clientX: 200, clientY: 250 }] }),
        );

        expect(onDragEnd).toHaveBeenCalledOnce();
        expect(onDragEnd).toHaveBeenCalledWith({
            centerX: 150 + 400 / 2,
            centerY: 200 + 300 / 2,
        });
        expect(handle.style.cursor).toBe('grab');
    });

    it('sets cursor to grabbing during drag', () => {
        makeDraggable(panel, handle, controller.signal);

        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 150, bubbles: true }));
        expect(handle.style.cursor).toBe('grabbing');

        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        expect(handle.style.cursor).toBe('grab');
    });

    it('works with null signal', () => {
        makeDraggable(panel, handle, null);

        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 150, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true }));

        expect(panel.style.left).toBe('150px');
        expect(panel.style.top).toBe('150px');
    });
});

describe('makeResizable', () => {
    let el: HTMLElement;
    let handle: HTMLElement;
    let controller: AbortController;

    beforeEach(() => {
        el = document.createElement('div');
        handle = document.createElement('div');
        el.appendChild(handle);
        document.body.appendChild(el);
        controller = new AbortController();

        el.getBoundingClientRect = () => makeBoundingRect({ width: 400 });
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('mousedown + mousemove updates width', () => {
        const onResize = vi.fn();
        makeResizable(el, handle, controller.signal, onResize);

        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true }));

        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, bubbles: true }));

        // startWidth=400, dx=600-500=100 => width=500
        expect(el.style.width).toBe('500px');
        expect(el.style.height).toBe('auto');
        expect(el.classList.contains('yt-caption-resized')).toBe(true);
        expect(onResize).toHaveBeenCalledWith({ width: 500, height: 0 });
    });

    it('respects MIN_RESIZE_WIDTH', () => {
        const onResize = vi.fn();
        makeResizable(el, handle, controller.signal, onResize);

        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true }));

        // Move far to the left so width would be negative
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, bubbles: true }));

        // startWidth=400, dx=0-500=-500 => raw=-100, clamped to MIN_RESIZE_WIDTH
        expect(el.style.width).toBe(`${MIN_RESIZE_WIDTH}px`);
        expect(onResize).toHaveBeenCalledWith({ width: MIN_RESIZE_WIDTH, height: 0 });
    });

    it('mouseup cleans up listeners', () => {
        const onResize = vi.fn();
        makeResizable(el, handle, controller.signal, onResize);

        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, bubbles: true }));

        expect(onResize).toHaveBeenCalledTimes(1);

        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        // Further mousemove should be no-op
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 700, bubbles: true }));
        expect(onResize).toHaveBeenCalledTimes(1);
    });

    it('abort signal cleans up all listeners', () => {
        const onResize = vi.fn();
        makeResizable(el, handle, controller.signal, onResize);

        // Start resizing
        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, bubbles: true }));
        expect(onResize).toHaveBeenCalledTimes(1);

        // Abort mid-resize
        controller.abort();

        // mousemove should no longer trigger resize
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 700, bubbles: true }));
        expect(onResize).toHaveBeenCalledTimes(1);

        // New mousedown on handle should not start a new resize session
        el.style.width = '';
        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, bubbles: true }));
        expect(el.style.width).toBe('');
    });

    it('touch events work for resize', () => {
        const onResize = vi.fn();
        makeResizable(el, handle, controller.signal, onResize);

        handle.dispatchEvent(
            new MockTouchEvent('touchstart', {
                cancelable: true,
                bubbles: true,
                touches: [{ clientX: 500, clientY: 100 }],
                changedTouches: [{ clientX: 500, clientY: 100 }],
            }),
        );

        document.dispatchEvent(
            new MockTouchEvent('touchmove', {
                cancelable: true,
                bubbles: true,
                touches: [{ clientX: 600, clientY: 100 }],
                changedTouches: [{ clientX: 600, clientY: 100 }],
            }),
        );

        expect(el.style.width).toBe('500px');
        expect(onResize).toHaveBeenCalledWith({ width: 500, height: 0 });

        document.dispatchEvent(
            new MockTouchEvent('touchend', { bubbles: true, changedTouches: [{ clientX: 600, clientY: 100 }] }),
        );

        // Should be cleaned up
        document.dispatchEvent(
            new MockTouchEvent('touchmove', {
                bubbles: true,
                touches: [{ clientX: 700, clientY: 100 }],
                changedTouches: [{ clientX: 700, clientY: 100 }],
            }),
        );
        expect(onResize).toHaveBeenCalledTimes(1);
    });

    it('works with null signal', () => {
        const onResize = vi.fn();
        makeResizable(el, handle, null, onResize);

        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, bubbles: true }));

        expect(el.style.width).toBe('500px');
        expect(onResize).toHaveBeenCalledWith({ width: 500, height: 0 });
    });

    it('multiple drag sessions each clean up properly', () => {
        const onResize = vi.fn();
        makeResizable(el, handle, controller.signal, onResize);

        // First session
        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        expect(onResize).toHaveBeenCalledTimes(1);

        // Reset el rect for second session
        el.getBoundingClientRect = () => makeBoundingRect({ width: 500 });

        // Second session
        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 600, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 700, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        expect(onResize).toHaveBeenCalledTimes(2);
        expect(onResize).toHaveBeenLastCalledWith({ width: 600, height: 0 });
    });
});
