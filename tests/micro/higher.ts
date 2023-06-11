const f0 = "Hello";

function f1(p0: string): string {
    return p0;
}

function f2(p1: (p0: string) => string): string {
    return p1(f0);
}

function f3(p2: (p1: (p0: string) => string) => string): string {
    return p2(f1);
}

function f4(p3: (p2: (p1: (p0: string) => string) => string) => string): string {
    return p3(f2);
}

function f5(p4: (p3: (p2: (p1: (p0: string) => string) => string) => string) => string): string {
    return p4(f3);
}

function f6(p5: (p4: (p3: (p2: (p1: (p0: string) => string) => string) => string) => string) => string): string {
    return p5(f4);
}

function f7(p6: (p5: (p4: (p3: (p2: (p1: (p0: string) => string) => string) => string) => string) => string) => string): string {
    return p6(f5);
}

console.log(f7(f6));

function g1(): string {
    return "Jelly";
}

function g2(): () => string {
    return g1;
}

function g3(): () => () => string {
    return g2;
}

function g4(): () => () => () => string {
    return g3;
}

function g5(): () => () => () => () => string {
    return g4;
}

function g6(): () => () => () => () => () => string {
    return g5;
}

function g7(): () => () => () => () => () => () => string {
    return g6;
}

console.log(g7()()()()()()());

const h0 = "World";

function h1(p0: string): string {
    return p0;
}

function h2(p1: (p0: string) => string): (p0: string) => string {
    return p1;
}

function h3(p2: (p1: (p0: string) => string) => ((p0: string) => string)): (p1: (p0: string) => string) => ((p0: string) => string) {
    return p2;
}

function h4(p3: (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)): (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string) {
    return p3;
}

function h5(p4: (p3: (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)): (p3: (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string) {
    return p4;
}

function h6(p5: (p4: (p3: (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p3: (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)): (p4: (p3: (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p3: (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string) {
    return p5;
}

function h7(p6: (p5: (p4: (p3: (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p3: (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p4: (p3: (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p3: (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)): (p5: (p4: (p3: (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p3: (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p4: (p3: (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p3: (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string)) => (p2: (p1: (p0: string) => string) => ((p0: string) => string)) => (p1: (p0: string) => string) => ((p0: string) => string) {
    return p6;
}

console.log(h7(h6)(h5)(h4)(h3)(h2)(h1)(h0));
