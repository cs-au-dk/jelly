class Node<T> {
    next: Node<T> | undefined;

    constructor(readonly value: T) {}
}

/**
 * Simple worklist queue.
 */
export class Worklist<T> {
    private first: Node<T> | undefined;
    private last: Node<T> | undefined;

    /**
     * Enqueue a new item.
     */
    enqueue(v: T) {
        const n = new Node(v);
        if (this.last)
            this.last.next = n;
        else
            this.first = n;
        this.last = n;
    }

    /**
     * Returns a generator that dequeues the items one by one.
     */
    *[Symbol.iterator](): Generator<T> {
        while (this.first) {
            const c = this.first;
            this.first = c.next;
            if (this.first === undefined)
                this.last = undefined;
            yield c.value;
        }
    }

    /**
     * Returns true if the worklist is nonempty.
     */
    isNonEmpty(): boolean {
        return this.first !== undefined;
    }
}