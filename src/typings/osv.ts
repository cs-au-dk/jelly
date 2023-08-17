/**
 * Open Source Vulnerability format.
 * From https://github.com/renovatebot/osv-offline/blob/main/packages/osv-offline-db/src/lib/osv.ts.
 * Fixed camelcase to underscores, added last_affected.
 */
export interface OpenSourceVulnerability {
    affected?: Affected[];
    aliases?: string[];
    credits?: Credit[];
    database_specific?: { [key: string]: unknown };
    details?: string;
    id: string;
    modified: Date;
    published?: Date;
    references?: Reference[];
    related?: string[];
    schema_version?: string;
    severity?: Severity[];
    summary?: string;
    withdrawn?: Date;
}

/**
 * The type of the vulnerability as reported by npm audit.
 */
export type NpmAuditVulnerability = {
    cvss: {
        score: number;
        vectorString: string | null;
    };
    cwe: string[];
    dependency: string; // name of the affected package
    name: string; // typically, also the name of the affected package
    range: string;
    severity: AuditSeverityType;
    source: number; // might change over time
    title: string;
    url: string;
};

export type AuditSeverityType =
    | 'info'
    | 'INFO'
    | 'low'
    | 'LOW'
    | 'moderate'
    | 'MODERATE'
    | 'high'
    | 'HIGH'
    | 'critical'
    | 'CRITICAL';

export interface Affected {
    database_specific?: { [key: string]: unknown };
    ecosystem_specific?: { [key: string]: unknown };
    package?: Package;
    ranges?: Range[];
    versions?: string[];
}

export interface Package {
    ecosystem: string;
    name: string;
    purl?: string;
}

export interface Range {
    events: Event[];
    repo?: string;
    type: RangeType;
}

export interface Event {
    introduced?: string;
    fixed?: string;
    limit?: string;
    last_affected?: string;
}

export type RangeType = 'ECOSYSTEM' | 'GIT' | 'SEMVER';

export interface Credit {
    contact?: string[];
    name: string;
}

export interface Reference {
    type: ReferenceType;
    url: string;
}

export type ReferenceType =
    |'ADVISORY'
    |'ARTICLE'
    |'FIX'
    |'GIT'
    |'PACKAGE'
    |'REPORT'
    |'WEB';

export interface Severity {
    score: string;
    type: SeverityType;
}

export type SeverityType = 'CVSS_V3';
