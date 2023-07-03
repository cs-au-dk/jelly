import assert from "assert";
import {getOrSet} from "./util";

/**
 * Nuutila and Soisalon-Soininen's strongly connected components algorithm.
 * @param nodes nodes that must be visited (not necessarily all nodes in the graph!)
 * @param succ successors for each node (undefined represents empty)
 * @returns [SCC representatives in reverse topological order, map from all visited nodes to their representatives]
 */
export function nuutila<NodeType>(nodes: Iterable<NodeType>, succ: (n: NodeType) => Iterable<NodeType> | undefined): [Array<NodeType>, Map<NodeType, NodeType>] {
    const d: Map<NodeType, number> = new Map; // visit order
    const r: Map<NodeType, NodeType> = new Map; // map from nodes to their representatives
    const c: Set<NodeType> = new Set; // nodes in known components
    const s: Array<NodeType> = []; // nodes in cycle but not yet inserted in c
    const t: Array<NodeType> = []; // representatives, in topological order
    let i = 1; // next visit order index
    for (const v of nodes)
        if (!d.has(v))
            visit(v);
    return [t, r];

    function visit(v: NodeType) {
        d.set(v, i++);
        r.set(v, v);
        const ws = succ(v);
        if (ws)
            for (const w of ws) {
                if (!d.has(w))
                    visit(w); // TODO: implement without recursion?
                if (!c.has(w)) {
                    const rv = r.get(v);
                    assert(rv);
                    const rw = r.get(w);
                    assert(rw);
                    const drv = d.get(rv);
                    assert(drv);
                    const drw = d.get(rw);
                    assert(drw);
                    r.set(v, drv < drw ? rv : rw);
                }
            }
        if (r.get(v) === v) {
            c.add(v);
            while (s.length > 0) {
                const w = s[s.length - 1];
                const dv = d.get(v);
                assert(dv);
                const dw = d.get(w);
                assert(dw);
                if (dw <= dv)
                    break;
                s.pop();
                c.add(w);
                r.set(w, v);
            }
            t.push(v);
        } else
            s.push(v);
    }
}

/**
 * Post-processing to extract the components, returned in reverse topological order.
 */
export function getComponents<NodeType>([t, r]: [Array<NodeType>, Map<NodeType, NodeType>]): Array<Array<NodeType>> {
    const m: Map<NodeType, Array<NodeType>> = new Map;
    for (const [v, w] of r.entries())
        getOrSet(m, w, () => []).push(v);
    const sccs = [];
    for (const v of t) {
        const c = m.get(v);
        assert(c);
        sccs.push(c);
    }
    return sccs;
}
