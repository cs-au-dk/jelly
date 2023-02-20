module.exports.filter = (iteratee) => {
    return (arr) => {
        const res = [];
        for (var x of arr) {
            if (iteratee(x))
                res.push(x);
        }
        return res;
    };
}
module.exports.obj = {foo: 17};
