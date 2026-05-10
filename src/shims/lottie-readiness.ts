// Shim for @hyperframes/core/runtime/lottie-readiness — not present in current package version.
// isLottieAnimationLoaded is used to check if a Lottie animation is ready before playback.
// Returning true means we treat all animations as loaded immediately.
export function isLottieAnimationLoaded(_anim: unknown): boolean {
  return true;
}
