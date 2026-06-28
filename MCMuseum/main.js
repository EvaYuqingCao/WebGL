const canvas = document.querySelector("#glCanvas");
const status = document.querySelector("#status");

const MODEL_URL = "../Assets/EvaMuseum.obj";
const MATERIAL_URL = "../Assets/EvaMuseum.mtl";
const TEXTURE_BASE_URL = "../Assets/Eva_embedded_files/";
const AVAILABLE_TEXTURE_FILES = new Set([
  "Nicolas_Poussin_-_Et_in_Arcadia_ego_(deuxième_version).jpeg",
  "Screen Shot 2024-05-02 at 11.36.50 AM.png",
  "Screen Shot 2024-05-02 at 11.42.05 AM.png",
  "Screen Shot 2024-05-02 at 11.49.52 AM.png",
  "Screen Shot 2024-05-02 at 11.59.05 AM.png",
  "Screen Shot 2024-05-02 at 11.59.24 AM.png",
  "Screen Shot 2024-05-02 at 11.59.39 AM.png",
  "Screen Shot 2024-05-02 at 12.00.17 PM.png",
  "Screen Shot 2024-05-02 at 12.01.22 PM.png",
  "Screen Shot 2024-05-02 at 12.12.27 PM.png",
  "Screen Shot 2024-05-02 at 12.14.06 PM.png",
  "Screen Shot 2024-05-02 at 12.15.53 PM.png",
  "Screen Shot 2024-05-02 at 12.18.19 PM.png",
  "Unnamed.png",
  "industrial-brick-common-3701-in-architextures.jpg",
  "travertine-7874-in-architextures.jpg",
  "walnut-12598-in-architextures.jpg"
]);
const TEXTURE_ALIASES = new Map([
  [
    "finnish-grey-brick-flemish-4075-in-architextures.jpg",
    "industrial-brick-common-3701-in-architextures.jpg"
  ],
  [
    "finnish-grey-brick-flemish-4075-in-architextures_1.jpg",
    "industrial-brick-common-3701-in-architextures.jpg"
  ]
]);

// Tweak these while testing the first-person navigation feel.
const NAVIGATION_SETTINGS = {
  groundHeight: -1.02,
  eyeHeight: 0.34,
  walkSpeed: 1.2,
  sprintMultiplier: 2.0,
  mouseSensitivity: 0.0022,
  keyboardTurnSpeed: 1.7,
  pitchLimit: 1.32
};

const gl = canvas.getContext("webgl", { antialias: true });

if (!gl) {
  setStatus("WebGL is not available in this browser.");
  throw new Error("WebGL is not available.");
}

const vertexShaderSource = `
  attribute vec3 a_position;
  attribute vec3 a_normal;
  attribute vec2 a_texcoord;

  uniform mat4 u_projection;
  uniform mat4 u_view;

  varying vec3 v_normal;
  varying vec2 v_texcoord;

  void main() {
    v_normal = a_normal;
    v_texcoord = a_texcoord;
    gl_Position = u_projection * u_view * vec4(a_position, 1.0);
  }
`;

const fragmentShaderSource = `
  precision highp float;

  uniform sampler2D u_texture;
  uniform vec3 u_lightDirection;

  varying vec3 v_normal;
  varying vec2 v_texcoord;

  void main() {
    vec3 normal = normalize(v_normal);
    float diffuse = abs(dot(normal, normalize(u_lightDirection)));
    float lighting = 0.34 + diffuse * 0.66;
    vec3 albedo = texture2D(u_texture, fract(v_texcoord)).rgb;

    gl_FragColor = vec4(albedo * lighting, 1.0);
  }
`;

const program = createProgram(vertexShaderSource, fragmentShaderSource);
const locations = {
  position: gl.getAttribLocation(program, "a_position"),
  normal: gl.getAttribLocation(program, "a_normal"),
  texcoord: gl.getAttribLocation(program, "a_texcoord"),
  projection: gl.getUniformLocation(program, "u_projection"),
  view: gl.getUniformLocation(program, "u_view"),
  texture: gl.getUniformLocation(program, "u_texture"),
  lightDirection: gl.getUniformLocation(program, "u_lightDirection")
};

const camera = {
  position: [0, NAVIGATION_SETTINGS.groundHeight + NAVIGATION_SETTINGS.eyeHeight, 1.55],
  yaw: 0,
  pitch: 0
};

window.MCMuseumNavigation = NAVIGATION_SETTINGS;
window.MCMuseumCamera = camera;

let drawables = [];
let drawRequested = false;
let renderLoopStarted = false;
let previousFrameTime = 0;

const pressedKeys = new Set();
const movementKeys = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight"
]);

start();

async function start() {
  try {
    setStatus("Loading OBJ and MTL...");
    const [mtlText, objText] = await Promise.all([
      loadText(MATERIAL_URL),
      loadText(MODEL_URL)
    ]);

    setStatus("Parsing museum geometry...");
    await nextFrame();

    const materials = parseMtl(mtlText);
    const model = parseObj(objText);
    const normalizedBounds = normalizeModel(model);

    setStatus("Uploading geometry to WebGL...");
    await nextFrame();

    drawables = createDrawables(model.geometries, materials);
    setupScene();
    startRenderLoop();

    const triangles = drawables.reduce((sum, item) => sum + item.count / 3, 0);
    setStatus(
      `Loaded ${triangles.toLocaleString()} triangles across ${drawables.length} materials. Loading texture maps...`
    );

    const textureReport = await loadMaterialImageTextures(
      [...new Set(drawables.map((item) => item.material))]
    );

    const boundsText = [
      normalizedBounds.min.map(formatNumber).join(", "),
      normalizedBounds.max.map(formatNumber).join(", ")
    ].join(" to ");

    setStatus(
      `${triangles.toLocaleString()} triangles, ${drawables.length} materials, ` +
        `${textureReport.loaded} texture maps loaded, ${textureReport.missing} missing. Bounds: ${boundsText}`
    );
    requestDraw();
  } catch (error) {
    console.error(error);
    setStatus(
      "Could not load the museum assets. Serve this folder with a local static server, then open /MCMuseum/."
    );
  }
}

function setupScene() {
  gl.useProgram(program);
  gl.uniform1i(locations.texture, 0);
  gl.uniform3f(locations.lightDirection, 0.45, 0.85, 0.55);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  canvas.addEventListener("click", handleCanvasClick);
  document.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", clearPressedKeys);
  window.addEventListener("resize", requestDraw);
}

function startRenderLoop() {
  if (renderLoopStarted) return;

  renderLoopStarted = true;
  requestAnimationFrame(renderFrame);
}

function renderFrame(now) {
  const deltaSeconds = previousFrameTime
    ? Math.min((now - previousFrameTime) * 0.001, 0.05)
    : 0;
  previousFrameTime = now;

  updateCamera(deltaSeconds);
  draw();
  requestAnimationFrame(renderFrame);
}

function draw() {
  if (!drawables.length) return;

  resizeCanvasToDisplaySize();

  const projection = new Float32Array(16);
  const view = new Float32Array(16);
  const aspect = canvas.width / canvas.height;
  const forward = getLookDirection();
  const target = [
    camera.position[0] + forward[0],
    camera.position[1] + forward[1],
    camera.position[2] + forward[2]
  ];

  mat4Perspective(projection, Math.PI / 4, aspect, 0.01, 100);
  mat4LookAt(view, camera.position, target, [0, 1, 0]);

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.79, 0.84, 0.83, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.useProgram(program);
  gl.uniformMatrix4fv(locations.projection, false, projection);
  gl.uniformMatrix4fv(locations.view, false, view);

  for (const drawable of drawables) {
    bindAttribute(drawable.positionBuffer, locations.position, 3);
    bindAttribute(drawable.normalBuffer, locations.normal, 3);
    bindAttribute(drawable.texcoordBuffer, locations.texcoord, 2);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, drawable.material.texture);
    gl.drawArrays(gl.TRIANGLES, 0, drawable.count);
  }
}

function requestDraw() {
  if (drawRequested) return;

  drawRequested = true;
  requestAnimationFrame(() => {
    drawRequested = false;
    draw();
  });
}

function updateCamera(deltaSeconds) {
  if (!deltaSeconds) return;

  const forwardAmount = keyAxis("KeyW", "ArrowUp") - keyAxis("KeyS", "ArrowDown");
  const rightAmount = keyAxis("KeyD", "ArrowRight") - keyAxis("KeyA", "ArrowLeft");
  const turnAmount = keyAxis("KeyE") - keyAxis("KeyQ");

  if (turnAmount) {
    camera.yaw += turnAmount * NAVIGATION_SETTINGS.keyboardTurnSpeed * deltaSeconds;
  }

  const forward = [Math.sin(camera.yaw), 0, -Math.cos(camera.yaw)];
  const right = [Math.cos(camera.yaw), 0, Math.sin(camera.yaw)];
  let moveX = forward[0] * forwardAmount + right[0] * rightAmount;
  let moveZ = forward[2] * forwardAmount + right[2] * rightAmount;
  const moveLength = Math.hypot(moveX, moveZ);

  if (moveLength > 0) {
    const sprint = pressedKeys.has("ShiftLeft") || pressedKeys.has("ShiftRight");
    const speed =
      NAVIGATION_SETTINGS.walkSpeed *
      (sprint ? NAVIGATION_SETTINGS.sprintMultiplier : 1);
    const distance = speed * deltaSeconds;

    moveX = (moveX / moveLength) * distance;
    moveZ = (moveZ / moveLength) * distance;
    camera.position[0] += moveX;
    camera.position[2] += moveZ;
  }

  camera.position[1] = NAVIGATION_SETTINGS.groundHeight + NAVIGATION_SETTINGS.eyeHeight;
}

function handleCanvasClick() {
  canvas.focus();

  if (canvas.requestPointerLock && document.pointerLockElement !== canvas) {
    const lockRequest = canvas.requestPointerLock();

    if (lockRequest && typeof lockRequest.catch === "function") {
      lockRequest.catch(() => {});
    }
  }
}

function handleMouseMove(event) {
  if (document.pointerLockElement !== canvas) {
    return;
  }

  camera.yaw += event.movementX * NAVIGATION_SETTINGS.mouseSensitivity;
  camera.pitch = clamp(
    camera.pitch - event.movementY * NAVIGATION_SETTINGS.mouseSensitivity,
    -NAVIGATION_SETTINGS.pitchLimit,
    NAVIGATION_SETTINGS.pitchLimit
  );
}

function handleKeyDown(event) {
  if (!movementKeys.has(event.code)) return;

  event.preventDefault();
  pressedKeys.add(event.code);
}

function handleKeyUp(event) {
  if (!movementKeys.has(event.code)) return;

  event.preventDefault();
  pressedKeys.delete(event.code);
}

function clearPressedKeys() {
  pressedKeys.clear();
}

function keyAxis(primaryCode, alternateCode) {
  return Number(pressedKeys.has(primaryCode) || pressedKeys.has(alternateCode));
}

function getLookDirection() {
  const cosPitch = Math.cos(camera.pitch);

  return [
    Math.sin(camera.yaw) * cosPitch,
    Math.sin(camera.pitch),
    -Math.cos(camera.yaw) * cosPitch
  ];
}

function parseMtl(text) {
  const materials = new Map();
  let current = ensureMaterial(materials, "Default");

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("newmtl ")) {
      current = ensureMaterial(materials, line.slice(7).trim());
    } else if (line.startsWith("Kd ")) {
      current.diffuse = line
        .slice(3)
        .trim()
        .split(/\s+/)
        .slice(0, 3)
        .map(Number);
    } else if (line.startsWith("d ")) {
      current.alpha = Number(line.slice(2).trim());
    } else if (line.startsWith("map_Kd ")) {
      current.mapKd = line.slice(7).trim();
    }
  }

  return materials;
}

function parseObj(text) {
  const sourcePositions = [];
  const sourceTexcoords = [];
  const sourceNormals = [];
  const geometriesByMaterial = new Map();
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  };
  let currentMaterialName = "Default";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("mtllib ")) continue;

    if (line.startsWith("v ")) {
      const values = line.slice(2).trim().split(/\s+/).map(Number);
      sourcePositions.push(values[0], values[1], values[2]);
      expandBounds(bounds, values);
    } else if (line.startsWith("vt ")) {
      const values = line.slice(3).trim().split(/\s+/).map(Number);
      sourceTexcoords.push(values[0], values[1]);
    } else if (line.startsWith("vn ")) {
      const values = line.slice(3).trim().split(/\s+/).map(Number);
      sourceNormals.push(values[0], values[1], values[2]);
    } else if (line.startsWith("usemtl ")) {
      currentMaterialName = line.slice(7).trim();
    } else if (line.startsWith("f ")) {
      const geometry = geometryForMaterial(geometriesByMaterial, currentMaterialName);
      const face = line.slice(2).trim().split(/\s+/);

      for (let i = 1; i < face.length - 1; i += 1) {
        addObjVertex(face[0], geometry, sourcePositions, sourceTexcoords, sourceNormals);
        addObjVertex(face[i], geometry, sourcePositions, sourceTexcoords, sourceNormals);
        addObjVertex(face[i + 1], geometry, sourcePositions, sourceTexcoords, sourceNormals);
      }
    }
  }

  return {
    bounds,
    geometries: [...geometriesByMaterial.values()].filter(
      (geometry) => geometry.positions.length > 0
    )
  };
}

function addObjVertex(token, geometry, sourcePositions, sourceTexcoords, sourceNormals) {
  const parts = token.split("/");
  const positionIndex = resolveObjIndex(parts[0], sourcePositions.length / 3);
  const texcoordIndex = parts[1]
    ? resolveObjIndex(parts[1], sourceTexcoords.length / 2)
    : -1;
  const normalIndex = parts[2] ? resolveObjIndex(parts[2], sourceNormals.length / 3) : -1;

  const p = positionIndex * 3;
  geometry.positions.push(
    sourcePositions[p],
    sourcePositions[p + 1],
    sourcePositions[p + 2]
  );

  if (normalIndex >= 0) {
    const n = normalIndex * 3;
    geometry.normals.push(sourceNormals[n], sourceNormals[n + 1], sourceNormals[n + 2]);
  } else {
    geometry.normals.push(0, 1, 0);
  }

  if (texcoordIndex >= 0) {
    const t = texcoordIndex * 2;
    geometry.texcoords.push(sourceTexcoords[t], sourceTexcoords[t + 1]);
  } else {
    geometry.texcoords.push(0, 0);
  }
}

function normalizeModel(model) {
  const min = model.bounds.min;
  const max = model.bounds.max;
  const centerX = (min[0] + max[0]) * 0.5;
  const centerZ = (min[2] + max[2]) * 0.5;
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const scale = 3.5 / size;
  const normalizedBounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  };

  for (const geometry of model.geometries) {
    const positions = geometry.positions;

    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (positions[i] - centerX) * scale;
      positions[i + 1] = (positions[i + 1] - min[1]) * scale - 1.05;
      positions[i + 2] = (positions[i + 2] - centerZ) * scale;
      expandBounds(normalizedBounds, [
        positions[i],
        positions[i + 1],
        positions[i + 2]
      ]);
    }
  }

  return normalizedBounds;
}

function createDrawables(geometries, materials) {
  return geometries.map((geometry) => {
    const material = ensureMaterial(materials, geometry.materialName);
    material.texture = createSolidTexture(material.diffuse);

    return {
      material,
      count: geometry.positions.length / 3,
      positionBuffer: createBuffer(new Float32Array(geometry.positions)),
      normalBuffer: createBuffer(new Float32Array(geometry.normals)),
      texcoordBuffer: createBuffer(new Float32Array(geometry.texcoords))
    };
  });
}

async function loadMaterialImageTextures(materials) {
  const report = { loaded: 0, missing: 0 };
  const jobs = materials.map(async (material) => {
    if (!material.mapKd) return;

    const textureFile = resolveTextureFile(material.mapKd);
    if (!textureFile) {
      report.missing += 1;
      return;
    }

    try {
      const response = await fetch(textureUrl(textureFile));
      if (!response.ok) {
        report.missing += 1;
        return;
      }

      const blob = await response.blob();
      const image = await loadImage(blob);
      uploadImageTexture(material.texture, image);
      material.loadedTexture = true;
      report.loaded += 1;
      requestDraw();
    } catch (error) {
      console.warn(`Texture unavailable: ${material.mapKd}`, error);
      report.missing += 1;
    }
  });

  await Promise.all(jobs);
  return report;
}

function createShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }

  return shader;
}

function createProgram(vertexSource, fragmentSource) {
  const linkedProgram = gl.createProgram();
  const vertexShader = createShader(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl.FRAGMENT_SHADER, fragmentSource);

  gl.attachShader(linkedProgram, vertexShader);
  gl.attachShader(linkedProgram, fragmentShader);
  gl.linkProgram(linkedProgram);

  if (!gl.getProgramParameter(linkedProgram, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(linkedProgram));
  }

  return linkedProgram;
}

function createBuffer(data) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

function bindAttribute(buffer, location, size) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

function createSolidTexture(diffuse) {
  const texture = gl.createTexture();
  const data = new Uint8Array([
    colorByte(diffuse[0]),
    colorByte(diffuse[1]),
    colorByte(diffuse[2]),
    255
  ]);

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    data
  );
  setTextureParams();

  return texture;
}

function uploadImageTexture(texture, image) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  setTextureParams();
}

function setTextureParams() {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode image."));
    };
    image.src = url;
  });
}

async function loadText(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.text();
}

function resizeCanvasToDisplaySize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function geometryForMaterial(geometries, materialName) {
  if (!geometries.has(materialName)) {
    geometries.set(materialName, {
      materialName,
      positions: [],
      normals: [],
      texcoords: []
    });
  }

  return geometries.get(materialName);
}

function ensureMaterial(materials, name) {
  if (!materials.has(name)) {
    materials.set(name, {
      name,
      diffuse: [0.8, 0.8, 0.8],
      alpha: 1,
      mapKd: null,
      texture: null,
      loadedTexture: false
    });
  }

  return materials.get(name);
}

function resolveObjIndex(value, count) {
  const index = Number(value);
  return index >= 0 ? index - 1 : count + index;
}

function textureUrl(fileName) {
  return TEXTURE_BASE_URL + fileName.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
}

function resolveTextureFile(fileName) {
  const normalized = fileName.replace(/\\/g, "/");
  const baseName = normalized.split("/").pop();

  if (AVAILABLE_TEXTURE_FILES.has(normalized)) return normalized;
  if (AVAILABLE_TEXTURE_FILES.has(baseName)) return baseName;
  if (TEXTURE_ALIASES.has(normalized)) return TEXTURE_ALIASES.get(normalized);
  if (TEXTURE_ALIASES.has(baseName)) return TEXTURE_ALIASES.get(baseName);

  return null;
}

function expandBounds(bounds, values) {
  for (let i = 0; i < 3; i += 1) {
    bounds.min[i] = Math.min(bounds.min[i], values[i]);
    bounds.max[i] = Math.max(bounds.max[i], values[i]);
  }
}

function mat4Perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy * 0.5);

  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = f;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = (2 * far * near) / (near - far);
  out[15] = 0;
}

function mat4LookAt(out, eye, target, up) {
  const z = normalize([
    eye[0] - target[0],
    eye[1] - target[1],
    eye[2] - target[2]
  ]);
  const x = normalize(cross(up, z));
  const y = cross(z, x);

  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[3] = 0;
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[7] = 0;
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[11] = 0;
  out[12] = -dot(x, eye);
  out[13] = -dot(y, eye);
  out[14] = -dot(z, eye);
  out[15] = 1;
}

function normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function colorByte(value) {
  return Math.round(clamp(value, 0, 1) * 255);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setStatus(message) {
  status.textContent = message;
}

function formatNumber(value) {
  return value.toFixed(2);
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
