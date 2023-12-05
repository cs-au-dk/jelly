
// setter inherited from prototype

const obj = {};

Object.setPrototypeOf(obj, {
    set foo(v) {
        console.log("setter called");
        this._foo = v;
    }
});

obj.foo = () => { console.log("foo called"); };

obj._foo();
