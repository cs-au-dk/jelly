const handler: ProxyHandler<any> = {

    get(target: any, p: string | symbol, receiver: any): any {
        switch (p) {
            case "length":
                if (receiver === theArgumentsProxy)
                    return 10; // number of mock arguments provided at forced execution of functions
                else
                    return 1; // value for other array lengths
            case Symbol.toPrimitive:
                return function(hint: "number" | "string" | "default"): number | string {
                    switch (hint) {
                        case "number":
                            return 0;
                        case "string":
                            return "";
                        case "default":
                            return "0"; // TODO: appropriate value?
                    }
                };
            case Symbol.iterator:
                return function() {
                    let index = 0;
                    return {
                        next: () => {
                            if (index++ < 3)
                                return {value: theProxy, done: false};
                            else
                                return {value: undefined, done: true};
                        }
                    };
                };
            // TODO: other standard symbols that should be modeled? see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol
            default:
                const desc = Object.getOwnPropertyDescriptor(target, p);
                if (desc && !desc.configurable && !desc.writable) // non-writable, non-configurable properties must return target value
                    return target[p];
                return theProxy;
        }
    },

    set(): boolean {
        return false; // if returning true, some native functions get stuck in proxy loop
    },

    has(): boolean {
        return true;
    },

    apply(): any {
        return theProxy;
    },

    construct(): any {
        return theProxy;
    },

    defineProperty(): boolean {
        return false;
    },

    deleteProperty(): boolean {
        return true;
    },

    getOwnPropertyDescriptor(target: any, property: any): PropertyDescriptor {
        if (property === "prototype")
            return Object.getOwnPropertyDescriptor(target, property)!;
        return {
            configurable: true,
            enumerable: true,
            value: theProxy,
            writable: true
        };
    },

    isExtensible(): boolean {
        return true;
    },

    setPrototypeOf(): boolean {
        return false;
    }
};

export const theProxy = new Proxy(function theProxy() {}, handler);

export const theArgumentsProxy = new Proxy([], handler);

export function makeBaseProxy(target: any): any {
    if (!target || !(typeof target === "object" || typeof target === "function"))
        return theProxy;
    return new Proxy(target, {

        get(target: any, prop: any, receiver: any): any {
            if (prop in target)
                return Reflect.get(target, prop, receiver);
            else {
                const desc = Object.getOwnPropertyDescriptor(target, prop);
                if (desc && !desc.configurable && !desc.writable) // non-writable, non-configurable properties must return target value
                    return target[prop];
                return theProxy;
            }
        },

        has(_target: any, _prop: any): boolean {
            return true;
        }
    });
}

export function isProxy(x: any): boolean {
    return x === theProxy || x === theArgumentsProxy;
}

export function stdlibProxy(obj: any): any {
    return new Proxy(obj, {
        get: function(target: any, prop: string): any {
            const desc = Object.getOwnPropertyDescriptor(target, prop);
            if (desc && !desc.configurable && !desc.writable) // non-writable, non-configurable properties must return target value
                return target[prop];
            if (typeof desc?.value === "function")
                return theProxy;
            return desc?.value;
        }
    });
}

export function makeModuleProxy(target: any): any {
    return new Proxy(target, {
        get(target: any, prop: any, _receiver: any): any {
            return prop === "constructor" ? theProxy : target[prop];
        }
    });
}