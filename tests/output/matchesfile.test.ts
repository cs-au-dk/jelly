import {serializeMatches} from "../../src/output/matchesfile";

describe("serializeMatches", () => {
    it("flattens an empty match set to an empty object", () => {
        const got = serializeMatches(new Map(), new Map());
        expect(got).toEqual({});
    });

    it("emits file:l:c:l:c strings per vuln id", () => {
        // Synthetic input: one vuln "GHSA-x" matched at one location.
        const node = {
            loc: {
                filename: "app.js",
                start: { line: 12, column: 0 },  // 0-indexed input → 1-indexed output
                end:   { line: 12, column: 26 },
            },
        } as const;
        const vuln = { osv: { id: "GHSA-x" } };
        const callMap = new Map([[node, new Set([vuln])]]);
        const got = serializeMatches(new Map(), callMap);
        expect(got).toEqual({ "GHSA-x": ["app.js:12:1:12:27"] });
    });

    it("accumulates multiple locations for the same vuln", () => {
        const nodeA = {
            loc: { filename: "a.js", start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
        };
        const nodeB = {
            loc: { filename: "b.js", start: { line: 2, column: 10 }, end: { line: 2, column: 20 } },
        };
        const vuln = { osv: { id: "GHSA-y" } };
        const callMap = new Map([
            [nodeA, new Set([vuln])],
            [nodeB, new Set([vuln])],
        ]);
        const got = serializeMatches(new Map(), callMap);
        expect(got["GHSA-y"]).toHaveLength(2);
        expect(got["GHSA-y"]).toContain("a.js:1:1:1:6");
        expect(got["GHSA-y"]).toContain("b.js:2:11:2:21");
    });

    it("preserves empty arrays for submitted-but-unmatched vuln ids", () => {
        // The `submittedIds` parameter causes serializeMatches to seed empty
        // arrays for every submitted id. Key-presence in the output is
        // therefore always meaningful to downstream consumers: an empty array
        // means "analyzed, no matches"; an absent key means "never submitted".
        const out = serializeMatches(new Map(), new Map(), ["GHSA-not-matched"]);
        expect(out).toEqual({ "GHSA-not-matched": [] });
    });

    it("skips nodes with loc: null or loc: undefined", () => {
        const nullNode = { loc: null };
        const undefNode = { loc: undefined };
        const vuln = { osv: { id: "GHSA-skipped" } };
        const callMap = new Map<any, Set<any>>([
            [nullNode, new Set([vuln])],
            [undefNode, new Set([vuln])],
        ]);
        const got = serializeMatches(new Map(), callMap);
        expect(got).toEqual({});
    });

    it("falls back to npm.url when osv.id is missing", () => {
        const node = {
            loc: { filename: "x.js", start: { line: 1, column: 0 }, end: { line: 1, column: 4 } },
        };
        const vuln = { npm: { name: "x", url: "https://github.com/advisories/GHSA-nnnn-nnnn-nnnn", range: "*" } };
        const callMap = new Map<any, Set<any>>([[node, new Set([vuln])]]);
        const got = serializeMatches(new Map(), callMap);
        expect(got).toEqual({
            "https://github.com/advisories/GHSA-nnnn-nnnn-nnnn": ["x.js:1:1:1:5"],
        });
    });
});
