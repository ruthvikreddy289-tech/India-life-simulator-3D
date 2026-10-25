import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const assets = path.join(dist, 'assets');

async function parseGLB(relative) {
  const bytes = await readFile(path.join(assets, relative));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${relative}: glTF magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${relative}: glTF 2.0`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${relative}: complete binary file`);
  let offset = 12, json, binary;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(chunk.length, length, `${relative}: complete chunk`);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8').replace(/\0+$/, ''));
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  assert.ok(json?.scenes?.length && json.nodes?.length && json.meshes?.length, `${relative}: scene geometry`);
  assert.ok(binary?.length, `${relative}: embedded geometry buffer`);
  for (const view of json.bufferViews || []) assert.ok((view.byteOffset || 0) + view.byteLength <= binary.length, `${relative}: buffer view bounds`);
  let triangles = 0;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
    assert.equal(primitive.mode ?? 4, 4, `${relative}: triangle primitives`);
    const position = json.accessors[primitive.attributes.POSITION];
    assert.ok(position.count > 0 && position.min?.every(Number.isFinite) && position.max?.every(Number.isFinite), `${relative}: finite vertex bounds`);
    triangles += (primitive.indices === undefined ? position.count : json.accessors[primitive.indices].count) / 3;
    if (primitive.material !== undefined) assert.ok(json.materials[primitive.material], `${relative}: material exists`);
  }
  return {json, binary, triangles, bytes: bytes.length};
}

function imageSize(buffer, label) {
  if (buffer.toString('ascii', 1, 4) === 'PNG') return {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
  if (buffer.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset < buffer.length - 9) {
      while (buffer[offset] === 0xff) offset++;
      const marker = buffer[offset++];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
      const length = buffer.readUInt16BE(offset);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3)};
      }
      offset += length;
    }
  }
  const hdr = buffer.subarray(0, 500).toString('ascii').match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
  if (hdr) return {width: Number(hdr[2]), height: Number(hdr[1])};
  assert.fail(`Cannot determine dimensions of ${label}`);
}

function assertMobileTexture(buffer, label, maximum = 1024) {
  const {width, height} = imageSize(buffer, label);
  assert.ok(width > 0 && height > 0 && width <= maximum && height <= maximum, `${label}: ${width}×${height} fits ${maximum}px mobile texture budget`);
}

test('generated architecture glTFs have valid buffers and reduced medium LOD geometry', async () => {
  const report = [];
  for (const name of ['apartment', 'corner-shop', 'heritage-shop', 'station', 'office', 'hotel']) {
    const near = await parseGLB(`architecture/${name}.glb`);
    const medium = await parseGLB(`architecture/${name}-medium.glb`);
    assert.ok(near.triangles > 1000, `${name}: detailed architecture asset`);
    assert.ok(medium.triangles < near.triangles * 0.85, `${name}: meaningful medium LOD reduction`);
    report.push({asset: name, near: near.triangles, medium: medium.triangles});
  }
  const license = await readFile(path.join(assets, 'architecture/LICENSE.md'), 'utf8');
  assert.match(license, /MIT|CC0|public domain/i, 'generated architecture has an explicit reuse license');
  console.log('Architecture triangle budgets:', JSON.stringify(report));
});

test('licensed vehicle has named wheel hierarchies and mobile LOD variants', async () => {
  const source = await parseGLB('car/car-player.glb');
  for (const name of ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR']) {
    const node = source.json.nodes.find(n => n.name === name);
    assert.ok(node?.children?.length >= 3, `${name}: independently animated wheel hierarchy`);
  }
  const attribution = await readFile(path.join(assets, 'car/SOURCE.md'), 'utf8');
  assert.match(attribution, /Creative Commons Attribution 4\.0|CC.BY.4/i);
  assert.match(attribution, /Eric Chadwick/i);
  const medium = await parseGLB('car/car-lod.glb');
  const low = await parseGLB('car/car-low.glb');
  assert.ok(medium.triangles < source.triangles * 0.5 && low.triangles < medium.triangles * 0.6, 'vehicle LODs reduce GPU geometry');
  assert.ok(medium.triangles <= 40000 && low.triangles <= 12000, 'mobile vehicle triangle budgets');
  assert.ok(source.triangles <= 90000, 'detailed player vehicle triangle budget');
  for (const [label, model] of [['car-player', source], ['car-lod', medium], ['car-low', low]]) {
    for (const image of model.json.images || []) {
      assert.ok(image.bufferView !== undefined, `${label}: self-contained image`);
      const view = model.json.bufferViews[image.bufferView];
      assertMobileTexture(model.binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength), `${label}/${image.name || image.bufferView}`);
    }
  }
  console.log('Vehicle triangle budgets:', JSON.stringify({source: source.triangles, medium: medium.triangles, low: low.triangles}));
});

test('surface maps and environment are local, attributed, and at most 1024 pixels', async () => {
  const textureDirectory = path.join(assets, 'textures');
  const files = await readdir(textureDirectory);
  for (const name of files) assertMobileTexture(await readFile(path.join(textureDirectory, name)), name);
  for (const surface of ['asphalt', 'concrete', 'paving', 'plaster']) {
    for (const map of ['color', 'normal', 'roughness']) assert.ok(files.includes(`${surface}-${map}.jpg`), `${surface}: complete PBR map set`);
  }
  const sources = JSON.parse(await readFile(path.join(assets, 'sources.json'), 'utf8'));
  for (const source of sources) {
    assert.ok(/^https:\/\//.test(source.source), `${source.path}: origin recorded`);
    assert.ok(source.license, `${source.path}: license recorded`);
    assert.ok((await readFile(path.join(dist, source.path))).length > 0, `${source.path}: source asset exists locally`);
  }
  const credits = await readFile(path.join(assets, 'CREDITS.md'), 'utf8');
  assert.match(credits, /CarConcept|Eric Chadwick/i);
  assert.match(credits, /Poly Haven|PolyHaven/i);
});
