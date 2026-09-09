"""User-authorized technical matte and exact registered contour extraction.
Preserves source RGB. Never edits the original generated image.
"""
from pathlib import Path
import argparse, json, hashlib
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def prepare(root, source, background):
    root=Path(root); assets=root/'assets'; assets.mkdir(parents=True,exist_ok=True)
    rgb=np.array(Image.open(source).convert('RGB'))
    # The generation contains an achromatic checkerboard; the equipment's contour
    # and enamel are chromatic. Keep the largest connected coloured silhouette.
    chroma=rgb.max(axis=2).astype(np.int16)-rgb.min(axis=2).astype(np.int16)
    seed=(chroma>9).astype(np.uint8)
    seed=cv2.morphologyEx(seed,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
    n,labels,stats,_=cv2.connectedComponentsWithStats(seed,8)
    main=1+np.argmax(stats[1:,cv2.CC_STAT_AREA]); mask=(labels==main).astype(np.uint8)
    # Restore enclosed neutral enamel/highlights above the strap. The original
    # lower strap aperture stays transparent; this is subject-specific matting.
    n,labels,stats,_=cv2.connectedComponentsWithStats(1-mask,8)
    for i in range(1,n):
        if stats[i,cv2.CC_STAT_AREA]<1100 or (stats[i,cv2.CC_STAT_TOP]>0 and stats[i,cv2.CC_STAT_TOP]<1000):mask[labels==i]=1
    alpha=(mask*255).astype(np.uint8)
    # Subpixel antialias only at the hard contour; source RGB remains untouched.
    alpha=cv2.GaussianBlur(alpha,(3,3),.45)
    rgba=np.dstack([rgb,alpha]); Image.fromarray(rgba).save(assets/'subject.png')
    bg=Image.open(background).convert('RGB')
    assert bg.size==(rgb.shape[1],rgb.shape[0]),'Canvas sizes differ'
    bg.save(assets/'background.png')
    gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
    contours=cv2.Canny(gray,65,145)
    contours[cv2.erode(mask,np.ones((3,3),np.uint8))==0]=0
    outline=cv2.morphologyEx(mask,cv2.MORPH_GRADIENT,np.ones((3,3),np.uint8))*255
    lines=np.maximum(contours,outline)
    Image.fromarray(255-lines).convert('RGB').save(assets/'lineart.png')
    W,H=bg.size; text=Image.new('RGBA',(W,H));d=ImageDraw.Draw(text)
    font='/System/Library/Fonts/STHeiti Medium.ttc'
    def write(x,y,label,size,anchor='la',fill=(255,247,222,255)):
        f=ImageFont.truetype(font,size)
        d.text((x,y),label,font=f,fill=fill,anchor=anchor,stroke_width=1,stroke_fill=(12,33,51,210))
    write(78,59,'精灵冒险图鉴  /  方法装备',25)
    write(72,104,'依赖镜头',89)
    write(78,212,'EPISTEMIC DEPENDENCE LENS',22)
    d.line((76,265,948,265),fill=(235,240,227,160),width=2)
    d.line((76,1270,948,1270),fill=(235,240,227,160),width=2)
    write(512,1302,'识别同源 · 保留反证',49,anchor='ma')
    write(512,1380,'让证据在需要时说话',30,anchor='ma')
    write(78,1469,'SCM  /  014',22)
    write(946,1469,'SKILL EQUIPMENT',20,anchor='ra')
    text.save(assets/'text.png')
    preview=Image.alpha_composite(bg.convert('RGBA'),Image.fromarray(rgba))
    preview=Image.alpha_composite(preview,text);preview.resize((512,768)).save(root/'layers-preview.png')
    report={'authorized_processing':'User explicitly approved local technical cutout, alpha and exact line-art extraction on 2026-09-09.','subject_source':str(source),'background_source':str(background),'method':'Largest chromatic connected silhouette; small neutral highlight holes restored; 0.45px edge antialias; registered Canny contours. Source RGB preserved.','alpha_transparent_fraction':float((alpha<16).mean()),'alpha_visible_fraction':float((alpha>127).mean()),'canvas':[W,H],'assets':{}}
    for name in ['subject','background','lineart','text']:
        p=assets/(name+'.png');report['assets'][name]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    (root/'layer-processing.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('project');p.add_argument('subject');p.add_argument('background');a=p.parse_args();prepare(a.project,a.subject,a.background)
