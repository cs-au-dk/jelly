import { EmptyObservable } from 'rxjs/observable/EmptyObservable'

const wrappedEpic = {};
const $$getObservable = 'foo';
let lifecycle2 = EmptyObservable.create();
wrappedEpic[$$getObservable] = () => lifecycle2;

const lifecycle = wrappedEpic[$$getObservable]();
lifecycle.startWith(null);