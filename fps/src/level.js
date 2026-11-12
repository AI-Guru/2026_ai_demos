// ============================================================
// SECTOR 07 — sublevel maintenance bay. One dense room:
// concrete shell, steel props, volumetric light slits, puddles.
// ============================================================
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

const ROOM = { w: 24, d: 18, h: 6 }; // x: -12..12, z: -9..9

function cloneMaps(set, rx, ry) {
  const out = {};
  for (const k of ['map', 'normalMap', 'ormMap']) {
    const t = set[k].clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    out[k] = t;
  }
  return out;
}

function stdMat(set, rx, ry, extra = {}) {
  const m = cloneMaps(set, rx, ry);
  return new THREE.MeshStandardMaterial({
    map: m.map,
    normalMap: m.normalMap,
    roughnessMap: m.ormMap,
    metalnessMap: m.ormMap,
    roughness: 1.0,
    metalness: 1.0,
    normalScale: new THREE.Vector2(1, 1),
    envMapIntensity: 0.45,
    ...extra,
  });
}

export function buildLevel(scene, tex, renderer) {
  RectAreaLightUniformsLib.init();
  const colliders = [];   // Box3 list for physics
  const solids = [];      // meshes for bullet raycasts
  const animators = [];   // fns(t, dt)
  const atmoObjects = []; // excluded from AO g-buffer

  const addCollider = (mesh, pad = 0) => {
    mesh.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(mesh);
    if (pad) box.expandByScalar(pad);
    colliders.push(box);
  };

  const box = (w, h, d, mat, x, y, z, opts = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = opts.cast !== false;
    m.receiveShadow = opts.receive !== false;
    scene.add(m);
    if (opts.solid !== false) { addCollider(m); solids.push(m); }
    return m;
  };

  // ---------------- shell ----------------
  const floorMat = stdMat(tex.floor, 6, 4.5, { envMapIntensity: 0.7 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor); solids.push(floor);

  const ceilMat = stdMat(tex.ceiling, 6, 4.5, { envMapIntensity: 0.15 });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = ROOM.h;
  ceil.receiveShadow = true;
  scene.add(ceil); solids.push(ceil);

  const wallMatX = stdMat(tex.concrete, 6, 1.5);
  const wallMatZ = stdMat(tex.concrete, 4.5, 1.5);
  const T = 0.5;
  box(ROOM.w + T * 2, ROOM.h, T, wallMatZ, 0, ROOM.h / 2, -ROOM.d / 2 - T / 2); // north
  box(ROOM.w + T * 2, ROOM.h, T, wallMatZ, 0, ROOM.h / 2, ROOM.d / 2 + T / 2);  // south
  box(T, ROOM.h, ROOM.d, wallMatX, -ROOM.w / 2 - T / 2, ROOM.h / 2, 0);          // west
  box(T, ROOM.h, ROOM.d, wallMatX, ROOM.w / 2 + T / 2, ROOM.h / 2, 0);           // east

  // pilasters
  const pilMat = stdMat(tex.concrete, 0.5, 1.5);
  for (let x = -9; x <= 9; x += 6) {
    box(0.7, ROOM.h, 0.55, pilMat, x, ROOM.h / 2, -ROOM.d / 2 + 0.27);
    box(0.7, ROOM.h, 0.55, pilMat, x, ROOM.h / 2, ROOM.d / 2 - 0.27);
  }
  for (let z = -6; z <= 6; z += 6) {
    box(0.55, ROOM.h, 0.7, pilMat, -ROOM.w / 2 + 0.27, ROOM.h / 2, z);
    box(0.55, ROOM.h, 0.7, pilMat, ROOM.w / 2 - 0.27, ROOM.h / 2, z);
  }

  // ceiling beams
  const beamMat = stdMat(tex.metal, 6, 0.4, { envMapIntensity: 0.6 });
  for (const z of [-6, 0, 6]) box(ROOM.w, 0.55, 0.7, beamMat, 0, ROOM.h - 0.28, z, { solid: false });

  // ---------------- blast door (north wall) ----------------
  const doorMat = stdMat(tex.metal, 1.6, 1.7, { envMapIntensity: 0.8 });
  const door = box(4.4, 4.6, 0.28, doorMat, 0, 2.3, -ROOM.d / 2 + 0.16);
  const signMat = new THREE.MeshStandardMaterial({
    map: tex.sign, roughness: 0.6, metalness: 0.3, envMapIntensity: 0.5,
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), signMat);
  sign.position.set(0, 2.55, -ROOM.d / 2 + 0.315);
  scene.add(sign); solids.push(sign);
  // hazard frame
  const hazMat = stdMat(tex.hazard, 2, 0.3);
  box(5.2, 0.35, 0.34, hazMat, 0, 4.78, -ROOM.d / 2 + 0.17, { solid: false });
  box(0.35, 4.95, 0.34, hazMat, -2.6, 2.47, -ROOM.d / 2 + 0.17, { solid: false });
  box(0.35, 4.95, 0.34, hazMat, 2.6, 2.47, -ROOM.d / 2 + 0.17, { solid: false });
  // red status lamp
  const lampRed = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2010, emissiveIntensity: 4 })
  );
  lampRed.position.set(0, 5.15, -ROOM.d / 2 + 0.3);
  scene.add(lampRed);
  const redLight = new THREE.PointLight(0xff3020, 6, 8, 2);
  redLight.position.copy(lampRed.position).z += 0.4;
  scene.add(redLight);
  animators.push((t) => {
    const p = 0.6 + 0.4 * Math.sin(t * 2.4);
    lampRed.material.emissiveIntensity = 2.5 + p * 2.5;
    redLight.intensity = 3 + p * 4;
  });
  // floor hazard strip before door
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.7), stdMat(tex.hazard, 2.6, 0.35));
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, 0.006, -ROOM.d / 2 + 1.0);
  strip.receiveShadow = true;
  scene.add(strip); solids.push(strip);

  // ---------------- crates & barrels ----------------
  const crateMat = stdMat(tex.crate, 1, 1, { envMapIntensity: 0.5 });
  const crateGeo = new THREE.BoxGeometry(1.15, 1.15, 1.15);
  const crateAt = (x, z, ry = 0, y = 0.575) => {
    const m = new THREE.Mesh(crateGeo, crateMat);
    m.position.set(x, y, z); m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true;
    scene.add(m); addCollider(m); solids.push(m);
    return m;
  };
  crateAt(-7.5, -5.2, 0.12); crateAt(-6.3, -5.5, -0.2); crateAt(-7.0, -5.0, 0.4, 1.725);
  crateAt(8.2, 4.8, 0.3); crateAt(9.3, 5.4, -0.15); crateAt(8.6, 5.9, 0.7);
  crateAt(8.7, 5.0, 0.1, 1.725);
  crateAt(-9.5, 6.2, -0.35); crateAt(-9.0, 7.2, 0.2);
  crateAt(4.6, -6.8, 0.5); crateAt(5.8, -6.4, -0.1);
  crateAt(-2.8, 2.6, 0.8); // center cover

  const barrelMat = stdMat(tex.metal, 1.2, 0.8, { envMapIntensity: 0.7 });
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.15, 20);
  const bandGeo = new THREE.CylinderGeometry(0.425, 0.425, 0.22, 20);
  const bandMat = stdMat(tex.hazard, 1.4, 0.25);
  const barrelAt = (x, z) => {
    const g = new THREE.Group();
    const b = new THREE.Mesh(barrelGeo, barrelMat);
    b.castShadow = b.receiveShadow = true;
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.y = 0.18; band.castShadow = true;
    g.add(b, band); g.position.set(x, 0.575, z);
    scene.add(g); addCollider(b); solids.push(b);
  };
  barrelAt(10.6, -7.4); barrelAt(10.0, -6.6); barrelAt(10.9, -6.3);
  barrelAt(-10.7, -1.8); barrelAt(-10.2, -2.7);
  barrelAt(2.2, 7.6); barrelAt(3.0, 7.9);

  // ---------------- pipes & cable tray ----------------
  const pipeMat = stdMat(tex.metal, 4, 0.3, { envMapIntensity: 0.9 });
  const pipeGeo = new THREE.CylinderGeometry(0.09, 0.09, ROOM.d - 1, 10);
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(pipeGeo, pipeMat);
    p.rotation.x = Math.PI / 2;
    p.position.set(ROOM.w / 2 - 0.35 - i * 0.26, 4.15 + i * 0.24, 0);
    p.castShadow = true;
    scene.add(p); solids.push(p);
  }
  // vertical pipe drops
  const dropGeo = new THREE.CylinderGeometry(0.09, 0.09, 4.2, 10);
  for (const z of [-7.5, 7.5]) {
    const p = new THREE.Mesh(dropGeo, pipeMat);
    p.position.set(ROOM.w / 2 - 0.35, 2.1, z);
    p.castShadow = true; scene.add(p); solids.push(p);
  }
  // cable tray along west wall
  const tray = box(0.4, 0.1, ROOM.d - 2, stdMat(tex.metal, 0.4, 6), -ROOM.w / 2 + 0.45, 4.6, 0, { solid: false });

  // ---------------- wall strip lights (cool) ----------------
  const stripEmissive = new THREE.MeshStandardMaterial({
    color: 0x0a1418, emissive: 0x9fdcff, emissiveIntensity: 3.2, roughness: 0.4,
  });
  const stripHousing = stdMat(tex.metal, 4, 0.2);
  const addStrip = (x, z, ry, len) => {
    const g = new THREE.Group();
    const h = new THREE.Mesh(new THREE.BoxGeometry(len, 0.16, 0.1), stripHousing);
    const e = new THREE.Mesh(new THREE.BoxGeometry(len - 0.2, 0.07, 0.06), stripEmissive);
    e.position.z = 0.05;
    g.add(h, e);
    g.position.set(x, 2.7, z); g.rotation.y = ry;
    scene.add(g);
    const rl = new THREE.RectAreaLight(0x9fdcff, 4.5, len, 0.2);
    rl.position.set(x + Math.sin(ry) * 0.15, 2.7, z + Math.cos(ry) * 0.15);
    rl.rotation.y = ry + Math.PI; // RectAreaLight emits along local -Z
    scene.add(rl);
  };
  // west & east walls, facing inward
  addStrip(-ROOM.w / 2 + 0.28, -3.5, Math.PI / 2, 7);
  addStrip(-ROOM.w / 2 + 0.28, 4.0, Math.PI / 2, 5);
  addStrip(ROOM.w / 2 - 0.28, 0.5, -Math.PI / 2, 8);

  // ---------------- warm maintenance lamps ----------------
  const lampFixtureMat = stdMat(tex.metal, 0.4, 0.4);
  const lampLensMat = new THREE.MeshStandardMaterial({
    color: 0x201408, emissive: 0xffb46b, emissiveIntensity: 5, roughness: 0.3,
  });
  const addLamp = (x, z, ry) => {
    const g = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.45), lampFixtureMat);
    arm.position.z = 0.2;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.3), lampFixtureMat);
    hood.position.set(0, 0.05, 0.45); hood.castShadow = true;
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), lampLensMat);
    lens.rotation.x = Math.PI / 2; lens.position.set(0, -0.04, 0.45);
    g.add(arm, hood, lens);
    g.position.set(x, 3.6, z); g.rotation.y = ry;
    scene.add(g);
    const pl = new THREE.PointLight(0xffb46b, 22, 13, 2);
    pl.position.set(x + Math.sin(ry) * 0.6, 3.4, z + Math.cos(ry) * 0.6);
    scene.add(pl);
  };
  addLamp(-6, -ROOM.d / 2 + 0.25, 0);
  addLamp(6, -ROOM.d / 2 + 0.25, 0);
  addLamp(-ROOM.w / 2 + 0.25, 7.5, Math.PI / 2);
  addLamp(ROOM.w / 2 - 0.25, -7.5, -Math.PI / 2);

  // ---------------- ceiling light slits + sun spots + shafts ----------------
  const slitMat = new THREE.MeshStandardMaterial({
    color: 0x111111, emissive: 0xfff0d8, emissiveIntensity: 9,
  });
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xffe9c4) },
      uOpacity: { value: 0.13 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
      }
      void main() {
        float facing = pow(abs(dot(normalize(vNormal), normalize(vViewDir))), 1.6);
        float vert = pow(vUv.y, 1.7);                 // bright at top
        float floorFade = smoothstep(0.0, 0.18, vUv.y);
        float streaks = 0.72 + 0.28 * noise(vec2(vUv.x * 9.0, vUv.y * 2.5 - uTime * 0.06));
        float a = uOpacity * facing * vert * floorFade * streaks;
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  animators.push((t) => { shaftMat.uniforms.uTime.value = t; });

  const slits = [
    { x: -7, z: -2.5, tilt: 0.10 },
    { x: 0.5, z: 2.5, tilt: -0.06 },
    { x: 7.5, z: -3.0, tilt: 0.14 },
  ];
  const sunSpots = [];
  for (const s of slits) {
    const slit = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.0), slitMat);
    slit.rotation.x = Math.PI / 2;
    slit.position.set(s.x, ROOM.h - 0.02, s.z);
    scene.add(slit);
    // frame
    const fr = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.3), beamMat);
    fr.position.set(s.x, ROOM.h - 0.06, s.z);
    scene.add(fr);

    const spot = new THREE.SpotLight(0xfff0d8, 175, 26, 0.46, 0.55, 1.8);
    spot.position.set(s.x, ROOM.h - 0.1, s.z);
    spot.target.position.set(s.x + s.tilt * 6, 0, s.z + s.tilt * 3);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0003;
    spot.shadow.camera.near = 0.5;
    spot.shadow.camera.far = 20;
    scene.add(spot, spot.target);
    sunSpots.push(spot);

    // volumetric shaft (4-sided frustum reads as a square column of light)
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 1.75, ROOM.h - 0.1, 4, 1, true),
      shaftMat
    );
    shaft.rotation.y = Math.PI / 4;
    shaft.position.set(s.x + s.tilt * 3, (ROOM.h - 0.1) / 2, s.z + s.tilt * 1.5);
    shaft.rotation.z = -s.tilt * 0.5;
    shaft.renderOrder = 5;
    scene.add(shaft);
    atmoObjects.push(shaft);
  }

  // ---------------- puddles ----------------
  const puddleMat = new THREE.MeshStandardMaterial({
    color: 0x06080b, metalness: 0.0, roughness: 0.045,
    normalMap: tex.concrete.normalMap,
    normalScale: new THREE.Vector2(0.05, 0.05),
    envMapIntensity: 3.2,
    transparent: true,
    alphaMap: tex.softCircle,
    depthWrite: false,
  });
  const puddleAt = (x, z, r, sx, sz) => {
    const p = new THREE.Mesh(new THREE.CircleGeometry(r, 28), puddleMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 0.004, z);
    p.scale.set(sx, sz, 1);
    p.receiveShadow = true;
    p.renderOrder = 1;
    scene.add(p); solids.push(p);
  };
  puddleAt(-4.5, 0.5, 1.9, 1.3, 0.8);
  puddleAt(5.5, 2.8, 1.4, 0.9, 1.25);
  puddleAt(1.5, -4.5, 2.2, 1.1, 0.7);

  // ---------------- vents (drone entry points) ----------------
  const ventMat = stdMat(tex.metal, 0.8, 0.6, { envMapIntensity: 0.8 });
  const ventGlowMat = new THREE.MeshStandardMaterial({
    color: 0x05070a, emissive: 0xff4030, emissiveIntensity: 2.0,
  });
  const ventInnerMat = new THREE.MeshStandardMaterial({
    color: 0x161a20, roughness: 0.9, metalness: 0.2,
    emissive: 0x5a1a0e, emissiveIntensity: 2.2,
  });
  const ventSlatMat = new THREE.MeshStandardMaterial({
    color: 0x6a7078, metalness: 0.6, roughness: 0.5, envMapIntensity: 0.9,
  });
  const droneSpawns = [];
  const addVent = (x, z, ry) => {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 0.25), ventMat);
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.95), ventInnerMat);
    dark.position.z = 0.14;
    g.add(frame, dark);
    for (let i = 0; i < 5; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.05, 0.05), ventSlatMat);
      slat.position.set(0, -0.38 + i * 0.19, 0.17);
      slat.rotation.x = 0.5;
      g.add(slat);
    }
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.06), ventGlowMat);
    glow.position.set(0, -0.55, 0.15);
    g.add(glow);
    g.position.set(x, 2.3, z); g.rotation.y = ry;
    scene.add(g);
    const inward = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
    droneSpawns.push(new THREE.Vector3(x, 2.3, z).addScaledVector(inward, 1.1));
  };
  addVent(-ROOM.w / 2 + 0.14, -4.5, Math.PI / 2);
  addVent(-ROOM.w / 2 + 0.14, 5.0, Math.PI / 2);
  addVent(ROOM.w / 2 - 0.14, 3.0, -Math.PI / 2);
  addVent(ROOM.w / 2 - 0.14, -5.5, -Math.PI / 2);

  // ---------------- scattered debris ----------------
  const debrisMat = stdMat(tex.concrete, 0.3, 0.3);
  const debrisGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(debrisGeo, debrisMat);
    const s = 0.06 + hash(i) * 0.16;
    m.scale.set(s, s * 0.6, s * (0.7 + hash(i + 40) * 0.8));
    m.position.set((hash(i + 10) - 0.5) * 21, s * 0.3, (hash(i + 20) - 0.5) * 15.5);
    m.rotation.y = hash(i + 30) * Math.PI;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
  function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  // ---------------- dust motes ----------------
  const DUST = 420;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST * 3);
  const dustSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * (ROOM.w - 2);
    dustPos[i * 3 + 1] = Math.random() * (ROOM.h - 0.5) + 0.2;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * (ROOM.d - 2);
    dustSeed[i] = Math.random() * 100;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    map: tex.glow, color: 0xcfe4ff, size: 0.026, transparent: true, opacity: 0.22,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.renderOrder = 6;
  scene.add(dust);
  atmoObjects.push(dust);
  animators.push((t) => {
    const p = dustGeo.attributes.position.array;
    for (let i = 0; i < DUST; i++) {
      const s = dustSeed[i];
      p[i * 3] += Math.sin(t * 0.22 + s) * 0.0011;
      p[i * 3 + 1] += Math.cos(t * 0.17 + s * 1.7) * 0.0008 - 0.0004;
      p[i * 3 + 2] += Math.sin(t * 0.19 + s * 2.3) * 0.0011;
      if (p[i * 3 + 1] < 0.15) p[i * 3 + 1] = ROOM.h - 0.4;
    }
    dustGeo.attributes.position.needsUpdate = true;
  });

  // ---------------- global lighting & atmosphere ----------------
  scene.fog = new THREE.FogExp2(0x07090d, 0.016);
  const hemi = new THREE.HemisphereLight(0x35455a, 0x2a241e, 0.7);
  scene.add(hemi);

  return {
    colliders,
    solids,
    droneSpawns,
    sunSpots,
    atmoObjects,
    playerSpawn: new THREE.Vector3(0, 0, 6.5),
    bounds: { minX: -ROOM.w / 2 + 0.6, maxX: ROOM.w / 2 - 0.6, minZ: -ROOM.d / 2 + 0.6, maxZ: ROOM.d / 2 - 0.6 },
    update(t, dt) { for (const a of animators) a(t, dt); },
  };
}