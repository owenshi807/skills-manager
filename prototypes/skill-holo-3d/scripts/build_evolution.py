"""Build four editable equipment tiers from the original thick-card Blender source.

Run with Blender --background --python scripts/build_evolution.py -- PROJECT.
This writes equipment-evolution.blend only; card.blend stays the original master.
"""
import hashlib
import json
import sys
from pathlib import Path

import bpy


TIERS = {
    'C': ('素木放大镜', 'none'),
    'R': ('双轴勘察镜', 'none'),
    'SR': ('三相解析镜', 'subject'),
    'SSR': ('万象重构镜', 'full'),
}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def setting(nodes, name, socket, value):
    """Fail loudly if the source material contract changes."""
    nodes[name].inputs[socket].default_value = value


def tier_image_paths(root, tier):
    """Keep semantic input roles separate from their actual source filenames."""
    directory = root / 'assets' / 'tiers' / tier
    paths = {key: directory / f'{key}.png' for key in ('subject', 'lineart', 'text')}
    if tier == 'SSR':
        paths.update(subject=directory / 'subject-divine.png',
                     background=directory / 'background.png',
                     crystal_mask=directory / 'crystal-mask.png')
    return paths


def replace_tree_images(tree, tier, images, group_copies):
    for node in tree.nodes:
        if node.type == 'TEX_IMAGE' and node.image:
            key = Path(bpy.path.abspath(node.image.filepath)).stem
            if key in images:
                node.image = images[key]
        elif tier == 'SSR' and node.type == 'GROUP' and node.node_tree:
            # The foil group contains a background-image texture. Copy its whole
            # hierarchy before replacement so C/R/SR keep the original imagery.
            source = node.node_tree
            if source not in group_copies:
                group_copies[source] = source.copy()
                group_copies[source].name = f'SSR · {source.name}'
                group_copies[source].animation_data_clear()
                replace_tree_images(group_copies[source], tier, images, group_copies)
            node.node_tree = group_copies[source]


def configure_material(material, tier, images, group_copies):
    tree = material.node_tree
    tree.animation_data_clear()
    nodes = tree.nodes
    replace_tree_images(tree, tier, images, group_copies)
    if '叠加 · 主体镭射' in nodes:
        settings = {
            'C': (0, 0, 0, 0, 0),
            'R': (0, 0, 0, 0, 0),
            'SR': (.18, 0, .10, .004, 0),
            'SSR': (.30, .18, .15, .006, 2.5),
        }[tier]
        for (name, socket), value in zip([
            ('叠加 · 主体镭射', 0), ('背景轻镭射', 0),
            ('条纹强度', 1), ('限制辉光覆盖 0.018', 1),
            ('闪星亮度', 1),
        ], settings):
            setting(nodes, name, socket, value)
        for name in ('主体原理化 · 金属1 / 糙度1', '背景原理化 · 金属1 / 糙度1'):
            setting(nodes, name, 'Metallic', {'C': .02, 'R': .15, 'SR': .6, 'SSR': 1}[tier])
            setting(nodes, name, 'Roughness', {'C': .95, 'R': .85, 'SR': .7, 'SSR': .6}[tier])
        # A static noise field responds to view-dependent UVs; no timeline flicker.
        setting(nodes, '闪烁 · 四维噪波', 'W', 0)
        material['镭射范围'] = TIERS[tier][1]
        if tier == 'SSR':
            reference = nodes.new('ShaderNodeTexImage')
            reference.name = '晶体灵魂区域 · 网页实时效果输入'
            reference.label = '精确晶体遮罩；动画由 ssr-divinity.js 实现'
            reference.image = images['crystal_mask']
            reference.extension = 'CLIP'
            reference.location = (-900, 1660)
            frame = nodes.new('NodeFrame')
            frame.name = 'SSR 晶体灵魂 · 网页动画参考'
            frame.label = '打包源输入参考；此 Blender 场景仅提供静态神域与可编辑材质'
            reference.parent = frame
            material['晶体灵魂动画'] = '网页 ssr-divinity.js 使用 crystal-mask.png 限定实时动画区域；本材质未实现该动画。'
    if '卡边黑色金属' in nodes:
        edge = nodes['卡边黑色金属']
        edge.inputs['Emission Strength'].default_value = .42 if tier == 'SSR' else 0
        edge.inputs['Base Color'].default_value = {
            'C': (.16, .12, .08, 1), 'R': (.035, .085, .11, 1),
            'SR': (.17, .11, .035, 1), 'SSR': (.025, .02, .035, 1),
        }[tier]
        edge.inputs['Metallic'].default_value = .05 if tier == 'C' else .7
    if '古金金属' in nodes:
        setting(nodes, '古金金属', 'Base Color', {
            'C': (.25, .18, .105, 1), 'R': (.31, .27, .14, 1),
            'SR': (.63, .37, .10, 1), 'SSR': (.83, .55, .17, 1),
        }[tier])
        setting(nodes, '古金金属', 'Metallic', .1 if tier == 'C' else .8)


def make_scene(base, tier, root):
    title, foil_scope = TIERS[tier]
    scene = bpy.data.scenes.new(f'{tier} · {title}')
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 20
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 720
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = str(root / 'renders' / f'equipment-{tier}.png')
    scene.view_settings.view_transform = base.view_settings.view_transform
    scene.view_settings.look = base.view_settings.look
    scene.world = base.world.copy()
    scene.world.name = f'{tier} · 摄影棚'
    scene.frame_start = scene.frame_end = 1
    card_collection = bpy.data.collections.new(f'{tier} · 可编辑卡体与材质')
    scene.collection.children.link(card_collection)
    source_collection = bpy.data.collections.new(f'{tier} · 原始输入参考')
    scene.collection.children.link(source_collection)
    studio_collection = bpy.data.collections.new(f'{tier} · 相机灯光')
    scene.collection.children.link(studio_collection)
    images = {}
    for key, path in tier_image_paths(root, tier).items():
        image = bpy.data.images.load(str(path), check_existing=False)
        image.name = f'{tier} · {title} · {key}'
        if tuple(image.size) != (1024, 1536):
            raise ValueError(f'Unexpected dimensions: {path}, {tuple(image.size)}')
        if key in ('subject', 'text') and image.channels != 4:
            raise ValueError(f'RGBA is required: {path}')
        if key in ('lineart', 'crystal_mask'):
            image.colorspace_settings.name = 'Non-Color'
        image.filepath = bpy.path.relpath(str(path), start=str(root))
        image.pack()
        images[key] = image
    objects = {}
    materials = {}
    group_copies = {}
    for original in base.objects:
        obj = original.copy()
        obj.name = f'{tier} · {original.name}'
        obj.animation_data_clear()
        if original.data:
            obj.data = original.data.copy()
            if hasattr(obj.data, 'animation_data_clear'):
                obj.data.animation_data_clear()
        target = (studio_collection if obj.type in ('CAMERA', 'LIGHT') else
                  source_collection if original.hide_render else card_collection)
        target.objects.link(obj)
        objects[original] = obj
        if obj.type == 'MESH':
            for slot in obj.material_slots:
                source = slot.material
                if source not in materials:
                    copy = source.copy()
                    copy.name = f'{tier} · {source.name}'
                    configure_material(copy, tier, images, group_copies)
                    materials[source] = copy
                slot.material = materials[source]
    for original, obj in objects.items():
        obj.parent = objects.get(original.parent)
        if obj.type == 'EMPTY':
            obj.rotation_euler = (0, 0, 0)
            obj['使用说明'] = '静态展示；手动旋转检查视差。无自动转卡或时间闪烁。'
            obj['装备名称'] = title
            obj['等级'] = tier
    pivot = next(obj for obj in objects.values() if obj.type == 'EMPTY')
    config = json.loads((root / 'card-config.json').read_text(encoding='utf-8-sig'))
    pivot['主体缩放'] = config.get('parameters', {}).get('subjectScale', 1.05)
    for material in materials.values():
        nodes = material.node_tree.nodes
        for node_name, socket_name, property_name in [
            ('主体 · 1.25 / 0.4', '缩放', '主体缩放'),
            ('主体 · 1.25 / 0.4', '深度', '主体深度'),
            ('背景 · 1 / −0.25', '深度', '背景深度'),
        ]:
            if node_name in nodes:
                driver = nodes[node_name].inputs[socket_name].driver_add('default_value').driver
                driver.type = 'SCRIPTED'
                variable = driver.variables.new()
                variable.name = 'value'
                variable.targets[0].id = pivot
                variable.targets[0].data_path = f'["{property_name}"]'
                driver.expression = 'value'
    scene.camera = objects[base.camera]
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    layers = tree.nodes.new('CompositorNodeRLayers')
    layers.scene = scene
    composite = tree.nodes.new('CompositorNodeComposite')
    if tier in ('SR', 'SSR'):
        glare = tree.nodes.new('CompositorNodeGlare')
        glare.glare_type = 'FOG_GLOW'
        glare.quality = 'HIGH'
        glare.threshold = 1.5
        glare.size = 8
        tree.links.new(layers.outputs['Image'], glare.inputs['Image'])
        tree.links.new(glare.outputs['Image'], composite.inputs['Image'])
    else:
        tree.links.new(layers.outputs['Image'], composite.inputs['Image'])
    scene['等级'] = tier
    scene['装备名称'] = title
    scene['镭射范围'] = foil_scope
    scene['网页一致性边界'] = '真实厚度卡体 + 分层视差贴图；非器物体积模型。Blender 节点与 Three.js shader 不逐像素一致。'
    scene['SSR说明'] = 'SSR 是 Skill 永久突破奖章；此场景为该皮肤的可编辑视觉来源，不是授予评级的逻辑。'
    scene['素材来源'] = 'image_gen 分级器物原画；用户授权技术透明通道与注册线描；中文确定性排版。'
    if tier == 'SSR':
        scene['神域背景'] = 'SSR 独立宇宙神域背景；C/R/SR 继续使用共同背景。'
        scene['晶体灵魂实现边界'] = '已打包 crystal-mask.png 精确区域参考；灵魂与元素的实时动画由网页 ssr-divinity.js 实现，此 Blender 场景不含该动画。'
    scene.frame_set(1)
    return scene, images


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    root = Path(args[0]).resolve() if args else Path(__file__).resolve().parents[1]
    source = root / 'card.blend'
    source_hash = sha256(source)
    for tier in TIERS:
        for path in tier_image_paths(root, tier).values():
            if not path.is_file():
                raise FileNotFoundError(f'Missing {path}')
    bpy.ops.wm.open_mainfile(filepath=str(source))
    base = bpy.context.scene
    scenes = []
    image_report = {}
    for tier in TIERS:
        scene, images = make_scene(base, tier, root)
        scenes.append(scene)
        image_report[tier] = {
            key: {'name': image.name, 'size': list(image.size), 'channels': image.channels,
                  'packed': bool(image.packed_file),
                  'source_path': str(tier_image_paths(root, tier)[key].relative_to(root)),
                  'sha256': sha256(tier_image_paths(root, tier)[key])}
            for key, image in images.items()
        }
    bpy.context.window.scene = scenes[0]
    old_objects = list(base.objects)
    bpy.data.scenes.remove(base)
    for obj in old_objects:
        if obj.users == 0 or not obj.users_scene:
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.outliner.orphans_purge(do_recursive=True)
    for image in bpy.data.images:
        if image.source == 'FILE':
            if image.filepath and not image.filepath.startswith('//'):
                image.filepath = bpy.path.relpath(image.filepath, start=str(root))
            image.pack()
    report = {
        'blender': bpy.app.version_string,
        'source': 'card.blend', 'source_sha256': source_hash,
        'output': 'equipment-evolution.blend',
        'geometry': 'Copied editable thick-card mesh, separate text plane and physical trim; equipment artwork is layered RGBA rather than volumetric equipment geometry.',
        'shader_limit': 'Blender material is an editable offline equivalent, not pixel-identical to the custom Three.js shader.',
        'ssr_divinity': {'static_divine_background': True, 'trimmed_subject_source': 'assets/tiers/SSR/subject-divine.png',
                        'crystal_mask_packed': True, 'crystal_soul_animation_in_blender': False,
                        'web_animation_source': 'ssr-divinity.js'},
        'images': image_report,
        'scenes': [],
    }
    for scene in scenes:
        animated = [obj.name for obj in scene.objects
                    if obj.animation_data and obj.animation_data.action]
        if animated:
            raise RuntimeError(f'Unexpected automatic object animation: {animated}')
        thick_meshes = [obj for obj in scene.objects if obj.type == 'MESH'
                        and max(v.co.z for v in obj.data.vertices) - min(v.co.z for v in obj.data.vertices) > .04]
        if not thick_meshes:
            raise RuntimeError(f'Missing physical card thickness: {scene.name}')
        report['scenes'].append({
            'name': scene.name, 'tier': scene['等级'], 'foil_scope': scene['镭射范围'],
            'mesh_objects': len([obj for obj in scene.objects if obj.type == 'MESH']),
            'thick_card_meshes': [obj.name for obj in thick_meshes],
            'automatic_object_animation': False,
            'camera': scene.camera.name,
        })
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.region_3d.view_perspective = 'CAMERA'
                area.spaces.active.shading.type = 'MATERIAL'
    bpy.ops.wm.save_as_mainfile(filepath=str(root / report['output']))
    if sha256(source) != source_hash:
        raise RuntimeError('Original card.blend unexpectedly changed')
    report['source_unchanged'] = True
    report['all_file_images_packed'] = all(image.packed_file for image in bpy.data.images if image.source == 'FILE')
    report['output_sha256'] = sha256(root / report['output'])
    # Reopen the actual saved source, including unconnected packed mask inputs.
    bpy.ops.wm.open_mainfile(filepath=str(root / report['output']))
    assert len(bpy.data.scenes) == len(TIERS)
    saved_audit = []
    for scene in bpy.data.scenes:
        tier = scene['等级']
        materials = {m for o in scene.objects if o.type == 'MESH' for m in o.data.materials if m}
        main = next(m for m in materials if '叠加 · 主体镭射' in m.node_tree.nodes)
        nodes = main.node_tree.nodes
        image_paths = {Path(bpy.path.abspath(n.image.filepath)).resolve()
                       for m in materials for n in m.node_tree.nodes
                       if n.type == 'TEX_IMAGE' and n.image}
        expected = set(tier_image_paths(root, tier).values())
        if not expected.issubset(image_paths):
            raise RuntimeError(f'Missing saved material inputs for {tier}: {expected - image_paths}')
        if tier != 'SSR' and root / 'assets' / 'tiers' / 'SSR' / 'background.png' in image_paths:
            raise RuntimeError(f'SSR background leaked into {tier}')
        if tier in ('C', 'R') and nodes['叠加 · 主体镭射'].inputs[0].default_value != 0:
            raise RuntimeError(f'Unexpected foil on {tier}')
        if tier != 'SSR' and nodes['背景轻镭射'].inputs[0].default_value != 0:
            raise RuntimeError(f'Unexpected background foil on {tier}')
        saved_audit.append({'scene': scene.name, 'input_paths': sorted(str(p.relative_to(root)) for p in image_paths),
                            'subject_foil': nodes['叠加 · 主体镭射'].inputs[0].default_value,
                            'background_foil': nodes['背景轻镭射'].inputs[0].default_value})
    if not all(image.packed_file for image in bpy.data.images if image.source == 'FILE'):
        raise RuntimeError('Saved file contains unpacked images')
    report['reopen_verified'] = True
    report['saved_scene_audit'] = saved_audit
    (root / 'equipment-evolution-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('EQUIPMENT_EVOLUTION_COMPLETE', root / report['output'])


if __name__ == '__main__':
    main()
