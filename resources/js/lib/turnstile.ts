// Cloudflare Turnstile (13 §3): the script is loaded on demand, once, with the CSP nonce of the page.

const SCRIPT_URL =
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export type TurnstileOptions = {
    sitekey: string;
    /** The form the token is for; the server only accepts a token of the action it expects. */
    action: string;
    callback: (token: string) => void;
    'expired-callback'?: () => void;
    'error-callback'?: () => void;
};

export type TurnstileApi = {
    render: (container: HTMLElement, options: TurnstileOptions) => string;
    reset: (widgetId: string) => void;
    remove: (widgetId: string) => void;
};

declare global {
    interface Window {
        turnstile?: TurnstileApi;
    }
}

let loading: Promise<TurnstileApi> | null = null;

/**
 * The CSP nonce of this page. Browsers hide the `nonce` attribute but keep the property, so it is read from a
 * script tag the server rendered with it (`@vite`, the page data).
 */
export function pageNonce(): string | undefined {
    const nonce =
        document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;

    return nonce === undefined || nonce === '' ? undefined : nonce;
}

export function loadTurnstile(): Promise<TurnstileApi> {
    if (window.turnstile !== undefined) {
        return Promise.resolve(window.turnstile);
    }

    loading ??= new Promise<TurnstileApi>((resolve, reject) => {
        const script = document.createElement('script');
        const nonce = pageNonce();

        script.src = SCRIPT_URL;
        script.async = true;
        script.defer = true;

        if (nonce !== undefined) {
            script.nonce = nonce;
        }

        script.onload = () => {
            if (window.turnstile === undefined) {
                loading = null;
                reject(new Error('Turnstile did not initialise.'));

                return;
            }

            resolve(window.turnstile);
        };
        script.onerror = () => {
            // A later widget may try again.
            loading = null;
            reject(new Error('Turnstile could not be loaded.'));
        };

        document.head.append(script);
    });

    return loading;
}

/** Forgets the pending load (tests). */
export function resetTurnstileLoader(): void {
    loading = null;
}
