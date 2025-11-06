/**
 * Vulnerability description, optionally augmented by a module, a function code location, or access paths.
 */
export type Vulnerability = ({
    osv: OpenSourceVulnerability
} | {
    npm: NpmAuditVulnerability
}) & ({
    loc: {
        filename: string;
    } & ({
        start: {
            line: number;
            column: number;
        },
        end: {
            line: number;
            column: number;
        }
    } | {});
} | {
    patterns: Array<string>;
} | {})

/**
 * Open Source Vulnerability format.
 * From https://github.com/renovatebot/osv-offline/blob/main/packages/osv-offline-db/src/lib/osv.ts.
 * Fixed camelcase to underscores, added last_affected. Unused fields are omitted.
 */
export type OpenSourceVulnerability = {
    id: string;
    affected?: Array<{
        package?: {
            name: string
        };
        ranges?: Array<{
            events: Array<{
                introduced?: string;
                fixed?: string;
                limit?: string;
                last_affected?: string;
            }>
        }>;
        versions?: Array<string>;
    }>;
}

/**
 * npm audit vulnerability format.
 * From https://github.com/npm/cli/blob/latest/workspaces/arborist/lib/vuln.js.
 * Unused fields are omitted.
 */
export type NpmAuditVulnerability = {
    name: string; // package name
    url: string; // typically "https://github.com/advisories/GHSA-xxxx-xxxx-xxxx"
    range: string; // semver range
}

export function getVulnerabilityId(v: Vulnerability): string {
    return "osv" in v ? v.osv.id : v.npm.url;
}
