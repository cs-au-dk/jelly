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
