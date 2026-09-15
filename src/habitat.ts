import * as T from 'three';
import { Room } from './room';
import { PLACES, type Action, type Life } from './life';

/** Geometry-built miniature home. Anatomy comes exclusively from flybody. */
export class Habitat {
  root = new T.Group();
  markers = new Map<Action,T.Mesh>();
  eggs: T.Mesh[] = [];
  food = new T.Group();
  heat: T.Mesh;
  trail: T.Line;
  private points: T.Vector3[] = [];
  private ring: T.Mesh;
  private labels: T.Sprite[] = [];
  onSelect: ((action: Action)=>void) | null = null;
  constructor(readonly room: Room) {
    this.root.scale.setScalar(6); room.scene.add(this.root);
    room.scene.background = new T.Color('#000000');
    room.scene.fog = new T.Fog('#000000',35,90);
    room.renderer.toneMapping=T.ACESFilmicToneMapping;
    room.renderer.toneMappingExposure=1.1;
    // One bounded shadow map; the same original anatomical meshes cast it.
    room.renderer.shadowMap.autoUpdate=false;room.renderer.shadowMap.needsUpdate=true;room.renderer.shadowMap.enabled=true;room.renderer.shadowMap.type=T.PCFShadowMap;
    const sun=room.scene.children.find(c=>c instanceof T.DirectionalLight) as T.DirectionalLight;
    sun.color.set('#eef3fa');sun.intensity=1.35;
    sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-14;sun.shadow.camera.right=14;sun.shadow.camera.top=14;sun.shadow.camera.bottom=-14;sun.shadow.camera.near=.1;sun.shadow.camera.far=50;sun.shadow.bias=-.0003;sun.shadow.normalBias=.015;
    for(const child of room.scene.children) if(child instanceof T.GridHelper) child.visible=false;
    const mat=(color:T.ColorRepresentation,roughness=.65,metalness=0)=>new T.MeshStandardMaterial({color,roughness,metalness});
    const stone=mat('#252d35'), wood=mat('#20262e'), green=mat('#354b48'), ivory=mat('#aab6bd'), metal=mat('#b6c1bc',.22,.65);
    const mesh=(geo:T.BufferGeometry,material:T.Material,x:number,y:number,z:number,parent:T.Object3D=this.root)=>{
      const m=new T.Mesh(geo,material); m.position.set(x,z,-y);m.castShadow=true;m.receiveShadow=true; parent.add(m); return m;
    };
    const box=(x:number,y:number,z:number,a:number,b:number,c:number,m:T.Material=stone)=>mesh(new T.BoxGeometry(a,c,b),m,x,y,z);
    const cylinder=(x:number,y:number,z:number,r:number,h:number,m:T.Material)=>mesh(new T.CylinderGeometry(r,r,h,40),m,x,y,z);
    // Surrounding countertop and wall make the millimetre-scale arena legible.
    box(0,0,-.30,3.8,2.75,.25,wood);
    box(0,0,-.19,3.5,2.45,.08,stone);
    const floors=[['#343b41',.84,.58],['#2c3941',-.84,.58],['#292e35',-.84,-.58],['#303934',.84,-.58]] as const;
    for(const [color,x,y] of floors) box(x,y,-.148,1.65,1.12,.002,mat(color));
    for(let x=-1.65;x<1.7;x+=.275) box(x,0,-.144,.003,2.25,.002,mat('#242b30'));
    for(let y=-1.1;y<1.2;y+=.275) box(0,y,-.143,3.35,.003,.002,mat('#242b30'));
    // Slim posts and a translucent back panel, outside the collision boundary.
    const glass=new T.MeshPhysicalMaterial({color:'#d7f0e7',transparent:true,opacity:.15,roughness:.13,metalness:.1,depthWrite:false,side:T.DoubleSide});
    box(0,1.23,.42,3.52,.018,1.2,glass);
    for(const x of [-1.77,1.77]) box(x,1.23,.42,.025,.025,1.2,metal);
    // Kitchen counter behind the reachable fruit patch.
    box(1.03,1.02,.03,.85,.20,.34,wood);
    box(1.03,1.02,.22,.94,.24,.04,ivory);
    for(const x of [.79,1.05,1.28]) box(x,.912,.04,.20,.008,.27,mat('#4b575e'));
    cylinder(.87,.63,-.132,.24,.022,ivory);
    this.root.add(this.food);
    const fruitMat=mat('#d99d39',.45);
    for(let i=0;i<3;i++) {
      const piece=mesh(new T.SphereGeometry(.065,24,18),fruitMat,.99+i*.025,.72-i*.085,-.07,this.food);
      piece.scale.set(1.15,.75,.7);
      mesh(new T.SphereGeometry(.007,8,8),mat('#795031'),1+i*.025,.725-i*.085,-.021,this.food);
    }
    // Shallow water accessible from the floor; faucet and rear sink are scenery.
    cylinder(-.88,.62,-.132,.26,.02,ivory);
    cylinder(-.88,.62,-.118,.225,.008,new T.MeshPhysicalMaterial({color:'#558e9b',metalness:.25,roughness:.1,transparent:true,opacity:.8}));
    box(-1.18,1.015,.015,.66,.22,.31,green);
    cylinder(-1.18,1,.185,.17,.04,metal);
    const faucet=mesh(new T.TorusGeometry(.10,.013,10,24,Math.PI),metal,-1.18,1,.31);
    faucet.rotation.z=0;
    // Refuge has a fabric floor and a canopy with a clear entrance.
    box(-.91,-.66,-.13,.57,.57,.028,mat('#464b50'));
    for(const x of [-1.24,-.57]) box(x,-.87,.04,.03,.04,.38,wood);
    box(-.91,-.94,.035,.7,.025,.36,wood);
    box(-.91,-.71,.255,.75,.66,.035,mat('#42494f'));
    const pillow=mesh(new T.SphereGeometry(.10,24,16),mat('#b6af93'),-1.05,-.88,-.09); pillow.scale.set(1,.25,.7);
    // Flower cluster. Each stalk and petal is 3D, with no billboard replacement.
    for(let i=0;i<5;i++) {
      const x=1.17+Math.sin(i*2.1)*.11, y=-.75+Math.cos(i*2.1)*.14, z=.07+(i%2)*.08;
      mesh(new T.CylinderGeometry(.007,.010,z+.15,8),green,x,y,(z-.15)/2);
      mesh(new T.SphereGeometry(.033,12,10),mat('#d5a855'),x,y,z);
      for(let j=0;j<5;j++) { const angle=j*Math.PI*2/5; const p=mesh(new T.SphereGeometry(.03,10,8),mat(i%2 ? '#d8c7a4':'#dbc0b4'),x+Math.cos(angle)*.036,y+Math.sin(angle)*.036,z-.005);p.scale.y=.3; }
    }
    cylinder(.22,-.74,-.13,.22,.03,mat('#b18c61'));
    cylinder(.22,-.74,-.109,.18,.007,mat('#625239'));
    for(let i=0;i<8;i++) { const egg=mesh(new T.SphereGeometry(.025,12,10),ivory,.13+(i%4)*.058,-.70-Math.floor(i/4)*.08,-.085);egg.scale.set(.45,.4,1.3);egg.visible=false;this.eggs.push(egg); }
    const colors=['#dba648','#71b9c4','#aba0cb','#b0c177','#dbad7d','#91a7aa'];
    PLACES.forEach((p,i)=>{
      const marker=mesh(new T.RingGeometry(p.radius,p.radius+.01,64),new T.MeshBasicMaterial({color:colors[i],side:T.DoubleSide,transparent:true,opacity:.65}),p.x,p.y,-.14);
      marker.rotation.x=-Math.PI/2; this.markers.set(p.id,marker);
      const label=this.label(p.name.toUpperCase(),colors[i]);label.position.set(p.x,-.02,-p.y-.31);this.root.add(label);this.labels.push(label);
    });
    this.ring=mesh(new T.RingGeometry(.17,.174,48),new T.MeshBasicMaterial({color:'#f8efc5',side:T.DoubleSide,transparent:true,opacity:.85}),0,0,-.137);this.ring.rotation.x=-Math.PI/2;
    this.heat=box(.9,.62,-.136,.68,.64,.005,new T.MeshBasicMaterial({color:'#ee633b',transparent:true,opacity:.28}));this.heat.visible=false;
    this.trail=new T.Line(new T.BufferGeometry(),new T.LineBasicMaterial({color:'#d9b96c',transparent:true,opacity:.55}));this.root.add(this.trail);
    // A visual scale bar, exactly one millimetre in model units.
    box(-1.36,-1.30,-.13,.1,.012,.006,mat('#3d5148'));
    const scaleLabel=this.label('1 MM','#344d42');scaleLabel.scale.set(.24,.05,1);scaleLabel.position.set(-1.36,-.12,1.36);this.root.add(scaleLabel);
    const ray=new T.Raycaster();const pointer=new T.Vector2();let down=[0,0];
    room.renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
    room.renderer.domElement.addEventListener('pointerup',e=>{
      if(Math.hypot(e.clientX-down[0],e.clientY-down[1])>5 || e.button!==0)return;
      const rect=room.renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
      ray.setFromCamera(pointer,room.camera);
      const hit=ray.ray.intersectPlane(new T.Plane(new T.Vector3(0,1,0),.84),new T.Vector3());
      if(hit){const p=PLACES.find(p=>Math.hypot(p.x-hit.x/6,p.y+hit.z/6)<p.radius+.1);if(p)this.onSelect?.(p.id);}
    });
  }
  private label(text:string,color:string) {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=64;
    const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,512,64);ctx.fillStyle=color;ctx.font='600 28px sans-serif';ctx.textAlign='center';ctx.fillText(text,256,42);
    const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;
    const sprite=new T.Sprite(new T.SpriteMaterial({map,depthTest:false,transparent:true}));sprite.scale.set(.65,.081,1);return sprite;
  }
  setAnnotations(visible: boolean) {
    for (const label of this.labels) label.visible = visible;
    for (const marker of this.markers.values()) marker.visible = visible;
    this.room.requestRender();
  }
  update(life:Life,x:number,y:number,heat:boolean,food:boolean) {
    this.ring.position.set(x,-.137,-y);
    (this.ring.material as T.MeshBasicMaterial).color.set(life.state.alive ? '#fff4c4':'#ed7564');
    this.heat.visible=heat;this.food.visible=food;
    this.eggs.forEach((egg,i)=>egg.visible=i<life.eggs.length);
    for(const [action,marker] of this.markers) (marker.material as T.MeshBasicMaterial).opacity=action===life.state.action ? .95:.25;
    if(life.state.alive){
      const last=this.points.at(-1);
      if(!last || Math.hypot(last.x-x,last.z+y)>.025){this.points.push(new T.Vector3(x,-.136,-y));if(this.points.length>400)this.points.shift();this.trail.geometry.dispose();this.trail.geometry=new T.BufferGeometry().setFromPoints(this.points);}
    }
  }
}
