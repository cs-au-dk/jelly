import {DummyModuleInfo, ModuleInfo} from "./infos";
import {ConstraintVar} from "./constraintvars";

/**
 * Access paths used for describing package/module interfaces.
 */
export abstract class AccessPath {

    protected constructor(private readonly str: string) {}

    toString(): string {
        return this.str;
    }
}

/**
 * Access path that represents module.exports values (for exports interfaces) or require("...") values (for imports interfaces).
 */
export class ModuleAccessPath extends AccessPath {

    readonly requireName: string | undefined;

    constructor(
        readonly moduleInfo: ModuleInfo | DummyModuleInfo,
        requireName: string
    ) {
        const t = !"./#".includes(requireName[0]) && requireName !== moduleInfo.getOfficialName() ? requireName : undefined; // only use require name if not relative and different from official name
        super(`<${moduleInfo.getOfficialName()}${moduleInfo instanceof ModuleInfo ? `@${moduleInfo.packageInfo.version}` : ''}${t ? `(${t})` : ""}>`);
        this.requireName = t;
    }
}

/**
 * Access path that represents an object property.
 */
export class PropertyAccessPath extends AccessPath {

    constructor(
        readonly base: ConstraintVar,
        readonly prop: string
    ) {
        super(`${base}.${prop}`);
    }
}

/**
 * Access path that represents the result of a function call (possibly with 'new').
 */
export class CallResultAccessPath extends AccessPath {

    constructor(readonly caller: ConstraintVar) {
        super(`${caller}()`);
    }
}

/**
 * Access path that represents the result of a JSX component instantiation.
 */
export class ComponentAccessPath extends AccessPath {

    constructor(readonly component: ConstraintVar) {
        super(`${component}<>`);
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
