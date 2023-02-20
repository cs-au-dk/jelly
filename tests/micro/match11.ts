import * as rx from "rxjs";

export function from<T>(rx: rx.Observable<T>) {
    return rx.fromPromise;
}

var x = rx.fromPromise; // high confidence match?
