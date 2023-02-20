import {CallGraph} from "callgraph";
import assert from "assert";

/**
 * Merges multiple call graphs into one by deduplicating and suitably modifying entry IDs.
 */
export function merge(callgraphs: Array<CallGraph>): CallGraph {
  const result: CallGraph = {
    entries: [],
    files: [],
    functions: [],
    calls: [],
    fun2fun: [],
    call2fun: [],
    ignore: []
  }

  for (const cg of callgraphs) {

    if (cg.entries)
      for (const entry of cg.entries)
        if (result.entries?.indexOf(entry) == -1)
          result.entries.push(entry);

    const fileMap = new Map<number, number>(); // original ID to result ID
    if (cg.files) {
      for (let originalId = 0; originalId < cg.files.length; originalId++) {
        const file = cg.files[originalId];
        assert.ok(file);
        let resultId = result.files?.indexOf(file);
        if (resultId === -1) {
          resultId = result.files.length;
          result.files.push(file);
        }
        assert.equal(result.files[resultId], file);
        fileMap.set(originalId, resultId);
      }
    }

    const functionsMap = new Map<number, number>();
    if (cg.functions) {
      for (let originalIdStr of Object.keys(cg.functions)) {
        let originalId = parseInt(originalIdStr);
        const fn = cg.functions[originalId];
        assert.ok(fn);
        let resultId = (result.functions as Array<string>).indexOf(fn);
        if (resultId === -1) {
          resultId = (result.functions as Array<string>).length;
          (result.functions as Array<string>).push(fn);
        }
        assert.equal(result.functions[resultId], fn);
        functionsMap.set(originalId, resultId);
      }
    }

    const callsMap = new Map<number, number>();
    if (cg.calls) {
      for (let originalIdStr of Object.keys(cg.calls)) {
        let originalId = parseInt(originalIdStr);
        const call = cg.calls[originalId];
        let resultId = (result.calls as Array<string>).indexOf(call);
        if (resultId == -1) {
          resultId = (result.calls as Array<string>).length;
          (result.calls as Array<string>).push(call);
        }
        callsMap.set(originalId, resultId);
      }
    }

    if (cg.fun2fun)
      for (let [u, v] of cg.fun2fun)
        if (functionsMap.has(u) && functionsMap.has(v)) {
          const [w, x] = [functionsMap.get(u)!, functionsMap.get(v)!];
          result.fun2fun.push([w, x]);
        }

    if (cg.call2fun)
      for (let [u, v] of cg.call2fun)
        if (callsMap.has(u) && functionsMap.has(v)) {
          const [w, x] = [callsMap.get(u)!, functionsMap.get(v)!];
          result.call2fun.push([w, x]);
        }

    if (cg.ignore)
      for (const ignoreLoc of cg.ignore)
        if (result.ignore?.indexOf(ignoreLoc) == -1)
          result.ignore.push(ignoreLoc);
  }

  return result;
}