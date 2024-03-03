import {CallGraph} from "../typings/callgraph";
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
  };

  type Edge = [number, number];
  const fun2fun = new Map<string, Edge>();
  const call2fun = new Map<string, Edge>();

  for (const cg of callgraphs) {
    if (cg.entries)
      for (const entry of cg.entries)
        if (result.entries?.indexOf(entry) === -1)
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

    const translate = (loc: string) => {
      const i = loc.indexOf(":");
      assert.notEqual(i, -1);
      const originalFileId = parseInt(loc.substring(0, i));
      const newFileId = fileMap.get(originalFileId);
      assert.notEqual(newFileId, undefined);
      return String(newFileId) + loc.substring(i);
    };

    const functionsMap = new Map<number, number>();
    if (cg.functions) {
      for (const originalIdStr of Object.keys(cg.functions)) {
        const originalId = parseInt(originalIdStr);
        let fn = cg.functions[originalId];
        assert.ok(fn);
        fn = translate(fn);
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
      for (const originalIdStr of Object.keys(cg.calls)) {
        const originalId = parseInt(originalIdStr);
        const call = translate(cg.calls[originalId]);
        let resultId = (result.calls as Array<string>).indexOf(call);
        if (resultId === -1) {
          resultId = (result.calls as Array<string>).length;
          (result.calls as Array<string>).push(call);
        }
        callsMap.set(originalId, resultId);
      }
    }

    if (cg.fun2fun)
      for (const [u, v] of cg.fun2fun)
        if (functionsMap.has(u) && functionsMap.has(v)) {
          const e: Edge = [functionsMap.get(u)!, functionsMap.get(v)!];
          fun2fun.set(e.join(","), e);
        }

    if (cg.call2fun)
      for (const [u, v] of cg.call2fun)
        if (callsMap.has(u) && functionsMap.has(v)) {
          const e: Edge = [callsMap.get(u)!, functionsMap.get(v)!];
          call2fun.set(e.join(","), e);
        }

    if (cg.ignore)
      for (const ignoreLoc of cg.ignore.map(translate))
        if (result.ignore?.indexOf(ignoreLoc) == -1)
          result.ignore.push(ignoreLoc);
  }

  result.fun2fun = Array.from(fun2fun.values());
  result.call2fun = Array.from(call2fun.values());

  const firstTime = callgraphs[0]?.time;
  if (firstTime !== undefined)
    result.time = firstTime;

  return result;
}
