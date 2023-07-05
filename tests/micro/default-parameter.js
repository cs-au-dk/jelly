
function f(x = function(){ console.log("hello");}){
    x();
}

function g(x = f()) { }
g();
