Object.defineProperty(exports, "__esModule", { value: true });
class Timer {
  constructor() {
    this.startTime = new Date();
  }
  elapsed() {
    return new Date().getTime() - this.startTime.getTime();
  }
}
exports.default = Timer;
