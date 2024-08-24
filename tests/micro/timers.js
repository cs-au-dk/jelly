setTimeout((x) => {
    x();
}, 100, () => {console.log("Delayed for 0.1 second.")});

queueMicrotask(() => {console.log("Micro task");});
