# Angle Studio

Turn a 2D image (character, creature, prop) into a pseudo-3D relief you can orbit and light, to study proportions, angles and lighting.

## Start
1. Double-click **`start.bat`**. It needs [Node.js](https://nodejs.org) and opens `http://localhost:5178`.
2. Put images into the **`images/`** folder (PNG, JPG, WEBP…). They appear in the left panel within a few seconds. You can also drag images onto the window or click ＋.
3. Click an image. The first time, the AI depth model downloads (~25 MB, cached afterwards). Each image's depth is saved in `images/_depth/`, so it's instant next time.

## How it works
- **AI depth**: [Depth Anything V2 (small)](https://huggingface.co/onnx-community/depth-anything-v2-small) runs **locally in your browser** through transformers.js (WebGPU if available, otherwise CPU). No account, no API key, and your images never leave your computer.
- The depth map displaces a dense grid, which gives a 3D relief. **Mirror back side** adds a mirrored back so it reads as a solid volume, and **Round edges** closes the silhouette.
- **Limit:** a single image has no information about the back or hidden parts. It looks convincing up to about ±45°. For full 360°, generate a `.glb` with an image-to-3D tool (TripoSR, Hunyuan3D, TRELLIS, Meshy, Tripo…) and drop the `.glb` into `images/`. Lights, clay mode and camera presets all work on it.

## Tips for best results
- One subject per image, with a full body visible.
- **Transparent PNGs** give perfect cutouts. Otherwise, adjust **Remove background**.
- Use **Clay** mode to judge lighting. The Color mode includes the light already painted into the image.
- **Edge tear**: lower values cut more between overlapping parts (an arm in front of the body), and higher values connect them with stretched surfaces.
- **Save depth map** exports the grayscale depth, which you can paint over in Photoshop (white = near). Load it back with *Depth source → Custom depth map*.

## Lights
- Add **Point** (bulb), **Spot** (cone) or **Sun** (parallel, like daylight) lights, or pick a **Preset**.
- Click a bulb in the viewport (or its card) and drag the arrows to move it. **Place at camera** or the <kbd>C</kbd> key puts it where you're looking from.
- Each light has color, power, shadows on/off, and for spot lights cone size and edge softness. **Ambient** controls the overall fill.

## Shortcuts
`1–5` camera angles · `S` screenshot · `C` move the selected light to the camera · `Delete` remove the selected light · `Esc` deselect

## Files
| File | Purpose |
|---|---|
| `serve.js` | Tiny local server: serves the app, lists `images/`, saves uploads and depth maps |
| `js/app.js` | 3D scene (three.js), depth to mesh, lights, library, UI |
| `js/depth.js` | AI depth estimation and image helpers (blur, cutout, inflate) |
| `css/style.css` | UI theme |
