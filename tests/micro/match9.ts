import Subject from "rxjs";
class RestrictionMosaicHttp {
    search() {
        return new Subject()
    }
}

function assign<T>(object: T): T {
    return Object.assign({ __proto__: Object.getPrototypeOf(object) }, object);
}

const restrictionMosaicRepository = assign(new RestrictionMosaicHttp("someURL"));
restrictionMosaicRepository.search().toPromise();