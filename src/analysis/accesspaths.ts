import {DummyModuleInfo, ModuleInfo} from "./infos";
import {ConstraintVar} from "./constraintvars";

/**
 * Access paths used for describing package/module interfaces.
 */
export abstract class AccessPath {

    private readonly str: string;

    protected constructor(str: string) {
        this.str = str;
    }

    toString(): string {
        return this.str;
    }
}

/**
 * Access path that represents module.exports values (for exports interfaces) or require("...") values (for imports interfaces).
 */
export class ModuleAccessPath extends AccessPath {

    readonly moduleInfo: ModuleInfo | DummyModuleInfo;

    readonly requireName: string | undefined;

    constructor(moduleInfo: ModuleInfo | DummyModuleInfo, requireName: string) {
        const t = !"./#".includes(requireName[0]) && requireName !== moduleInfo.getOfficialName() ? requireName : undefined; // only use require name if not relative and different from official name
        super(`<${moduleInfo.getOfficialName()}${moduleInfo instanceof ModuleInfo ? `@${moduleInfo.packageInfo.version}` : ''}${t ? `(${t})` : ""}>`);
        this.moduleInfo = moduleInfo;
        this.requireName = t;
    }
}

/**
 * Access path that represents an object property.
 */
export class PropertyAccessPath extends AccessPath {

    readonly base: ConstraintVar;

    readonly prop: string;

    constructor(base: ConstraintVar, prop: string) {
        super(`${base}.${prop}`);
        this.base = base;
        this.prop = prop;
    }
}

/**
 * Access path that represents the result of a function call (possibly with 'new').
 */
export class CallResultAccessPath extends AccessPath {

    readonly caller: ConstraintVar;

    constructor(caller: ConstraintVar) {
        super(`${caller}()`);
        this.caller = caller;
    }
}

/**
 * Access path that represents the result of a JSX component instantiation.
 */
export class ComponentAccessPath extends AccessPath {

    readonly component: ConstraintVar;

    constructor(component: ConstraintVar) {
        super(`${component}<>`);
        this.component = component;
    }
}

/**
 * Access path that represents values from ignored modules.
 */
export class IgnoredAccessPath extends AccessPath {

    static instance = new IgnoredAccessPath();

    constructor() {
        super("Ignored");
    }
}

/**
 * Access path that represents unknown values.
 */
export class UnknownAccessPath extends AccessPath {

    static instance = new UnknownAccessPath();

    constructor() {
        super("Unknown");
    }
}
