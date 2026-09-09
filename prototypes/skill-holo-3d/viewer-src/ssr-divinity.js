// SSR-only material helpers. Coordinates and RGB are supplied by the card shader;
// time is elapsed seconds, frozen by the caller for pause / reduced motion.
// This module never changes card orientation, foil angle, or printed typography.
export const divinityShader = /* glsl */`
const float divineTau = 6.28318530718;

float divineHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float divineNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(divineHash(cell), divineHash(cell + vec2(1.0, 0.0)), f.x),
             mix(divineHash(cell + vec2(0.0, 1.0)), divineHash(cell + vec2(1.0)), f.x), f.y);
}

float divineSegment(vec2 p, vec2 a, vec2 b) {
  vec2 v = b - a;
  float along = clamp(dot(p - a, v) / max(dot(v, v), .000001), 0.0, 1.0);
  return length(p - a - v * along);
}

mat2 divineRotation(float angle) {
  float c = cos(angle), s = sin(angle);
  return mat2(c, -s, s, c);
}

// A closed but breathing orbit: three paths occupy different depths of the gem.
// Each stays inside the caller's normalized crystal coordinates [-1, 1].
vec2 divineSpiritPath(float phase, float seed) {
  float radius = .36 + seed * .12;
  return vec2(
    sin(phase) * radius * (.90 + .13 * cos(phase * 2.0 + seed)),
    cos(phase) * (.60 - seed * .115) + .09 * sin(phase * 2.0 + seed * 1.8)
  );
}

vec3 divineCrystal(vec2 p, vec3 base, float time) {
  float radius = length(p);
  float inner = 1.0 - smoothstep(.66, 1.12, radius);
  // Only two noise evaluations. A deeper central well separates the spirits
  // from the painted glass; the outer facet rim keeps its original luminance.
  float flowA = divineNoise(p * 2.7 + vec2(time * .039, -time * .025));
  float flowB = divineNoise(p * 4.1 + vec2(-time * .027, time * .033) + flowA * .75);
  float spiral = atan(p.y + .0001, p.x + .0001);
  float currentA = pow(.5 + .5 * sin(radius * 12.0 - spiral * 2.0 - time * .48 + flowA * 3.4), 4.0);
  float currentB = pow(.5 + .5 * sin(p.y * 10.0 + p.x * 4.0 + time * .36 + flowB * 4.2), 5.0);
  vec3 cyan = vec3(.12, .86, 1.0);
  vec3 violet = vec3(.54, .27, 1.0);
  float depthWell = 1.0 - smoothstep(.47, .93, radius);
  vec3 result = base * (1.0 - depthWell * .36);
  result += inner * (cyan * currentA * .15 + violet * currentB * .13);
  result += vec3(.015, .029, .073) * inner * (.4 + flowB * .6);

  // Three spirits, eight segments each. Their 8.8 / 10.5 / 12.2 second periods
  // move white-gold heads and curved, tapering aqua / violet tails continuously.
  // Depth changes modulate opacity gently; no blinking or whole-card pulse.
  for (int spirit = 0; spirit < 3; spirit++) {
    float seed = float(spirit);
    float phase = time * divineTau / (8.8 + seed * 1.7) + seed * 2.17;
    float depth = .72 + .19 * sin(phase + seed * 1.4);
    vec3 tailColor = mix(cyan, violet, seed * .43);
    vec2 head = divineSpiritPath(phase, seed);
    vec2 tangent = normalize(divineSpiritPath(phase + .018, seed) - head);
    vec2 headDelta = p - head;
    vec2 headFrame = vec2(dot(headDelta, tangent), dot(headDelta, vec2(-tangent.y, tangent.x)));
    float headBody = exp(-dot(headFrame / vec2(.085, .040), headFrame / vec2(.085, .040)));
    float headHalo = exp(-dot(headDelta, headDelta) / .016);
    vec2 previous = head;
    float trail = 0.0;
    for (int segment = 0; segment < 8; segment++) {
      float along = float(segment + 1) / 8.0;
      vec2 next = divineSpiritPath(phase - along * 1.28, seed);
      float distanceToTail = divineSegment(p, previous, next);
      float width = mix(.040, .012, along);
      float ribbon = exp(-distanceToTail * distanceToTail / (width * width));
      // Max, rather than sum, prevents bright knots at the segment joints.
      trail = max(trail, ribbon * pow(1.0 - along * .91, 1.15));
      previous = next;
    }
    result += inner * depth * (tailColor * (trail * .55 + headHalo * .055)
      + vec3(1.0, .95, .79) * headBody * .67);
  }
  return min(result, vec3(1.35));
}

vec3 divineCosmos(vec2 uv, vec3 base, float time) {
  vec2 p = uv - vec2(.50, .55);
  float distanceToCore = length(p * vec2(1.0, .78));
  // A low-amplitude nebula drift preserves the generated background painting.
  // This uses analytic waves, avoiding additional noise or texture samples.
  float drift = .5 + .5 * sin(p.x * 12.0 + p.y * 7.0 - time * .115
    + sin(p.y * 11.0 + time * .09));
  float halo = exp(-distanceToCore * distanceToCore * 10.0);
  vec3 result = base + mix(vec3(.007, .014, .043), vec3(.024, .008, .040), drift) * halo;

  // Two crossing elliptical meridians connect the artifact to its surrounding
  // space. The arcs themselves stay still; only three motes travel each orbit.
  for (int orbit = 0; orbit < 2; orbit++) {
    float seed = float(orbit);
    mat2 rotation = divineRotation(.59 - seed * 1.28);
    vec2 axes = vec2(.46 - seed * .04, .18 + seed * .04);
    vec2 local = rotation * p;
    vec2 q = local / axes;
    float radial = length(q);
    float angle = atan(q.y, q.x);
    float arcGate = smoothstep(-.80, -.24, sin(angle + seed * 2.6));
    float line = exp(-pow((radial - 1.0) / .012, 2.0));
    float softLine = exp(-pow((radial - 1.0) / .055, 2.0));
    vec3 orbitColor = mix(vec3(.24, .64, .87), vec3(.77, .54, .23), seed);
    result += orbitColor * arcGate * (line * .19 + softLine * .022);

    // Small, stable lights take 22 / 29 seconds around a meridian; no twinkle.
    for (int mote = 0; mote < 3; mote++) {
      float phase = time * divineTau / (22.0 + seed * 7.0)
        + float(mote) * divineTau / 3.0 + seed * 1.4;
      vec2 position = vec2(cos(phase), sin(phase)) * axes;
      vec2 delta = local - position;
      float core = exp(-dot(delta, delta) / .000018);
      float glow = exp(-dot(delta, delta) / .00032);
      result += orbitColor * (core * .63 + glow * .075);
    }
  }
  return min(result, vec3(1.20));
}
`;
