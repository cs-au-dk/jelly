class C {
    constructor() {
        return () => {console.log("here")}
    }
}

class Parser extends C {
    constructor() {
        super()
    }
}

var x = new Parser()
x();
