module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    maxWorkers: 1,
    setupFilesAfterEnv: ["jest-expect-message"],
    coverageProvider: "v8",
    coverageDirectory: "tmp/coverage",
    roots: ["tests"],
    testMatch: ["**/*.test.ts"]
};
