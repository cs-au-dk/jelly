import {tmpdir} from "os";
import winston from "winston";
import * as Transport from 'winston-transport';
import {options} from "../options";

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const WHITE = "\x1b[37m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const RESET =  "\x1b[0m";
const CLEAR = "\u001b[0K";

const colors: {
    [key: string]: string
} = {
    error: RED,
    warn: YELLOW,
    info: WHITE,
    verbose: GREEN,
    debug: CYAN,
}

export const isTTY = process.stdout.isTTY;

const logger = winston.createLogger({
    level: "info",
    format: winston.format.printf(({level, message}) =>
        isTTY && options?.tty ? colors[level] + message + RESET + CLEAR : message),
    transports: new winston.transports.Console({
        stderrLevels: [] // change to ["error"] to direct error messages to stderr
    })
});

export default logger;

export function setLogLevel(level: string) {
    logger.level = options.loglevel = level;
}

export function logToFile(file?: string): Transport {
    const t = new winston.transports.File({
        filename: file ?? `${tmpdir()}/jelly-${process.pid}.log`
    });
    logger.remove(logger.transports[0]);
    logger.add(t);
    return t;
}

export function writeStdOut(s: string) {
    process.stdout.write(s + "\u001b[0K\r");
}

export function writeStdOutIfActive(s: string) {
    if (options.printProgress && options.tty && isTTY && logger.level === "info")
        writeStdOut(s);
}
