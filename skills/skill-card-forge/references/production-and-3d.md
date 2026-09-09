# Layering, motion, and 3D adaptation

## Layer contract

Static art needs no production layers. When a layered, animated, or 3D export is requested, produce or request:

- `subject.png`: independent equipment RGBA with true alpha.
- `background.png`: environment without a duplicate equipment; selected static inhabitants may remain.
- `lineart.png`: pixel-registered to the subject.
- `text.png`: deterministic typesetting, separate from art.
- `foil_mask.png`: empty for C/R; equipment-only for SR; text excluded for every grade.
- Optional `core_mask.png` for core motion, depth layers for domain parallax, and an independent inhabitant layer with habitat/path/occlusion for moving external beings.

If alpha cannot be produced, use uniform white only for an explicit technical cutout. Never use a painted checkerboard. Keep every layer aligned to the approved artwork; layer processing must not redesign it.

## Interaction and motion

Product adaptation must implement a small pointer-position tilt and settle on pointer leave. Click, Enter, and Space flip the card. Do not add automatic rotation, drag-to-rotate, a separate back-action button, whole-card flash, or automatic foil sweep.

C/R/SR have no idle time loop. SSR may have one local slow response, core flow, or occasional inhabitant event; foil remains view-driven, never time-driven. Freeze local motion when paused, reduced-motion is requested, the back is visible, the card is off-screen, or the document is hidden. The static/reduced-motion pose must remain clear.

## Full 3D export with holo-card-studio

Use this path only when the user asks for a full 3D export and installed `holo-card-studio` is available. Its source pipeline consumes `project/card-config.json` and `assets/{subject,background,lineart,text}.png`, then generates `card.glb`. The glTF can truthfully provide a card body with real thickness, edges, and front/back geometry. Subject/background layering and view-dependent parallax are **2.5D**; do not claim the illustrated equipment itself is a true volumetric model.

Do not modify the installed vendor Skill. Do not rerun its generic pipeline over an existing customized viewer: its template copy can overwrite custom web work. Instead, retain a separate product-owned viewer source and use an adaptation/rebuild layer modelled on a project-local rebuild flow that preserves `viewer-src` while replacing generated assets. Adapt the exported web viewer to the interaction and grade rules above: C/R no holo, SR equipment-only, SSR full card excluding text and only local life/motion.

Blender custom shaders do not survive glTF export. Implement any browser foil/motion as an explicit product viewer adaptation, document the difference, and never promise pixel-identical Blender and web rendering. If `holo-card-studio`, its runtime, or required assets are missing, report the missing capability and provide the valid prompt/layer plan; do not silently install a replacement, rewrite the vendor engine, or misrepresent a static result as 3D.
