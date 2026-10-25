import * as THREE from './vendor/three.module.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {clone as cloneSkeleton} from './vendor/SkeletonUtils.js';

// Cesium Man, ©2017 Cesium, CC BY4.0. See assets/CREDITS.md and
// assets/pedestrians/SOURCE.md. Skeletal meshes are pooled; distant walkers use
// the city's cheap instanced silhouettes. No animation loops run outside update.
export async function createCharacters(scene, pedestrians) {
  const gltf = await new GLTFLoader().loadAsync('./assets/pedestrians/citizen.glb');
  const source = gltf.scene;
  source.updateMatrixWorld(true);
  source.traverse(node => { if (node.isSkinnedMesh) node.skeleton.update(); });
  const bounds = new THREE.Box3().setFromObject(source);
  const height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height < .1 || !gltf.animations.length) {
    throw new Error('The citizen asset is missing its skeleton or walking animation.');
  }
  const scale = 1.75 / height;
  const clip = gltf.animations[0];
  const previous = new WeakMap();
  const pool = [];
  const clothingTints = [0xffffff, 0xe9edff, 0xfff0dc, 0xe5f0df, 0xffe8df, 0xe1eef1];
  let sourceTriangles = 0;
  source.traverse(node => {
    if (node.isMesh) sourceTriangles += (node.geometry.index?.count || node.geometry.attributes.position.count) / 3;
  });
  const metrics = {loadedAsset:true, asset:'CesiumMan', license:'CC-BY-4.0', pooledCount:6, activeCount:0, activeTriangles:0, trianglesPerCharacter:sourceTriangles, animated:true};
  for (let i=0; i<6; i++) {
    const wrapper = new THREE.Group();
    wrapper.name = `CitizenAnimated${i+1}`;
    const model = cloneSkeleton(source);
    model.scale.setScalar(scale);
    model.position.y = -bounds.min.y * scale;
    // Source asset faces +Z after its authored axis-conversion hierarchy.
    model.rotation.y = Math.PI;
    const materialCache = new Map();
    const meshes = [];
    model.traverse(node => {
      if (!node.isMesh) return;
      const originals = Array.isArray(node.material) ? node.material : [node.material];
      const variants = originals.map(material => {
        if (!materialCache.has(material)) {
          const variant = material.clone();
          variant.color.multiply(new THREE.Color(clothingTints[i]));
          variant.roughness = .95;
          variant.metalness = 0;
          variant.envMapIntensity = .55;
          if (variant.map) variant.map.anisotropy = 2;
          materialCache.set(material, variant);
        }
        return materialCache.get(material);
      });
      node.material = Array.isArray(node.material) ? variants : variants[0];
      node.frustumCulled = false;
      node.receiveShadow = true;
      meshes.push(node);
    });
    wrapper.add(model);
    wrapper.visible = false;
    scene.add(wrapper);
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(clip);
    action.play();
    mixer.setTime((i * .173 * clip.duration) % clip.duration);
    pool.push({wrapper,model,mixer,action,meshes,person:null});
  }

  function update(dt, time, player={x:-5,z:55}) {
    const chosen = pedestrians
      .map(person => ({person, distance:Math.hypot(person.x-player.x, person.z-player.z)}))
      .filter(item => item.distance < 75)
      .sort((a,b) => a.distance-b.distance)
      .slice(0, pool.length);
    const selected = new Set(chosen.map(item=>item.person));
    for (const slot of pool) {
      if (!selected.has(slot.person)) {
        slot.person = null;
        slot.wrapper.visible = false;
      }
    }
    for (const {person,distance} of chosen) {
      const slot = pool.find(item=>item.person===person) || pool.find(item=>!item.person);
      slot.person = person;
      slot.wrapper.visible = true;
      slot.wrapper.position.set(person.x,person.crossing?.12:.30,person.z);
      slot.wrapper.rotation.y = person.mesh.rotation.y;
      person.mesh.visible = false;
      const old = previous.get(person);
      const moved = old ? Math.hypot(person.x-old.x,person.z-old.z) : 0;
      const walkingSpeed = dt > 0 ? Math.min(1.7,moved/dt) : 0;
      slot.action.timeScale = walkingSpeed / 1.1;
      slot.mixer.update(Math.max(0,Math.min(dt,.1)));
      for (const mesh of slot.meshes) mesh.castShadow = distance < 38;
    }
    for (const person of pedestrians) previous.set(person,{x:person.x,z:person.z});
    metrics.activeCount=chosen.length;
    metrics.activeTriangles=chosen.length*sourceTriangles;
  }
  update(0,0);
  return {update,metrics};
}
