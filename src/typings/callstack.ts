import {Vulnerability} from "./vulnerabilities";

export type Location = {
    start: {
        line: number,
        column: number
    },
    end: {
        line: number,
        column: number
    },
    filename: string
}

export type CallStack = Array<{
    package: string,
    sourceLocation: Location,
    confidence?: number // number between 0 and 1
}>

export type FunctionLevelPaths = {
    analysisLevel: "function-level",
    stacks: Array<CallStack>,
}

export type VulnerabilityPaths = Array<{
    vulnerability: Vulnerability,
    paths: FunctionLevelPaths
}>
