import fs from "fs";
import {execSync} from "child_process";
import path from "path";

/**
 * The git tag of the version to be installed.
 */
const tag = process.env.TAG;

/**
 * Location for previous version of Jelly.
 */
const jellyPrevious = `${__dirname}/../node_modules/jelly-previous`;

/**
 * Location for test packages.
 */
export const packagesDir = `${__dirname}/../../tmp/packages`;

// noinspection JSUnusedGlobalSymbols
/**
 * Install the tagged version of Jelly if tests/node_modules/jelly-previous doesn't exist:
 * * Git clone the tagged version of Jelly
 * * Rename the package name to jelly-previous
 * * Patch the files
 * * Install its dependencies
 * * Remove unnecessary files
 * Executed via globalSetup in jest.config.js.
 */
export default function() {
    // if previous version of Jelly exists, check if it is the correct version and overwrite the utils.ts
    if (!tag) {
        console.error("Environment variable TAG not set, aborting");
        process.exit(1);
    }
    const packageJsonFile = `${jellyPrevious}/package.json`;
    if (fs.existsSync(packageJsonFile)) {
        const packageJson = require(packageJsonFile);
        console.log(`Previous version '${packageJson.name}' exists`);
        if (packageJson.name === `jelly-${tag}`)
            return;
        console.log(`Tag does not match '${tag}'`)
        fs.rmSync(jellyPrevious, {recursive: true});
    }
    console.log(`Installing previous version '${tag}' of Jelly...`);
    fs.mkdirSync(jellyPrevious, {recursive: true});
    execSync(`git clone --depth=1 --single-branch --branch ${tag} $(git remote get-url origin) -c advice.detachedHead=false ${jellyPrevious}`);
    const packageJson = require(packageJsonFile);
    packageJson.name = `jelly-${tag}`;
    packageJson.version = tag;
    // patches
    fs.writeFileSync(packageJsonFile, JSON.stringify(packageJson, null, 2)); // patches package.json
    replaceInFolder('"diagnostics"', '"./typings/diagnostics.d"', jellyPrevious, true);
    // install dependencies
    execSync(`cd ${jellyPrevious} && npm install --force`);
    // clear unnecessary files
    fs.rmSync(`${jellyPrevious}/tests`, {recursive: true});
    fs.rmSync(`${jellyPrevious}/.idea`, {recursive: true});
    fs.rmSync(`${jellyPrevious}/.git`, {recursive: true});
    fs.rmSync(`${jellyPrevious}/bin`, {recursive: true});
    fs.rmSync(`${jellyPrevious}/.gitignore`, {force: true});
    fs.rmSync(`${jellyPrevious}/.gitattributes`, {force: true});
}

/**
 * Download the package and install its dependencies.
 * @param name package name
 * @param version package version
 */
export function preparePackage(name: string, version: string) {
    const pkgNameNoDir = name.replace('/', '-').replace("@", "");
    const packageDir = `${packagesDir}/${pkgNameNoDir}`;
    const versionDir = `${packageDir}/${version}`;

    // Step 1, downloading
    if (fs.existsSync(packageDir))
        return;
    fs.mkdirSync(packageDir, {recursive: true});
    if (!fs.existsSync(`${versionDir}/package.json`)) {
        if (fs.existsSync(versionDir))
            fs.rmSync(versionDir, {recursive: true});
        const downloadCmd = `cd ${packageDir} && npm pack ${name}@${version}`;
        execSync(downloadCmd);
        fs.mkdirSync(versionDir, {recursive: true});
        const tarCmd = `cd ${packageDir} && tar -zxvf ${pkgNameNoDir}-${version}.tgz -C ${versionDir} && rm -rf ${pkgNameNoDir}-${version}.tgz`;
        execSync(tarCmd);
        const mvCmd = `cd ${versionDir}/* && mv * ../ && rm -rf ${versionDir}/package`;
        execSync(mvCmd);
    }

    // Step 2, npm install
    if (!fs.existsSync(`${versionDir}/node_modules`)) {
        const npmInstall = `cd ${versionDir} && npm install --ignore-scripts --force`;
        execSync(npmInstall);
    }
}

/**
 * Replace string to another string in file.
 * @param searchValue
 * @param replaceValue
 * @param filePath
 */
function replaceInFile(searchValue: string | RegExp, replaceValue: string, filePath: string) {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const newContent = fileContent.replace(searchValue, replaceValue);
    fs.writeFileSync(filePath, newContent, 'utf8');
}

/**
 * Replace *.d.ts import string, from "x" to "./typings/x.d.ts", including sub-folders.
 * @param replacePath if a replaceValue is a path, the value would be prefixed with "../" if replace happened in the sub-folder.
 */
function replaceInFolder(searchValue: string | RegExp, replaceValue: string, folderPath: string, replacePath: boolean = false): void {
    const fileNames = fs.readdirSync(folderPath);

    fileNames.forEach((fileName) => {
        const filePath = path.join(folderPath, fileName);
        const stats = fs.statSync(filePath);

        if (stats.isDirectory() && !fileName.startsWith(".")) {
            replaceInFolder(searchValue, replacePath ? '"../' + replaceValue.substring(1) : replaceValue, filePath, replacePath);
        } else if (stats.isFile()) {
            replaceInFile(searchValue, replaceValue, filePath);
        }
    });
}