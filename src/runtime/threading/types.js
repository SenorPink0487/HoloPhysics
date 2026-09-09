/**
 * Shared layout and constants for PhysicsBackend (main thread + future worker).
 *
 * Pose buffer stride per body (Float32):
 *   [px, py, pz, qx, qy, qz, qw, vx, vy, vz]
 */

export const POSE_STRIDE = 10;

/** Matches cannon-es Body type flags so existing experiment code stays valid. */
export const BODY_TYPE = Object.freeze({
  DYNAMIC: 1,
  STATIC: 2,
  KINEMATIC: 4,
});

export const DEFAULT_FIXED_DT = 1 / 60;
export const DEFAULT_MAX_SUBSTEPS = 4;

/** Byte offset helpers for a body slot in a pose Float32Array. */
export function poseOffset(slot) {
  return slot * POSE_STRIDE;
}

export function readPose(poses, slot) {
  const o = poseOffset(slot);
  return {
    px: poses[o],
    py: poses[o + 1],
    pz: poses[o + 2],
    qx: poses[o + 3],
    qy: poses[o + 4],
    qz: poses[o + 5],
    qw: poses[o + 6],
    vx: poses[o + 7],
    vy: poses[o + 8],
    vz: poses[o + 9],
  };
}

export function writePose(poses, slot, {
  px = 0, py = 0, pz = 0,
  qx = 0, qy = 0, qz = 0, qw = 1,
  vx = 0, vy = 0, vz = 0,
} = {}) {
  const o = poseOffset(slot);
  poses[o] = px;
  poses[o + 1] = py;
  poses[o + 2] = pz;
  poses[o + 3] = qx;
  poses[o + 4] = qy;
  poses[o + 5] = qz;
  poses[o + 6] = qw;
  poses[o + 7] = vx;
  poses[o + 8] = vy;
  poses[o + 9] = vz;
}
