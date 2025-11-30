import {tmpdir} from "os";
import winston from "winston";
import * as Transport from 'winston-transport';
import {options} from "../options";
import {sep} from "path";
import {truncateSync} from "node:fs";

export const RED = "\x1b[31m";
export const YELLOW = "\x1b[33m";
export const DEFAULT = "\x1b[39m";
export const GREEN = "\x1b[32m";
export const CYAN = "\x1b[36m";
export const WHITE = "\x1b[97m";
export const GREY = "\x1b[90m";
export const BOLD = "\x1b[1m";
export const RESET = "\x1b[0m";
export const CLEAR = "\x1b[0K";

const colors: {
    [key: string]: string
} = {
    error: RED,
    warn: YELLOW,
    info: DEFAULT,
    verbose: GREEN,
    debug: CYAN,
};

const stdout = process.stdout; // read before sandboxing

export const isTTY = stdout.isTTY;

const logger = winston.createLogger({
    level: "info",
    format: winston.format.printf(({level, message}) =>
        isTTY && options?.tty && !options.logfile ? colors[level] + message + RESET + CLEAR : message as string),
    transports: new winston.transports.Stream({stream: stdout})
});

export default logger;

export function setLogLevel(level: string) {
    logger.level = options.loglevel = level;

    // Shortcut `is{Level}Enabled` methods to avoid overhead of winston's isLevelEnabled
    // Transports added later should not have individual levels to ensure this works correctly
    for (const lvl of Object.keys(colors)) {
        const fnName = `is${lvl.charAt(0).toUpperCase() + lvl.slice(1)}Enabled`;
        delete (logger as any)[fnName];  // Remove existing own property, if any
        Object.defineProperty(logger, fnName, {
            value: logger.isLevelEnabled(lvl) ? () => true : () => false,
            writable: false,
            configurable: true,
            enumerable: false
        });
    }
}

export function logToFile(file?: string): Transport {
    if (file)
        try {
            truncateSync(file, 0);
        } catch {}
    const t = new winston.transports.File({
        filename: file ?? `${tmpdir()}${sep}jelly-${process.pid}.log`
    });
    logger.remove(logger.transports[0]);
    logger.add(t);
    return t;
}

export function writeStdOut(s: string) {
    stdout.write(WHITE + BOLD + s.substring(0, stdout.columns) + RESET + CLEAR + "\r");
}

export function writeStdOutIfActive(s: string) {
    if (options.printProgress && options.tty && !options.logfile && isTTY && logger.level === "info")
        writeStdOut(s);
}
