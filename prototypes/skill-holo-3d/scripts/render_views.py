"""Render front and both tilt directions from the editable Blender scene."""
import bpy,json,sys
from pathlib import Path
root=Path(sys.argv[sys.argv.index('--')+1]).resolve()
scene=bpy.context.scene
scene.render.resolution_x=720;scene.render.resolution_y=1000
scene.cycles.samples=20;scene.cycles.use_denoising=True
try:
 prefs=bpy.context.preferences.addons['cycles'].preferences
 prefs.compute_device_type='METAL';prefs.get_devices()
 gpu=False
 for dev in prefs.devices:dev.use=dev.type!='CPU';gpu=gpu or dev.use
 if gpu:scene.cycles.device='GPU'
except Exception as e:print('Metal unavailable; CPU render',e)
for image in bpy.data.images:
 if image.filepath and image.source=='FILE':image.filepath=bpy.path.relpath(image.filepath,start=str(root))
scene['素材来源']='内置 image_gen 生成主体/背景；用户授权技术抠图和精确注册线描；中文确定性排版。'
scene['网页材质说明']='GLB导出真实几何和材质角色；Three.js重新构建视差与镭射。网页版具有额外C/R/SR/SSR门控；此Blender场景为完整镭射母版。'
report=[]
for name,frame in [('hero',25),('tilt-left',1),('tilt-right',49)]:
 scene.frame_set(frame);scene.render.filepath=str(root/'renders'/(name+'.png'))
 bpy.ops.render.render(write_still=True)
 report.append({'file':name+'.png','frame':frame,'engine':scene.render.engine,'device':scene.cycles.device,'samples':scene.cycles.samples})
scene.frame_set(25);scene.render.filepath=str(root/'renders'/'hero.png')
bpy.ops.wm.save_as_mainfile(filepath=str(root/'card.blend'))
(root/'renders'/'render-report.json').write_text(json.dumps(report,indent=2))
