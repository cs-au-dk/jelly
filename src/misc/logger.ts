import {tmpdir} from "os";
import winston from "winston";
import * as Transport from 'winston-transport';
import {options} from "../options";
import {sep} from "path";

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
        isTTY && options?.tty && !options.logfile ? colors[level] + message + RESET + CLEAR : message),
    transports: new winston.transports.Stream({stream: stdout})
});

export default logger;

export function setLogLevel(level: string) {
    logger.level = options.loglevel = level;
}

export function logToFile(file?: string): Transport {
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
