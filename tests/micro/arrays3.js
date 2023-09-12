
[() => console.log("hi")].reduce(() => void 0)();

const arr = [123];
for (let i = 0; i < 10; i++)
    arr[i] = () => console.log("hi2");

arr.length = 1;
arr.reduce(() => void 0)();

[].reduce(() => void 0, () => console.log("hi3"))();
