/*! DO NOT INSTRUMENT */

import {CodeSnippetLocation, SourceObject} from "../typings/jalangi";
import assert from "assert";
import path from "path";
import fs from "fs";
import {SourceMap, SourceMapping} from "node:module";

const SOURCE_FILE_MAP: Map<string, SourceMap> = new Map();

function locIsValid(src: SourceMapping) {
    assert(src, `startLoc is null`);
    assert(src.hasOwnProperty("originalLine"), `loc is null`);
    assert(src.hasOwnProperty("originalColumn"), `loc is null`);
}

/**
 * Map source memoryLocation in memory to original memoryLocation in disk source file.
 * @param sourceMap a source map object, line/column numbers are 0-indexed for function location is [start, end]
 * @param memoryLocation line/column numbers are 1-indexed and the range is [start, end] not [start, end)
 */
export function mapToOriginalLocation(sourceMap: SourceMap, memoryLocation: CodeSnippetLocation): CodeSnippetLocation {
    const startLoc = sourceMap.findEntry(memoryLocation.start.line - 1, memoryLocation.start.column - 1);
    // findEntry of Graaljs may produce invalid source memoryLocation so verify it.
    locIsValid(startLoc);
    // source mappings line numbers are starting from 0, so plus 1 line
    const startLine = startLoc.originalLine + 1;
    const startColumn = startLoc.originalColumn + 1;
    assert(!Number.isNaN(startLine), `startLoc is null`);
    assert(!Number.isNaN(startColumn), `startLoc is null`);
    // because in memory is [start, end) so for end column we have to +1 at first, so it is memoryLocation.end.column + 1 -1, which is memoryLocation.end.column
    const endLoc = sourceMap.findEntry(memoryLocation.end.line - 1, memoryLocation.end.column);
    locIsValid(endLoc);
    const endLine = endLoc.originalLine + 1;
    const endColumn = endLoc.originalColumn;
    assert(!Number.isNaN(endLine), `endLoc is null`);
    assert(!Number.isNaN(endColumn), `endLoc is null`);
    return {
        start: {
            line: startLine,
            column: startColumn
        },
        end: {
            line: endLine,
            column: endColumn
        }
    };
}

/**
 * Decode the sourceMappingURL in to SourceMap and record for the given file.
 */
export function decodeAndSetSourceMap(sourceCode: string, filename: string): boolean {
    const lines = sourceCode.split('\n');
    let match;
    // sourceMappingURL does not always stay in the end of the file.
    for (let i = lines.length - 10 < 0 ? 0 : lines.length - 10; i < lines.length; i++) {
        match = lines[i].match(/^\/\/# sourceMappingURL=data:application\/json;charset=utf-8;base64,(.*)$/);
        if (match)
            break;
    }
    if (!match)
        return false;
    const base64 = match[1];
    const json = Buffer.from(base64, 'base64').toString('utf8');
    const sourceMapping = JSON.parse(json);
    const decodedMappings = new SourceMap(sourceMapping);
    SOURCE_FILE_MAP.set(filename, decodedMappings);
    return true;
}

/**
 * map the source object to original source object, if source map is available.
 */
export function getSourceObject(compiledSourceObject: SourceObject): SourceObject {
    if (compiledSourceObject.loc.start.line < 0)
        return compiledSourceObject;
    let mappings = SOURCE_FILE_MAP.get(compiledSourceObject.name);
    if (!mappings)
        mappings = SOURCE_FILE_MAP.get(path.resolve(compiledSourceObject.name));
    if (mappings) {
        const loc = mapToOriginalLocation(mappings, compiledSourceObject.loc);
        // heuristics for `export function f(){}`, the extracted original source location starts at export keyword
        // but it should start at function to match the static
        if (loc.start.column === 1) {
            const contents = fs.readFileSync(compiledSourceObject.name, 'utf-8');
            const code = extractCodeSnippet(contents, loc);
            if (code.startsWith("export "))
                loc.start.column = 8;
        }
        compiledSourceObject.loc = loc
        return compiledSourceObject;
    } else
        return compiledSourceObject;
}

/**
 * Extracts the source code of the provided code in the given range.
 * @param code the entire code
 * @param loc the range to extract [fromLine(start with 1), toLine] [fromColumn(start with 1), toColumn]
 * @private
 * @return extracted code snippet.
 */
export function extractCodeSnippet(code: string, loc: CodeSnippetLocation): string {
    const lines = code.split("\n");
    const extractedLines = lines.slice(loc.start.line - 1, loc.end.line);
    if (loc.start.line === loc.end.line)
        return extractedLines[0].slice(loc.start.column - 1, loc.end.column);
    extractedLines[0] = extractedLines[0].slice(loc.start.column - 1);
    extractedLines[extractedLines.length - 1] = extractedLines[extractedLines.length - 1].slice(0, loc.end.column);
    return extractedLines.join("\n");
}
