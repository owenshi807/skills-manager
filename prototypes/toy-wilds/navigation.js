// A small grid belongs to this scene. Ground clicks find a route around water and props.
export function createNavigation(world,radius=.24){
 const b=world.bounds,cell=.5;
 function walkable(x,z){if(x<b.minX+radius||x>b.maxX-radius||z<b.minZ+radius||z>b.maxZ-radius)return false;return !world.colliders.some(c=>c.r!==undefined?Math.hypot(x-c.x,z-c.z)<c.r+radius:Math.abs(x-c.x)<c.halfX+radius&&Math.abs(z-c.z)<c.halfZ+radius)}
 const key=(x,z)=>x+','+z;
 function path(from,target){
  const start={x:Math.round(from.x/cell),z:Math.round(from.z/cell)},desired={x:Math.round(target.x/cell),z:Math.round(target.z/cell)};
  let end=null;
  for(let r=0;r<=12&&!end;r++)for(let dx=-r;dx<=r&&!end;dx++)for(let dz=-r;dz<=r;dz++){if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;const x=desired.x+dx,z=desired.z+dz;if(walkable(x*cell,z*cell)){end={x,z};break}}
  if(!end)return [];
  const first={...start,g:0,h:Math.hypot(end.x-start.x,end.z-start.z),parent:null},open=[first],best=new Map([[key(start.x,start.z),first]]),closed=new Set();let found=null;
  const offsets=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  while(open.length&&closed.size<6500){let at=0;for(let i=1;i<open.length;i++)if(open[i].g+open[i].h<open[at].g+open[at].h)at=i;const node=open.splice(at,1)[0],k=key(node.x,node.z);if(closed.has(k))continue;if(node.x===end.x&&node.z===end.z){found=node;break}closed.add(k);
   for(const[dx,dz]of offsets){const x=node.x+dx,z=node.z+dz,nk=key(x,z);if(closed.has(nk)||!walkable(x*cell,z*cell))continue;if(dx&&dz&&(!walkable(node.x*cell,z*cell)||!walkable(x*cell,node.z*cell)))continue;const g=node.g+Math.hypot(dx,dz),old=best.get(nk);if(old&&old.g<=g)continue;const n={x,z,g,h:Math.hypot(end.x-x,end.z-z),parent:node};best.set(nk,n);open.push(n)}
  }
  const result=[];while(found?.parent){result.push({x:found.x*cell,z:found.z*cell});found=found.parent}return result.reverse();
 }
 return{walkable,path};
}
