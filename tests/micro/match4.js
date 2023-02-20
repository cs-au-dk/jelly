const { Observable } = require('rxjs');

Observable.interval(5)
    .retryWhen(attempts =>
        attempts.mergeMap());
