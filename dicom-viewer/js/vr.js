/* ==========================================================================
   CT Console — GPU volume rendering.

   Raymarches a WebGL2 3D texture of the CT volume. Two output modes:
     · "vr"  — front-to-back compositing through a transfer function, with
               gradient-based shading, i.e. the familiar 3D reconstruction.
     · "mip" — maximum intensity projection through the whole volume.

   The transfer functions are the usual clinical starting points (bone, angio,
   soft tissue, lung) expressed as HU control points, uploaded as a 256-entry
   RGBA lookup texture.
   ========================================================================== */
(function (global) {
  "use strict";

  var VERT = [
    "#version 300 es",
    "in vec2 aPos;",
    "out vec2 vUV;",
    "void main() {",
    "  vUV = aPos * 0.5 + 0.5;",
    "  gl_Position = vec4(aPos, 0.0, 1.0);",
    "}",
  ].join("\n");

  var FRAG = [
    "#version 300 es",
    "precision highp float;",
    "precision highp sampler3D;",
    "",
    "in vec2 vUV;",
    "out vec4 fragColor;",
    "",
    "uniform sampler3D uVolume;",
    "uniform sampler2D uTransfer;",
    "uniform mat4 uInvView;",   // camera -> world
    "uniform vec3 uBoxSize;",   // world half-extents of the volume box
    "uniform float uStep;",     // ray step in world units
    "uniform float uFov;",
    "uniform float uAspect;",
    "uniform int uMode;",       // 0 = composite VR, 1 = MIP
    "uniform float uOpacity;",  // global opacity scale
    "uniform vec2 uClip;",      // normalised sample range to keep [lo, hi]
    "",
    "// Ray vs axis-aligned box, slab method.",
    "bool intersectBox(vec3 ro, vec3 rd, vec3 half_, out float t0, out float t1) {",
    "  vec3 inv = 1.0 / rd;",
    "  vec3 a = (-half_ - ro) * inv;",
    "  vec3 b = ( half_ - ro) * inv;",
    "  vec3 lo = min(a, b);",
    "  vec3 hi = max(a, b);",
    "  t0 = max(max(lo.x, lo.y), lo.z);",
    "  t1 = min(min(hi.x, hi.y), hi.z);",
    "  return t1 > max(t0, 0.0);",
    "}",
    "",
    "vec3 toTexCoord(vec3 p) {",
    "  return p / (2.0 * uBoxSize) + 0.5;",
    "}",
    "",
    "float sampleVolume(vec3 p) {",
    "  return texture(uVolume, toTexCoord(p)).r;",
    "}",
    "",
    "// Central-difference gradient, used as a surface normal for shading.",
    "vec3 gradient(vec3 p, float h) {",
    "  float dx = sampleVolume(p + vec3(h, 0.0, 0.0)) - sampleVolume(p - vec3(h, 0.0, 0.0));",
    "  float dy = sampleVolume(p + vec3(0.0, h, 0.0)) - sampleVolume(p - vec3(0.0, h, 0.0));",
    "  float dz = sampleVolume(p + vec3(0.0, 0.0, h)) - sampleVolume(p - vec3(0.0, 0.0, h));",
    "  return vec3(dx, dy, dz);",
    "}",
    "",
    "void main() {",
    "  // Build a camera ray for this pixel.",
    "  vec2 ndc = vUV * 2.0 - 1.0;",
    "  float tanHalf = tan(uFov * 0.5);",
    "  vec3 dirCam = normalize(vec3(ndc.x * tanHalf * uAspect, ndc.y * tanHalf, -1.0));",
    "  vec3 ro = (uInvView * vec4(0.0, 0.0, 0.0, 1.0)).xyz;",
    "  vec3 rd = normalize((uInvView * vec4(dirCam, 0.0)).xyz);",
    "",
    "  float t0, t1;",
    "  if (!intersectBox(ro, rd, uBoxSize, t0, t1)) {",
    "    fragColor = vec4(0.0);",
    "    return;",
    "  }",
    "  t0 = max(t0, 0.0);",
    "",
    "  if (uMode == 1) {",
    "    // Maximum intensity projection.",
    "    float peak = 0.0;",
    "    for (float t = t0; t < t1; t += uStep) {",
    "      float s = sampleVolume(ro + rd * t);",
    "      if (s >= uClip.x && s <= uClip.y) peak = max(peak, s);",
    "    }",
    "    fragColor = vec4(vec3(peak), 1.0);",
    "    return;",
    "  }",
    "",
    "  // Front-to-back compositing.",
    "  vec4 acc = vec4(0.0);",
    "  float h = uStep;",
    "  for (float t = t0; t < t1; t += uStep) {",
    "    vec3 p = ro + rd * t;",
    "    float s = sampleVolume(p);",
    "    if (s < uClip.x || s > uClip.y) continue;",
    "",
    "    vec4 tf = texture(uTransfer, vec2(s, 0.5));",
    "    float alpha = tf.a * uOpacity;",
    "    if (alpha <= 0.001) continue;",
    "",
    "    // Shade with the local gradient; flat regions keep their base colour.",
    "    vec3 g = gradient(p, h);",
    "    float gl = length(g);",
    "    vec3 colour = tf.rgb;",
    "    if (gl > 0.0001) {",
    "      vec3 n = normalize(g);",
    "      vec3 lightDir = normalize(-rd + vec3(0.35, 0.45, 0.0));",
    "      float diffuse = abs(dot(n, lightDir));",
    "      float spec = pow(max(dot(reflect(-lightDir, n), -rd), 0.0), 24.0);",
    "      colour = colour * (0.35 + 0.75 * diffuse) + vec3(0.6) * spec * 0.35;",
    "    }",
    "",
    "    // Opacity correction keeps density consistent as the step changes.",
    "    float a = 1.0 - pow(1.0 - alpha, uStep * 220.0);",
    "    acc.rgb += (1.0 - acc.a) * a * colour;",
    "    acc.a += (1.0 - acc.a) * a;",
    "    if (acc.a > 0.98) break;",  // early ray termination
    "  }",
    "  fragColor = acc;",
    "}",
  ].join("\n");

  /* ---------------------------------------------------------------------
   * Transfer functions — control points are (HU, r, g, b, alpha)
   * ------------------------------------------------------------------- */
  var TRANSFER_FUNCTIONS = {
    bone: {
      label: "Bone",
      points: [
        [-1024, 0.00, 0.00, 0.00, 0.00],
        [  140, 0.00, 0.00, 0.00, 0.00],
        [  250, 0.78, 0.72, 0.58, 0.28],
        [  600, 0.94, 0.90, 0.80, 0.72],
        [ 1500, 1.00, 0.99, 0.95, 0.92],
        [ 3071, 1.00, 1.00, 1.00, 0.96],
      ],
    },
    angio: {
      label: "Angio",
      points: [
        [-1024, 0.00, 0.00, 0.00, 0.00],
        [  120, 0.00, 0.00, 0.00, 0.00],
        [  180, 0.72, 0.16, 0.12, 0.22],
        [  320, 0.92, 0.32, 0.22, 0.62],
        [  600, 0.98, 0.78, 0.60, 0.80],
        [ 1400, 1.00, 0.97, 0.90, 0.92],
        [ 3071, 1.00, 1.00, 1.00, 0.95],
      ],
    },
    soft: {
      label: "Soft Tissue",
      points: [
        [-1024, 0.00, 0.00, 0.00, 0.00],
        [ -200, 0.00, 0.00, 0.00, 0.00],
        [  -60, 0.75, 0.48, 0.40, 0.10],
        [   60, 0.88, 0.62, 0.52, 0.32],
        [  200, 0.92, 0.76, 0.66, 0.46],
        [  700, 0.96, 0.92, 0.86, 0.80],
        [ 3071, 1.00, 1.00, 1.00, 0.92],
      ],
    },
    lung: {
      label: "Lung",
      points: [
        [-1024, 0.00, 0.00, 0.00, 0.00],
        [ -950, 0.30, 0.40, 0.62, 0.02],
        [ -750, 0.48, 0.62, 0.82, 0.10],
        [ -500, 0.72, 0.80, 0.92, 0.22],
        [ -200, 0.90, 0.72, 0.66, 0.34],
        [  300, 0.96, 0.88, 0.80, 0.62],
        [ 3071, 1.00, 1.00, 1.00, 0.88],
      ],
    },
    skin: {
      label: "Skin",
      points: [
        [-1024, 0.00, 0.00, 0.00, 0.00],
        [ -400, 0.00, 0.00, 0.00, 0.00],
        [ -150, 0.86, 0.68, 0.58, 0.42],
        [  100, 0.92, 0.78, 0.68, 0.72],
        [ 3071, 1.00, 0.96, 0.92, 0.88],
      ],
    },
  };

  /**
   * Rasterise a transfer function into a 256-entry RGBA LUT. The LUT is
   * indexed by the *normalised* sample value, so it has to be built against
   * the same [windowLow, windowHigh] the texture was packed with.
   */
  function buildTransferLUT(name, windowLow, windowHigh) {
    var tf = TRANSFER_FUNCTIONS[name] || TRANSFER_FUNCTIONS.bone;
    var pts = tf.points;
    var lut = new Uint8Array(256 * 4);
    var range = windowHigh - windowLow || 1;

    for (var i = 0; i < 256; i++) {
      var hu = windowLow + (i / 255) * range;
      var p0 = pts[0], p1 = pts[pts.length - 1];
      for (var k = 0; k < pts.length - 1; k++) {
        if (hu >= pts[k][0] && hu <= pts[k + 1][0]) { p0 = pts[k]; p1 = pts[k + 1]; break; }
        if (hu < pts[0][0]) { p0 = p1 = pts[0]; break; }
        if (hu > pts[pts.length - 1][0]) { p0 = p1 = pts[pts.length - 1]; break; }
      }
      var span = p1[0] - p0[0];
      var f = span > 0 ? (hu - p0[0]) / span : 0;
      lut[i * 4 + 0] = Math.round(255 * (p0[1] + (p1[1] - p0[1]) * f));
      lut[i * 4 + 1] = Math.round(255 * (p0[2] + (p1[2] - p0[2]) * f));
      lut[i * 4 + 2] = Math.round(255 * (p0[3] + (p1[3] - p0[3]) * f));
      lut[i * 4 + 3] = Math.round(255 * (p0[4] + (p1[4] - p0[4]) * f));
    }
    return lut;
  }

  /* ---------------------------------------------------------------------
   * Renderer
   * ------------------------------------------------------------------- */
  function VolumeRenderer(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", { alpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!this.gl) throw new Error("WebGL2 is not available in this browser — 3D volume rendering needs it.");

    var gl = this.gl;
    this.program = linkProgram(gl, VERT, FRAG);
    this.uniforms = collectUniforms(gl, this.program);

    // Full-screen triangle pair.
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(this.program, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.volumeTex = null;
    this.transferTex = null;
    this.boxSize = [0.5, 0.5, 0.5];
    this.rotX = -1.35;   // start looking at the body from slightly above front
    this.rotY = 0.0;
    this.distance = 2.6;
    this.opacity = 1.0;
    this.mode = "vr";
    this.clip = [0.0, 1.0];
    this.quality = 1.0;
  }

  VolumeRenderer.prototype.dispose = function () {
    var gl = this.gl;
    if (this.volumeTex) gl.deleteTexture(this.volumeTex);
    if (this.transferTex) gl.deleteTexture(this.transferTex);
    this.volumeTex = this.transferTex = null;
  };

  /** Upload a packed volume (from CTVolume.packTexture). */
  VolumeRenderer.prototype.setVolume = function (packed) {
    var gl = this.gl;
    if (this.volumeTex) gl.deleteTexture(this.volumeTex);

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texImage3D(
      gl.TEXTURE_3D, 0, gl.R8,
      packed.width, packed.height, packed.depth, 0,
      gl.RED, gl.UNSIGNED_BYTE, packed.data
    );
    this.volumeTex = tex;
    this.packed = packed;

    // Keep the body's real proportions: scale the box by physical extent.
    var maxSize = Math.max(packed.sizeX, packed.sizeY, packed.sizeZ) || 1;
    this.boxSize = [
      0.5 * packed.sizeX / maxSize,
      0.5 * packed.sizeY / maxSize,
      0.5 * packed.sizeZ / maxSize,
    ];
    // Step small enough to cross the thinnest axis in plenty of samples.
    var maxDim = Math.max(packed.width, packed.height, packed.depth);
    this.baseStep = 1.0 / (maxDim * 1.6);
  };

  VolumeRenderer.prototype.setTransferFunction = function (name, windowLow, windowHigh) {
    var gl = this.gl;
    var lut = buildTransferLUT(name, windowLow, windowHigh);
    if (this.transferTex) gl.deleteTexture(this.transferTex);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
    this.transferTex = tex;
    this.transferName = name;
  };

  VolumeRenderer.prototype.orbit = function (dx, dy) {
    this.rotY += dx * 0.01;
    this.rotX += dy * 0.01;
    var limit = Math.PI / 2 - 0.01;
    // Keep the camera off the poles so the view can't flip.
    this.rotX = Math.max(-Math.PI + 0.01, Math.min(Math.PI - 0.01, this.rotX));
    void limit;
  };

  VolumeRenderer.prototype.zoom = function (factor) {
    this.distance = Math.max(0.7, Math.min(8, this.distance * factor));
  };

  VolumeRenderer.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(rect.width * dpr * this.quality));
    var h = Math.max(1, Math.round(rect.height * dpr * this.quality));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  };

  VolumeRenderer.prototype.render = function () {
    var gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.volumeTex || !this.transferTex) return;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, this.volumeTex);
    gl.uniform1i(this.uniforms.uVolume, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.transferTex);
    gl.uniform1i(this.uniforms.uTransfer, 1);

    gl.uniformMatrix4fv(this.uniforms.uInvView, false, this.cameraMatrix());
    gl.uniform3fv(this.uniforms.uBoxSize, this.boxSize);
    gl.uniform1f(this.uniforms.uStep, this.baseStep);
    gl.uniform1f(this.uniforms.uFov, 0.9);
    gl.uniform1f(this.uniforms.uAspect, this.canvas.width / this.canvas.height);
    gl.uniform1i(this.uniforms.uMode, this.mode === "mip" ? 1 : 0);
    gl.uniform1f(this.uniforms.uOpacity, this.opacity);
    gl.uniform2fv(this.uniforms.uClip, this.clip);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  };

  /** Orbit camera -> inverse view matrix (camera space to world space). */
  VolumeRenderer.prototype.cameraMatrix = function () {
    var cx = Math.cos(this.rotX), sx = Math.sin(this.rotX);
    var cy = Math.cos(this.rotY), sy = Math.sin(this.rotY);

    // Camera position on a sphere around the origin.
    var eye = [
      this.distance * cx * sy,
      this.distance * sx,
      this.distance * cx * cy,
    ];

    var f = normalize([-eye[0], -eye[1], -eye[2]]);        // forward (-Z)
    var upHint = Math.abs(f[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
    var s = normalize(cross(f, upHint));                    // right (+X)
    var u = cross(s, f);                                    // up (+Y)

    // Column-major inverse-view: [right, up, -forward, eye]
    return new Float32Array([
      s[0], s[1], s[2], 0,
      u[0], u[1], u[2], 0,
      -f[0], -f[1], -f[2], 0,
      eye[0], eye[1], eye[2], 1,
    ]);
  };

  /* ---------------------------------------------------------------------
   * Small helpers
   * ------------------------------------------------------------------- */
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function normalize(v) {
    var len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  function compile(gl, type, source) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error("Shader compile failed: " + log);
    }
    return sh;
  }

  function linkProgram(gl, vertSrc, fragSrc) {
    var vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
    var fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error("Program link failed: " + log);
    }
    return prog;
  }

  function collectUniforms(gl, program) {
    var out = {};
    var count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < count; i++) {
      var info = gl.getActiveUniform(program, i);
      out[info.name] = gl.getUniformLocation(program, info.name);
    }
    return out;
  }

  global.CTVolumeRenderer = {
    Renderer: VolumeRenderer,
    TRANSFER_FUNCTIONS: TRANSFER_FUNCTIONS,
    buildTransferLUT: buildTransferLUT,
    isSupported: function () {
      try {
        var c = document.createElement("canvas");
        return !!c.getContext("webgl2");
      } catch (err) {
        return false;
      }
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
