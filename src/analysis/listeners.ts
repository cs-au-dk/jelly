/**
 * IDs for token listeners.
 */
export enum TokenListener {
    CALL_BASE, // base at method call
    CALL_METHOD, // callee at method call
    CALL_FUNCTION, // callee at (non-method) function call
    CALL_REQUIRE, // callee at 'require' call (direct calls only)
    CALL_EXTERNAL, // argument at call to external function
    READ_BASE, // base at property read (static)
    READ_BASE_DYNAMIC, // base at property read (dynamic)
    READ_GETTER, // getter at property read
    READ_GETTER2, // getter at property read (for PackageObjectTokens)
    READ_GETTER_THIS, // getter at property read
    READ_GETTER_THIS2, // getter at property read (for PackageObjectTokens)
    WRITE_BASE, // base at property write (static)
    WRITE_BASE_DYNAMIC, // base at property write (dynamic)
    WRITE_SETTER, // setter at property write
    WRITE_SETTER_THIS, // setter at property write
    WRITE_OBJECT_PATTERN_REST, // assignment at object pattern
    WRITE_OBJECT_PATTERN_REST_PROPERTIES, // assignment at object pattern
    WRITE_ARRAY_PATTERN_REST, // assignment at array pattern
    WRITE_ARRAY_PATTERN_REST_ARRAY, // assignment at array pattern
    WRITE_REQUIRE_EXTENSIONS,
    IMPORT_BASE,
    EXPORT_BASE,
    ANCESTORS,
    READ_ANCESTORS,
    WRITE_ANCESTORS,
    PACKAGE_NEIGHBORS,
    CLASS_FIELD,
    EXTENDS,
    READ_ITERATOR_VALUE,
    OBJECT_SPREAD,
    CALL_PROMISE_EXECUTOR,
    CALL_PROMISE_RESOLVE,
    CALL_PROMISE_ONFULFILLED,
    CALL_PROMISE_ONREJECTED,
    CALL_PROMISE_ONFINALLY,
    MAKE_PROMISE_RESOLVE,
    MAKE_PROMISE_REJECT,
    MAKE_PROMISE_ALL,
    MAKE_PROMISE_ALLSETTLED,
    MAKE_PROMISE_ANY,
    MAKE_PROMISE_RACE,
    AWAIT,
    JSX_ELEMENT,
    NATIVE_INVOKE_CALLBACK,
    NATIVE_INVOKE_CALLBACK2,
    NATIVE_INVOKE_CALL_APPLY2,
    NATIVE_INVOKE_CALL_APPLY3,
    NATIVE_ASSIGN_PROPERTIES,
    NATIVE_ASSIGN_PROPERTIES2,
    NATIVE_ASSIGN_PROPERTIES3,
    NATIVE_OBJECT_CREATE,
    NATIVE_OBJECT_DEFINE_PROPERTY,
    NATIVE_OBJECT_DEFINE_PROPERTIES,
    NATIVE_ASSIGN_ITERATOR_MAP_VALUE_PAIRS,
    NATIVE_ASSIGN_BASE_ARRAY_ARRAY_VALUE_TO_ARRAY,
    NATIVE_RETURN_PROTOTYPE_OF,
    NATIVE_SET_PROTOTYPE_OF,
}
