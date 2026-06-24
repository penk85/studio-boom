export function sampleMotionEase(name: string | undefined, value: number): number {
  switch (name) {
    case "linear":
      return value;
    case "easeIn":
      return value * value;
    case "easeOut":
      return 1 - Math.pow(1 - value, 2);
    case "snappy":
      return 1 - Math.pow(1 - value, 4);
    case "overshoot": {
      const overshoot = 1.70158;
      return (overshoot + 1) * value * value * value - overshoot * value * value;
    }
    case "bounce": {
      const strength = 7.5625;
      const divisor = 2.75;
      if (value < 1 / divisor) return strength * value * value;
      if (value < 2 / divisor) return strength * Math.pow(value - 1.5 / divisor, 2) + 0.75;
      if (value < 2.5 / divisor) return strength * Math.pow(value - 2.25 / divisor, 2) + 0.9375;
      return strength * Math.pow(value - 2.625 / divisor, 2) + 0.984375;
    }
    case "elastic":
      return value === 0
        ? 0
        : value === 1
          ? 1
          : -Math.pow(2, 10 * value - 10) * Math.sin((value * 10 - 10.75) * ((2 * Math.PI) / 3));
    case "hold":
      return value < 1 ? 0 : 1;
    case "easeInOut":
    default:
      return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
  }
}
