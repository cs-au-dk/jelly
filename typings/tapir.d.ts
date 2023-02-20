// mono:tapir/src/pattern-finder/patch-description-types.ts

export interface LibraryPatchDescriptionTypes {
    [index: string]: ClientPatchType;
}

export interface ClientPatchType {
    excludedFolders?: string[];
    excludedFiles?: string[];
    includedFiles?: string[]; // new
    patches: PatchType[];
    repo: RepoType;
    install?: boolean;
}

export interface PatchType {
    file: string;
    lineNumber: number;
    classification: string;
    truePositive?: boolean;
}

export interface RepoType {
    gitCommit: string;
    gitURL: string;
}

// mono:tapir/src/pattern-finder/pattern-language.ts

export interface PatternWrapper {
    pattern: string;
    question?: string;
    id: string;
    changelogId?: string;
    changelogDescription?: string;
    deprecation?: boolean;
    benign?: boolean;
}

// mono:types/semantic-patches.d.ts

export type SemanticPatch = {
    version: number,
    semanticPatch: {
        detectionPattern: string;
        primaryTemplate?: any; // not used here
        objectModifiers?: any; // not used here
        alternativeTemplate?: any; // not used here
        suggestedFixDescription?: string;
        transformationQuestion?: string;
        unknownAccessPathQuestion?: string;
        extraQuestion?: string;
        expectedToFail?: boolean;
    }
    semanticPatchId: string,
    breakingChangeId: string,
    enabled: boolean,
    comment: string
};

// new version of mono:types/semantic-patches.d.ts

export interface SemanticPatchNew {
    detectionPattern: string;
    primaryTemplate?: any; // not used here
    objectModifiers?: any; // not used here
    alternativeTemplate?: any; // not used here
    suggestedFixDescription?: string;
    transformationQuestion?: string;
    unknownAccessPathQuestion?: string;
    extraQuestion?: string;
    expectedToFail?: boolean;
}

export type RepoMatches = [
    {
        repo: {
            gitURL: string,
            gitCommit: string
        },
        matches: [Match]
    }
];

export type Match = {
    file: string,
    semanticPatchId: string;
    semanticPatchVersion: number;
    loc: string;
    highConfidence: boolean,
    questions: [{
        matchId: string,
        answer: "yes" | "no" | null,
        type: string,
        text: string
    }]
};
