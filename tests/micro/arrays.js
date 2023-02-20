var x = [,() => {}];
x[42] = () => {};
x[x] = () => {};
var y = x[1];
y();
var z = x[x];
z();

x.push(() => {});
var t = x.pop();
t();
var t2 = x[3];
if (t2) t2();
