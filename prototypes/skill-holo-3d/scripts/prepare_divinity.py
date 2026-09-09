"""Prepare user-authorized exact crystal mask and clean alpha for the SSR realm.

The generated equipment is retained. Only its outer white matte fringe is
trimmed in a sibling texture; the generated divine background is copied intact.
"""
from pathlib import Path
import hashlib
import json
import shutil
import cv2
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]

def main():
    assets=ROOT/'assets/tiers/SSR'
    meta=json.loads((ROOT/'assets/ssr-divinity-prompt.json').read_text())
    background=assets/'background.png'
    if not background.exists():shutil.copy2(meta['source'],background)
    assert Image.open(background).size==(1024,1536)
    im=np.array(Image.open(assets/'subject.png').convert('RGBA'))
    # One pixel of matte-fringe cleanup is visible against the new dark realm.
    # Never mutate the preceding edition's subject.png or its original source.
    im[:,:,3]=cv2.erode(im[:,:,3],np.ones((3,3),np.uint8))
    Image.fromarray(im).save(assets/'subject-divine.png')
    polygon=np.array([(502,475),(549,470),(622,510),(651,563),(677,632),(659,683),(611,743),(554,766),(512,760),(448,735),(409,700),(379,652),(384,600),(414,536)],dtype=np.int32)
    mask=np.zeros((1536,1024),dtype=np.uint8)
    cv2.fillPoly(mask,[polygon],255)
    r,g,b=[im[:,:,i].astype(float) for i in range(3)]
    cyan=(g>r*.92)&(b>r*1.06)&(b>65)
    mask[~cyan]=0
    mask=cv2.GaussianBlur(mask,(7,7),1.2)
    mask[im[:,:,3]<200]=0
    Image.fromarray(mask).convert('RGB').save(assets/'crystal-mask.png')
    # Preview only: red demonstrates exact mask support without changing source.
    preview=im.copy();a=mask.astype(float)/255*.6
    preview[:,:,:3]=(im[:,:,:3]*(1-a[:,:,None])+np.array([255,40,80])*a[:,:,None]).astype(np.uint8)
    Image.fromarray(preview).save(ROOT/'ssr-crystal-mask-preview.png')
    web=ROOT/'web/assets/tiers/SSR';web.mkdir(parents=True,exist_ok=True)
    for name in ['background','subject-divine','crystal-mask']:
        shutil.copy2(assets/(name+'.png'),web/(name+'.png'))
    report={'background':'image_gen original copied intact','alpha':'Sibling texture, one-pixel fringe trim; source RGB and preceding artwork preserved.','mask':'Hand-registered core polygon intersected with cyan glass and subject alpha; 1.2px feather. Shader uses the SAME signed subject parallax UV.','core_image_center':[533,622],'core_image_radius':[175,165],'canvas':[1024,1536],'mask_bbox':Image.fromarray(mask).getbbox(),'assets':{}}
    for name in ['background','subject-divine','crystal-mask']:
        report['assets'][name]=hashlib.sha256((assets/(name+'.png')).read_bytes()).hexdigest()
    (ROOT/'ssr-divinity-assets.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()
