import {options} from "../options";

export default class Timer {

    startTime: bigint;

    constructor() {
        this.startTime = process.hrtime.bigint();
    }

    /**
     * Returns the elapsed time in nanoseconds since the timer was created.
     */
    elapsed(): bigint {
        return process.hrtime.bigint() - this.startTime;
    }

    checkTimeout() {
        if (options.timeout && this.elapsed() > BigInt(options.timeout) * 1000000000n)
            throw new TimeoutException();
    }
}

export class TimeoutException extends Error {

    constructor() {
        super("Analysis time limit exceeded");
    }
}

export function nanoToMs(n: bigint): string {
    return `${n / 1000000n}ms`;
}
