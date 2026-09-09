/**
 * Convert a virtual-stick displacement into a stable, normalized input.
 * Keeping this math independent of the DOM makes the touch control behaviour
 * easy to test and completely decoupled from external modules.
 */
export function normalizeJoystickInput(dx, dy, radius, deadZone = 0.16) {
  const safeRadius = Math.max(1, Number(radius) || 1);
  const rawLength = Math.hypot(dx, dy);
  const cappedLength = Math.min(rawLength, safeRadius);
  const rawMagnitude = cappedLength / safeRadius;

  if (!rawLength || rawMagnitude <= deadZone) {
    return { x: 0, y: 0, magnitude: 0 };
  }

  const magnitude = (rawMagnitude - deadZone) / (1 - deadZone);
  return {
    x: (dx / rawLength) * magnitude,
    y: (dy / rawLength) * magnitude,
    magnitude,
  };
}

export function touchActionMode(state) {
  if (state === 'free') return 'enter';
  if (state === 'aiming' || state === 'charging') return 'exit';
  return 'waiting';
}