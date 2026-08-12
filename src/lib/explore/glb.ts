/**
 * A minimal glTF 2.0 binary writer — positions, normals, indices, nothing else.
 *
 * This exists because the 3-D Tiles build step has to emit tile content, and
 * every general-purpose glTF exporter available is either a browser API
 * (`THREE.GLTFExporter` needs a DOM) or a large dependency that would ship a
 * material system, an animation system and a texture pipeline for geometry that
 * has none of those things.
 *
 * What a tile of city massing actually is: one interleaved-by-attribute buffer
 * of `Float32` positions, one of `Float32` normals, one `Uint32` index list,
 * and a single unlit material. That is about a hundred lines of well-specified
 * binary, and writing it directly means the build step has no runtime
 * dependencies at all.
 *
 * ## The parts that are easy to get wrong
 *
 * | | |
 * |---|---|
 * | **Chunk padding** | Both the JSON and the BIN chunk must be padded to four bytes — JSON with spaces, BIN with zeros. An unpadded file loads in some viewers and not others, which is the worst possible failure |
 * | **`min`/`max` on POSITION** | Required by the spec, not optional. Loaders use it for bounding volumes, and a missing one makes frustum culling silently wrong rather than making the file invalid |
 * | **Y-up** | glTF is Y-up by definition; this scene is Z-up. The swap happens here, once, rather than being fixed with a rotation on every tile at runtime |
 */

export interface GlbMesh {
  /** Scene metres, +X east, +Y north, +Z up — this project's own frame. */
  position: Float32Array;
  normal: Float32Array;
  index: Uint32Array;
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"
const BIN_CHUNK = 0x004e4942; // "BIN\0"

const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

/** Rounds up to the next multiple of four. */
function pad4(n: number): number {
  return (n + 3) & ~3;
}

/**
 * Z-up scene metres to glTF's Y-up.
 *
 * `(x, y, z)` becomes `(x, z, -y)`, which is a −90° rotation about X and the
 * conventional mapping. Applied to positions and normals alike; normals need no
 * renormalising because a rotation preserves length.
 */
function toGltfAxes(source: Float32Array): Float32Array {
  const out = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 3) {
    out[i] = source[i];
    out[i + 1] = source[i + 2];
    out[i + 2] = -source[i + 1];
  }
  return out;
}

export function writeGlb(mesh: GlbMesh): Uint8Array {
  const position = toGltfAxes(mesh.position);
  const normal = toGltfAxes(mesh.normal);
  const index = mesh.index;

  // Bounding box, in glTF axes, because that is what the accessor describes.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = position[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (!Number.isFinite(min[0])) {
    min[0] = min[1] = min[2] = 0;
    max[0] = max[1] = max[2] = 0;
  }

  const positionBytes = position.byteLength;
  const normalBytes = normal.byteLength;
  const indexBytes = index.byteLength;

  const positionOffset = 0;
  const normalOffset = pad4(positionOffset + positionBytes);
  const indexOffset = pad4(normalOffset + normalBytes);
  const binLength = pad4(indexOffset + indexBytes);

  const gltf = {
    asset: { version: '2.0', generator: 'cresa-spaces 3d-tiles build' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1 },
            indices: 2,
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
    /**
     * Unlit and white.
     *
     * The city's colour comes from Explore's own facade shader, which is
     * swapped onto the tile's meshes as they load. Baking a material here
     * would be a second opinion about what a building looks like, and the two
     * would drift.
     */
    materials: [
      {
        name: 'massing',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        extensions: { KHR_materials_unlit: {} },
      },
    ],
    extensionsUsed: ['KHR_materials_unlit'],
    accessors: [
      {
        bufferView: 0,
        componentType: FLOAT,
        count: position.length / 3,
        type: 'VEC3',
        min,
        max,
      },
      {
        bufferView: 1,
        componentType: FLOAT,
        count: normal.length / 3,
        type: 'VEC3',
      },
      {
        bufferView: 2,
        componentType: UNSIGNED_INT,
        count: index.length,
        type: 'SCALAR',
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: positionOffset, byteLength: positionBytes, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: normalOffset, byteLength: normalBytes, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: indexOffset, byteLength: indexBytes, target: ELEMENT_ARRAY_BUFFER },
    ],
    buffers: [{ byteLength: binLength }],
  };

  const jsonText = JSON.stringify(gltf);
  const jsonBytes = new TextEncoder().encode(jsonText);
  const jsonLength = pad4(jsonBytes.length);

  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);

  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  out.set(jsonBytes, 20);
  // Padded with spaces, which the spec requires for the JSON chunk
  // specifically — zeros here make the JSON unparseable in strict loaders.
  for (let i = 20 + jsonBytes.length; i < 20 + jsonLength; i++) out[i] = 0x20;

  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, binLength, true);
  view.setUint32(binHeader + 4, BIN_CHUNK, true);

  const binStart = binHeader + 8;
  out.set(new Uint8Array(position.buffer, position.byteOffset, positionBytes), binStart + positionOffset);
  out.set(new Uint8Array(normal.buffer, normal.byteOffset, normalBytes), binStart + normalOffset);
  out.set(new Uint8Array(index.buffer, index.byteOffset, indexBytes), binStart + indexOffset);

  return out;
}
