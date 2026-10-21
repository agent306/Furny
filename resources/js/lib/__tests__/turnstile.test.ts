import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    loadTurnstile,
    pageNonce,
    resetTurnstileLoader,
} from '@/lib/turnstile';
import type { TurnstileApi } from '@/lib/turnstile';

const api: TurnstileApi = {
    render: () => 'widget-1',
    reset: () => undefined,
    remove: () => undefined,
};

// The scripts the loader adds. They are caught instead of attached: the test environment would try to fetch them.
let added: HTMLScriptElement[] = [];

function turnstileScripts(): HTMLScriptElement[] {
    return added;
}

beforeEach(() => {
    added = [];
    resetTurnstileLoader();
    delete window.turnstile;
    vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
        added.push(
            ...nodes.filter((node) => node instanceof HTMLScriptElement),
        );
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete window.turnstile;
});

describe('pageNonce', () => {
    it('reads the nonce of the script tags the server rendered', () => {
        const script = document.createElement('script');
        script.nonce = 'abc123';
        script.setAttribute('nonce', 'abc123');
        document.body.append(script);

        expect(pageNonce()).toBe('abc123');
    });

    it('is undefined when no script has one', () => {
        document.body.append(document.createElement('script'));

        expect(pageNonce()).toBeUndefined();
    });
});

describe('loadTurnstile', () => {
    it('adds the Cloudflare script in explicit mode with the nonce of the page, once', async () => {
        const server = document.createElement('script');
        server.setAttribute('nonce', 'abc123');
        server.nonce = 'abc123';
        document.body.append(server);

        const first = loadTurnstile();
        const second = loadTurnstile();
        const [script, ...others] = turnstileScripts();

        expect(others).toEqual([]);
        expect(script?.src).toBe(
            'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
        );
        expect(script?.nonce).toBe('abc123');
        expect(script?.async).toBe(true);

        window.turnstile = api;
        script?.onload?.(new Event('load'));

        await expect(first).resolves.toBe(api);
        await expect(second).resolves.toBe(api);
    });

    it('adds no nonce when the page has none', () => {
        void loadTurnstile();

        expect(turnstileScripts()[0]?.nonce).toBeFalsy();
    });

    it('resolves at once when the script is there already', async () => {
        window.turnstile = api;

        await expect(loadTurnstile()).resolves.toBe(api);
        expect(turnstileScripts()).toHaveLength(0);
    });

    it('rejects when the script cannot be loaded, and tries again next time', async () => {
        const failed = loadTurnstile();

        turnstileScripts()[0]?.onerror?.(new Event('error'));
        await expect(failed).rejects.toThrow('could not be loaded');

        const again = loadTurnstile();

        expect(turnstileScripts()).toHaveLength(2);
        window.turnstile = api;
        turnstileScripts()[1]?.onload?.(new Event('load'));
        await expect(again).resolves.toBe(api);
    });

    it('rejects when the script ran but did not define turnstile', async () => {
        const loading = loadTurnstile();

        turnstileScripts()[0]?.onload?.(new Event('load'));

        await expect(loading).rejects.toThrow('did not initialise');
    });
});
