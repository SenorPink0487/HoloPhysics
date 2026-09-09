/**
 * Render Worker — owns OffscreenCanvas + a minimal Three.js world.
 *
 * Protocol (Main → Worker):
 *   { type: 'init', canvas, width, height, pixelRatio?, clearColor? }
 *   { type: 'resize', width, height, pixelRatio? }
 *   { type: 'setCamera', camera: { position, target?, fov?, near?, far?, aspect? } }
 *   { type: 'setClearColor', color, alpha? }
 *   { type: 'upsertMesh', mesh: { id, kind, ... } }
 *   { type: 'removeMesh', id }
 *   { type: 'applyPoses', buffer: Float32Array, stride?, idOrder?: number[] }
 *   { type: 'present', requestId? }
 *   { type: 'dispose' }
 *
 * Protocol (Worker → Main):
 *   { type: 'ready' }
 *   { type: 'presented', requestId?, ms, drawCalls?, triangles? }
 *   { type: 'acked', requestId? }
 *   { type: 'error', requestId?, message }
 */

import * as THREE from 'three';
import { RENDER_MESH_KIND, RENDER_POSE_STRIDE } from './renderTypes.js';

/** @type {THREE.WebGLRenderer | null} */
let renderer = null;
/** @type {THREE.Scene | null} */
let scene = null;
/** @type {THREE.PerspectiveCamera | null} */
let camera = null;
/** @type {Map<number | string, { mesh: THREE.Object3D, kind: string }>} */
const meshes = new Map();
let disposed = false;

function ensureWorld() {
  if (!scene) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c1220);
    const hemi = new THREE.HemisphereLight(0xdde7ff, 0x1a2030, 0.85);
    const dir = new THREE.DirectionalLight(0xfff6ea, 0.9);
    dir.position.set(4, 10, 6);
    scene.add(hemi, dir);
  }
  if (!camera) {
    camera = new THREE.PerspectiveCamera(42, 1, 0.08, 200);
    camera.position.set(6, 4, 8);
    camera.lookAt(0, 1, 0);
  }
}

function buildMesh(desc = {}) {
  const kind = desc.kind || desc.shape || RENDER_MESH_KIND.SPHERE;
  let geometry;
  if (kind === RENDER_MESH_KIND.BOX || kind === 'box') {
    const size = desc.size || [1, 1, 1];
    geometry = new THREE.BoxGeometry(size[0] || 1, size[1] || 1, size[2] || 1);
  } else if (kind === RENDER_MESH_KIND.PLANE || kind === 'plane') {
    const size = desc.size || [10, 10];
    geometry = new THREE.PlaneGeometry(size[0] || 10, size[1] || 10);
  } else {
    geometry = new THREE.SphereGeometry(Number(desc.radius) || 0.3, 24, 16);
  }
  const material = new THREE.MeshStandardMaterial({
    color: desc.color != null ? desc.color : 0x3ee0b0,
    metalness: desc.metalness != null ? desc.metalness : 0.15,
    roughness: desc.roughness != null ? desc.roughness : 0.45,
  });
  const mesh = new THREE.Mesh(geometry, material);
  if (kind === RENDER_MESH_KIND.PLANE || kind === 'plane') {
    mesh.rotation.x = desc.rotation?.[0] != null ? desc.rotation[0] : -Math.PI / 2;
  }
  if (desc.position) mesh.position.set(desc.position[0], desc.position[1], desc.position[2]);
  if (desc.quaternion) {
    mesh.quaternion.set(desc.quaternion[0], desc.quaternion[1], desc.quaternion[2], desc.quaternion[3]);
  } else if (desc.rotation && kind !== RENDER_MESH_KIND.PLANE && kind !== 'plane') {
    mesh.rotation.set(desc.rotation[0] || 0, desc.rotation[1] || 0, desc.rotation[2] || 0);
  }
  if (desc.scale) {
    if (Array.isArray(desc.scale)) mesh.scale.set(desc.scale[0], desc.scale[1], desc.scale[2]);
    else mesh.scale.setScalar(Number(desc.scale) || 1);
  }
  return { mesh, kind };
}

function upsertMesh(desc) {
  ensureWorld();
  const id = desc.id;
  if (id == null) throw new Error('upsertMesh requires id');
  const existing = meshes.get(id);
  if (existing) {
    scene.remove(existing.mesh);
    existing.mesh.geometry?.dispose?.();
    existing.mesh.material?.dispose?.();
    meshes.delete(id);
  }
  const entry = buildMesh(desc);
  scene.add(entry.mesh);
  meshes.set(id, entry);
  return true;
}

function removeMesh(id) {
  const entry = meshes.get(id);
  if (!entry || !scene) return false;
  scene.remove(entry.mesh);
  entry.mesh.geometry?.dispose?.();
  if (Array.isArray(entry.mesh.material)) entry.mesh.material.forEach((m) => m?.dispose?.());
  else entry.mesh.material?.dispose?.();
  meshes.delete(id);
  return true;
}

function applyPoses(buffer, stride = RENDER_POSE_STRIDE, idOrder = null) {
  if (!buffer || !buffer.length) return 0;
  let applied = 0;
  if (idOrder && idOrder.length) {
    for (let i = 0; i < idOrder.length; i += 1) {
      const entry = meshes.get(idOrder[i]);
      if (!entry) continue;
      const o = i * stride;
      if (o + 7 >= buffer.length) break;
      entry.mesh.position.set(buffer[o], buffer[o + 1], buffer[o + 2]);
      entry.mesh.quaternion.set(buffer[o + 3], buffer[o + 4], buffer[o + 5], buffer[o + 6]);
      applied += 1;
    }
    return applied;
  }
  // Fallback: apply in Map insertion order (stable for small demos).
  let slot = 0;
  for (const entry of meshes.values()) {
    const o = slot * stride;
    if (o + 7 >= buffer.length) break;
    entry.mesh.position.set(buffer[o], buffer[o + 1], buffer[o + 2]);
    entry.mesh.quaternion.set(buffer[o + 3], buffer[o + 4], buffer[o + 5], buffer[o + 6]);
    slot += 1;
    applied += 1;
  }
  return applied;
}

function setCameraState(desc = {}) {
  ensureWorld();
  if (desc.fov != null) camera.fov = desc.fov;
  if (desc.near != null) camera.near = desc.near;
  if (desc.far != null) camera.far = desc.far;
  if (desc.aspect != null) camera.aspect = desc.aspect;
  if (desc.position) camera.position.set(desc.position[0], desc.position[1], desc.position[2]);
  if (desc.target) camera.lookAt(desc.target[0], desc.target[1], desc.target[2]);
  camera.updateProjectionMatrix();
}

function presentFrame() {
  if (!renderer || !scene || !camera) {
    throw new Error('render worker not initialized');
  }
  const t0 = performance.now();
  renderer.render(scene, camera);
  const ms = performance.now() - t0;
  return {
    ms,
    drawCalls: renderer.info?.render?.calls ?? 0,
    triangles: renderer.info?.render?.triangles ?? 0,
  };
}

function disposeAll() {
  for (const id of [...meshes.keys()]) removeMesh(id);
  renderer?.dispose?.();
  renderer = null;
  scene = null;
  camera = null;
  disposed = true;
}

function handleMessage(data) {
  const type = data?.type;
  try {
    switch (type) {
      case 'init': {
        disposed = false;
        ensureWorld();
        const canvas = data.canvas;
        if (!canvas) throw new Error('init requires OffscreenCanvas');
        const width = Math.max(1, data.width | 0 || canvas.width || 1);
        const height = Math.max(1, data.height | 0 || canvas.height || 1);
        const dpr = Number(data.pixelRatio) || 1;
        renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: data.antialias !== false,
          alpha: !!data.alpha,
          powerPreference: 'high-performance',
        });
        renderer.setPixelRatio(dpr);
        renderer.setSize(width, height, false);
        if (data.clearColor != null) {
          scene.background = new THREE.Color(data.clearColor);
        }
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
        return { type: 'ready', kind: 'worker' };
      }
      case 'resize': {
        if (!renderer || !camera) return { type: 'error', message: 'not initialized' };
        const width = Math.max(1, data.width | 0);
        const height = Math.max(1, data.height | 0);
        if (data.pixelRatio != null) renderer.setPixelRatio(Number(data.pixelRatio) || 1);
        renderer.setSize(width, height, false);
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
        return data.requestId != null ? { type: 'acked', requestId: data.requestId } : null;
      }
      case 'setCamera': {
        setCameraState(data.camera || data);
        return data.requestId != null ? { type: 'acked', requestId: data.requestId } : null;
      }
      case 'setClearColor': {
        ensureWorld();
        scene.background = new THREE.Color(data.color ?? 0x0c1220);
        return data.requestId != null ? { type: 'acked', requestId: data.requestId } : null;
      }
      case 'upsertMesh': {
        upsertMesh(data.mesh || data);
        return data.requestId != null
          ? { type: 'acked', requestId: data.requestId, id: (data.mesh || data).id }
          : null;
      }
      case 'removeMesh': {
        const ok = removeMesh(data.id);
        return data.requestId != null
          ? { type: 'acked', requestId: data.requestId, ok }
          : null;
      }
      case 'applyPoses': {
        const n = applyPoses(data.buffer, data.stride || RENDER_POSE_STRIDE, data.idOrder || null);
        return data.requestId != null
          ? { type: 'acked', requestId: data.requestId, applied: n }
          : null;
      }
      case 'present': {
        const stats = presentFrame();
        return {
          type: 'presented',
          requestId: data.requestId,
          ms: stats.ms,
          drawCalls: stats.drawCalls,
          triangles: stats.triangles,
        };
      }
      case 'dispose': {
        disposeAll();
        return { type: 'disposed', requestId: data.requestId };
      }
      default:
        return { type: 'error', requestId: data?.requestId, message: `Unknown message type: ${type}` };
    }
  } catch (error) {
    return {
      type: 'error',
      requestId: data?.requestId,
      message: error?.message || String(error),
    };
  }
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (event) => {
    const response = handleMessage(event.data);
    if (!response) return;
    self.postMessage(response);
  };
}

export { handleMessage };
