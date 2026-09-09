"""Rebuild this user-owned holo-card project without overwriting custom viewer work."""
from pathlib import Path
import argparse, json, os, shutil, subprocess, sys
from install_blender import install
from validate_assets import validate

def main():
 p=argparse.ArgumentParser();p.add_argument('--project',default=str(Path(__file__).resolve().parents[1]));p.add_argument('--skip-render',action='store_true');p.add_argument('--skip-npm',action='store_true');a=p.parse_args()
 root=Path(a.project).resolve();scripts=root/'scripts';validate(root)
 exe=install(root);env=dict(os.environ);env['BLENDER_USER_CONFIG']=str(root/'runtime-config');Path(env['BLENDER_USER_CONFIG']).mkdir(exist_ok=True)
 subprocess.run([str(exe),'--background','--factory-startup','--python-exit-code','1','--python',str(scripts/'build_card.py'),'--',str(root),'--skip-render'],env=env,check=True)
 if not (root/'card.blend').exists():raise RuntimeError('card.blend missing')
 subprocess.run([str(exe),'--background','--python-exit-code','1','--python',str(scripts/'export_web.py'),'--',str(root)],env=env,check=True)
 if not a.skip_render:subprocess.run([str(exe),'--background',str(root/'card.blend'),'--python-exit-code','1','--python',str(scripts/'render_views.py'),'--',str(root)],env=env,check=True)
 tiers=root/'assets'/'tiers'
 if tiers.exists():subprocess.run([str(exe),'--background','--python-exit-code','1','--python',str(scripts/'build_evolution.py'),'--',str(root)],env=env,check=True)
 web=root/'web';web.mkdir(exist_ok=True)
 for file in (root/'viewer-src').iterdir():
  if file.is_file() and file.name!='card-config.json':shutil.copy2(file,web/file.name)
 shutil.copy2(root/'card-config.json',web/'card-config.json')
 for name in ['subject','background','lineart','text']:shutil.copy2(root/'assets'/(name+'.png'),web/'assets'/(name+'.png'))
 if tiers.exists():shutil.copytree(tiers,web/'assets'/'tiers',dirs_exist_ok=True)
 if not a.skip_npm:subprocess.run(['npm','ci','--ignore-scripts','--no-audit','--no-fund'] if (web/'package-lock.json').exists() else ['npm','install','--ignore-scripts','--no-audit','--no-fund'],cwd=web,check=True)
 print('Ready: node',web/'server.mjs')
if __name__=='__main__':main()
