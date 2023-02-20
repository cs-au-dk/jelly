var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const timer_1 = __importDefault(require("./lib4"));
const lib3 = __importDefault(require("./lib3"));

const timer = new timer_1.default();

console.log(`Total analysis time: ${timer.elapsed()}ms`);
