// ============================================================
// Post pipeline: GTAO → bloom → film grade (vignette, grain,
// chromatic aberration, split-tone) → ACES output → SMAA.
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.44 },
    uGrain: { value: 0.028 },
    uAberration: { value: 0.0022 },
    uDamage: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration, uDamage;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 centered = uv - 0.5;
      float dist = length(centered);

      // subtle barrel distortion
      uv = 0.5 + centered * (1.0 + 0.02 * dist * dist);

      // radial chromatic aberration
      vec2 off = centered * uAberration * (0.4 + dist * 2.0);
      float r = texture2D(tDiffuse, uv + off).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - off).b;
      vec3 col = vec3(r, g, b);

      // split tone: cool shadows, warm highlights
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col += (1.0 - luma) * vec3(-0.006, 0.004, 0.014);
      col += luma * vec3(0.012, 0.006, -0.004);

      // saturation & gentle S-curve
      col = mix(vec3(luma), col, 1.07);
      col = clamp(col, 0.0, 10.0);
      col = col * (1.0 + 0.06 * col) / (1.0 + 0.06 * col * col + 0.0001);

      // vignette
      float vig = smoothstep(0.92, 0.32, dist);
      col *= mix(1.0, vig, uVignette);

      // animated film grain, stronger in shadows
      float grain = (hash(uv * vec2(1920.0, 1080.0) + fract(uTime) * 43.7) - 0.5);
      col += grain * uGrain * (0.35 + 0.65 * (1.0 - luma));

      // damage pulse tint
      col = mix(col, vec3(0.55, 0.05, 0.03), uDamage * 0.35 * smoothstep(0.25, 0.85, dist));

      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPost(renderer, scene, camera, quality = 'high', aoExclude = []) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  let gtao = null;
  if (quality === 'high') {
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.updateGtaoMaterial({
      radius: 0.32, distanceExponent: 1, thickness: 1, scale: 1.15,
      samples: 16, distanceFallOff: 1, screenSpaceRadius: false,
    });
    gtao.updatePdMaterial({
      lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4,
      radiusExponent: 1, rings: 2, samples: 16,
    });
    // keep additive volumes / sprites / viewmodel out of the AO g-buffer
    // (override material would rasterize sprite quads as opaque geometry)
    const origRender = gtao.render.bind(gtao);
    gtao.render = function (r, writeBuffer, readBuffer, dt, mask) {
      const saved = [];
      for (const o of aoExclude) { saved.push(o.visible); o.visible = false; }
      const spriteSaved = [];
      scene.traverse((o) => {
        if (o.isSprite) { spriteSaved.push([o, o.visible]); o.visible = false; }
      });
      origRender(r, writeBuffer, readBuffer, dt, mask);
      for (const [o, v] of spriteSaved) o.visible = v;
      aoExclude.forEach((o, i) => { o.visible = saved[i]; });
    };
    composer.addPass(gtao);
  }

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.55, 1.0);
  composer.addPass(bloom);

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  const output = new OutputPass();
  composer.addPass(output);

  let smaa = null;
  if (quality === 'high') {
    smaa = new SMAAPass(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio());
    composer.addPass(smaa);
  }

  return {
    composer, bloom, grade, gtao,
    resize(w, h) {
      composer.setSize(w, h);
      if (smaa) smaa.setSize(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    },
    update(t) { grade.uniforms.uTime.value = t; },
  };
}