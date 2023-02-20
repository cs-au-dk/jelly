// Exporting individual features
export let name1, name2, nameN; // also var, const
export let name11 = 1, name12 = 2, name1N; // also var, const

export function functionName(){}

export class ClassName {}

var name31, name32, name3N, variable1, variable2, name4N;

// Export list
export { name31, name32, name3N };

// Renaming exports
export { variable1 as name41, variable2 as name42, name4N };
//// writing to exports.name1 = name1, exportsname42 = variable2, etc.

// Exporting destructured assignments with renaming
export const { name51, name52: bar } = o;
export const [ name61, name62 ] = array;
///// handled by existing desugaring

// Default exports
//export default expression;
//export default function () { } // also class, function*
//export default function name71() { } // also class, function*
//export { name1 as default};
////////// writing to exports.default = expression, etc.

// Aggregating modules
export * from "foo"; // does not set the default export
////// imports "foo", then copies all properties with Object.key, forEach, defineProperty!!!

//export * as name81 from "foo"; // ECMAScript® 2O20
export { name91, name92, name9N } from "foo";
//// imports "foo", exports its name91 property, etc.
export { import1 as name01, import2 as name02, name0N } from "foo";
export { default } from "foo";
/// imports "foo", exports its default propert