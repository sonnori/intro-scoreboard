/**
 * The stage.
 *
 * Two coloured light fields meet at a seam on the floor. The seam is not
 * decoration: its position is the score difference, so the leading team is
 * visibly pushing the other one off the stage. Everything else here — grid,
 * haze, ripples — exists to make that one reading legible from a camera.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const MAX_RIPPLES = 5;
const HALF_WIDTH = 15; // world units from centre to the edge of play

const floorVert = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vXZ = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const floorFrag = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3  uColorA;
  uniform vec3  uColorB;
  uniform float uSeam;
  uniform float uEnergyA;
  uniform float uEnergyB;
  uniform vec3  uSeamColor;
  uniform float uAlert;      // 0..1 — a team is one point from the match
  uniform float uAlertSide;  // -1 = A's half, +1 = B's half
  uniform vec4  uRipples[${MAX_RIPPLES}];  // x, z, birth, side
  varying vec2 vXZ;

  float gridMask(vec2 p, float scale, float weight) {
    vec2 c = p * scale;
    vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
    return 1.0 - min(min(g.x, g.y) / weight, 1.0);
  }

  void main() {
    vec2 p = vXZ;                                   // p.y grows away from camera
    float dist  = max(0.0, p.y + 17.5);
    float depth = exp(-dist * 0.062) * smoothstep(34.0, 12.0, p.y);  // no hard horizon
    float edge  = smoothstep(38.0, 8.0, abs(p.x));

    float fine  = gridMask(p, 0.5, 1.3) * 0.16;
    float major = gridMask(p, 0.125, 1.5) * 0.42;
    float grid  = max(fine, major);

    // territory: everything left of the seam belongs to A
    float side = smoothstep(1.6, -1.6, p.x - uSeam);
    vec3 tint  = mix(uColorB * uEnergyB, uColorA * uEnergyA, side);

    // light pools rather than a flat wash, so the floor has a centre of gravity
    float pool = exp(-abs(p.x - uSeam) * 0.045) * 0.30
               + exp(-length(p - vec2(uSeam, -4.0)) * 0.07) * 0.22;

    // the line of scrimmage: a hot filament where the two territories meet
    float d     = p.x - uSeam;
    float hot   = exp(-d * d * 2.6);
    float bleed = exp(-abs(d) * 0.5) * 0.20;
    float pulse = 0.78 + 0.22 * sin(p.y * 0.34 - uTime * 1.7);

    float ripple = 0.0;
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 r = uRipples[i];
      if (r.z < 0.0) continue;
      float age = uTime - r.z;
      if (age < 0.0 || age > 2.2) continue;
      float d = length(p - r.xy);
      float radius = age * 11.0;
      float band = exp(-pow(d - radius, 2.0) * 1.4);
      ripple += band * (1.0 - age / 2.2);
    }

    // match point: that team's half beats, and waves roll toward the seam
    float own  = uAlertSide < -0.5 ? side : (uAlertSide > 0.5 ? 1.0 - side : 1.0);
    float beat = 0.62 + 0.38 * sin(uTime * 3.4);
    float roll = 0.5 + 0.5 * sin(p.x * 0.28 * -uAlertSide - uTime * 2.6);
    float alert = uAlert * own * (beat * 0.5 + roll * 0.5);

    vec3 col = tint * (grid * (0.85 + alert * 1.5) + pool * (0.42 + alert * 0.5));
    col += uSeamColor * (hot * (0.95 + uAlert * 0.7) * pulse + bleed);
    col += mix(uColorB, uColorA, side) * ripple * 1.1;
    col *= depth * edge * 0.9;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const dustVert = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uSeam;
  uniform vec3  uColorA;
  uniform vec3  uColorB;
  varying vec3  vColor;
  varying float vFade;

  void main() {
    vec3 p = position;
    p.y = mod(p.y + uTime * (0.20 + aSeed * 0.35), 16.0);
    p.x += sin(uTime * 0.28 + aSeed * 40.0) * 1.3;
    float side = smoothstep(1.5, -1.5, p.x - uSeam);
    vColor = mix(uColorB, uColorA, side);
    vFade = smoothstep(16.0, 3.0, p.y)
          * smoothstep(30.0, 16.0, abs(p.x))
          * smoothstep(-22.0, -4.0, p.z);   // thin out toward the back wall
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (14.0 + aSeed * 22.0) / max(1.0, -mv.z) * 6.0;
    gl_Position = projectionMatrix * mv;
  }
`;

const dustFrag = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vFade * 0.22;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }
`;

const burstVert = /* glsl */ `
  attribute vec3 aVel;
  attribute float aSeed;
  uniform float uAge;
  varying float vFade;
  void main() {
    vec3 p = position + aVel * uAge;
    p.y -= 4.2 * uAge * uAge;
    vFade = smoothstep(3.4, 0.4, uAge) * step(0.0, p.y);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (9.0 + aSeed * 20.0) / max(1.0, -mv.z) * 6.0;
    gl_Position = projectionMatrix * mv;
  }
`;

const burstFrag = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.1, d) * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

export function createArena(canvas) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor(0x07080f, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x07080f, 0.018);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
  const camHome = new THREE.Vector3(0, 9.4, 17.5);
  camera.position.copy(camHome);
  camera.lookAt(0, 1.2, 0);

  const colorA = new THREE.Color('#12e3e3');
  const colorB = new THREE.Color('#ff2e88');

  /* floor */
  const ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -1, 0));
  const floorMat = new THREE.ShaderMaterial({
    vertexShader: floorVert,
    fragmentShader: floorFrag,
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: colorA },
      uColorB: { value: colorB },
      uSeam: { value: 0 },
      uEnergyA: { value: 1 },
      uEnergyB: { value: 1 },
      uSeamColor: { value: new THREE.Color('#ffffff') },
      uAlert: { value: 0 },
      uAlertSide: { value: -1 },
      uRipples: { value: ripples },
    },
    fog: false,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 70, 1, 1), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  /* drifting haze */
  const DUST = 700;
  const dustGeo = new THREE.BufferGeometry();
  const dpos = new Float32Array(DUST * 3);
  const dseed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dpos[i * 3] = (Math.random() - 0.5) * 56;
    dpos[i * 3 + 1] = Math.random() * 16;
    dpos[i * 3 + 2] = -20 + Math.random() * 28;
    dseed[i] = Math.random();
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dseed, 1));
  const dustMat = new THREE.ShaderMaterial({
    vertexShader: dustVert,
    fragmentShader: dustFrag,
    uniforms: {
      uTime: { value: 0 },
      uSeam: { value: 0 },
      uColorA: { value: colorA },
      uColorB: { value: colorB },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Points(dustGeo, dustMat));

  /* win burst */
  const BURST = 700;
  const burstGeo = new THREE.BufferGeometry();
  const bpos = new Float32Array(BURST * 3);
  const bvel = new Float32Array(BURST * 3);
  const bseed = new Float32Array(BURST);
  for (let i = 0; i < BURST; i++) bseed[i] = Math.random();
  burstGeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
  burstGeo.setAttribute('aVel', new THREE.BufferAttribute(bvel, 3));
  burstGeo.setAttribute('aSeed', new THREE.BufferAttribute(bseed, 1));
  const burstMat = new THREE.ShaderMaterial({
    vertexShader: burstVert,
    fragmentShader: burstFrag,
    uniforms: { uAge: { value: 99 }, uColor: { value: new THREE.Color('#ffffff') } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const burst = new THREE.Points(burstGeo, burstMat);
  burst.frustumCulled = false;
  burst.visible = false;
  scene.add(burst);

  /* post */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.46, 0.75, 0.5);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let seamTarget = 0;
  let seamNow = 0;
  let alertTarget = 0;
  let shake = 0;
  let burstAge = 99;
  let running = true;
  let rippleSlot = 0;

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    // keep the whole stage in frame on narrow screens
    camera.fov = w / h < 1 ? 62 : 46;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
  }
  resize();
  window.addEventListener('resize', resize);

  const clock = new THREE.Clock();
  let t = 0;

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    t += reduced ? dt * 0.15 : dt;

    seamNow += (seamTarget - seamNow) * Math.min(1, dt * 4.5);
    const seamX = seamNow * HALF_WIDTH;

    const alert = floorMat.uniforms.uAlert;
    alert.value += (alertTarget - alert.value) * Math.min(1, dt * 3);

    floorMat.uniforms.uTime.value = t;
    floorMat.uniforms.uSeam.value = seamX;
    dustMat.uniforms.uTime.value = t;
    dustMat.uniforms.uSeam.value = seamX;

    // the line of scrimmage wears the leading team's colour
    const lead = THREE.MathUtils.clamp(seamNow * 2.4, -1, 1);
    floorMat.uniforms.uSeamColor.value
      .copy(colorB)
      .lerp(colorA, (lead + 1) / 2)
      .multiplyScalar(0.55 + Math.abs(lead) * 0.5);

    if (burstAge < 3.6) {
      burstAge += dt;
      burstMat.uniforms.uAge.value = burstAge;
    } else if (burst.visible) {
      burst.visible = false;
    }

    shake *= 1 - Math.min(1, dt * 5);
    const sway = reduced ? 0 : Math.sin(t * 0.22) * 0.5;
    camera.position.set(
      camHome.x + sway + (Math.random() - 0.5) * shake,
      camHome.y + Math.cos(t * 0.17) * 0.22 + (Math.random() - 0.5) * shake,
      camHome.z
    );
    camera.lookAt(seamX * 0.12, 1.2, 0);

    composer.render();
  }
  requestAnimationFrame(frame);

  return {
    setColors(a, b) {
      colorA.set(a);
      colorB.set(b);
    },
    /** @param {number} n normalised lead: +1 A has pushed B off the stage, -1 the reverse */
    setSeam(n) {
      seamTarget = THREE.MathUtils.clamp(n, -1, 1);
    },
    setEnergy(a, b) {
      floorMat.uniforms.uEnergyA.value = 0.55 + a * 0.75;
      floorMat.uniforms.uEnergyB.value = 0.55 + b * 0.75;
    },
    /** @param {'a'|'b'|'both'|null} side whose half is one point from the match */
    setAlert(side) {
      alertTarget = side ? 1 : 0;
      if (side) floorMat.uniforms.uAlertSide.value = side === 'a' ? -1 : side === 'b' ? 1 : 0;
    },
    /** shockwave on the scoring team's half */
    pulse(side) {
      const x = side === 'a' ? -7 - Math.random() * 5 : 7 + Math.random() * 5;
      ripples[rippleSlot].set(x, -2 + (Math.random() - 0.5) * 8, t, side === 'a' ? -1 : 1);
      rippleSlot = (rippleSlot + 1) % MAX_RIPPLES;
      if (!reduced) shake = 0.14;
    },
    burst(color) {
      burstMat.uniforms.uColor.value.set(color);
      const p = burstGeo.attributes.position.array;
      const v = burstGeo.attributes.aVel.array;
      for (let i = 0; i < BURST; i++) {
        p[i * 3] = (Math.random() - 0.5) * 34;
        p[i * 3 + 1] = 0.3;
        p[i * 3 + 2] = -10 + Math.random() * 16;
        const a = Math.random() * Math.PI * 2;
        const s = 2 + Math.random() * 6;
        v[i * 3] = Math.cos(a) * s * 0.8;
        v[i * 3 + 1] = 7 + Math.random() * 9;
        v[i * 3 + 2] = Math.sin(a) * s * 0.5;
      }
      burstGeo.attributes.position.needsUpdate = true;
      burstGeo.attributes.aVel.needsUpdate = true;
      burstAge = 0;
      burstMat.uniforms.uAge.value = 0;
      burst.visible = true;
      if (!reduced) shake = 0.3;
    },
    dispose() {
      running = false;
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };
}
