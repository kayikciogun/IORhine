// Basit debug yardımcı modülü
// DEBUG bayrağı environment'a göre ayarlanır
// Browser'da NEXT_PUBLIC_DEBUG, server'da DEBUG kullanılır
const DEBUG_ENV = (
    typeof window !== 'undefined' 
        ? process.env.NEXT_PUBLIC_DEBUG || ''
        : process.env.DEBUG || ''
).toLowerCase();

export const DEBUG =
    DEBUG_ENV === 'true' ||
    DEBUG_ENV === '1' ||
    (DEBUG_ENV === '' && process.env.NODE_ENV !== 'production');

type AnyArgs = any[];

export const debug = {
    log: (...args: AnyArgs) => { if (DEBUG) console.log(...args); },
    warn: (...args: AnyArgs) => { if (DEBUG) console.warn(...args); },
    group: (...args: AnyArgs) => { if (DEBUG && (console as any).group) (console as any).group(...args); },
    groupEnd: () => { if (DEBUG && (console as any).groupEnd) (console as any).groupEnd(); },
    error: (...args: AnyArgs) => { if (DEBUG) console.error(...args); }
};

// DEBUG kapalıysa global console.log/warn/group çağrılarını sustur
// error'lar görünür kalır
(() => {
    if (!DEBUG) {
        try {
            const c: any = console as any;
            c.log = () => {};
            c.warn = () => {};
            if (typeof c.group === 'function') c.group = () => {};
            if (typeof c.groupEnd === 'function') c.groupEnd = () => {};
        } catch (_) {
            // ignore
        }
    }
})();

