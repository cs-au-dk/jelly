import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

import {Node} from "@babel/types";
import {requireResolve} from "../../src/misc/files";
import {options, resetOptions} from "../../src/options";
import {FilePath} from "../../src/misc/util";
import logger from "../../src/misc/logger";
import {realpathSync} from "fs";
import Solver from "../../src/analysis/solver";

describe("tests/unit/files/requireResolve", () => {
	interface NestedDirectoryJSON {
		[key: string]: NestedDirectoryJSON | string;
	}

	beforeAll(() => {
		resetOptions()
		logger.transports[0].level = options.loglevel = "error";
	});

	interface testdata {
		name: string,
		vol: NestedDirectoryJSON,
		requireStr: string,
		fromFile: FilePath,
		expected?: string,
	}

	const tsProjectCJS: NestedDirectoryJSON = {
		"./package.json": JSON.stringify({ name: "ts-project" }),
		"./tsconfig.json": JSON.stringify({
			compilerOptions: { module: "commonjs" },
		}),
		"./index.ts": "export * from './lib';",
		"./lib.ts": "export const numberRegexp = /^[0-9]+$/;",
	};
	const tsProjectESM = {
		...tsProjectCJS,
		"./package.json": JSON.stringify({
			name: "ts-project",
			type: "module",
		}),
		"./tsconfig.json": JSON.stringify({
			compilerOptions: { module: "nodenext" },
		}),
	};

	const tests: testdata[] = [
		{
			name: "relative/self",
			vol: { "./hello.js": "world" },
			requireStr: "./hello.js",
			fromFile: `hello.js`,
			expected: "hello.js",
		},
		{
			name: "relative/self/missing",
			vol: {},
			requireStr: "./hello.js",
			fromFile: `hello.js`,
		},
		{
			name: "relative/dir/index.js",
			vol: {
				"./dir": { "index.js": "" },
			},
			requireStr: "./dir",
			fromFile: "hello.js",
			expected: "dir/index.js",
		},
		{
			name: "relative/dir/main",
			vol: {
				"./dir": {
					"./package.json": JSON.stringify({ main: "./main.js" }),
					"./main.js": "",
				},
			},
			requireStr: "./dir",
			fromFile: "hello.js",
			expected: "dir/main.js",
		},
		{
			name: "relative/dir/exports",
			vol: {
				"./dir": {
					"./package.json": JSON.stringify({
						main: "./main.js",
						exports: "./exported.js",
					}),
					"./main.js": "",
					"./exported.js": "",
				},
			},
			requireStr: "./dir",
			fromFile: "hello.js",
			// this is a bit unintuitive, but the exports field is unused for relative imports
			expected: "dir/main.js",
		},
		{
			name: "node_modules/dir/exports",
			vol: {
				"./node_modules": {
					"./dir": {
						"./package.json": JSON.stringify({
							main: "./main.js",
							exports: "./exported.js",
						}),
						"./main.js": "",
						"./exported.js": "",
					},
				},
			},
			requireStr: "dir",
			fromFile: "hello.js",
			expected: "node_modules/dir/exported.js",
		},
		{
			name: "self-reference",
			vol: {
				"./package.json": JSON.stringify({
					name: "self",
					exports: "./file.js",
				}),
				"./file.js": "hello",
			},
			requireStr: "self",
			fromFile: "index.js",
			expected: "file.js",
		},
		{
			name: "self-reference/invalid",
			vol: {
				"./package.json": JSON.stringify({
					name: "self",
					exports: "./file.js",
				}),
				"./file.js": "hello",
				"./file2.js": "world",
			},
			requireStr: "self/file2.js",
			fromFile: "index.js",
		},
		{
			name: "ts/cjs/relative",
			vol: tsProjectCJS,
			requireStr: "./lib",
			fromFile: "index.ts",
			expected: "lib.ts",
		},
		{
			name: "ts/cjs/relative/missing",
			vol: tsProjectCJS,
			requireStr: "./lib2",
			fromFile: "index.ts",
		},
		{
			// tsconfig.json specifies module: "commonjs", which makes moduleResolution: "node"
			// the extension of the importing file (.mts) should not be taken into account in this case
			// therefore no extension should be required to import the library
			name: "ts/cjs/mts/relative",
			vol: tsProjectCJS,
			requireStr: "./lib",
			fromFile: "index.mts",
			expected: "lib.ts",
		},
		{
			// this is similar
			name: "ts/esm/esnext with node resolution",
			vol: {
				...tsProjectESM,
				"./tsconfig.json": JSON.stringify({
					compilerOptions: {
						module: "esnext",
						moduleResolution: "node",
					},
				}),
			},
			requireStr: "./lib",
			fromFile: "index.ts",
			expected: "lib.ts",
		},
		{
			name: "ts/cjs/esnext with node resolution",
			vol: {
				...tsProjectCJS,
				"./tsconfig.json": JSON.stringify({
					compilerOptions: {
						module: "esnext",
						moduleResolution: "node",
					},
				}),
			},
			requireStr: "./lib",
			fromFile: "index.ts",
			expected: "lib.ts",
		},
		{
			name: "ts/esm/relative",
			vol: tsProjectESM,
			requireStr: "./lib.ts",
			fromFile: "index.ts",
			expected: "lib.ts",
		},
		{
			name: "ts/esm/relative/missing",
			vol: tsProjectESM,
			requireStr: "./lib2.ts",
			fromFile: "index.ts",
		},
		{
			// the TypeScript compiler respects the package.json field 'typesVersions',
			// which is typically used to specify a directory for declaration files
			// this causes issues, as resolution does not fall back after failing to find
			// the required file in the directory specified in 'typesVersions'
			// this bug affects imports of the 'moment' package
			name: "typesVersions",
			vol: {
				"./node_modules": {
					"./moment": {
						"./package.json": JSON.stringify({
							main: "./moment.js",
							typesVersions: {
								">=3.1": {
									"*": [
										"ts3.1-typings/*"
									]
								}
							},
						}),
						"./ts3.1-typings": { "./moment.d.ts": "" },
						"./moment.js": "hello",
					},
				},
			},
			requireStr: "moment",
			fromFile: "index.js",
			expected: "node_modules/moment/moment.js",
		},
		{
			name: "typesVersions2",
			vol: {
				"./node_modules": {
					"./fast-check": {
						"./package.json": JSON.stringify({
							name: "fast-check",
							version: "1.26.0",
							main: "lib/fast-check.js",
							module: "lib/esm/fast-check.js",
							types: "lib/types/fast-check.d.ts",
							typesVersions: {
								">=3.2": {
									"*": ["lib/ts3.2/fast-check.d.ts"],
								},
							},
						}),
						"./lib": {
							"./fast-check.js": "",
							"./esm": { "./fast-check.js": "" },
							"./types": { "./fast-check.d.ts": "" },
							"./ts3.2": { "./fast-check.d.ts": "" },
						},
					},
				},
				"./package.json": "{}",
			},
			requireStr: "fast-check",
			fromFile: "index.js",
			expected: "node_modules/fast-check/lib/fast-check.js",
		},
		{
			// relative paths should be resolved against all rootDirs
			name: "ts/cjs/rootDirs",
			vol: {
				...tsProjectCJS,
				"./tsconfig.json": JSON.stringify({
					compilerOptions: {
						module: "commonjs",
						rootDirs: ["./a", "./b"],
					},
				}),
				"./a": { "./module_a.ts": "" },
				"./b": { "./module_b.ts": "" },
			},
			requireStr: "./module_a",
			fromFile: "b/module_b.ts",
			expected: "a/module_a.ts",
		},
		{
			name: "ts/cjs/baseUrl",
			vol: {
				...tsProjectCJS,
				"./tsconfig.json": JSON.stringify({
					compilerOptions: {
						module: "commonjs",
						baseUrl: "./",
					},
				}),
			},
			requireStr: "lib",
			fromFile: "index.ts",
			expected: "lib.ts",
		},
		{
			name: "ts/cjs/paths",
			vol: {
				...tsProjectCJS,
				"./tsconfig.json": JSON.stringify({
					compilerOptions: {
						module: "commonjs",
						paths: {
							"lib": ["./libs/lib.ts"],
						},
					},
				}),
				"./libs": { "./lib.ts": "export const numberRegexp = /^[0-9]+$/;" },
			},
			requireStr: "lib",
			fromFile: "index.ts",
			expected: "libs/lib.ts",
		},
		{
			// not critical, as we don't care about JSON files, but
			// it's nice to avoid reporting errors
			name: "json without extension",
			vol: { "./package.json": "[]" },
			requireStr: "./package",
			fromFile: "hello.js",
			expected: undefined,
		},
		{
			// this is not super common, but NodeJS resolves files with unknown
			// file extensions as JavaScript files, whereas the TypeScript
			// compiler refuses to resolve them
			name: "custom extension",
			vol: { "./javascript.cool": "console.log('hi');" },
			requireStr: "./javascript.cool",
			fromFile: "index.js",
			// TODO: do we want to try to parse these files as JavaScript instead of discarding them?
			// expected: "javascript.cool",
			expected: undefined,
		},
		{
			name: "tsconfig.json shouldn't apply to dependencies",
			vol: {
				"./node_modules": {
					"./some-lib": {
						"./package.json": JSON.stringify({
							name: "some-lib",
							dependencies: { jquery: "*" },
						}),
						"./index.js": "require('jquery');",
					},
					"./jquery": {
						"./package.json": JSON.stringify({ name: "jquery" }),
						"./index.js": "module.exports = 'hi';",
					},
				},
				"./tsconfig.json": JSON.stringify({
					compilerOptions: {
						paths: {
							jquery: ["./jquery/oops.js"],
						},
					},
				}),
				"./jquery": { "./oops.js": "" },
			},
			requireStr: "jquery",
			fromFile: "node_modules/some-lib/index.js",
			expected: "node_modules/jquery/index.js",
		},
	];

	const bugs: testdata[] = [
		{
			name: "esm/relative/conditional exports/no extension",
			vol: {
				"./package.json": JSON.stringify({
					type: "module",
					exports: {
						".": "./index.js",
						"./matcher": {
							"require": "./matcher.cjs",
							"default": "./matcher.mjs",
						},
					},
				}),
				"./matcher.cjs": "",
				"./matcher.mjs": "",
			},
			requireStr: "./matcher",
			fromFile: "index.js",
			// ESM relative imports require a file extension, but some projects rely on "incorrect"
			// behaviour in bundlers & test runners that naively transform the imports into 'require'
			// it is not obvious whether we want to support this, and whether the .cjs or .mjs file
			// should be expected in this case
			// expected: "matcher.cjs",
		},
		{
			// with moduleResolution: "nodenext", a file extension is required when the file compiles to an ES module
			name: "ts/esm/relative/no extension",
			vol: tsProjectESM,
			requireStr: "./lib",
			fromFile: "index.ts",
		},
	];

	test.each(tests)("$name", testRequireResolve);
	test.failing.each(bugs)("bug: $name", testRequireResolve);

	async function testRequireResolve(data: testdata) {
		// set up temporary filesystem
		const basedir = options.basedir = await setUpTmpDir(data.vol);

		try {
			const from = path.resolve(basedir, data.fromFile);
			const solver = new Solver();
			const resolve = () => requireResolve(data.requireStr, from, solver.globalState, {} as Node, solver.fragmentState);
			if ("expected" in data)
				expect(resolve()).toBe(data.expected && path.resolve(basedir, data.expected));
			else
				expect(resolve).toThrow();
		} finally {
			await fs.rm(basedir, { recursive: true });
		}
	}

	async function setUpTmpDir(vol: NestedDirectoryJSON): Promise<string> {
		const basedir = await fs.mkdtemp(path.join(os.tmpdir(), "jelly-test-files-"));

		async function f(cpath: string, dir: NestedDirectoryJSON) {
			for (const [name, content] of Object.entries(dir)) {
				const subpath = path.join(cpath, name);
				if (typeof content === "string")
					await fs.writeFile(subpath, content)
				else {
					await fs.mkdir(subpath);
					await f(subpath, content);
				}
			}
		}

		await f(basedir, vol);

		return realpathSync(basedir);
	}
});
