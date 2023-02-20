import mongoose from 'mongoose';
const schema = mongoose.Schema();
schema.method('delete', function (cb) {
    return this.save(cb);
})