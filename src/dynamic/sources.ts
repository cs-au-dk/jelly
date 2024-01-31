/**
 * Packages that are typically used for tests only and should be excluded in the collected call graphs.
 */
const TEST_PACKAGES = [
    "ava", "uvu", "yarn", "karma", "mocha", "jasmine", "tap", "tape", "@babel", "@jest",
    "nyc", "c8",
    "chai", "expect", "should", "supertest",
    "@sinonjs", "sinon", "nock",
]; // TODO: other test packages?


// jest and istanbul use helper packages, for instance jest-mock.
// (?:-[^/]+)? optionally matches a dash followed by non-slash characters.
const testRegexp = new RegExp(`\\bnode_modules/(?:${TEST_PACKAGES.join("|")}|(?:jest|istanbul)(?:-[^/]+)?)/`);

/**
 * Tests whether the path points to a file inside a test package.
 */
export function isPathInTestPackage(path: string): boolean {
    return testRegexp.test(path);
}

/**
 * Tests whether the difference between two source files is the addition of a
 * "header" on the first line that shifts the first line of the disk source some
 * columns to the right. Trailing characters after the disk source are allowed.
 * This kind of difference will not impact source locations on subsequent lines.
 */
export function isSourceSimplyWrapped(diskSource: string, observedSource: string): boolean {
    // TODO: if source map support is implemented, we can easily return a fake source map here
    const i = observedSource.indexOf(diskSource);
    if (i === -1) return false;

    const newlinePos = observedSource.indexOf("\n");
    return (newlinePos === -1 || i <= newlinePos);
}
