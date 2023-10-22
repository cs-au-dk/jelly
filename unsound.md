# Known sources of unsoundness

- dynamic property read/write (warnings)
  - MemberExpression, OptionalMemberExpression
  - ObjectProperty, ObjectMethod, ClassProperty, ClassMethod, ClassPrivateMethod, ClassAccessorProperty, ClassPrivateProperty

- dynamic require/import


- prototype inheritance, super, extends (partly modeled...)


- ECMAScript standard library
  - Function.prototype.{apply,call,bind} (partly modeled...)
  - Object.{defineProperty, defineProperties, ...} (partly modeled...)
  - Promise
    - thenables (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise#thenables)
    - 'throw' in promise handlers converting exceptions to rejections, rejected promises at 'await' converting rejections to exceptions
    - AggregateError in Promises.any
  - Array:
    - 'from' with multiple arguments (mapFn and thisArg ignored)
    - 'flat' with unknown depth (recursive flattening ignored)
    - 'flatMap' (return value ignored)
  - Symbol
  - Proxy, Reflect, ...
 

- Node.js standard library (callbacks, events)


- BindExpression (nonstandard)


- SpreadElement (warnings)


- ExportNamespaceSpecifier, ImportAttribute (warnings)


- CatchClause (ObjectTokens are widened at ThrowStatement but other tokens are ignored)


- assignment to 'arguments[...]' and arguments.callee (see arguments.js)
- user-defined iterators (standard iterators are supported)
- symbols (incl. "well-known symbols" like [Symbol.iterator] used for iterables)
- events
