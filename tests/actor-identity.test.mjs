import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorer, createRelic, disposeActorResources } from '../src/features/toy-wilds/actors.js';

test('changing one Agent identity does not recolor another Agent or its Skill artifact', () => {
  const relic = createRelic(), first = createExplorer(), second = createExplorer();
  const colors = object => { const result=[];object.traverse(mesh=>{if(mesh.material)result.push(mesh.material.color.getHexString())});return result; };
  const originalRelic = colors(relic), originalSecond = colors(second.group);
  for (const lineage of ['maker','sage','ranger','explorer']) {
    first.setAppearance({lineage,coat:'#557755',accent:'#e0a040',hat:'#dce4b7'});
    assert.equal(first.group.userData.lineage,lineage);
    const outfits=first.group.children.filter(child=>child.name.startsWith('Lineage: '));
    assert.deepEqual(outfits.filter(child=>child.visible).map(child=>child.name),[`Lineage: ${lineage}`]);
    assert.deepEqual(colors(relic),originalRelic);
    assert.deepEqual(colors(second.group),originalSecond);
  }
  for (const count of [0,1,2,8,0]) {
    first.setEquipment(count);
    assert.equal(first.group.getObjectByName('Equipped Skill cards').children.filter(child=>child.visible).length,Math.min(count,3));
    assert.equal(second.group.userData.equippedCount,0);
  }
  const geometry=new Set(),material=new Set();
  for(const object of [relic,first.group,second.group])object.traverse(mesh=>{if(mesh.geometry)geometry.add(mesh.geometry);if(mesh.material)material.add(mesh.material)});
  geometry.forEach(item=>item.dispose());material.forEach(item=>item.dispose());disposeActorResources();
});
