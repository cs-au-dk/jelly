/**
 * Packages that are typically used for tests only and should be excluded in the collected call graphs.
 */
const TEST_PACKAGES = [
    "ava", "yarn", "karma", "mocha", "jasmine", "tap", "tape", "@babel", "@jest",
    "nyc", "c8",
    "chai", "expect", "should", "supertest",
    "sinon", "nock",
]; // TODO: other test packages?


// jest and istanbul use helper packages, for instance jest-mock.
// (?:-[^/]+)? optionally matches a dash followed by non-slash characters.
const testRegexp = new RegExp(`\\bnode_modules/(?:${TEST_PACKAGES.join('|')}|(?:jest|istanbul)(?:-[^/]+)?)/`);

/**
 * Tests whether the path points to a file inside a test package.
 */
export function isPathInTestPackage(path: string): boolean {
    return testRegexp.test(path);
}
