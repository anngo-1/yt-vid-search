/**
 * captions - pure helpers for caption position migration
 *
 * DOM rendering lives in components/CaptionOverlay.ts
 */

import type { CenterPosition } from '@/types';

/** Detect old { top, left } format vs new { centerX, centerY } */
export function isOldPositionFormat(pos: { top?: number; left?: number }): boolean {
    return typeof pos.top === 'number' && typeof pos.left === 'number';
}

/** Convert old top/left to center-based position */
export function migratePosition(pos: { top: number; left: number }, width: number, height: number): CenterPosition {
    return {
        centerX: pos.left + width / 2,
        centerY: pos.top + height / 2,
    };
}
