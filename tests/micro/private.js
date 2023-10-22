class C {
    #foo = () => {console.log("foo")};

    #bar() {
        console.log("bar");
    }

    static #baz = () => {console.log("baz")};

    static #qux() {
        console.log("qux");
    }

    constructor() {
        this.#foo();
        this.#foo = () => {console.log("quux")};
        this.#foo();
        this.#bar();
        C.#baz();
        C.#qux();
    }
}

new C()
