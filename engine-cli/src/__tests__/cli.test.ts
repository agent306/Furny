import { describe, expect, it } from 'vitest';
import { dispatch } from '../cli';

describe('engine CLI dispatch', () => {
    it('answers the version command', () => {
        expect(dispatch('version', '{}')).toEqual({
            ok: true,
            result: { engineVersion: '1.0.0' },
        });
    });

    it('rejects an unknown command', () => {
        expect(dispatch('nope', '{}')).toMatchObject({
            ok: false,
            error: { code: 'unknown_command' },
        });
    });

    it('rejects input that is not JSON', () => {
        expect(dispatch('version', '{')).toMatchObject({
            ok: false,
            error: { code: 'invalid_json' },
        });
    });
});
