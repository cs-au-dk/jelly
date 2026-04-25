import {serializeReachable} from "../../src/output/reachablefile";

describe("serializeReachable - packages", () => {
    it("emits empty arrays when nothing is reachable", () => {
        expect(serializeReachable([], [])).toEqual({packages: [], modules: []});
    });

    it("converts package-info records to {name, version?}", () => {
        const got = serializeReachable(
            [
                {name: "lodash", version: "4.17.21"},
                {name: "semver"}, // version missing is legal
                {name: "react-server-dom-webpack", version: "19.2.0"},
            ],
            [],
        );
        expect(got.packages).toEqual([
            {name: "lodash", version: "4.17.21"},
            {name: "semver"},
            {name: "react-server-dom-webpack", version: "19.2.0"},
        ]);
        expect(got.modules).toEqual([]);
    });

    it("deduplicates packages by (name, version)", () => {
        const got = serializeReachable(
            [
                {name: "lodash", version: "4.17.21"},
                {name: "lodash", version: "4.17.21"},
                {name: "lodash", version: "4.17.20"},
            ],
            [],
        );
        expect(got.packages).toEqual([
            {name: "lodash", version: "4.17.21"},
            {name: "lodash", version: "4.17.20"},
        ]);
    });

    it("omits version field when missing (not null, not empty string)", () => {
        const got = serializeReachable([{name: "pkg-without-version"}], []);
        expect(got.packages[0]).toEqual({name: "pkg-without-version"});
        expect("version" in got.packages[0]).toBe(false);
    });

    it("treats empty-string version as absent (dedup + omission)", () => {
        const got = serializeReachable(
            [
                {name: "x", version: ""},
                {name: "x"},
            ],
            [],
        );
        expect(got.packages).toHaveLength(1);
        expect("version" in got.packages[0]).toBe(false);
    });
});

describe("serializeReachable - modules", () => {
    it("emits resolved modules with their owning package", () => {
        const got = serializeReachable(
            [{name: "lodash", version: "4.17.21"}],
            [
                {moduleName: "lodash/cloneDeep", package: {name: "lodash", version: "4.17.21"}},
                {moduleName: "lodash/index", package: {name: "lodash", version: "4.17.21"}},
            ],
        );
        expect(got.modules).toEqual([
            {moduleName: "lodash/cloneDeep", package: {name: "lodash", version: "4.17.21"}},
            {moduleName: "lodash/index", package: {name: "lodash", version: "4.17.21"}},
        ]);
    });

    it("emits dummy modules without a package field", () => {
        const got = serializeReachable(
            [],
            [
                {moduleName: "fs"},                  // node builtin / unresolved
                {moduleName: "missing-package"},
            ],
        );
        expect(got.modules).toEqual([
            {moduleName: "fs"},
            {moduleName: "missing-package"},
        ]);
        // version-omission contract applies to both packages AND modules' nested package.
        expect("package" in got.modules[0]).toBe(false);
        expect("package" in got.modules[1]).toBe(false);
    });

    it("omits version on a module's nested package when absent", () => {
        const got = serializeReachable(
            [],
            [{moduleName: "x/y", package: {name: "x"}}],
        );
        expect(got.modules[0]).toEqual({moduleName: "x/y", package: {name: "x"}});
        expect("version" in got.modules[0].package!).toBe(false);
    });

    it("treats module-package empty-string version as absent", () => {
        const got = serializeReachable(
            [],
            [{moduleName: "x/y", package: {name: "x", version: ""}}],
        );
        expect("version" in got.modules[0].package!).toBe(false);
    });

    it("does not deduplicate modules — solver's map is already uniquely keyed", () => {
        const got = serializeReachable(
            [],
            [
                {moduleName: "lodash/cloneDeep", package: {name: "lodash", version: "4.17.21"}},
                {moduleName: "lodash/cloneDeep", package: {name: "lodash", version: "4.17.21"}},
            ],
        );
        // Both entries pass through; consumer is expected to receive a unique
        // module list from the caller.
        expect(got.modules).toHaveLength(2);
    });
});

describe("serializeReachable - shape contract", () => {
    it("always returns both keys, even when empty", () => {
        const got = serializeReachable([], []);
        expect(Object.keys(got).sort()).toEqual(["modules", "packages"]);
    });
});
