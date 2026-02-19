import {CallExpression, Identifier, NewExpression, OptionalCallExpression} from "@babel/types";
import Solver from "../analysis/solver";
import {NativeObjectToken} from "../analysis/tokens";
import {ModuleInfo} from "../analysis/infos";
import {ecmascriptModels} from "./ecmascript";
import {NodePath} from "@babel/traverse";
import {nodejsModels} from "./nodejs";
import {options} from "../options";
import logger from "../misc/logger";
import {Operations} from "../analysis/operations";
import {ObjectPropertyVarObj} from "../analysis/constraintvars";

export type CallNodePath = NodePath<CallExpression | OptionalCallExpression | NewExpression>;

export type NativeGlobalModelParams = {
    solver: Solver,
    globalSpecialNatives: SpecialNativeObjects
};

export type NativeModelParams = NativeGlobalModelParams & {
    moduleInfo: ModuleInfo,
    moduleSpecialNatives: SpecialNativeObjects,
};

export type NativeFunctionParams = NativeModelParams & {
    base: ObjectPropertyVarObj | undefined,
    op: Operations,
    path: CallNodePath,
    callArgs?: CallExpression["arguments"], // when set, overrides path.node.arguments (used by call/apply on native functions)
};

export type NativeFunctionAnalyzer = (p: NativeFunctionParams) => void;

export type NativeModelInitializer = (p: NativeModelParams) => void;

export type NativeVariableInitializer = (p: NativeGlobalModelParams) => NativeObjectToken;

export type NativeModel = {
    name: string,
    init?: NativeModelInitializer,
    variables?: Array<NativeVariableModel>,
    params?: Array<NativeVariableModel>,
    functions: Array<NativeFunctionModel>,
    classes: Array<NativeClassModel>
}

export type NativeVariableModel = {
    name: string,
    init?: NativeVariableInitializer
};

export type NativeFunctionModel = {
    name: string,
    invoke?: NativeFunctionAnalyzer
};

export type NativeFieldModel = {
    name: string
};

export type NativeClassModel = {
    name: string,
    hidden?: boolean,
    invoke?: NativeFunctionAnalyzer,
    fields?: Array<NativeFieldModel>, // TODO: NativeObjectModel.fields is current unused
    staticMethods?: Array<NativeFunctionModel>,
    methods?: Array<NativeFunctionModel>
};

export type SpecialNativeObjects = Record<string, NativeObjectToken>;

/**
 * Prepares models for the ECMAScript and Node.js native declarations.
 * Returns the tokens for special global native objects.
 */
export function buildGlobalNatives(solver: Solver): SpecialNativeObjects {
    const globalSpecialNatives: SpecialNativeObjects = {};
    const f = solver.fragmentState;
    const a = solver.globalState;
    solver.phase = "Initializing";

    const models = [ecmascriptModels, nodejsModels];
    for (const m of models) {

        /**
         * Adds an identifier to the global scope.
         * @param name identifier name
         * @param invoke optional model of calls if a function
         * @param constr if true, the function is a constructor (default: false)
         * @param hidden if true, the identifier is not added to globals
         * @param init if provided, execute this initializer instead of using a fresh NativeObjectToken
         */
        function defineGlobal(name: string, invoke?: NativeFunctionAnalyzer, constr: boolean = false, hidden: boolean = false, init?: NativeVariableInitializer) {
            if (options.natives || m.name === "ecmascript" || (m.name === "nodejs" && ["exports", "module"].includes(name))) {
                const t = init
                    ? init({solver, globalSpecialNatives})
                    : a.canonicalizeToken(new NativeObjectToken(name, undefined, invoke, constr));
                globalSpecialNatives[name] = t;
                if (!hidden)
                    solver.addTokenConstraint(t, f.varProducer.objPropVar(globalSpecialNatives["globalThis"], name));
            }
        }

        /**
         * Adds a global function.
         */
        function defineGlobalFunction(name: string, invoke: NativeFunctionAnalyzer | undefined, constr: boolean = false, hidden: boolean = false) {
            defineGlobal(name, invoke, constr, hidden);
        }

        /**
         * Adds a prototype object for a class.
         */
        function definePrototypeObject(name: string): NativeObjectToken {
            const t = a.canonicalizeToken(new NativeObjectToken(`${name}.prototype`));
            if (m.name === "ecmascript")
                globalSpecialNatives[t.name] = t;
            if (options.natives || m.name === "ecmascript")
                solver.addTokenConstraint(t, f.varProducer.objPropVar(globalSpecialNatives[name], "prototype"));
            return t;
        }

        /**
         * Adds a field to an object.
         */
        function defineField(x: NativeClassModel, nf: NativeFieldModel) {
            // TODO: defineField (ignored for now...)
        }

        /**
         * Adds a static method to an object.
         */
        function defineStaticMethod(x: NativeClassModel, nf: NativeFunctionModel) {
            if (options.natives) {
                const t = a.canonicalizeToken(new NativeObjectToken(`${x.name}.${nf.name}`, undefined, nf.invoke));
                if (m.name === "ecmascript")
                    globalSpecialNatives[t.name] = t;
                solver.addTokenConstraint(t, f.varProducer.objPropVar(globalSpecialNatives[x.name], nf.name));
            }
        }

        /**
         * Adds a (non-static) method to an object.
         */
        function defineMethod(x: NativeClassModel, nf: NativeFunctionModel, pro: NativeObjectToken) {
            if (options.natives) {
                const t = a.canonicalizeToken(new NativeObjectToken(`${x.name}.prototype.${nf.name}`, undefined, nf.invoke));
                if (m.name === "ecmascript")
                    globalSpecialNatives[t.name] = t;
                solver.addTokenConstraint(t, f.varProducer.objPropVar(pro, nf.name));
            }
        }

        if (logger.isVerboseEnabled())
            logger.verbose(`Adding ${m.name}`);

        // global variables
        if (m.variables)
            for (const v of m.variables)
                defineGlobal(v.name, undefined, undefined, undefined, v.init);

        // global functions
        for (const f of m.functions)
            defineGlobalFunction(f.name, f.invoke);

        // global classes
        for (const x of m.classes) {
            defineGlobalFunction(x.name, x.invoke, true, x.hidden);
            const pro = definePrototypeObject(x.name);

            // fields
            if (x.fields)
                for (const v of x.fields)
                    defineField(x, v);

            // static methods
            if (x.staticMethods)
                for (const f of x.staticMethods)
                    defineStaticMethod(x, f);

            // non-static methods
            if (x.methods)
                for (const f of x.methods)
                    defineMethod(x, f, pro);
        }
    }

    return globalSpecialNatives;
}

/**
 * Prepares module-specific models for the Node.js native declarations.
 * Returns the tokens for special module-specific native objects.
 */
export function buildModuleNatives(solver: Solver, moduleInfo: ModuleInfo, moduleParams: Map<string, Identifier>): SpecialNativeObjects {
    const moduleSpecialNatives: SpecialNativeObjects = {};
    const f = solver.fragmentState;
    const a = solver.globalState;
    const globalSpecialNatives = a.globalSpecialNatives!;

    const models = [ecmascriptModels, nodejsModels];
    for (const m of models) {

        /**
         * Adds an identifier to the global scope.
         * @param name identifier name
         * @param init if provided, execute this initializer instead of using a fresh NativeObjectToken
         */
        function defineGlobal(name: string, init?: NativeVariableInitializer) {
            if (options.natives || m.name === "ecmascript" || (m.name === "nodejs" && ["exports", "module"].includes(name))) {
                const t = init
                    ? init({solver, globalSpecialNatives})
                    : a.canonicalizeToken(new NativeObjectToken(name, moduleInfo));
                moduleSpecialNatives[name] = t;
                solver.addTokenConstraint(t, f.varProducer.nodeVar(moduleParams.get(name)!));
            }
        }

        // implicit parameters
        if (m.params)
            for (const v of m.params)
                defineGlobal(v.name, v.init);
    }

    // specialized initialization
    for (const m of models)
        if (m.init) {
            if (logger.isVerboseEnabled())
                logger.verbose(`Running initialization for ${m.name}`);
            m.init({solver, moduleInfo, moduleSpecialNatives, globalSpecialNatives});
        }

    return moduleSpecialNatives;
}
