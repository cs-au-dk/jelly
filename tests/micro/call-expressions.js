(function(){})();
var x = function(){}();
var y = (function(){}());
(function(){}());
( (function(){}) )();
(( (function(){}) )());
(( (function(){})() ));
( () /* hello */ => void 0)(/* world */);
( (() => void 0)() );
function f() {}
f();
(f)();
((f))();
((f)());
(((f))());
(( (/* */(f))))();
(f)(({} /* comment */));
(f());
((f()));
( f() );
const o = {f};
o.f();
(o.f());
((o.f()));
(o.f)();
((o.f)());
(((o.f)()));
o?.f();
(o?.f());
((o?.f()));
new f();
(new f());
((new f()));
new (f)();
(new (f)());
((new (f)()));
(new ((f))());
