/**
 * 班級作業登記系統 - 可觀測性與日誌監控模組 (Observability & Logging)
 * 統一處理日誌等級、錯誤捕捉與使用者友善回饋。
 */

export const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

let currentLogLevel = LogLevel.INFO;

export const logger = {
    setLevel(level) {
        currentLogLevel = level;
    },
    debug(action, data = null) {
        if (currentLogLevel <= LogLevel.DEBUG) {
            console.debug(`[DEBUG][${new Date().toISOString()}][${action}]`, data || '');
        }
    },
    info(action, data = null) {
        if (currentLogLevel <= LogLevel.INFO) {
            console.info(`[INFO][${new Date().toISOString()}][${action}]`, data || '');
        }
    },
    warn(action, errorOrData) {
        if (currentLogLevel <= LogLevel.WARN) {
            console.warn(`[WARN][${new Date().toISOString()}][${action}]`, errorOrData || '');
        }
    },
    error(action, error, context = null) {
        if (currentLogLevel <= LogLevel.ERROR) {
            console.error(`[ERROR][${new Date().toISOString()}][${action}]`, error, context || '');
        }
    }
};

/**
 * 全域異常捕獲與 Error Boundary
 */
export function initGlobalErrorMonitoring() {
    window.addEventListener('error', (event) => {
        logger.error('UNCAUGHT_GLOBAL_ERROR', event.error || event.message, {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        logger.error('UNHANDLED_PROMISE_REJECTION', event.reason);
    });
}

