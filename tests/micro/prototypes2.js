let f = () => console.log("f");
class A {}
A.prototype.t = f;
(new A).t();
