# MCMuseum WebGL Scene

Small, dependency-free WebGL scene that loads `Assets/EvaMuseum.obj` and
`Assets/EvaMuseum.mtl` into `MCMuseum/`.

## How To Run

Serve this folder with any local static server, then open:

`http://127.0.0.1:4173/MCMuseum/`

For example, from this folder:

```sh
python3 -m http.server 4173
```

Opening `MCMuseum/index.html` directly from Finder may show the page, but most
browsers block JavaScript from loading local OBJ, MTL, and image files through
`file://`.

## Files

- `MCMuseum/index.html` contains the page and canvas.
- `MCMuseum/main.js` loads the OBJ, MTL, and available texture maps.
- `Assets/` contains the model, material file, and embedded texture images.
- `shared/site.css` contains the page styling.

## Navigation

Click the canvas once to enter mouse-look mode. Use `WASD` or the arrow keys
to walk on the XZ ground plane. Use `Q` and `E` for keyboard turning, and hold
`Shift` to move faster.

The first-person tuning values are near the top of `MCMuseum/main.js`:

```js
const NAVIGATION_SETTINGS = {
  groundHeight: -1.02,
  eyeHeight: 0.34,
  walkSpeed: 1.2,
  sprintMultiplier: 2.0,
  mouseSensitivity: 0.0022,
  keyboardTurnSpeed: 1.7,
  pitchLimit: 1.32
};
```

At runtime, the same object is exposed as `window.MCMuseumNavigation`, and the
live camera is exposed as `window.MCMuseumCamera`, so you can tweak values in
DevTools and immediately test the feel.

## Local Machine Check

This machine has Chrome and Safari installed, so WebGL should work.

No `node` or `npm` install is needed. The system `python3` command currently
appears to require macOS Command Line Tools, but Codex has a bundled Python
runtime available for serving and verification.
