import {
    CallStacksOutput,
    DEFAULT_MAX_PATHS_PER_SITE,
    DEFAULT_MAX_SITES_PER_VULN,
    Frame,
    serializeCallStacks,
    VulnPaths,
} from "../../src/output/callstacksfile";
import {Vulnerability} from "../../src/typings/vulnerabilities";

// A minimal CallGraphLike that returns no callers — used to test the empty
// and seeded cases that don't exercise the BFS.
const emptyCallGraph = {
    callersOf: () => [],
    isEntry: () => true,
    frameFor: (node: unknown): Frame | null => (node as Frame | null),
};

function frame(name: string, line = 1, column = 0): Frame {
    return {
        package: name,
        sourceLocation: {
            start: {line, column},
            end:   {line, column: column + 1},
            filename: `${name}.js`,
        },
        confidence: 1,
    };
}

function makeGraph(
    edges: Record<string, string[]>,
    entries: Set<string>,
    framesByNode: Record<string, Frame>,
) {
    const reverseEdges: Record<string, string[]> = {};
    for (const [from, tos] of Object.entries(edges)) {
        for (const to of tos) {
            (reverseEdges[to] ??= []).push(from);
        }
    }
    return {
        callersOf: (n: unknown): Iterable<unknown> => reverseEdges[n as string] ?? [],
        isEntry: (n: unknown): boolean => entries.has(n as string),
        frameFor: (n: unknown): Frame | null => framesByNode[n as string] ?? null,
    };
}

function findVuln(out: CallStacksOutput, id: string): VulnPaths | undefined {
    return out.find(v => "osv" in v.vulnerability ? v.vulnerability.osv?.id === id
                       : "npm" in v.vulnerability ? v.vulnerability.npm?.url === id
                       : false);
}

describe("serializeCallStacks", () => {
    it("returns an empty array when there are no matches", () => {
        const got = serializeCallStacks(new Map(), new Map(), emptyCallGraph);
        expect(got).toEqual([]);
    });

    it("emits a single-frame stack when the match site is itself an entry-point function", () => {
        const sinkFrame = frame("vulnpkg");
        const sink = sinkFrame; // node identity == frame in this synthetic test
        const vuln = {osv: {id: "GHSA-single"}};
        const callMap = new Map<unknown, Set<Vulnerability>>([[sink, new Set([vuln])]]);
        const cg = {
            callersOf: () => [],
            isEntry: () => true,
            frameFor: (n: unknown): Frame | null => n as Frame | null,
        };
        const got = serializeCallStacks(callMap, new Map(), cg);
        expect(got).toEqual([
            {
                vulnerability: vuln,
                paths: {
                    analysisLevel: "function-level",
                    stacks: [[sinkFrame]],
                },
            },
        ]);
    });
});

describe("serializeCallStacks reverse-BFS", () => {
    it("walks one caller hop to an entry function", () => {
        const cg = makeGraph(
            {entry: ["sink"]},          // entry calls sink
            new Set(["entry"]),
            {entry: frame("entry"), sink: frame("sink")},
        );
        const callMap = new Map<unknown, Set<Vulnerability>>([
            ["sink", new Set([{osv: {id: "GHSA-hop"}}])],
        ]);
        const got = serializeCallStacks(callMap, new Map(), cg);
        expect(got).toHaveLength(1);
        expect(got[0].paths.stacks).toEqual([[frame("entry"), frame("sink")]]);
        expect(got[0].paths.analysisLevel).toBe("function-level");
        expect(got[0].vulnerability).toEqual({osv: {id: "GHSA-hop"}});
    });

    it("emits both stacks when two distinct entry paths reach the same sink", () => {
        const cg = makeGraph(
            {a: ["sink"], b: ["sink"]},
            new Set(["a", "b"]),
            {a: frame("a"), b: frame("b"), sink: frame("sink")},
        );
        const callMap = new Map<unknown, Set<Vulnerability>>([
            ["sink", new Set([{osv: {id: "GHSA-two"}}])],
        ]);
        const got = serializeCallStacks(callMap, new Map(), cg);
        expect(got).toHaveLength(1);
        const stacks = got[0].paths.stacks;
        expect(stacks).toHaveLength(2);
        expect(stacks).toContainEqual([frame("a"), frame("sink")]);
        expect(stacks).toContainEqual([frame("b"), frame("sink")]);
    });

    it("breaks cycles in the caller graph", () => {
        // entry → mid → sink, plus mid → mid (self-loop)
        const cg = makeGraph(
            {entry: ["mid"], mid: ["sink", "mid"]},
            new Set(["entry"]),
            {entry: frame("entry"), mid: frame("mid"), sink: frame("sink")},
        );
        const callMap = new Map<unknown, Set<Vulnerability>>([
            ["sink", new Set([{osv: {id: "GHSA-cycle"}}])],
        ]);
        const got = serializeCallStacks(callMap, new Map(), cg);
        expect(got).toHaveLength(1);
        // Exactly one path: entry → mid → sink. The self-loop is broken.
        expect(got[0].paths.stacks).toEqual([[frame("entry"), frame("mid"), frame("sink")]]);
    });

    it("emits the partial path when caller cycle prevents reaching an entry", () => {
        // a ↔ b, no entry. Match at b. b's only caller is a; a's only caller
        // is b (already visited). Without the dead-end emit, the partial path
        // is silently dropped.
        const cg = makeGraph(
            {a: ["b"], b: ["a"]},
            new Set(),
            {a: frame("a"), b: frame("b")},
        );
        const callMap = new Map<unknown, Set<Vulnerability>>([
            ["b", new Set([{osv: {id: "GHSA-cycle-deadend"}}])],
        ]);
        const got = serializeCallStacks(callMap, new Map(), cg);
        expect(got).toHaveLength(1);
        expect(got[0].paths.stacks).toEqual([[frame("a"), frame("b")]]);
    });

    it("handles two distinct vuln ids at distinct match sites", () => {
        const cg = makeGraph(
            {entry: ["sinkA", "sinkB"]},
            new Set(["entry"]),
            {entry: frame("entry"), sinkA: frame("sinkA"), sinkB: frame("sinkB")},
        );
        const callMap = new Map<unknown, Set<Vulnerability>>([
            ["sinkA", new Set([{osv: {id: "GHSA-a"}}])],
            ["sinkB", new Set([{osv: {id: "GHSA-b"}}])],
        ]);
        const got = serializeCallStacks(callMap, new Map(), cg);
        expect(got).toHaveLength(2);
        const a = findVuln(got, "GHSA-a");
        const b = findVuln(got, "GHSA-b");
        expect(a?.paths.stacks).toEqual([[frame("entry"), frame("sinkA")]]);
        expect(b?.paths.stacks).toEqual([[frame("entry"), frame("sinkB")]]);
    });

    it("preserves npm.url discriminator when osv.id is missing", () => {
        const cg = makeGraph(
            {entry: ["sink"]},
            new Set(["entry"]),
            {entry: frame("entry"), sink: frame("sink")},
        );
        const npmVuln = {npm: {name: "foo", url: "https://github.com/advisories/GHSA-foo", range: "*"}};
        const callMap = new Map<unknown, Set<Vulnerability>>([
            ["sink", new Set([npmVuln])],
        ]);
        const got = serializeCallStacks(callMap, new Map(), cg);
        expect(got).toHaveLength(1);
        expect(got[0].vulnerability).toEqual(npmVuln);
    });

    it("deduplicates structurally identical stacks for the same vuln", () => {
        const cg = makeGraph(
            {entry: ["sink"]},
            new Set(["entry"]),
            {entry: frame("entry"), sink: frame("sink")},
        );
        const vuln = {osv: {id: "GHSA-dup"}};
        const callMap = new Map<unknown, Set<Vulnerability>>([
            ["sink", new Set([vuln, vuln])], // same vuln in the set twice — Sets dedupe naturally
        ]);
        const got = serializeCallStacks(callMap, new Map(), cg);
        expect(got).toHaveLength(1);
        expect(got[0].paths.stacks).toHaveLength(1);
    });

    it("omits vulns that have no paths from the output array", () => {
        // An empty match set produces no records — even though no path means
        // we don't emit a vuln entry. Submitted-but-unmatched ids are not
        // seeded.
        const got = serializeCallStacks(new Map(), new Map(), emptyCallGraph);
        expect(got).toEqual([]);
    });

    it("uses 0-indexed columns (does not add +1)", () => {
        // Adapter-level frames carry 0-indexed columns. The serializer
        // passes them through unchanged.
        const sinkFrame = frame("sink", 7, 4);
        const sink = sinkFrame;
        const callMap = new Map<unknown, Set<Vulnerability>>([
            [sink, new Set([{osv: {id: "GHSA-cols"}}])],
        ]);
        const cg = {
            callersOf: () => [],
            isEntry: () => true,
            frameFor: (n: unknown): Frame | null => n as Frame | null,
        };
        const got = serializeCallStacks(callMap, new Map(), cg);
        expect(got[0].paths.stacks[0][0].sourceLocation.start).toEqual({line: 7, column: 4});
    });
});

describe("serializeCallStacks caps", () => {
    it("exposes the documented default caps (5 / 5)", () => {
        expect(DEFAULT_MAX_PATHS_PER_SITE).toBe(5);
        expect(DEFAULT_MAX_SITES_PER_VULN).toBe(5);
    });

    it("maxPathsPerSite caps the number of paths emitted from one match site", () => {
        // 6 entries all directly call the sink — without a cap the BFS emits 6
        // distinct one-hop paths.
        const entries = new Set(["e1", "e2", "e3", "e4", "e5", "e6"]);
        const edges: Record<string, string[]> = {};
        const frames: Record<string, Frame> = {sink: frame("sink")};
        for (const e of entries) {
            edges[e] = ["sink"];
            frames[e] = frame(e);
        }
        const cg = makeGraph(edges, entries, frames);
        const callMap = new Map<unknown, Set<Vulnerability>>([
            ["sink", new Set([{osv: {id: "GHSA-cap"}}])],
        ]);

        // Default (5) caps the output to 5 paths.
        const defaultGot = serializeCallStacks(callMap, new Map(), cg);
        expect(defaultGot[0].paths.stacks).toHaveLength(5);

        // Explicit cap at 2 caps the output to 2 paths.
        const cappedGot = serializeCallStacks(callMap, new Map(), cg, {maxPathsPerSite: 2});
        expect(cappedGot[0].paths.stacks).toHaveLength(2);

        // High cap returns all 6.
        const allGot = serializeCallStacks(callMap, new Map(), cg, {maxPathsPerSite: 100});
        expect(allGot[0].paths.stacks).toHaveLength(6);
    });

    it("maxSitesPerVuln caps the number of match sites traversed per vuln", () => {
        // 6 distinct match sites all share the same vuln id; each has a
        // direct entry caller (so reverseBFS emits exactly 1 path per site).
        const sinks = ["s1", "s2", "s3", "s4", "s5", "s6"];
        const entries = new Set(sinks.map(s => `e_${s}`));
        const edges: Record<string, string[]> = {};
        const frames: Record<string, Frame> = {};
        for (const s of sinks) {
            edges[`e_${s}`] = [s];
            frames[s] = frame(s);
            frames[`e_${s}`] = frame(`e_${s}`);
        }
        const cg = makeGraph(edges, entries, frames);

        const sharedVuln = {osv: {id: "GHSA-many-sites"}};
        const callMap = new Map<unknown, Set<Vulnerability>>(
            sinks.map(s => [s as unknown, new Set([sharedVuln])]),
        );

        // Default (5) caps to 5 sites × 1 path each = 5 paths.
        const defaultGot = serializeCallStacks(callMap, new Map(), cg);
        expect(defaultGot[0].paths.stacks).toHaveLength(5);

        // Explicit cap at 2 caps to 2 sites × 1 path = 2 paths.
        const cappedGot = serializeCallStacks(callMap, new Map(), cg, {maxSitesPerVuln: 2});
        expect(cappedGot[0].paths.stacks).toHaveLength(2);

        // High cap returns all 6.
        const allGot = serializeCallStacks(callMap, new Map(), cg, {maxSitesPerVuln: 100});
        expect(allGot[0].paths.stacks).toHaveLength(6);
    });

    it("per-vuln site cap is shared across callMap and functionMap walks", () => {
        // Two sites, one in callMap, one in functionMap — both target the same
        // vuln. With maxSitesPerVuln: 1 only the first walk's site contributes.
        const cg = makeGraph(
            {entry: ["s_call", "s_func"]},
            new Set(["entry"]),
            {entry: frame("entry"), s_call: frame("s_call"), s_func: frame("s_func")},
        );
        const vuln = {osv: {id: "GHSA-shared"}};
        const callMap = new Map<unknown, Set<Vulnerability>>([["s_call", new Set([vuln])]]);
        const functionMap = new Map<unknown, Set<Vulnerability>>([["s_func", new Set([vuln])]]);

        const got = serializeCallStacks(callMap, functionMap, cg, {maxSitesPerVuln: 1});
        expect(got).toHaveLength(1);
        expect(got[0].paths.stacks).toHaveLength(1);
        // The first walk (callMap) should be the one that contributed.
        expect(got[0].paths.stacks[0][1].package).toBe("s_call");
    });

    it("treats two Vulnerability instances with the same id as one site", () => {
        // Two distinct Vulnerability objects (osv + npm) at one site
        // resolving to the same id must consume only one slot of
        // maxSitesPerVuln. Without dedup, the first site bumps sitesProcessed
        // by 2 and silences subsequent sites prematurely.
        const sinks = ["s1", "s2", "s3"];
        const entries = new Set(sinks.map(s => `e_${s}`));
        const edges: Record<string, string[]> = {};
        const frames: Record<string, Frame> = {};
        for (const s of sinks) {
            edges[`e_${s}`] = [s];
            frames[s] = frame(s);
            frames[`e_${s}`] = frame(`e_${s}`);
        }
        const cg = makeGraph(edges, entries, frames);

        const id = "GHSA-shared-id";
        const v1: Vulnerability = {osv: {id}};
        const v2: Vulnerability = {npm: {name: "x", url: id, range: "*"}};
        const callMap = new Map<unknown, Set<Vulnerability>>(
            sinks.map(s => [s as unknown, new Set([v1, v2])]),
        );

        // With maxSitesPerVuln: 2 we should still traverse 2 sites, not 1.
        const got = serializeCallStacks(callMap, new Map(), cg, {maxSitesPerVuln: 2});
        expect(got).toHaveLength(1);
        expect(got[0].paths.stacks).toHaveLength(2);
    });
});
