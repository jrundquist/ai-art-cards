import log from "electron-log";
import path from "path";
import fs from "fs";

/**
 * A unified logger that works in both Electron and standalone Node processes.
 * It wraps electron-log to provide consistent logging to file and console.
 */

// Configure defaults
log.transports.console.format =
  "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
log.transports.file.level = "debug";

export function configureLogger(logPath?: string) {
  if (logPath) {
    try {
      // Ensure directory exists
      const logDir = path.dirname(logPath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      log.transports.file.resolvePathFn = () => logPath;
      log.info(`[Logger] Log file set to: ${logPath}`);
    } catch (e) {
      console.error(`[Logger] Failed to configure log path: ${e}`);
    }
  }
}

export const logger = {
  info: (...args: any[]) => log.info(...args),
  warn: (...args: any[]) => log.warn(...args),
  error: (...args: any[]) => log.error(...args),
  debug: (...args: any[]) => log.debug(...args),
};
