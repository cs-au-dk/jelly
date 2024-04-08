import * as ts from 'typescript';
import {SymbolFlags, TypeFlags} from 'typescript';
import logger, {writeStdOutIfActive} from "../misc/logger";
import {
    FilePath,
    Location,
    LocationJSON,
    mapArrayAdd,
    SourceLocationsToJSON,
    locationToStringWithFileAndEnd,
    SimpleLocation
} from "../misc/util";
import {dirname, resolve} from "path";
import Timer, {nanoToMs} from "../misc/timer";
import {Type} from "../patternmatching/patterns";
import {existsSync, readFileSync} from "fs";
import {options} from "../options";

/**
 * Map from package name to locations of TypeScript AST nodes with a type from that package.
 */
export type LibraryUsage = Map<string, Array<[SimpleLocation & {filename: string}, ts.Type]>>;

export type LibraryUsageJSON = {
    files: Array<FilePath>,
    packages: Record<string, Array<[LocationJSON, string]>>
};

/**
 * Infers types using TypeScript.
 */
export class TypeScriptTypeInferrer {

    readonly program: ts.Program;

    readonly checker: ts.TypeChecker;

    readonly files = new Map<FilePath, ts.SourceFile>();

    readonly timer = new Timer(); // TODO: include time for calls to getTypeAtLocation and getLibraryUsage?

    /**
     * Parses and infers types for the given files (and reachable files).
     */
    constructor(files: Array<string>) {
        writeStdOutIfActive("Parsing as TypeScript...");
        logger.info("Parsing as TypeScript");
        const tsconfig = ts.findConfigFile(options.basedir, ts.sys.fileExists);
        const inside = tsconfig && tsconfig.startsWith(options.basedir);
        if (tsconfig && inside)
            logger.verbose(`Using ${tsconfig}`);
        this.program = tsconfig && inside ? this.createProgram(tsconfig) :
            ts.createProgram(files.map(f => resolve(options.basedir, f)), { // TODO: use typeAcquisition?
                target: ts.ScriptTarget.ES5,
                module: ts.ModuleKind.CommonJS,
                allowJs: true,
                checkJs: true
            });
        this.checker = this.program.getTypeChecker();
        if (logger.isDebugEnabled())
            logger.debug("Parsed files (excluding declaration files):");
        for (const file of this.program.getSourceFiles())
            if (!file.isDeclarationFile) {
                this.files.set(file.fileName, file);
                logger.debug(file.fileName);
            }
        logger.info(`TypeScript parsing time: ${nanoToMs(this.timer.elapsed())}, files: ${this.program.getSourceFiles().length}`);
    }

    private createProgram(tsconfigPath: string): ts.Program {
        const tsConfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
        const configHostParser: ts.ParseConfigHost = {
            fileExists: existsSync,
            readDirectory: ts.sys.readDirectory,
            readFile: file => readFileSync(file, 'utf8'),
            useCaseSensitiveFileNames: process.platform === 'linux'
        };
        const tsConfigParsed = ts.parseJsonConfigFileContent(tsConfig.config, configHostParser, resolve(dirname(tsconfigPath)), {noEmit: true});
        const compilerHost = ts.createCompilerHost(tsConfigParsed.options, true);
        // TODO: set default typeRoots to options.basedir?
        return ts.createProgram(tsConfigParsed.fileNames, tsConfigParsed.options, compilerHost);
    }

    /**
     * Returns the TypeScript type for the given TypeScript node, or undefined if not found.
     */
    getTypeAtTSNode(node: ts.Node, loc: SimpleLocation | string): ts.Type | undefined {
        try {
            return this.checker.getTypeAtLocation(node);
        } catch (e) {
            logger.error(`TypeScript internal error while querying type at ${typeof loc === "string" ? loc : locationToStringWithFileAndEnd(loc)}: ${e}`);
            return undefined;
        }
    }

    /**
     * Returns the TypeScript type for the given location (with filename), or undefined if not found.
     */
    getType(loc: Location | SimpleLocation): ts.Type | undefined {
        const file = "module" in loc && this.files.get(loc.module!.getPath());
        if (!file)
            return undefined;
        try {
            const start = file.getPositionOfLineAndCharacter(loc.start.line - 1, loc.start.column);
            const end = file.getPositionOfLineAndCharacter(loc.end.line - 1, loc.end.column);
            let node: ts.Node = (ts as any).getTokenAtPosition(file, start);
            while (node && node.end < end)
                node = node.parent;
            if (!node)
                return undefined;
            const posLineChar = file.getLineAndCharacterOfPosition(node.getStart());
            const endLineChar = file.getLineAndCharacterOfPosition(node.getEnd());
            if (logger.isVerboseEnabled() &&
                posLineChar.line + 1 !== loc.start.line ||
                posLineChar.character !== loc.start.column ||
                endLineChar.line + 1 !== loc.end.line ||
                endLineChar.character !== loc.end.column)
                logger.verbose(`TypeScript AST node misaligned: ${file.fileName}:${posLineChar.line + 1}:${posLineChar.character + 1}:${endLineChar.line + 1}:${endLineChar.character + 1}, expected ${locationToStringWithFileAndEnd(loc)}`); // FIXME: no longer relevant?
            const type = this.getTypeAtTSNode(node, loc);
            if (logger.isDebugEnabled())
                logger.debug(`TypeScript type at ${locationToStringWithFileAndEnd(loc)}: ${type ? this.checker.typeToString(type) : "???"}`);
            return type;
        } catch {
            return undefined;
        }
    }

    /**
     * Converts a TypeScript type to a pattern type, or returns undefined if unable.
     */
    convertType(type: ts.Type | undefined): Type | undefined {
        if (!type)
            return undefined;
        if (type.flags & TypeFlags.Any && !(type.symbol && type.symbol.flags & SymbolFlags.Transient)) // transient represents unresolved types
            return Type.makeSimpleType("any");
        if (type.flags & (TypeFlags.String | TypeFlags.TemplateLiteral))
            return Type.makeSimpleType("string");
        if (type.flags & TypeFlags.Number)
            return Type.makeSimpleType("number");
        if (type.flags & TypeFlags.Boolean)
            return Type.makeSimpleType("boolean");
        if (type.flags & TypeFlags.Undefined)
            return Type.makeSimpleType("undefined");
        if (type.flags & TypeFlags.Null)
            return Type.makeSimpleType("null");
        if (type.flags & (TypeFlags.StringLiteral | TypeFlags.NumberLiteral))
            return Type.makeValueType((type as any).value);
        if (type.flags & TypeFlags.BooleanLiteral) {
            const intrinsicName = (type as any).intrinsicName;
            if (intrinsicName === "true")
                return Type.makeValueType(true);
            if (intrinsicName === "false")
                return Type.makeValueType(false);
        }
        if (type.flags & TypeFlags.Object && type.symbol) {
            if (type.symbol.escapedName === "Array")
                return Type.makeSimpleType("array"); // TODO: detect empty-array?
            if (type.symbol.escapedName === "__object")
                return Type.makeSimpleType("object");
            if (type.symbol.flags & (SymbolFlags.Function | SymbolFlags.Method))
                return Type.makeSimpleType("function", undefined); // TODO: detect function arity
            if (type.symbol.flags & (SymbolFlags.Interface | SymbolFlags.Class | SymbolFlags.RegularEnum))
                return Type.makeTSType(type.symbol.escapedName as string);
        }
        if (type.aliasSymbol)
            return Type.makeTSType(type.aliasSymbol.escapedName as string);
        // TODO: TypeFlags.Union, TypeFlags.Intersection ... ?
        return undefined;
    }

    /**
     * Returns a library usage map.
     */
    getLibraryUsage(): LibraryUsage {
        const res: LibraryUsage = new Map();
        const program = this.program;
        const checker = this.checker;
        for (const file of this.files.values()) {
            function visit(node: ts.Node) {
                function getLoc(start: ts.LineAndCharacter, end: ts.LineAndCharacter): string {
                    return `${file.fileName}:${start.line + 1}:${start.character + 1}:${end.line + 1}:${end.character + 1}`;
                }
                function visitType(type: ts.Type) {
                    if (type.isUnionOrIntersection()) { // FIXME: how to handle union/intersection types properly? other relevant kinds of composite types?
                        for (const t of type.types)
                            visitType(t);
                    } else if (!(type.flags & TypeFlags.Any)) {
                        const declFile = type.symbol?.getDeclarations()?.[0]?.getSourceFile().fileName;
                        if (declFile) {
                            const packageFile = (program as any).sourceFileToPackageName.get(declFile) as string;
                            if (packageFile) {
                                const i1 = packageFile.indexOf("/");
                                const i2 = packageFile.startsWith("@") ? packageFile.indexOf("/", i1 + 1) : i1;
                                const packageName = packageFile.substring(0, i2);
                                const start = file.getLineAndCharacterOfPosition(node.getStart());
                                const end = file.getLineAndCharacterOfPosition(node.getEnd());
                                mapArrayAdd(packageName, [{
                                        filename: file.fileName,
                                        start: {line: start.line + 1, column: start.character},
                                        end: {line: end.line + 1, column: end.character}
                                    },
                                        type],
                                    res);
                                if (logger.isVerboseEnabled())
                                    logger.verbose(`${getLoc(start, end)}: ${checker.typeToString(type)} in ${packageName}, type.flags=${type.flags}, type.symbol.flags=${type.symbol?.flags}`);
                                return;
                            }
                        }
                        // XXX
                        // if (logger.isVerboseEnabled()) {
                        //     const start = file.getLineAndCharacterOfPosition(node.getStart());
                        //     const end = file.getLineAndCharacterOfPosition(node.getEnd());
                        //     logger.info(`No library usage found at ${getLoc(start, end)}: ${checker.typeToString(type)}, type.flags=${type.flags}, type.symbol.flags=${type.symbol?.flags}`);
                        // }
                    }
                }
                try {
                    visitType(checker.getTypeAtLocation(node));
                } catch (e) {
                    logger.warn(`TypeScript internal error while querying type: ${e}`);
                    //console.error(e); // XXX
                }
                ts.forEachChild(node, visit);
            }
            ts.forEachChild(file, visit);
        }
        return res;
    }

    libraryUsageToJSON(u: LibraryUsage): LibraryUsageJSON {
        const res: LibraryUsageJSON = {files: [], packages: {}};
        const locs = new SourceLocationsToJSON(res.files);
        for (const [p, as] of u) {
            const bs: Array<[LocationJSON, string]> = [];
            for (const [loc, type] of as)
                bs.push([locs.makeLocString(loc), this.checker.typeToString(type)]);
            res.packages[p] = bs;
        }
        return res;
    }
}
