const p2 = new Promise((resolve, reject) => {
    resolve(() => { // fulfilled value
        console.log("p2resolve");
    });
});

for (const round of [1,2,3,4]) {

    const p1 = new Promise((resolve, reject) => { // must be called with 'new'
        switch (round) {
            case 1:
                resolve(() => { // fulfillment value
                    console.log("resolve1");
                });
                break;
            case 2:
                reject(() => { // rejection value
                    console.log("reject2");
                });
                break;
            case 3:
                throw () => { // similar to reject
                    console.log("throw30");
                };
            case 4:
                resolve(p2); // if a resolve value (but not a reject value!) is itself a promise, it is inserted in the chain
                break;
        }
        // return value of executor is ignored
    });

    p1.then(a => { // if not a function, the identity function is used
        console.log("then3");
        a();
        // if returning a promise, the result promise obtains its fulfilled/rejected value from that promise
        // if throws, thrown value becomes rejected value of result promise
        return () => { // returned value becomes fulfilled value of result promise
            console.log("thenreturn10");
        };
    }, b => {
        console.log("else4");
        b();
        return () => {
            console.log("elsereturn11");
        };
    }) // .then returns a new chained promise
        .then(a => {
            console.log("chainedthen5");
            a();
        }, b => {
            console.log("chainedelse6");
            b();
        })


    p1.finally(() => { // called when the promise is settled
        console.log("finally20");
    }).catch(c => {
        console.log("catch50");
        c();
    });

    p1.then(a => { // one promise can have multiple handlers
        console.log("anotherthen7");
        a();
        return p2; // if a handler returns a promise, the return value of then will be fulfilled/rejected based on the eventual state of that promise
    }, b => {
        console.log("anotherelse8");
        b();
        return () => {
            console.log("anotherelsereturn41");
        };
    }).then(aa => {
        console.log("anotherthen37");
        aa();
    }, bb => {
        console.log("anotherelse38");
        bb();
    });

    p1.catch(cc => {
        console.log("catch22");
        cc();
        return () => {
            console.log("catchreturn23");
        };
    }).then(dd => {
        console.log("anotherthen24");
        dd();
    });
}

Promise.resolve(() => {console.log("promiseresolve1");}).then(
    v => {
        v();
    },
    r => {
        r();
    },
);

Promise.reject(() => {console.log("promisereject1");}).then(
    v => {
        v();
    },
    r => {
        r();
    },
);

Promise.resolve(p2).then(
    v => {
        v();
    },
    r => {
        r();
    },
);

const p3 = new Promise((resolve, reject) => {
    reject(() => {
        console.log("p3reject");
    });
});
Promise.all([p2]).then(
    va => {
        va[0]();
    },
    ra => {
        ra();
    },
);
Promise.all([p2, p3]).catch(
    ra => {
        ra();
    },
);
Promise.allSettled([p2, p3]).then(
    va => {
        va[0].value();
        va[1].reason();
    }
);
Promise.any([p2, p3]).then(
    va => {
        va();
    },
    ra => {
        ra();
    },
);
Promise.race([p2, p3]).then(
    va => {
        va();
    },
    ra => {
        ra();
    },
);

// const aThenable = {
//     then(onFulfilled, onRejected) {
//         onFulfilled({
//             // The thenable is fulfilled with another thenable
//             then(onFulfilled, onRejected) {
//                 onFulfilled(42);
//             },
//         });
//     },
// };
//
// Promise.resolve(aThenable);
