import { HandLandmarker } from '@mediapipe/tasks-vision';

let handLandmarker = null;

function flattenLandmarks(landmarks = []) {
  const values = new Float32Array(landmarks.length * 3);
  landmarks.forEach(({ x, y, z }, index) => {
    const offset = index * 3;
    values[offset] = x;
    values[offset + 1] = y;
    values[offset + 2] = z;
  });
  return values;
}

function serializeResult(result) {
  const landmarks = result?.landmarks || [];
  const worldLandmarks = result?.worldLandmarks || [];
  const handedness = result?.handedness || result?.handednesses || [];
  return landmarks.map((points, index) => ({
    label: handedness[index]?.[0]?.categoryName || null,
    score: Number(handedness[index]?.[0]?.score) || 0,
    landmarks: flattenLandmarks(points),
    worldLandmarks: flattenLandmarks(worldLandmarks[index]),
  }));
}

async function initialize({
  wasmLoaderPath,
  wasmBinaryPath,
  modelPath,
  numHands = 2,
}) {
  handLandmarker = await HandLandmarker.createFromOptions({
    wasmLoaderPath,
    wasmBinaryPath,
  }, {
    baseOptions: { modelAssetPath: modelPath, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  self.postMessage({ type: 'ready', delegate: 'GPU' });
}

self.onmessage = async ({ data }) => {
  if (data?.type === 'init') {
    try {
      await initialize(data);
    } catch (error) {
      self.postMessage({
        type: 'error',
        stage: 'init',
        message: error?.message || String(error),
      });
    }
    return;
  }

  if (data?.type === 'frame') {
    const { bitmap, timestamp, frameId } = data;
    const startedAt = performance.now();
    try {
      if (!handLandmarker) throw new Error('Hand landmarker is not initialized');
      const result = handLandmarker.detectForVideo(bitmap, timestamp);
      const hands = serializeResult(result);
      const transfer = hands.flatMap((hand) => [
        hand.landmarks.buffer,
        hand.worldLandmarks.buffer,
      ]);
      self.postMessage({
        type: 'result',
        frameId,
        timestamp,
        inferenceMs: performance.now() - startedAt,
        hands,
      }, transfer);
    } catch (error) {
      self.postMessage({
        type: 'error',
        stage: 'frame',
        frameId,
        message: error?.message || String(error),
      });
    } finally {
      bitmap?.close?.();
    }
    return;
  }

  if (data?.type === 'close') {
    handLandmarker?.close?.();
    handLandmarker = null;
    self.close();
  }
};
