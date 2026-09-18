export const MathUtils = {
  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  },
  lerp(a, b, t) {
    return a + (b - a) * t;
  },
  randRange(min, max) {
    return Math.random() * (max - min) + min;
  },
  randInt(min, max) {
    return Math.floor(this.randRange(min, max + 1));
  }
};
