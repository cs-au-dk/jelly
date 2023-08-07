const obj = {
    a: () => console.log("a"),
    b: () => console.log("b"),
};

for (const name in obj)
    obj[name]();
