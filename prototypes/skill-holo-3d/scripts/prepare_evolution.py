"""User-authorized alpha preparation, registration and typography for lens variants.

Source images are retained verbatim; new PNGs normalize only canvas placement,
remove the generated white backdrop, and derive contours from that same image.
"""
from pathlib import Path
import hashlib
import json
import shutil
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SPECS = {
    'C': ('素木放大镜', '看清线索', '一枚镜片 · 一次聚焦', (610, 860)),
    'R': ('双轴勘察镜', '建立校准', '折叠副镜 · 双轴校准', (790, 1030)),
    'SR': ('三相解析镜', '看见关系', '三相棱镜 · 交叉解析', (850, 1120)),
    'SSR': ('万象重构镜', '重连框架', '开放轨道 · 异构重连', (920, 1170)),
}
FONT = '/System/Library/Fonts/STHeiti Medium.ttc'

def matte(source):
    im = Image.open(source).convert('RGBA')
    rgba = np.asarray(im).copy()
    if rgba[:, :, 3].min() < 250:
        return im, 'generated alpha preserved'
    rgb = rgba[:, :, :3]
    # White-generation fallback: neutral near-white backdrop only. Dark outlines
    # protect ivory hardware. Keep every substantial component, including satellites.
    chroma = rgb.max(2).astype(np.int16) - rgb.min(2).astype(np.int16)
    mask = ((rgb.min(2) < 238) | (chroma > 13)).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    keep = np.zeros_like(mask)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] > 100:
            keep[labels == i] = 1
    # Restore tiny enclosed white material highlights, preserving structural gaps.
    n, labels, stats, _ = cv2.connectedComponentsWithStats(1 - keep, 8)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < 1600:
            keep[labels == i] = 1
    rgba[:, :, 3] = cv2.GaussianBlur(keep * 255, (3, 3), .45)
    return Image.fromarray(rgba), 'white-background matte, small enclosed highlights restored; structural gaps retained'

def make_text(tier, title, meaning, details):
    text = Image.new('RGBA', (1024, 1536))
    d = ImageDraw.Draw(text)
    def write(x, y, label, size, anchor='la'):
        d.text((x,y),label,font=ImageFont.truetype(FONT,size),fill=(255,247,222,255),anchor=anchor,stroke_width=1,stroke_fill=(12,33,51,210))
    write(78,59,'依赖镜头  /  装备形态',25)
    write(72,109,title,72)
    write(78,207,'EQUIPMENT EVOLUTION',22)
    write(945,60,tier,43,'ra')
    d.line((76,265,948,265),fill=(235,240,227,150),width=2)
    d.line((76,1270,948,1270),fill=(235,240,227,150),width=2)
    write(512,1305,meaning,51,'ma')
    write(512,1382,details,29,'ma')
    write(78,1469,'SCM  /  014',22)
    write(946,1469,'SKILL EQUIPMENT',20,'ra')
    return text

def main():
    meta=json.loads((ROOT/'assets/evolution-prompts.json').read_text())
    report={'method':'Built-in image_gen; explicit user-approved local alpha, registered contour and typography processing. Original RGB sources retained verbatim.', 'tiers':{}}
    comparison=Image.new('RGB',(1440,900),'#edf0ea')
    d=ImageDraw.Draw(comparison)
    for ix,(tier,(title,meaning,details,bounds)) in enumerate(SPECS.items()):
        folder=ROOT/'assets/tiers'/tier;folder.mkdir(parents=True,exist_ok=True)
        source=folder/'source.png'
        # A checked-out project is self-contained; the original generation path
        # is only needed on first import, never for later reconstruction.
        if not source.exists():
            shutil.copy2(meta['sources'][tier],source)
        cut,method=matte(source)
        crop=cut.crop(cut.getbbox())
        crop.thumbnail(bounds,Image.Resampling.LANCZOS)
        subject=Image.new('RGBA',(1024,1536))
        # Every tier has the same optical center. Increasing hardware size is
        # deliberate, but silhouette and architecture carry the level difference.
        xy=((1024-crop.width)//2,790-crop.height//2)
        subject.alpha_composite(crop,xy)
        subject.save(folder/'subject.png')
        arr=np.asarray(subject);mask=(arr[:,:,3]>127).astype(np.uint8)
        edges=cv2.Canny(cv2.cvtColor(arr[:,:,:3],cv2.COLOR_RGB2GRAY),65,145)
        edges[cv2.erode(mask,np.ones((3,3),np.uint8))==0]=0
        edges=np.maximum(edges,cv2.morphologyEx(mask,cv2.MORPH_GRADIENT,np.ones((3,3),np.uint8))*255)
        Image.fromarray(255-edges).convert('RGB').save(folder/'lineart.png')
        text=make_text(tier,title,meaning,details);text.save(folder/'text.png')
        web=ROOT/'web/assets/tiers'/tier;web.mkdir(parents=True,exist_ok=True)
        for name in ['subject','lineart','text']:
            shutil.copy2(folder/(name+'.png'),web/(name+'.png'))
        # A fixed neutral contact sheet explicitly excludes card shaders/effects.
        tile=Image.new('RGBA',(360,700))
        display=subject.resize((360,540),Image.Resampling.LANCZOS)
        tile.alpha_composite(display,(0,75))
        comparison.paste(tile,(ix*360,90),tile)
        cx=ix*360+180
        d.text((cx,55),tier,font=ImageFont.truetype(FONT,36),fill='#183c42',anchor='mm')
        d.text((cx,730),title,font=ImageFont.truetype(FONT,28),fill='#183c42',anchor='mm')
        d.text((cx,780),meaning,font=ImageFont.truetype(FONT,22),fill='#527076',anchor='mm')
        report['tiers'][tier]={'title':title,'method':method,'canvas':[1024,1536],'bbox':subject.getbbox(),'transparent_fraction':float((arr[:,:,3]<16).mean()),'subject_sha256':hashlib.sha256((folder/'subject.png').read_bytes()).hexdigest(),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
    comparison.save(ROOT/'equipment-evolution-comparison.png')
    (ROOT/'evolution-asset-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
