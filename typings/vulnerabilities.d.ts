import {OpenSourceVulnerability} from "./osv";

/**
 * OSV entry, optionally augmented by code location or access path.
 */
export interface Vulnerability {
    osv: OpenSourceVulnerability;
    location?: {
        link?: string;
        file: string;
        line?: number;
        code?: string;
    }
    patterns?: Array<string>;
}