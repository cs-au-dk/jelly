(async function() {

    const p = new Promise((resolve, reject) => {
        resolve(() => {
            console.log("resolved");
        });
    });

    const t1 = await p;
    t1();

    const t2 = await (()=>{console.log("value");}); // can await non-promise values
    t2();

    const f1 = async function() {
        return ()=>{console.log("async1");}; // return value is wrapped into a promise
    }
    const f2 = await f1();
    f2();

    const f3 = async function() {
        return ()=>{console.log("async2");}; // return value is wrapped into a promise
    }
    f3().then(f4 => {
        f4();
    });

    const f5 = async function*() {
        yield ()=>{console.log("async3a");}; // yield value is wrapped into a promise in an iterator
        return ()=>{console.log("async3b");};
    }
    const f6 = f5();
    f6.next().then(res => {
        res.value();
    });
    f6.next().then(res => {
        res.value();
    });

    const f7 = async function*() {
        yield* [()=>{console.log("async4a");}]; // yield* values are wrapped into promises in an iterator
        return ()=>{console.log("async4b");};
    }
    const f8 = f7(); // f8 is an AsyncGenerator
    const p2 = f8.next(); // p is a promise
    p2.then(res => {
        res.value();
    });
    f8.next().then(res => {
        res.value();
    });

    for await (const q of f7()) {
        q();
    }

}());
