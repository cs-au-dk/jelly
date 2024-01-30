
(async () => {
    function resolveWithFun(resolve) {
        resolve(() => console.log("Hello World!"));
    }

    const f1 = await new Promise((resolve) => resolveWithFun(resolve));
    f1();

    const f2 = await new Promise((resolve) => resolveWithFun(resolve));
    f2();
})();
