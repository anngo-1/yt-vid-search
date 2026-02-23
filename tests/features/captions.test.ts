import { describe, it, expect } from 'vitest';
import { stubChrome } from '../helpers/chrome-mock';
import { isOldPositionFormat, migratePosition } from '../../src/features/captions';

stubChrome();

describe('isOldPositionFormat', () => {
    it('detects old top/left format', () => {
        expect(isOldPositionFormat({ top: 10, left: 20 })).toBe(true);
    });

    it('rejects center-based format', () => {
        expect(isOldPositionFormat({ centerX: 100, centerY: 200 } as unknown as { top: number; left: number })).toBe(
            false,
        );
    });

    it('handles positions with both formats', () => {
        const pos = { top: 10, left: 20, centerX: 100 } as unknown as { top: number; left: number };
        expect(isOldPositionFormat(pos)).toBe(true);
    });
});

describe('migratePosition', () => {
    it('converts old position to center position', () => {
        const result = migratePosition({ top: 100, left: 200 }, 600, 120);
        expect(result).toEqual({
            centerX: 200 + 600 / 2, // 500
            centerY: 100 + 120 / 2, // 160
        });
    });

    it('handles zero position', () => {
        const result = migratePosition({ top: 0, left: 0 }, 600, 120);
        expect(result).toEqual({ centerX: 300, centerY: 60 });
    });

    it('handles small dimensions', () => {
        const result = migratePosition({ top: 50, left: 50 }, 200, 40);
        expect(result).toEqual({ centerX: 150, centerY: 70 });
    });
});
