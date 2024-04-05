/** All statically resolvable require calls should be collected at the AST traversal and processed, regardless of
 * if the dynamic execution encounters it. */

function FuncWithUnreachableCode(x) {
    while (x.hasNext()) {
        // ...
    }

    // This require is unreachable due to the infinite while loop. Yet we should still see the effects of running the
    // top-level code of it.
    const req = require('foolib')

}