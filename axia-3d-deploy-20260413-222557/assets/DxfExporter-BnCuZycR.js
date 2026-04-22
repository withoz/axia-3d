import{M as g,r as $,Y as E,s as f}from"./three-loaders-DY7O_fXk.js";class N{constructor(){this.entities=[],this.layers=new Set,this.entityCount=0}addLine(e,t,r={}){const n={type:"LINE",layer:"Default",color:256,...r,start:e,end:t};return this.entities.push(n),this.layers.add(n.layer||"Default"),this}addCircle(e,t,r={}){if(t<=0)return console.warn("[DxfWriter] 원의 반지름이 0 이하입니다"),this;const n={type:"CIRCLE",layer:"Default",color:256,...r,center:e,radius:t};return this.entities.push(n),this.layers.add(n.layer||"Default"),this}addArc(e,t,r,n,s={}){if(t<=0)return console.warn("[DxfWriter] 호의 반지름이 0 이하입니다"),this;const a={type:"ARC",layer:"Default",color:256,...s,center:e,radius:t,startAngle:r,endAngle:n};return this.entities.push(a),this.layers.add(a.layer||"Default"),this}addPolyline(e,t={}){if(e.length<2)return console.warn("[DxfWriter] 폴리라인은 최소 2개의 점이 필요합니다"),this;const r={type:"LWPOLYLINE",layer:"Default",color:256,...t,points:e};return this.entities.push(r),this.layers.add(r.layer||"Default"),this}addFace(e,t={}){if(e.length<3||e.length>4)return console.warn("[DxfWriter] 면은 3개 또는 4개의 정점이 필요합니다"),this;const r={type:"FACE",layer:"Default",color:256,...t,vertices:e};return this.entities.push(r),this.layers.add(r.layer||"Default"),this}clear(){return this.entities=[],this.layers.clear(),this.entityCount=0,this}export(){let e="";return e+=this.generateHeader(),e+=this.generateTables(),e+=this.generateEntities(),e+=`0
EOF
`,e}generateHeader(){let e=`0
SECTION
2
HEADER
`;e+=`9
$ACADVER
1
AC1015
`,e+=`9
$INSUNITS
70
4
`,e+=`9
$GRIDUNIT
10
10.0
20
10.0
`,e+=`9
$SNAPUNIT
10
1.0
20
1.0
`;const[t,r]=this.calculateBounds();return e+=`9
$EXTMIN
10
${t.x}
20
${t.y}
30
${t.z}
`,e+=`9
$EXTMAX
10
${r.x}
20
${r.y}
30
${r.z}
`,e+=`0
ENDSEC
`,e}generateTables(){let e=`0
SECTION
2
TABLES
`;e+=`0
TABLE
2
LAYER
70
`+(this.layers.size+1)+`
`,e+=this.generateLayerEntry("0",7);const t=new Map([["Default",256],["Grid",3],["Geometry",1]]);return this.layers.forEach(r=>{const n=t.get(r)||256;e+=this.generateLayerEntry(r,n)}),e+=`0
ENDTABLE
`,e+=`0
ENDSEC
`,e}generateLayerEntry(e,t){let r=`0
LAYER
`;return r+=`2
`+e+`
`,r+=`70
0
`,r+=`62
`+t+`
`,r+=`6
CONTINUOUS
`,r}generateEntities(){let e=`0
SECTION
2
ENTITIES
`;this.entityCount=0;for(const t of this.entities)e+=this.generateEntity(t);return e+=`0
ENDSEC
`,e}generateEntity(e){const t=e.layer||"Default",r=e.color||256;let n="";switch(n+=`0
${e.type}
`,n+=`8
${t}
`,n+=`62
${r}
`,e.type){case"LINE":return n+this.generateLineData(e);case"CIRCLE":return n+this.generateCircleData(e);case"ARC":return n+this.generateArcData(e);case"LWPOLYLINE":return n+this.generatePolylineData(e);case"FACE":return n+this.generateFaceData(e);default:return console.warn(`[DxfWriter] 지원하지 않는 엔티티 타입: ${e.type}`),""}}generateLineData(e){const{start:t,end:r}=e;let n="";return n+=`10
${this.formatNumber(t.x)}
`,n+=`20
${this.formatNumber(t.y)}
`,n+=`30
${this.formatNumber(t.z||0)}
`,n+=`11
${this.formatNumber(r.x)}
`,n+=`21
${this.formatNumber(r.y)}
`,n+=`31
${this.formatNumber(r.z||0)}
`,n}generateCircleData(e){const{center:t,radius:r}=e;let n="";return n+=`10
${this.formatNumber(t.x)}
`,n+=`20
${this.formatNumber(t.y)}
`,n+=`30
${this.formatNumber(t.z||0)}
`,n+=`40
${this.formatNumber(r)}
`,n}generateArcData(e){const{center:t,radius:r,startAngle:n,endAngle:s}=e;let a="";return a+=`10
${this.formatNumber(t.x)}
`,a+=`20
${this.formatNumber(t.y)}
`,a+=`30
${this.formatNumber(t.z||0)}
`,a+=`40
${this.formatNumber(r)}
`,a+=`50
${this.formatNumber(n)}
`,a+=`51
${this.formatNumber(s)}
`,a}generatePolylineData(e){const{points:t,closed:r}=e;let n="";n+=`90
${t.length}
`,n+=`70
${r?1:0}
`;for(const s of t)n+=`10
${this.formatNumber(s.x)}
`,n+=`20
${this.formatNumber(s.y)}
`;return n}generateFaceData(e){const{vertices:t}=e;let r="";for(let n=0;n<t.length;n++){const s=t[n],a=10+n,i=20+n,o=30+n;r+=`${a}
${this.formatNumber(s.x)}
`,r+=`${i}
${this.formatNumber(s.y)}
`,r+=`${o}
${this.formatNumber(s.z||0)}
`}if(t.length===3){const n=t[2];r+=`13
${this.formatNumber(n.x)}
`,r+=`23
${this.formatNumber(n.y)}
`,r+=`33
${this.formatNumber(n.z||0)}
`}return r}calculateBounds(){let e=1/0,t=1/0,r=1/0,n=-1/0,s=-1/0,a=-1/0;for(const i of this.entities){const o=this.extractPointsFromEntity(i);for(const h of o)e=Math.min(e,h.x),t=Math.min(t,h.y),r=Math.min(r,h.z||0),n=Math.max(n,h.x),s=Math.max(s,h.y),a=Math.max(a,h.z||0)}return isFinite(e)?[{x:e,y:t,z:r},{x:n,y:s,z:a}]:[{x:0,y:0,z:0},{x:100,y:100,z:0}]}extractPointsFromEntity(e){const t=[];switch(e.type){case"LINE":{const r=e;t.push(r.start,r.end);break}case"CIRCLE":{const r=e;t.push(r.center);break}case"ARC":{const r=e;t.push(r.center);break}case"LWPOLYLINE":{const r=e;t.push(...r.points);break}case"FACE":{const r=e;t.push(...r.vertices);break}}return t}formatNumber(e){return e.toFixed(1).replace(/\.0$/,"")}}class y{constructor(){this.writer=new N}exportScene(e,t={}){const{precision:r=1}=t;console.log("[DxfExporter] DXF 내보내기 시작..."),e.traverse(s=>{s instanceof g?this.extractMesh(s,r):s instanceof $?this.extractLineSegments(s,r):s instanceof E&&this.extractPoints(s,r)});const n=this.writer.export();return console.log("[DxfExporter] DXF 내보내기 완료"),n}extractMesh(e,t){const r=e.geometry;if(!(r instanceof f)){console.warn("[DxfExporter] BufferGeometry만 지원합니다");return}const n=r.getAttribute("position");if(!n)return;const s=n.array,a=r.getIndex(),i=e.name||`Mesh_${Math.random().toString(36).substr(2,9)}`;if(a){const o=a.array;for(let h=0;h<o.length;h+=3){const l=o[h]*3,u=o[h+1]*3,c=o[h+2]*3,d={x:this.round(s[l],t),y:this.round(s[l+1],t),z:this.round(s[l+2],t)},m={x:this.round(s[u],t),y:this.round(s[u+1],t),z:this.round(s[u+2],t)},x={x:this.round(s[c],t),y:this.round(s[c+1],t),z:this.round(s[c+2],t)};this.writer.addFace([d,m,x],{layer:i})}}else for(let o=0;o<s.length;o+=9){const h={x:this.round(s[o],t),y:this.round(s[o+1],t),z:this.round(s[o+2],t)},l={x:this.round(s[o+3],t),y:this.round(s[o+4],t),z:this.round(s[o+5],t)},u={x:this.round(s[o+6],t),y:this.round(s[o+7],t),z:this.round(s[o+8],t)};this.writer.addFace([h,l,u],{layer:i})}console.log(`[DxfExporter] 메시 '${i}' 추출 완료: ${Math.floor(s.length/9)} 삼각형`)}extractLineSegments(e,t){const r=e.geometry;if(!(r instanceof f))return;const n=r.getAttribute("position");if(!n)return;const s=n.array,a=e.name||"Lines";for(let i=0;i<s.length;i+=6){const o={x:this.round(s[i],t),y:this.round(s[i+1],t),z:this.round(s[i+2],t)},h={x:this.round(s[i+3],t),y:this.round(s[i+4],t),z:this.round(s[i+5],t)};this.writer.addLine(o,h,{layer:a})}console.log(`[DxfExporter] 선 '${a}' 추출 완료: ${s.length/6} 선`)}extractPoints(e,t){const r=e.geometry;if(!(r instanceof f))return;const n=r.getAttribute("position");if(!n)return;const s=n.array,a=e.name||"Points";for(let i=0;i<s.length;i+=3){const o={x:this.round(s[i],t),y:this.round(s[i+1],t),z:this.round(s[i+2],t)};this.writer.addCircle(o,1,{layer:a})}console.log(`[DxfExporter] 점 '${a}' 추출 완료: ${s.length/3} 점`)}round(e,t){if(t<=0)return Math.round(e);const r=Math.pow(10,t);return Math.round(e*r)/r}static downloadDxf(e,t="export.dxf",r={}){const s=new y().exportScene(e,r),a=new Blob([s],{type:"application/octet-stream"}),i=URL.createObjectURL(a),o=document.createElement("a");o.href=i,o.download=t,document.body.appendChild(o),o.click(),document.body.removeChild(o),URL.revokeObjectURL(i),console.log(`[DxfExporter] 다운로드 완료: ${t}`)}}export{y as DxfExporter};
