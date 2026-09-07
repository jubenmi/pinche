// The UI's clock is reactive only when a caller stores these ticks in its state.
export function createClockTicker(onTick) {
  let active = false;
  let disposed = false;
  let timer = null;
  const tick = () => {
    if (!active) return;
    const now = Date.now();
    onTick(now);
    if (active) timer = setTimeout(tick, 1000 - (now % 1000));
  };
  const stop = () => {
    active = false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    start() {
      if (active || disposed) return;
      active = true;
      tick();
    },
    stop,
    dispose() {
      disposed = true;
      stop();
    }
  };
}
