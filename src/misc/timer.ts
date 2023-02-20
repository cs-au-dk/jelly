import {cpuUsage} from "process";
import {options} from "../options";

export default class Timer {

    startTime: Date;

    startUsage: NodeJS.CpuUsage;
    
    constructor() {
        this.startTime = new Date();
        this.startUsage = cpuUsage();
    }

    /**
     * Returns the elapsed time in milliseconds since the timer was created.
     */
    elapsed(): number {
        return new Date().getTime() - this.startTime.getTime();
    }

    /**
     * Returns the elapsed user+system CPU time in milliseconds since the timer was created.
     * May be higher than the actual elapsed time if multiple CPU cores are performing work.
     */
    elapsedCPU(): number {
        const u = cpuUsage(this.startUsage);
        return Math.round((u.user + u.system) / 1000);
    }

    checkTimeout() {
        if (options.timeout && this.elapsed() > options.timeout * 1000)
            throw new TimeoutException();
    }
}

export class TimeoutException extends Error {

    constructor() {
        super("Analysis time limit exceeded");
    }
}
