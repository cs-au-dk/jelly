function foo() {

    var q1 = {
        m1() {
            console.log("q1.m1");
            this.m3();
        }
    }
    var q2 = {
        m2() {
            super.m1();
        },
        m3() {
            console.log("q2.m3");
        }
    }
    Object.setPrototypeOf(q2, q1);
    q2.m2();

}
foo();
