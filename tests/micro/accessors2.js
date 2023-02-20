const obj = {
    baz: function() {
        console.log("hello")
    },
    get foo() {
        this.baz();
    },

    set s(x) {
        this.bar = x;
    }
}

obj.foo;

obj.s = function() {
    console.log("olleh")
}
obj.bar();



