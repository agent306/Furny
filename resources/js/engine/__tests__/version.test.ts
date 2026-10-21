import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../version';

describe('ENGINE_VERSION', () => {
    it('is the 1.0.0 semver of the engine output contract', () => {
        expect(ENGINE_VERSION).toBe('1.0.0');
    });
});
