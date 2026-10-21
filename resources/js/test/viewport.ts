// happy-dom evaluates `matchMedia` against its viewport, so a test picks a
// breakpoint by setting the width before it mounts (15 §6: phone < 768,
// tablet 768-1023, desktop >= 1024).
type HappyWindow = Window & {
    happyDOM?: {
        setViewport: (viewport: { width: number; height?: number }) => void;
    };
};

const DEFAULT = { width: 1024, height: 768 };

export function setViewport(width: number): void {
    (window as HappyWindow).happyDOM?.setViewport({ width, height: 800 });
}

export function resetViewport(): void {
    (window as HappyWindow).happyDOM?.setViewport(DEFAULT);
}

export const PHONE = 375;
export const TABLET = 820;
export const DESKTOP = 1280;
