import * as rx from "rxjs";

// if not export, then no argument values and therefore no matches are reported
// uncertain type match because rx.Observable<T> isn't handled by convertType
export async function logObservable<T>(rx: rx.Observable<T>, unitMs: number): Promise<any[]> {
    return rx.toPromise();
}