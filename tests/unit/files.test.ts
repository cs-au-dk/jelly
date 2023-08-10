import {Node} from "@babel/types";
import {FragmentState} from "../../src/analysis/fragmentstate";
import {GlobalState} from "../../src/analysis/globalstate";
import {requireResolve} from "../../src/misc/files";
import {vol, NestedDirectoryJSON} from "memfs";
import {options, resetOptions} from "../../src/options";
import {FilePath} from "../../src/misc/util";
import path from "path";

// replace fs module with in-memory filesystem
jest.mock("fs", () => jest.requireActual("memfs").fs);

const f = new FragmentState(new GlobalState());

describe("tests/unit/files/requireResolve", () => {
	const basedir = "/jellytest";

	beforeAll(() => resetOptions());

	beforeEach(() => {
		options.basedir = basedir;
		vol.reset();
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
			expected: `${basedir}/hello.js`,
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
			expected: `${basedir}/dir/index.js`,
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
			expected: `${basedir}/dir/main.js`,
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
			expected: `${basedir}/dir/main.js`,
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
			expected: `${basedir}/node_modules/dir/exported.js`,
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
			expected: `${basedir}/file.js`,
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
			expected: `${basedir}/lib.ts`,
		},
		{
			name: "ts/cjs/relative/missing",
			vol: tsProjectCJS,
			requireStr: "./lib2",
			fromFile: "index.ts",
		},
		{
			// with moduleResolution: "nodenext", a file extension is required when the file compiles to an ES module
			name: "ts/esm/relative/no extension",
			vol: tsProjectESM,
			requireStr: "./lib",
			fromFile: "index.ts",
		},
		{
			name: "ts/esm/relative/missing",
			vol: tsProjectESM,
			requireStr: "./lib2.ts",
			fromFile: "index.ts",
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
			expected: `${basedir}/lib.ts`,
		},
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
			// expected: `${basedir}/matcher.cjs`,
		},
	];

	const bugs: testdata[] = [
		{
			// not critical, as we don't care about JSON files, but
			// a lot of errors are reported due to this issue
			name: "json without extension",
			vol: { "./package.json": "[]" },
			requireStr: "./package",
			fromFile: "hello.js",
			expected: `${basedir}/node_modules/package.json`,
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
							"main": "./moment.js",
							"typesVersions": {
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
			expected: `${basedir}/node_modules/moment/moment.js`,
		},
		{
			// this is not super common, but NodeJS resolves files with unknown
			// file extensions as JavaScript files, whereas the TypeScript
			// compiler refuses to resolve them
			name: "custom extension",
			vol: { "./javascript.cool": "console.log('hi');" },
			requireStr: "./javascript.cool",
			fromFile: "index.js",
			expected: `${basedir}/javascript.cool`,
		},
		{
			// tsconfig.json specifies module: "commonjs", which makes moduleResolution: "node"
			// the extension of the importing file (.mts) should not be taken into account in this case
			// therefore no extension should be required to import the library
			name: "ts/cjs/mts/relative",
			vol: tsProjectCJS,
			requireStr: "./lib",
			fromFile: "index.mts",
			expected: `${basedir}/lib.ts`,
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
			expected: `${basedir}/lib.ts`,
		},
		{
			// tsResolveModuleName strips the required .ts suffix
			name: "ts/esm/relative",
			vol: tsProjectESM,
			requireStr: "./lib.ts",
			fromFile: "index.ts",
			expected: `${basedir}/lib.ts`,
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
			expected: `${basedir}/a/module_a.ts`,
		},
		// TODO: tssconfig.json with custom baseURL
	];

	test.each(tests)("$name", testRequireResolve);
	test.failing.each(bugs)("bug: $name", testRequireResolve);

	function testRequireResolve(data: testdata) {
		// set up virtual filesystem
		vol.fromNestedJSON(data.vol, basedir);

		const from = path.resolve(basedir, data.fromFile);
		const resolve = () => requireResolve(data.requireStr, from, {} as Node, f);
		if ("expected" in data)
			expect(resolve()).toBe(data.expected);
		else
			expect(resolve).toThrow();
	}
});
