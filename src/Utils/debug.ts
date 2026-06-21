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
    error: (...args: AnyArgs) => { console.error(...args); }
};

// P2-B11: Global console.log/warn/group override kaldırıldı.
// Eski IIFE ``console.log = () => {}`` ile tüm console.log'ları susturuyordu —
// bu, üçüncü parti kütüphanelerin (Next.js, React DevTools, error tracking)
// log'larını da kırıyordu. ``debug.log``/``debug.warn`` zaten ``DEBUG`` gate'li;
// global override'a gerek yok.

