import assert from "assert";
import {pushAll} from "./util";

export type Node = {
    edges: Array<Edge>
}

export type Edge = {
    from?: Node,
    to: Node,
    weight: number
}

export type Graph = {
    nodes: Array<Node>
}

export type Path = {
    totalCost: number,
    edges: Array<Readonly<Required<Edge>>>
}

/**
 * Yen's algorithm for finding K shortest paths in a directed graph with weighted edges.
 * Based on https://github.com/tomer953/k-shortest-path/blob/master/index.js.
 * @param g graph
 * @param source source node
 * @param target target node
 * @param K the desired number of paths
 * @return array of length at most K containing the paths
 */
export function yen(g: Graph, source: Node, target: Node, K: number): Array<Path> {
    const ksp: Array<Path> = [];
    const candidates: Array<Required<Path>> = [];
    let kthPath = getShortestPath(g, source, target);
    if (!kthPath)
        return ksp;
    ksp.push(kthPath);
    for (let k = 1; k < K; k++) {
        const previousPath = ksp[k - 1];
        for (let i = 0; i < previousPath.edges.length; i++) {
            const removed = new Set<Edge | Node>();
            const spurNode = previousPath.edges[i].from;
            const rootPath = clonePathTo(previousPath, i);
            for (const p of ksp)
                if (isPathEqual(rootPath, clonePathTo(p, i)))
                    removed.add(p.edges[i]);
            for (const rootPathEdge of rootPath.edges) {
                const rn = rootPathEdge.from;
                if (rn !== spurNode)
                    removed.add(rn);
            }
            const spurPath = getShortestPath(g, spurNode, target, removed);
            if (spurPath !== undefined) {
                const totalPath = clonePath(rootPath);
                pushAll(spurPath.edges, totalPath.edges);
                totalPath.totalCost += spurPath.totalCost;
                if (!isPathExistInArray(candidates, totalPath))
                    candidates.push(totalPath);
            }
        }
        let isNewPath: boolean;
        do {
            kthPath = removeBestCandidate(candidates);
            isNewPath = true;
            if (kthPath !== undefined)
                for (const p of ksp)
                    if (isPathEqual(p, kthPath)) { // XXX: necessary?
                        isNewPath = false;
                        break;
                    }
        } while (!isNewPath);
        if (kthPath === undefined)
            break;
        ksp.push(kthPath);
    }
    return ksp;
}

function getShortestPath(g: Graph, source: Node, target: Node, removed?: Set<Edge | Node>): Path | undefined {
    const {distance, back} = dijkstra(g, source, removed);
    if (distance.get(target)! === Number.POSITIVE_INFINITY)
        return undefined;
    const edges: Array<Readonly<Required<Edge>>> = [];
    let currentNode: Node = target;
    while (currentNode !== source) {
        const b = back.get(currentNode);
        assert(b !== undefined && b.from !== undefined);
        edges.push(b as Required<Edge>);
        currentNode = b.from;
    }
    return {
        totalCost: distance.get(target)!,
        edges: edges.reverse()
    };
}

function clonePathTo(path: Path, i: number): Path {
    const newPath: Path = {totalCost: 0, edges: []};
    const len = path.edges.length;
    if (i > len)
        i = len;
    for (let j = 0; j < i; j++) {
        const edge = path.edges[j];
        newPath.edges.push(edge);
        newPath.totalCost += edge.weight;
    }
    return newPath;
}

function isPathEqual(path1: Path, path2: Path): boolean {
    if (path1.edges.length !== path2.edges.length)
        return false;
    for (let i = 0; i < path1.edges.length; i++) {
        const edge1 = path1.edges[i];
        const edge2 = path2.edges[i];
        if (edge1.from !== edge2.from)
            return false;
        if (edge1.to !== edge2.to)
            return false;
    }
    return true;
}

function clonePath(path: Path): Path {
    return {
        totalCost: path.totalCost,
        edges: Array.from(path.edges)
    };
}

function isPathExistInArray(candidates: Array<Required<Path>>, path: Path): boolean {
    return candidates.some(candi => isPathEqual(candi, path));
}

function removeBestCandidate(candidates: Array<Required<Path>>): Path | undefined {
    return candidates.sort((a, b) => b.totalCost - a.totalCost).pop();
}

/**
 * Dijkstra's algorithm for finding shortest paths in directed graphs with weighted edges.
 * Based on https://github.com/dagrejs/graphlib/blob/master/lib/alg/dijkstra.js.
 * @param g graph
 * @param source source node
 * @param removed nodes and edges that should be considered removed
 * @return maps from nodes to distance from source and nearest predecessor toward source
 */
function dijkstra(g: Graph, source: Node, removed?: Set<Edge | Node>): {
    distance: Map<Node, number>,
    back: Map<Node, Edge>
} {
    const distance: Map<Node, number> = new Map();
    const back: Map<Node, Edge> = new Map();
    const pq = new PriorityQueue<Node>();
    g.nodes.forEach((v: Node) => {
        if (!removed?.has(v)) {
            const d = v === source ? 0 : Number.POSITIVE_INFINITY;
            distance.set(v, d);
            pq.add(v, d);
        }
    });
    while (pq.size() > 0) {
        const v = pq.removeMin();
        const vd = distance.get(v)!;
        if (vd === Number.POSITIVE_INFINITY)
            break;
        v.edges.forEach((edge: Edge) => {
            if (!removed?.has(edge)) {
                const w = edge.to;
                if (!removed?.has(w)) {
                    const wd = distance.get(w)!;
                    const d = vd + edge.weight;
                    if (d < wd) {
                        distance.set(w, d);
                        back.set(w, edge);
                        edge.from = v;
                        pq.decrease(w, d);
                    }
                }
            }
        });
    }
    return {distance, back};
}

/**
 * Priority queue (heap).
 * Based on https://github.com/dagrejs/graphlib/blob/master/lib/data/priority-queue.js.
 */
class PriorityQueue<T extends object> {

    private arr: Array<{key: T, priority: number}> = [];

    private keyIndices: Map<T, number> = new Map();

    size(): number {
        return this.arr.length;
    }

    add(key: T, priority: number): boolean {
        if (!this.keyIndices.has(key)) {
            const arr = this.arr;
            const index = arr.length;
            this.keyIndices.set(key, index);
            arr.push({key: key, priority: priority});
            this.dec(index);
            return true;
        }
        return false;
    }

    removeMin(): T {
        this.swap(0, this.arr.length - 1);
        const min = this.arr.pop()!;
        this.keyIndices.delete(min.key);
        this.heapify(0);
        return min.key;
    }

    decrease(key: T, priority: number) {
        const index = this.keyIndices.get(key)!;
        assert(priority <= this.arr[index].priority);
        this.arr[index].priority = priority;
        this.dec(index);
    }

    private heapify(i: number) {
        const arr = this.arr;
        const l = 2 * i;
        const r = l + 1;
        let largest = i;
        if (l < arr.length) {
            largest = arr[l].priority < arr[largest].priority ? l : largest;
            if (r < arr.length)
                largest = arr[r].priority < arr[largest].priority ? r : largest;
            if (largest !== i) {
                this.swap(i, largest);
                this.heapify(largest);
            }
        }
    }

    private dec(index: number) {
        const arr = this.arr;
        const priority = arr[index].priority;
        let parent;
        while (index !== 0) {
            parent = index >> 1;
            if (arr[parent].priority < priority)
                break;
            this.swap(index, parent);
            index = parent;
        }
    }

    private swap(i: number, j: number) {
        const arr = this.arr;
        const keyIndices = this.keyIndices;
        const origArrI = arr[i];
        const origArrJ = arr[j];
        arr[i] = origArrJ;
        arr[j] = origArrI;
        keyIndices.set(origArrJ.key, i);
        keyIndices.set(origArrI.key, j);
    }
}
