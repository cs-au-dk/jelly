export type Indexed = {index: number};

export class ArrayMap<KS, K extends Indexed & KS, V> {

    protected a: Array<V | undefined> = [];

    private s: number = 0;

    constructor(readonly dom: Array<KS>) {}

    get size(): number {
        return this.s;
    }

    get(k: K): V | undefined {
        return this.a[k.index];
    }

    set(k: K, v: V) {
        if (this.a[k.index] === undefined)
            this.s++;
        this.a[k.index] = v;
    }

    delete(k: K) {
        if (this.a[k.index] !== undefined)
            this.s--;
        this.a[k.index] = undefined;
    }

    has(k: K): boolean {
        return this.a[k.index] !== undefined;
    }

    *keys(): Generator<KS> {
        for (const [i, v] of this.a.entries())
            if (v !== undefined)
                yield this.dom[i];
    }

    *values(): Generator<V> {
        for (const v of this.a)
            if (v !== undefined)
                yield v;
    }

    *[Symbol.iterator](): Generator<[KS, V]> {
        for (const [i, v] of this.a.entries())
            if (v !== undefined)
                yield [this.dom[i], v];
    }
}

export class ArrayMapSet<KS, K extends Indexed & KS, V> extends ArrayMap<KS, K, Set<V>> {

    getSet(k: K): Set<V> {
        let s = this.get(k);
        if (s === undefined) {
            s = new Set;
            this.set(k, s);
        }
        return s;
    }
}

export class ArrayMapMap<KS, K1 extends Indexed & KS, K2, V> extends ArrayMap<KS, K1, Map<K2, V>> {

    getMap(k: K1): Map<K2, V> {
        let m = this.get(k);
        if (m === undefined) {
            m = new Map;
            this.set(k, m);
        }
        return m;
    }

    totalSize(): number {
        let s = 0;
        for (const m of this.a.values())
            if (m !== undefined)
               s += m.size;
        return s;
    }
}
