(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))n(i);new MutationObserver(i=>{for(const s of i)if(s.type==="childList")for(const o of s.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&n(o)}).observe(document,{childList:!0,subtree:!0});function t(i){const s={};return i.integrity&&(s.integrity=i.integrity),i.referrerPolicy&&(s.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?s.credentials="include":i.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function n(i){if(i.ep)return;i.ep=!0;const s=t(i);fetch(i.href,s)}})();const cu="modulepreload",lu=function(r){return"/"+r},ml={},hu=function(e,t,n){let i=Promise.resolve();if(t&&t.length>0){let o=function(l){return Promise.all(l.map(h=>Promise.resolve(h).then(d=>({status:"fulfilled",value:d}),d=>({status:"rejected",reason:d}))))};document.getElementsByTagName("link");const a=document.querySelector("meta[property=csp-nonce]"),c=a?.nonce||a?.getAttribute("nonce");i=o(t.map(l=>{if(l=lu(l),l in ml)return;ml[l]=!0;const h=l.endsWith(".css"),d=h?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${l}"]${d}`))return;const u=document.createElement("link");if(u.rel=h?"stylesheet":cu,h||(u.as="script"),u.crossOrigin="",u.href=l,c&&u.setAttribute("nonce",c),document.head.appendChild(u),h)return new Promise((m,g)=>{u.addEventListener("load",m),u.addEventListener("error",()=>g(new Error(`Unable to preload CSS for ${l}`)))})}))}function s(o){const a=new Event("vite:preloadError",{cancelable:!0});if(a.payload=o,window.dispatchEvent(a),!a.defaultPrevented)throw o}return i.then(o=>{for(const a of o||[])a.status==="rejected"&&s(a.reason);return e().catch(s)})};/**
 * @license
 * Copyright 2010-2024 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const Wc="170",du=0,gl=1,uu=2,ud=1,fd=2,ui=3,ln=0,Jt=1,sn=2,Ui=0,Ls=1,Ya=2,_l=3,xl=4,fu=5,Ki=100,pu=101,mu=102,gu=103,_u=104,xu=200,vu=201,yu=202,bu=203,$a=204,Ka=205,Mu=206,Su=207,wu=208,Eu=209,Tu=210,Au=211,Cu=212,Ru=213,Lu=214,Za=0,Ja=1,Qa=2,Os=3,ec=4,tc=5,nc=6,ic=7,Xo=0,Iu=1,Pu=2,_i=0,Du=1,Nu=2,Fu=3,Uu=4,Ou=5,ku=6,Bu=7,vl="attached",zu="detached",pd=300,ks=301,Bs=302,sc=303,rc=304,jo=306,ti=1e3,Dn=1001,Bo=1002,pn=1003,md=1004,ur=1005,cn=1006,Lo=1007,Yn=1008,vi=1009,gd=1010,_d=1011,Sr=1012,Xc=1013,ns=1014,$n=1015,Rr=1016,jc=1017,qc=1018,zs=1020,xd=35902,vd=1021,yd=1022,Nn=1023,bd=1024,Md=1025,Is=1026,Gs=1027,Yc=1028,$c=1029,Sd=1030,Kc=1031,Zc=1033,Io=33776,Po=33777,Do=33778,No=33779,oc=35840,ac=35841,cc=35842,lc=35843,hc=36196,dc=37492,uc=37496,fc=37808,pc=37809,mc=37810,gc=37811,_c=37812,xc=37813,vc=37814,yc=37815,bc=37816,Mc=37817,Sc=37818,wc=37819,Ec=37820,Tc=37821,Fo=36492,Ac=36494,Cc=36495,wd=36283,Rc=36284,Lc=36285,Ic=36286,wr=2300,Er=2301,ta=2302,yl=2400,bl=2401,Ml=2402,Gu=2500,Hu=0,Ed=1,Pc=2,Vu=3200,Wu=3201,qo=0,Xu=1,Di="",It="srgb",mn="srgb-linear",Yo="linear",Nt="srgb",cs=7680,Sl=519,ju=512,qu=513,Yu=514,Td=515,$u=516,Ku=517,Zu=518,Ju=519,Dc=35044,wl="300 es",gi=2e3,zo=2001;class Xs{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});const n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){if(this._listeners===void 0)return!1;const n=this._listeners;return n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){if(this._listeners===void 0)return;const i=this._listeners[e];if(i!==void 0){const s=i.indexOf(t);s!==-1&&i.splice(s,1)}}dispatchEvent(e){if(this._listeners===void 0)return;const n=this._listeners[e.type];if(n!==void 0){e.target=this;const i=n.slice(0);for(let s=0,o=i.length;s<o;s++)i[s].call(this,e);e.target=null}}}const on=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];let El=1234567;const Ps=Math.PI/180,Hs=180/Math.PI;function Zn(){const r=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(on[r&255]+on[r>>8&255]+on[r>>16&255]+on[r>>24&255]+"-"+on[e&255]+on[e>>8&255]+"-"+on[e>>16&15|64]+on[e>>24&255]+"-"+on[t&63|128]+on[t>>8&255]+"-"+on[t>>16&255]+on[t>>24&255]+on[n&255]+on[n>>8&255]+on[n>>16&255]+on[n>>24&255]).toLowerCase()}function Zt(r,e,t){return Math.max(e,Math.min(t,r))}function Jc(r,e){return(r%e+e)%e}function Qu(r,e,t,n,i){return n+(r-e)*(i-n)/(t-e)}function ef(r,e,t){return r!==e?(t-r)/(e-r):0}function yr(r,e,t){return(1-t)*r+t*e}function tf(r,e,t,n){return yr(r,e,1-Math.exp(-t*n))}function nf(r,e=1){return e-Math.abs(Jc(r,e*2)-e)}function sf(r,e,t){return r<=e?0:r>=t?1:(r=(r-e)/(t-e),r*r*(3-2*r))}function rf(r,e,t){return r<=e?0:r>=t?1:(r=(r-e)/(t-e),r*r*r*(r*(r*6-15)+10))}function of(r,e){return r+Math.floor(Math.random()*(e-r+1))}function af(r,e){return r+Math.random()*(e-r)}function cf(r){return r*(.5-Math.random())}function lf(r){r!==void 0&&(El=r);let e=El+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function hf(r){return r*Ps}function df(r){return r*Hs}function uf(r){return(r&r-1)===0&&r!==0}function ff(r){return Math.pow(2,Math.ceil(Math.log(r)/Math.LN2))}function pf(r){return Math.pow(2,Math.floor(Math.log(r)/Math.LN2))}function mf(r,e,t,n,i){const s=Math.cos,o=Math.sin,a=s(t/2),c=o(t/2),l=s((e+n)/2),h=o((e+n)/2),d=s((e-n)/2),u=o((e-n)/2),m=s((n-e)/2),g=o((n-e)/2);switch(i){case"XYX":r.set(a*h,c*d,c*u,a*l);break;case"YZY":r.set(c*u,a*h,c*d,a*l);break;case"ZXZ":r.set(c*d,c*u,a*h,a*l);break;case"XZX":r.set(a*h,c*g,c*m,a*l);break;case"YXY":r.set(c*m,a*h,c*g,a*l);break;case"ZYZ":r.set(c*g,c*m,a*h,a*l);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+i)}}function qn(r,e){switch(e.constructor){case Float32Array:return r;case Uint32Array:return r/4294967295;case Uint16Array:return r/65535;case Uint8Array:return r/255;case Int32Array:return Math.max(r/2147483647,-1);case Int16Array:return Math.max(r/32767,-1);case Int8Array:return Math.max(r/127,-1);default:throw new Error("Invalid component type.")}}function Rt(r,e){switch(e.constructor){case Float32Array:return r;case Uint32Array:return Math.round(r*4294967295);case Uint16Array:return Math.round(r*65535);case Uint8Array:return Math.round(r*255);case Int32Array:return Math.round(r*2147483647);case Int16Array:return Math.round(r*32767);case Int8Array:return Math.round(r*127);default:throw new Error("Invalid component type.")}}const Zi={DEG2RAD:Ps,RAD2DEG:Hs,generateUUID:Zn,clamp:Zt,euclideanModulo:Jc,mapLinear:Qu,inverseLerp:ef,lerp:yr,damp:tf,pingpong:nf,smoothstep:sf,smootherstep:rf,randInt:of,randFloat:af,randFloatSpread:cf,seededRandom:lf,degToRad:hf,radToDeg:df,isPowerOfTwo:uf,ceilPowerOfTwo:ff,floorPowerOfTwo:pf,setQuaternionFromProperEuler:mf,normalize:Rt,denormalize:qn};class Ge{constructor(e=0,t=0){Ge.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){const t=this.x,n=this.y,i=e.elements;return this.x=i[0]*t+i[3]*n+i[6],this.y=i[1]*t+i[4]*n+i[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Zt(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){const n=Math.cos(t),i=Math.sin(t),s=this.x-e.x,o=this.y-e.y;return this.x=s*n-o*i+e.x,this.y=s*i+o*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class ft{constructor(e,t,n,i,s,o,a,c,l){ft.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,i,s,o,a,c,l)}set(e,t,n,i,s,o,a,c,l){const h=this.elements;return h[0]=e,h[1]=i,h[2]=a,h[3]=t,h[4]=s,h[5]=c,h[6]=n,h[7]=o,h[8]=l,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){const t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,i=t.elements,s=this.elements,o=n[0],a=n[3],c=n[6],l=n[1],h=n[4],d=n[7],u=n[2],m=n[5],g=n[8],_=i[0],f=i[3],p=i[6],x=i[1],y=i[4],v=i[7],F=i[2],A=i[5],L=i[8];return s[0]=o*_+a*x+c*F,s[3]=o*f+a*y+c*A,s[6]=o*p+a*v+c*L,s[1]=l*_+h*x+d*F,s[4]=l*f+h*y+d*A,s[7]=l*p+h*v+d*L,s[2]=u*_+m*x+g*F,s[5]=u*f+m*y+g*A,s[8]=u*p+m*v+g*L,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[1],i=e[2],s=e[3],o=e[4],a=e[5],c=e[6],l=e[7],h=e[8];return t*o*h-t*a*l-n*s*h+n*a*c+i*s*l-i*o*c}invert(){const e=this.elements,t=e[0],n=e[1],i=e[2],s=e[3],o=e[4],a=e[5],c=e[6],l=e[7],h=e[8],d=h*o-a*l,u=a*c-h*s,m=l*s-o*c,g=t*d+n*u+i*m;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);const _=1/g;return e[0]=d*_,e[1]=(i*l-h*n)*_,e[2]=(a*n-i*o)*_,e[3]=u*_,e[4]=(h*t-i*c)*_,e[5]=(i*s-a*t)*_,e[6]=m*_,e[7]=(n*c-l*t)*_,e[8]=(o*t-n*s)*_,this}transpose(){let e;const t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){const t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,i,s,o,a){const c=Math.cos(s),l=Math.sin(s);return this.set(n*c,n*l,-n*(c*o+l*a)+o+e,-i*l,i*c,-i*(-l*o+c*a)+a+t,0,0,1),this}scale(e,t){return this.premultiply(na.makeScale(e,t)),this}rotate(e){return this.premultiply(na.makeRotation(-e)),this}translate(e,t){return this.premultiply(na.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){const t=this.elements,n=e.elements;for(let i=0;i<9;i++)if(t[i]!==n[i])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}}const na=new ft;function Ad(r){for(let e=r.length-1;e>=0;--e)if(r[e]>=65535)return!0;return!1}function Tr(r){return document.createElementNS("http://www.w3.org/1999/xhtml",r)}function gf(){const r=Tr("canvas");return r.style.display="block",r}const Tl={};function fr(r){r in Tl||(Tl[r]=!0,console.warn(r))}function _f(r,e,t){return new Promise(function(n,i){function s(){switch(r.clientWaitSync(e,r.SYNC_FLUSH_COMMANDS_BIT,0)){case r.WAIT_FAILED:i();break;case r.TIMEOUT_EXPIRED:setTimeout(s,t);break;default:n()}}setTimeout(s,t)})}function xf(r){const e=r.elements;e[2]=.5*e[2]+.5*e[3],e[6]=.5*e[6]+.5*e[7],e[10]=.5*e[10]+.5*e[11],e[14]=.5*e[14]+.5*e[15]}function vf(r){const e=r.elements;e[11]===-1?(e[10]=-e[10]-1,e[14]=-e[14]):(e[10]=-e[10],e[14]=-e[14]+1)}const gt={enabled:!0,workingColorSpace:mn,spaces:{},convert:function(r,e,t){return this.enabled===!1||e===t||!e||!t||(this.spaces[e].transfer===Nt&&(r.r=xi(r.r),r.g=xi(r.g),r.b=xi(r.b)),this.spaces[e].primaries!==this.spaces[t].primaries&&(r.applyMatrix3(this.spaces[e].toXYZ),r.applyMatrix3(this.spaces[t].fromXYZ)),this.spaces[t].transfer===Nt&&(r.r=Ds(r.r),r.g=Ds(r.g),r.b=Ds(r.b))),r},fromWorkingColorSpace:function(r,e){return this.convert(r,this.workingColorSpace,e)},toWorkingColorSpace:function(r,e){return this.convert(r,e,this.workingColorSpace)},getPrimaries:function(r){return this.spaces[r].primaries},getTransfer:function(r){return r===Di?Yo:this.spaces[r].transfer},getLuminanceCoefficients:function(r,e=this.workingColorSpace){return r.fromArray(this.spaces[e].luminanceCoefficients)},define:function(r){Object.assign(this.spaces,r)},_getMatrix:function(r,e,t){return r.copy(this.spaces[e].toXYZ).multiply(this.spaces[t].fromXYZ)},_getDrawingBufferColorSpace:function(r){return this.spaces[r].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(r=this.workingColorSpace){return this.spaces[r].workingColorSpaceConfig.unpackColorSpace}};function xi(r){return r<.04045?r*.0773993808:Math.pow(r*.9478672986+.0521327014,2.4)}function Ds(r){return r<.0031308?r*12.92:1.055*Math.pow(r,.41666)-.055}const Al=[.64,.33,.3,.6,.15,.06],Cl=[.2126,.7152,.0722],Rl=[.3127,.329],Ll=new ft().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Il=new ft().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);gt.define({[mn]:{primaries:Al,whitePoint:Rl,transfer:Yo,toXYZ:Ll,fromXYZ:Il,luminanceCoefficients:Cl,workingColorSpaceConfig:{unpackColorSpace:It},outputColorSpaceConfig:{drawingBufferColorSpace:It}},[It]:{primaries:Al,whitePoint:Rl,transfer:Nt,toXYZ:Ll,fromXYZ:Il,luminanceCoefficients:Cl,outputColorSpaceConfig:{drawingBufferColorSpace:It}}});let ls;class yf{static getDataURL(e){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let t;if(e instanceof HTMLCanvasElement)t=e;else{ls===void 0&&(ls=Tr("canvas")),ls.width=e.width,ls.height=e.height;const n=ls.getContext("2d");e instanceof ImageData?n.putImageData(e,0,0):n.drawImage(e,0,0,e.width,e.height),t=ls}return t.width>2048||t.height>2048?(console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons",e),t.toDataURL("image/jpeg",.6)):t.toDataURL("image/png")}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){const t=Tr("canvas");t.width=e.width,t.height=e.height;const n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);const i=n.getImageData(0,0,e.width,e.height),s=i.data;for(let o=0;o<s.length;o++)s[o]=xi(s[o]/255)*255;return n.putImageData(i,0,0),t}else if(e.data){const t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(xi(t[n]/255)*255):t[n]=xi(t[n]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}}let bf=0;class Cd{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:bf++}),this.uuid=Zn(),this.data=e,this.dataReady=!0,this.version=0}set needsUpdate(e){e===!0&&this.version++}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];const n={uuid:this.uuid,url:""},i=this.data;if(i!==null){let s;if(Array.isArray(i)){s=[];for(let o=0,a=i.length;o<a;o++)i[o].isDataTexture?s.push(ia(i[o].image)):s.push(ia(i[o]))}else s=ia(i);n.url=s}return t||(e.images[this.uuid]=n),n}}function ia(r){return typeof HTMLImageElement<"u"&&r instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&r instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&r instanceof ImageBitmap?yf.getDataURL(r):r.data?{data:Array.from(r.data),width:r.width,height:r.height,type:r.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let Mf=0;class jt extends Xs{constructor(e=jt.DEFAULT_IMAGE,t=jt.DEFAULT_MAPPING,n=Dn,i=Dn,s=cn,o=Yn,a=Nn,c=vi,l=jt.DEFAULT_ANISOTROPY,h=Di){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Mf++}),this.uuid=Zn(),this.name="",this.source=new Cd(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=i,this.magFilter=s,this.minFilter=o,this.anisotropy=l,this.format=a,this.internalFormat=null,this.type=c,this.offset=new Ge(0,0),this.repeat=new Ge(1,1),this.center=new Ge(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new ft,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.version=0,this.onUpdate=null,this.isRenderTargetTexture=!1,this.pmremVersion=0}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];const n={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==pd)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case ti:e.x=e.x-Math.floor(e.x);break;case Dn:e.x=e.x<0?0:1;break;case Bo:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case ti:e.y=e.y-Math.floor(e.y);break;case Dn:e.y=e.y<0?0:1;break;case Bo:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}}jt.DEFAULT_IMAGE=null;jt.DEFAULT_MAPPING=pd;jt.DEFAULT_ANISOTROPY=1;class vt{constructor(e=0,t=0,n=0,i=1){vt.prototype.isVector4=!0,this.x=e,this.y=t,this.z=n,this.w=i}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,i){return this.x=e,this.y=t,this.z=n,this.w=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){const t=this.x,n=this.y,i=this.z,s=this.w,o=e.elements;return this.x=o[0]*t+o[4]*n+o[8]*i+o[12]*s,this.y=o[1]*t+o[5]*n+o[9]*i+o[13]*s,this.z=o[2]*t+o[6]*n+o[10]*i+o[14]*s,this.w=o[3]*t+o[7]*n+o[11]*i+o[15]*s,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);const t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,i,s;const c=e.elements,l=c[0],h=c[4],d=c[8],u=c[1],m=c[5],g=c[9],_=c[2],f=c[6],p=c[10];if(Math.abs(h-u)<.01&&Math.abs(d-_)<.01&&Math.abs(g-f)<.01){if(Math.abs(h+u)<.1&&Math.abs(d+_)<.1&&Math.abs(g+f)<.1&&Math.abs(l+m+p-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;const y=(l+1)/2,v=(m+1)/2,F=(p+1)/2,A=(h+u)/4,L=(d+_)/4,O=(g+f)/4;return y>v&&y>F?y<.01?(n=0,i=.707106781,s=.707106781):(n=Math.sqrt(y),i=A/n,s=L/n):v>F?v<.01?(n=.707106781,i=0,s=.707106781):(i=Math.sqrt(v),n=A/i,s=O/i):F<.01?(n=.707106781,i=.707106781,s=0):(s=Math.sqrt(F),n=L/s,i=O/s),this.set(n,i,s,t),this}let x=Math.sqrt((f-g)*(f-g)+(d-_)*(d-_)+(u-h)*(u-h));return Math.abs(x)<.001&&(x=1),this.x=(f-g)/x,this.y=(d-_)/x,this.z=(u-h)/x,this.w=Math.acos((l+m+p-1)/2),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this.w=Math.max(e.w,Math.min(t.w,this.w)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this.w=Math.max(e,Math.min(t,this.w)),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class Sf extends Xs{constructor(e=1,t=1,n={}){super(),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=1,this.scissor=new vt(0,0,e,t),this.scissorTest=!1,this.viewport=new vt(0,0,e,t);const i={width:e,height:t,depth:1};n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:cn,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1},n);const s=new jt(i,n.mapping,n.wrapS,n.wrapT,n.magFilter,n.minFilter,n.format,n.type,n.anisotropy,n.colorSpace);s.flipY=!1,s.generateMipmaps=n.generateMipmaps,s.internalFormat=n.internalFormat,this.textures=[];const o=n.count;for(let a=0;a<o;a++)this.textures[a]=s.clone(),this.textures[a].isRenderTargetTexture=!0;this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this.depthTexture=n.depthTexture,this.samples=n.samples}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let i=0,s=this.textures.length;i<s;i++)this.textures[i].image.width=e,this.textures[i].image.height=t,this.textures[i].image.depth=n;this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let n=0,i=e.textures.length;n<i;n++)this.textures[n]=e.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0;const t=Object.assign({},e.texture.image);return this.texture.source=new Cd(t),this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class is extends Sf{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}}class Rd extends jt{constructor(e=null,t=1,n=1,i=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:i},this.magFilter=pn,this.minFilter=pn,this.wrapR=Dn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}}class wf extends jt{constructor(e=null,t=1,n=1,i=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:i},this.magFilter=pn,this.minFilter=pn,this.wrapR=Dn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class bi{constructor(e=0,t=0,n=0,i=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=i}static slerpFlat(e,t,n,i,s,o,a){let c=n[i+0],l=n[i+1],h=n[i+2],d=n[i+3];const u=s[o+0],m=s[o+1],g=s[o+2],_=s[o+3];if(a===0){e[t+0]=c,e[t+1]=l,e[t+2]=h,e[t+3]=d;return}if(a===1){e[t+0]=u,e[t+1]=m,e[t+2]=g,e[t+3]=_;return}if(d!==_||c!==u||l!==m||h!==g){let f=1-a;const p=c*u+l*m+h*g+d*_,x=p>=0?1:-1,y=1-p*p;if(y>Number.EPSILON){const F=Math.sqrt(y),A=Math.atan2(F,p*x);f=Math.sin(f*A)/F,a=Math.sin(a*A)/F}const v=a*x;if(c=c*f+u*v,l=l*f+m*v,h=h*f+g*v,d=d*f+_*v,f===1-a){const F=1/Math.sqrt(c*c+l*l+h*h+d*d);c*=F,l*=F,h*=F,d*=F}}e[t]=c,e[t+1]=l,e[t+2]=h,e[t+3]=d}static multiplyQuaternionsFlat(e,t,n,i,s,o){const a=n[i],c=n[i+1],l=n[i+2],h=n[i+3],d=s[o],u=s[o+1],m=s[o+2],g=s[o+3];return e[t]=a*g+h*d+c*m-l*u,e[t+1]=c*g+h*u+l*d-a*m,e[t+2]=l*g+h*m+a*u-c*d,e[t+3]=h*g-a*d-c*u-l*m,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,i){return this._x=e,this._y=t,this._z=n,this._w=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){const n=e._x,i=e._y,s=e._z,o=e._order,a=Math.cos,c=Math.sin,l=a(n/2),h=a(i/2),d=a(s/2),u=c(n/2),m=c(i/2),g=c(s/2);switch(o){case"XYZ":this._x=u*h*d+l*m*g,this._y=l*m*d-u*h*g,this._z=l*h*g+u*m*d,this._w=l*h*d-u*m*g;break;case"YXZ":this._x=u*h*d+l*m*g,this._y=l*m*d-u*h*g,this._z=l*h*g-u*m*d,this._w=l*h*d+u*m*g;break;case"ZXY":this._x=u*h*d-l*m*g,this._y=l*m*d+u*h*g,this._z=l*h*g+u*m*d,this._w=l*h*d-u*m*g;break;case"ZYX":this._x=u*h*d-l*m*g,this._y=l*m*d+u*h*g,this._z=l*h*g-u*m*d,this._w=l*h*d+u*m*g;break;case"YZX":this._x=u*h*d+l*m*g,this._y=l*m*d+u*h*g,this._z=l*h*g-u*m*d,this._w=l*h*d-u*m*g;break;case"XZY":this._x=u*h*d-l*m*g,this._y=l*m*d-u*h*g,this._z=l*h*g+u*m*d,this._w=l*h*d+u*m*g;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){const n=t/2,i=Math.sin(n);return this._x=e.x*i,this._y=e.y*i,this._z=e.z*i,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){const t=e.elements,n=t[0],i=t[4],s=t[8],o=t[1],a=t[5],c=t[9],l=t[2],h=t[6],d=t[10],u=n+a+d;if(u>0){const m=.5/Math.sqrt(u+1);this._w=.25/m,this._x=(h-c)*m,this._y=(s-l)*m,this._z=(o-i)*m}else if(n>a&&n>d){const m=2*Math.sqrt(1+n-a-d);this._w=(h-c)/m,this._x=.25*m,this._y=(i+o)/m,this._z=(s+l)/m}else if(a>d){const m=2*Math.sqrt(1+a-n-d);this._w=(s-l)/m,this._x=(i+o)/m,this._y=.25*m,this._z=(c+h)/m}else{const m=2*Math.sqrt(1+d-n-a);this._w=(o-i)/m,this._x=(s+l)/m,this._y=(c+h)/m,this._z=.25*m}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<Number.EPSILON?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Zt(this.dot(e),-1,1)))}rotateTowards(e,t){const n=this.angleTo(e);if(n===0)return this;const i=Math.min(1,t/n);return this.slerp(e,i),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){const n=e._x,i=e._y,s=e._z,o=e._w,a=t._x,c=t._y,l=t._z,h=t._w;return this._x=n*h+o*a+i*l-s*c,this._y=i*h+o*c+s*a-n*l,this._z=s*h+o*l+n*c-i*a,this._w=o*h-n*a-i*c-s*l,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);const n=this._x,i=this._y,s=this._z,o=this._w;let a=o*e._w+n*e._x+i*e._y+s*e._z;if(a<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,a=-a):this.copy(e),a>=1)return this._w=o,this._x=n,this._y=i,this._z=s,this;const c=1-a*a;if(c<=Number.EPSILON){const m=1-t;return this._w=m*o+t*this._w,this._x=m*n+t*this._x,this._y=m*i+t*this._y,this._z=m*s+t*this._z,this.normalize(),this}const l=Math.sqrt(c),h=Math.atan2(l,a),d=Math.sin((1-t)*h)/l,u=Math.sin(t*h)/l;return this._w=o*d+this._w*u,this._x=n*d+this._x*u,this._y=i*d+this._y*u,this._z=s*d+this._z*u,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){const e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),i=Math.sqrt(1-n),s=Math.sqrt(n);return this.set(i*Math.sin(e),i*Math.cos(e),s*Math.sin(t),s*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class P{constructor(e=0,t=0,n=0){P.prototype.isVector3=!0,this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(Pl.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(Pl.setFromAxisAngle(e,t))}applyMatrix3(e){const t=this.x,n=this.y,i=this.z,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6]*i,this.y=s[1]*t+s[4]*n+s[7]*i,this.z=s[2]*t+s[5]*n+s[8]*i,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){const t=this.x,n=this.y,i=this.z,s=e.elements,o=1/(s[3]*t+s[7]*n+s[11]*i+s[15]);return this.x=(s[0]*t+s[4]*n+s[8]*i+s[12])*o,this.y=(s[1]*t+s[5]*n+s[9]*i+s[13])*o,this.z=(s[2]*t+s[6]*n+s[10]*i+s[14])*o,this}applyQuaternion(e){const t=this.x,n=this.y,i=this.z,s=e.x,o=e.y,a=e.z,c=e.w,l=2*(o*i-a*n),h=2*(a*t-s*i),d=2*(s*n-o*t);return this.x=t+c*l+o*d-a*h,this.y=n+c*h+a*l-s*d,this.z=i+c*d+s*h-o*l,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){const t=this.x,n=this.y,i=this.z,s=e.elements;return this.x=s[0]*t+s[4]*n+s[8]*i,this.y=s[1]*t+s[5]*n+s[9]*i,this.z=s[2]*t+s[6]*n+s[10]*i,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){const n=e.x,i=e.y,s=e.z,o=t.x,a=t.y,c=t.z;return this.x=i*c-s*a,this.y=s*o-n*c,this.z=n*a-i*o,this}projectOnVector(e){const t=e.lengthSq();if(t===0)return this.set(0,0,0);const n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return sa.copy(this).projectOnVector(e),this.sub(sa)}reflect(e){return this.sub(sa.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Zt(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y,i=this.z-e.z;return t*t+n*n+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){const i=Math.sin(t)*e;return this.x=i*Math.sin(n),this.y=Math.cos(t)*e,this.z=i*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){const t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),i=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=i,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const sa=new P,Pl=new bi;class Un{constructor(e=new P(1/0,1/0,1/0),t=new P(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(Gn.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(Gn.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){const n=Gn.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);const n=e.geometry;if(n!==void 0){const s=n.getAttribute("position");if(t===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=s.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,Gn):Gn.fromBufferAttribute(s,o),Gn.applyMatrix4(e.matrixWorld),this.expandByPoint(Gn);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Vr.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),Vr.copy(n.boundingBox)),Vr.applyMatrix4(e.matrixWorld),this.union(Vr)}const i=e.children;for(let s=0,o=i.length;s<o;s++)this.expandByObject(i[s],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,Gn),Gn.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Js),Wr.subVectors(this.max,Js),hs.subVectors(e.a,Js),ds.subVectors(e.b,Js),us.subVectors(e.c,Js),wi.subVectors(ds,hs),Ei.subVectors(us,ds),Gi.subVectors(hs,us);let t=[0,-wi.z,wi.y,0,-Ei.z,Ei.y,0,-Gi.z,Gi.y,wi.z,0,-wi.x,Ei.z,0,-Ei.x,Gi.z,0,-Gi.x,-wi.y,wi.x,0,-Ei.y,Ei.x,0,-Gi.y,Gi.x,0];return!ra(t,hs,ds,us,Wr)||(t=[1,0,0,0,1,0,0,0,1],!ra(t,hs,ds,us,Wr))?!1:(Xr.crossVectors(wi,Ei),t=[Xr.x,Xr.y,Xr.z],ra(t,hs,ds,us,Wr))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,Gn).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(Gn).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(oi[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),oi[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),oi[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),oi[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),oi[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),oi[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),oi[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),oi[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(oi),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}}const oi=[new P,new P,new P,new P,new P,new P,new P,new P],Gn=new P,Vr=new Un,hs=new P,ds=new P,us=new P,wi=new P,Ei=new P,Gi=new P,Js=new P,Wr=new P,Xr=new P,Hi=new P;function ra(r,e,t,n,i){for(let s=0,o=r.length-3;s<=o;s+=3){Hi.fromArray(r,s);const a=i.x*Math.abs(Hi.x)+i.y*Math.abs(Hi.y)+i.z*Math.abs(Hi.z),c=e.dot(Hi),l=t.dot(Hi),h=n.dot(Hi);if(Math.max(-Math.max(c,l,h),Math.min(c,l,h))>a)return!1}return!0}const Ef=new Un,Qs=new P,oa=new P;class On{constructor(e=new P,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){const n=this.center;t!==void 0?n.copy(t):Ef.setFromPoints(e).getCenter(n);let i=0;for(let s=0,o=e.length;s<o;s++)i=Math.max(i,n.distanceToSquared(e[s]));return this.radius=Math.sqrt(i),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){const t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){const n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Qs.subVectors(e,this.center);const t=Qs.lengthSq();if(t>this.radius*this.radius){const n=Math.sqrt(t),i=(n-this.radius)*.5;this.center.addScaledVector(Qs,i/n),this.radius+=i}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(oa.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Qs.copy(e.center).add(oa)),this.expandByPoint(Qs.copy(e.center).sub(oa))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}}const ai=new P,aa=new P,jr=new P,Ti=new P,ca=new P,qr=new P,la=new P;class Lr{constructor(e=new P,t=new P(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,ai)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);const n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){const t=ai.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(ai.copy(this.origin).addScaledVector(this.direction,t),ai.distanceToSquared(e))}distanceSqToSegment(e,t,n,i){aa.copy(e).add(t).multiplyScalar(.5),jr.copy(t).sub(e).normalize(),Ti.copy(this.origin).sub(aa);const s=e.distanceTo(t)*.5,o=-this.direction.dot(jr),a=Ti.dot(this.direction),c=-Ti.dot(jr),l=Ti.lengthSq(),h=Math.abs(1-o*o);let d,u,m,g;if(h>0)if(d=o*c-a,u=o*a-c,g=s*h,d>=0)if(u>=-g)if(u<=g){const _=1/h;d*=_,u*=_,m=d*(d+o*u+2*a)+u*(o*d+u+2*c)+l}else u=s,d=Math.max(0,-(o*u+a)),m=-d*d+u*(u+2*c)+l;else u=-s,d=Math.max(0,-(o*u+a)),m=-d*d+u*(u+2*c)+l;else u<=-g?(d=Math.max(0,-(-o*s+a)),u=d>0?-s:Math.min(Math.max(-s,-c),s),m=-d*d+u*(u+2*c)+l):u<=g?(d=0,u=Math.min(Math.max(-s,-c),s),m=u*(u+2*c)+l):(d=Math.max(0,-(o*s+a)),u=d>0?s:Math.min(Math.max(-s,-c),s),m=-d*d+u*(u+2*c)+l);else u=o>0?-s:s,d=Math.max(0,-(o*u+a)),m=-d*d+u*(u+2*c)+l;return n&&n.copy(this.origin).addScaledVector(this.direction,d),i&&i.copy(aa).addScaledVector(jr,u),m}intersectSphere(e,t){ai.subVectors(e.center,this.origin);const n=ai.dot(this.direction),i=ai.dot(ai)-n*n,s=e.radius*e.radius;if(i>s)return null;const o=Math.sqrt(s-i),a=n-o,c=n+o;return c<0?null:a<0?this.at(c,t):this.at(a,t)}intersectsSphere(e){return this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){const t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;const n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){const n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){const t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,i,s,o,a,c;const l=1/this.direction.x,h=1/this.direction.y,d=1/this.direction.z,u=this.origin;return l>=0?(n=(e.min.x-u.x)*l,i=(e.max.x-u.x)*l):(n=(e.max.x-u.x)*l,i=(e.min.x-u.x)*l),h>=0?(s=(e.min.y-u.y)*h,o=(e.max.y-u.y)*h):(s=(e.max.y-u.y)*h,o=(e.min.y-u.y)*h),n>o||s>i||((s>n||isNaN(n))&&(n=s),(o<i||isNaN(i))&&(i=o),d>=0?(a=(e.min.z-u.z)*d,c=(e.max.z-u.z)*d):(a=(e.max.z-u.z)*d,c=(e.min.z-u.z)*d),n>c||a>i)||((a>n||n!==n)&&(n=a),(c<i||i!==i)&&(i=c),i<0)?null:this.at(n>=0?n:i,t)}intersectsBox(e){return this.intersectBox(e,ai)!==null}intersectTriangle(e,t,n,i,s){ca.subVectors(t,e),qr.subVectors(n,e),la.crossVectors(ca,qr);let o=this.direction.dot(la),a;if(o>0){if(i)return null;a=1}else if(o<0)a=-1,o=-o;else return null;Ti.subVectors(this.origin,e);const c=a*this.direction.dot(qr.crossVectors(Ti,qr));if(c<0)return null;const l=a*this.direction.dot(ca.cross(Ti));if(l<0||c+l>o)return null;const h=-a*Ti.dot(la);return h<0?null:this.at(h/o,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class Ze{constructor(e,t,n,i,s,o,a,c,l,h,d,u,m,g,_,f){Ze.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,i,s,o,a,c,l,h,d,u,m,g,_,f)}set(e,t,n,i,s,o,a,c,l,h,d,u,m,g,_,f){const p=this.elements;return p[0]=e,p[4]=t,p[8]=n,p[12]=i,p[1]=s,p[5]=o,p[9]=a,p[13]=c,p[2]=l,p[6]=h,p[10]=d,p[14]=u,p[3]=m,p[7]=g,p[11]=_,p[15]=f,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Ze().fromArray(this.elements)}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){const t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){const t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){const t=this.elements,n=e.elements,i=1/fs.setFromMatrixColumn(e,0).length(),s=1/fs.setFromMatrixColumn(e,1).length(),o=1/fs.setFromMatrixColumn(e,2).length();return t[0]=n[0]*i,t[1]=n[1]*i,t[2]=n[2]*i,t[3]=0,t[4]=n[4]*s,t[5]=n[5]*s,t[6]=n[6]*s,t[7]=0,t[8]=n[8]*o,t[9]=n[9]*o,t[10]=n[10]*o,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){const t=this.elements,n=e.x,i=e.y,s=e.z,o=Math.cos(n),a=Math.sin(n),c=Math.cos(i),l=Math.sin(i),h=Math.cos(s),d=Math.sin(s);if(e.order==="XYZ"){const u=o*h,m=o*d,g=a*h,_=a*d;t[0]=c*h,t[4]=-c*d,t[8]=l,t[1]=m+g*l,t[5]=u-_*l,t[9]=-a*c,t[2]=_-u*l,t[6]=g+m*l,t[10]=o*c}else if(e.order==="YXZ"){const u=c*h,m=c*d,g=l*h,_=l*d;t[0]=u+_*a,t[4]=g*a-m,t[8]=o*l,t[1]=o*d,t[5]=o*h,t[9]=-a,t[2]=m*a-g,t[6]=_+u*a,t[10]=o*c}else if(e.order==="ZXY"){const u=c*h,m=c*d,g=l*h,_=l*d;t[0]=u-_*a,t[4]=-o*d,t[8]=g+m*a,t[1]=m+g*a,t[5]=o*h,t[9]=_-u*a,t[2]=-o*l,t[6]=a,t[10]=o*c}else if(e.order==="ZYX"){const u=o*h,m=o*d,g=a*h,_=a*d;t[0]=c*h,t[4]=g*l-m,t[8]=u*l+_,t[1]=c*d,t[5]=_*l+u,t[9]=m*l-g,t[2]=-l,t[6]=a*c,t[10]=o*c}else if(e.order==="YZX"){const u=o*c,m=o*l,g=a*c,_=a*l;t[0]=c*h,t[4]=_-u*d,t[8]=g*d+m,t[1]=d,t[5]=o*h,t[9]=-a*h,t[2]=-l*h,t[6]=m*d+g,t[10]=u-_*d}else if(e.order==="XZY"){const u=o*c,m=o*l,g=a*c,_=a*l;t[0]=c*h,t[4]=-d,t[8]=l*h,t[1]=u*d+_,t[5]=o*h,t[9]=m*d-g,t[2]=g*d-m,t[6]=a*h,t[10]=_*d+u}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Tf,e,Af)}lookAt(e,t,n){const i=this.elements;return Sn.subVectors(e,t),Sn.lengthSq()===0&&(Sn.z=1),Sn.normalize(),Ai.crossVectors(n,Sn),Ai.lengthSq()===0&&(Math.abs(n.z)===1?Sn.x+=1e-4:Sn.z+=1e-4,Sn.normalize(),Ai.crossVectors(n,Sn)),Ai.normalize(),Yr.crossVectors(Sn,Ai),i[0]=Ai.x,i[4]=Yr.x,i[8]=Sn.x,i[1]=Ai.y,i[5]=Yr.y,i[9]=Sn.y,i[2]=Ai.z,i[6]=Yr.z,i[10]=Sn.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,i=t.elements,s=this.elements,o=n[0],a=n[4],c=n[8],l=n[12],h=n[1],d=n[5],u=n[9],m=n[13],g=n[2],_=n[6],f=n[10],p=n[14],x=n[3],y=n[7],v=n[11],F=n[15],A=i[0],L=i[4],O=i[8],w=i[12],S=i[1],U=i[5],Z=i[9],K=i[13],se=i[2],fe=i[6],z=i[10],de=i[14],$=i[3],D=i[7],B=i[11],j=i[15];return s[0]=o*A+a*S+c*se+l*$,s[4]=o*L+a*U+c*fe+l*D,s[8]=o*O+a*Z+c*z+l*B,s[12]=o*w+a*K+c*de+l*j,s[1]=h*A+d*S+u*se+m*$,s[5]=h*L+d*U+u*fe+m*D,s[9]=h*O+d*Z+u*z+m*B,s[13]=h*w+d*K+u*de+m*j,s[2]=g*A+_*S+f*se+p*$,s[6]=g*L+_*U+f*fe+p*D,s[10]=g*O+_*Z+f*z+p*B,s[14]=g*w+_*K+f*de+p*j,s[3]=x*A+y*S+v*se+F*$,s[7]=x*L+y*U+v*fe+F*D,s[11]=x*O+y*Z+v*z+F*B,s[15]=x*w+y*K+v*de+F*j,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[4],i=e[8],s=e[12],o=e[1],a=e[5],c=e[9],l=e[13],h=e[2],d=e[6],u=e[10],m=e[14],g=e[3],_=e[7],f=e[11],p=e[15];return g*(+s*c*d-i*l*d-s*a*u+n*l*u+i*a*m-n*c*m)+_*(+t*c*m-t*l*u+s*o*u-i*o*m+i*l*h-s*c*h)+f*(+t*l*d-t*a*m-s*o*d+n*o*m+s*a*h-n*l*h)+p*(-i*a*h-t*c*d+t*a*u+i*o*d-n*o*u+n*c*h)}transpose(){const e=this.elements;let t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){const i=this.elements;return e.isVector3?(i[12]=e.x,i[13]=e.y,i[14]=e.z):(i[12]=e,i[13]=t,i[14]=n),this}invert(){const e=this.elements,t=e[0],n=e[1],i=e[2],s=e[3],o=e[4],a=e[5],c=e[6],l=e[7],h=e[8],d=e[9],u=e[10],m=e[11],g=e[12],_=e[13],f=e[14],p=e[15],x=d*f*l-_*u*l+_*c*m-a*f*m-d*c*p+a*u*p,y=g*u*l-h*f*l-g*c*m+o*f*m+h*c*p-o*u*p,v=h*_*l-g*d*l+g*a*m-o*_*m-h*a*p+o*d*p,F=g*d*c-h*_*c-g*a*u+o*_*u+h*a*f-o*d*f,A=t*x+n*y+i*v+s*F;if(A===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const L=1/A;return e[0]=x*L,e[1]=(_*u*s-d*f*s-_*i*m+n*f*m+d*i*p-n*u*p)*L,e[2]=(a*f*s-_*c*s+_*i*l-n*f*l-a*i*p+n*c*p)*L,e[3]=(d*c*s-a*u*s-d*i*l+n*u*l+a*i*m-n*c*m)*L,e[4]=y*L,e[5]=(h*f*s-g*u*s+g*i*m-t*f*m-h*i*p+t*u*p)*L,e[6]=(g*c*s-o*f*s-g*i*l+t*f*l+o*i*p-t*c*p)*L,e[7]=(o*u*s-h*c*s+h*i*l-t*u*l-o*i*m+t*c*m)*L,e[8]=v*L,e[9]=(g*d*s-h*_*s-g*n*m+t*_*m+h*n*p-t*d*p)*L,e[10]=(o*_*s-g*a*s+g*n*l-t*_*l-o*n*p+t*a*p)*L,e[11]=(h*a*s-o*d*s-h*n*l+t*d*l+o*n*m-t*a*m)*L,e[12]=F*L,e[13]=(h*_*i-g*d*i+g*n*u-t*_*u-h*n*f+t*d*f)*L,e[14]=(g*a*i-o*_*i-g*n*c+t*_*c+o*n*f-t*a*f)*L,e[15]=(o*d*i-h*a*i+h*n*c-t*d*c-o*n*u+t*a*u)*L,this}scale(e){const t=this.elements,n=e.x,i=e.y,s=e.z;return t[0]*=n,t[4]*=i,t[8]*=s,t[1]*=n,t[5]*=i,t[9]*=s,t[2]*=n,t[6]*=i,t[10]*=s,t[3]*=n,t[7]*=i,t[11]*=s,this}getMaxScaleOnAxis(){const e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],i=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,i))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){const t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){const n=Math.cos(t),i=Math.sin(t),s=1-n,o=e.x,a=e.y,c=e.z,l=s*o,h=s*a;return this.set(l*o+n,l*a-i*c,l*c+i*a,0,l*a+i*c,h*a+n,h*c-i*o,0,l*c-i*a,h*c+i*o,s*c*c+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,i,s,o){return this.set(1,n,s,0,e,1,o,0,t,i,1,0,0,0,0,1),this}compose(e,t,n){const i=this.elements,s=t._x,o=t._y,a=t._z,c=t._w,l=s+s,h=o+o,d=a+a,u=s*l,m=s*h,g=s*d,_=o*h,f=o*d,p=a*d,x=c*l,y=c*h,v=c*d,F=n.x,A=n.y,L=n.z;return i[0]=(1-(_+p))*F,i[1]=(m+v)*F,i[2]=(g-y)*F,i[3]=0,i[4]=(m-v)*A,i[5]=(1-(u+p))*A,i[6]=(f+x)*A,i[7]=0,i[8]=(g+y)*L,i[9]=(f-x)*L,i[10]=(1-(u+_))*L,i[11]=0,i[12]=e.x,i[13]=e.y,i[14]=e.z,i[15]=1,this}decompose(e,t,n){const i=this.elements;let s=fs.set(i[0],i[1],i[2]).length();const o=fs.set(i[4],i[5],i[6]).length(),a=fs.set(i[8],i[9],i[10]).length();this.determinant()<0&&(s=-s),e.x=i[12],e.y=i[13],e.z=i[14],Hn.copy(this);const l=1/s,h=1/o,d=1/a;return Hn.elements[0]*=l,Hn.elements[1]*=l,Hn.elements[2]*=l,Hn.elements[4]*=h,Hn.elements[5]*=h,Hn.elements[6]*=h,Hn.elements[8]*=d,Hn.elements[9]*=d,Hn.elements[10]*=d,t.setFromRotationMatrix(Hn),n.x=s,n.y=o,n.z=a,this}makePerspective(e,t,n,i,s,o,a=gi){const c=this.elements,l=2*s/(t-e),h=2*s/(n-i),d=(t+e)/(t-e),u=(n+i)/(n-i);let m,g;if(a===gi)m=-(o+s)/(o-s),g=-2*o*s/(o-s);else if(a===zo)m=-o/(o-s),g=-o*s/(o-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return c[0]=l,c[4]=0,c[8]=d,c[12]=0,c[1]=0,c[5]=h,c[9]=u,c[13]=0,c[2]=0,c[6]=0,c[10]=m,c[14]=g,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,t,n,i,s,o,a=gi){const c=this.elements,l=1/(t-e),h=1/(n-i),d=1/(o-s),u=(t+e)*l,m=(n+i)*h;let g,_;if(a===gi)g=(o+s)*d,_=-2*d;else if(a===zo)g=s*d,_=-1*d;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return c[0]=2*l,c[4]=0,c[8]=0,c[12]=-u,c[1]=0,c[5]=2*h,c[9]=0,c[13]=-m,c[2]=0,c[6]=0,c[10]=_,c[14]=-g,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){const t=this.elements,n=e.elements;for(let i=0;i<16;i++)if(t[i]!==n[i])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}}const fs=new P,Hn=new Ze,Tf=new P(0,0,0),Af=new P(1,1,1),Ai=new P,Yr=new P,Sn=new P,Dl=new Ze,Nl=new bi;class Fn{constructor(e=0,t=0,n=0,i=Fn.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=i}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,i=this._order){return this._x=e,this._y=t,this._z=n,this._order=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){const i=e.elements,s=i[0],o=i[4],a=i[8],c=i[1],l=i[5],h=i[9],d=i[2],u=i[6],m=i[10];switch(t){case"XYZ":this._y=Math.asin(Zt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-h,m),this._z=Math.atan2(-o,s)):(this._x=Math.atan2(u,l),this._z=0);break;case"YXZ":this._x=Math.asin(-Zt(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(a,m),this._z=Math.atan2(c,l)):(this._y=Math.atan2(-d,s),this._z=0);break;case"ZXY":this._x=Math.asin(Zt(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(-d,m),this._z=Math.atan2(-o,l)):(this._y=0,this._z=Math.atan2(c,s));break;case"ZYX":this._y=Math.asin(-Zt(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(u,m),this._z=Math.atan2(c,s)):(this._x=0,this._z=Math.atan2(-o,l));break;case"YZX":this._z=Math.asin(Zt(c,-1,1)),Math.abs(c)<.9999999?(this._x=Math.atan2(-h,l),this._y=Math.atan2(-d,s)):(this._x=0,this._y=Math.atan2(a,m));break;case"XZY":this._z=Math.asin(-Zt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(u,l),this._y=Math.atan2(a,s)):(this._x=Math.atan2(-h,m),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return Dl.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Dl,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return Nl.setFromEuler(this),this.setFromQuaternion(Nl,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}Fn.DEFAULT_ORDER="XYZ";class Qc{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}}let Cf=0;const Fl=new P,ps=new bi,ci=new Ze,$r=new P,er=new P,Rf=new P,Lf=new bi,Ul=new P(1,0,0),Ol=new P(0,1,0),kl=new P(0,0,1),Bl={type:"added"},If={type:"removed"},ms={type:"childadded",child:null},ha={type:"childremoved",child:null};class Ut extends Xs{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Cf++}),this.uuid=Zn(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=Ut.DEFAULT_UP.clone();const e=new P,t=new Fn,n=new bi,i=new P(1,1,1);function s(){n.setFromEuler(t,!1)}function o(){t.setFromQuaternion(n,void 0,!1)}t._onChange(s),n._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:i},modelViewMatrix:{value:new Ze},normalMatrix:{value:new ft}}),this.matrix=new Ze,this.matrixWorld=new Ze,this.matrixAutoUpdate=Ut.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=Ut.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Qc,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return ps.setFromAxisAngle(e,t),this.quaternion.multiply(ps),this}rotateOnWorldAxis(e,t){return ps.setFromAxisAngle(e,t),this.quaternion.premultiply(ps),this}rotateX(e){return this.rotateOnAxis(Ul,e)}rotateY(e){return this.rotateOnAxis(Ol,e)}rotateZ(e){return this.rotateOnAxis(kl,e)}translateOnAxis(e,t){return Fl.copy(e).applyQuaternion(this.quaternion),this.position.add(Fl.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(Ul,e)}translateY(e){return this.translateOnAxis(Ol,e)}translateZ(e){return this.translateOnAxis(kl,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(ci.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?$r.copy(e):$r.set(e,t,n);const i=this.parent;this.updateWorldMatrix(!0,!1),er.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?ci.lookAt(er,$r,this.up):ci.lookAt($r,er,this.up),this.quaternion.setFromRotationMatrix(ci),i&&(ci.extractRotation(i.matrixWorld),ps.setFromRotationMatrix(ci),this.quaternion.premultiply(ps.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(Bl),ms.child=e,this.dispatchEvent(ms),ms.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}const t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(If),ha.child=e,this.dispatchEvent(ha),ha.child=null),this}removeFromParent(){const e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),ci.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),ci.multiply(e.parent.matrixWorld)),e.applyMatrix4(ci),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(Bl),ms.child=e,this.dispatchEvent(ms),ms.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,i=this.children.length;n<i;n++){const o=this.children[n].getObjectByProperty(e,t);if(o!==void 0)return o}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);const i=this.children;for(let s=0,o=i.length;s<o;s++)i[s].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(er,e,Rf),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(er,Lf,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);const t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);const t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);const t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].traverseVisible(e)}traverseAncestors(e){const t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);const t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t){const n=this.parent;if(e===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){const i=this.children;for(let s=0,o=i.length;s<o;s++)i[s].updateWorldMatrix(!1,!0)}}toJSON(e){const t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});const i={};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.castShadow===!0&&(i.castShadow=!0),this.receiveShadow===!0&&(i.receiveShadow=!0),this.visible===!1&&(i.visible=!1),this.frustumCulled===!1&&(i.frustumCulled=!1),this.renderOrder!==0&&(i.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(i.userData=this.userData),i.layers=this.layers.mask,i.matrix=this.matrix.toArray(),i.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(i.matrixAutoUpdate=!1),this.isInstancedMesh&&(i.type="InstancedMesh",i.count=this.count,i.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(i.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(i.type="BatchedMesh",i.perObjectFrustumCulled=this.perObjectFrustumCulled,i.sortObjects=this.sortObjects,i.drawRanges=this._drawRanges,i.reservedRanges=this._reservedRanges,i.visibility=this._visibility,i.active=this._active,i.bounds=this._bounds.map(a=>({boxInitialized:a.boxInitialized,boxMin:a.box.min.toArray(),boxMax:a.box.max.toArray(),sphereInitialized:a.sphereInitialized,sphereRadius:a.sphere.radius,sphereCenter:a.sphere.center.toArray()})),i.maxInstanceCount=this._maxInstanceCount,i.maxVertexCount=this._maxVertexCount,i.maxIndexCount=this._maxIndexCount,i.geometryInitialized=this._geometryInitialized,i.geometryCount=this._geometryCount,i.matricesTexture=this._matricesTexture.toJSON(e),this._colorsTexture!==null&&(i.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(i.boundingSphere={center:i.boundingSphere.center.toArray(),radius:i.boundingSphere.radius}),this.boundingBox!==null&&(i.boundingBox={min:i.boundingBox.min.toArray(),max:i.boundingBox.max.toArray()}));function s(a,c){return a[c.uuid]===void 0&&(a[c.uuid]=c.toJSON(e)),c.uuid}if(this.isScene)this.background&&(this.background.isColor?i.background=this.background.toJSON():this.background.isTexture&&(i.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(i.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){i.geometry=s(e.geometries,this.geometry);const a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){const c=a.shapes;if(Array.isArray(c))for(let l=0,h=c.length;l<h;l++){const d=c[l];s(e.shapes,d)}else s(e.shapes,c)}}if(this.isSkinnedMesh&&(i.bindMode=this.bindMode,i.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),i.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const a=[];for(let c=0,l=this.material.length;c<l;c++)a.push(s(e.materials,this.material[c]));i.material=a}else i.material=s(e.materials,this.material);if(this.children.length>0){i.children=[];for(let a=0;a<this.children.length;a++)i.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){i.animations=[];for(let a=0;a<this.animations.length;a++){const c=this.animations[a];i.animations.push(s(e.animations,c))}}if(t){const a=o(e.geometries),c=o(e.materials),l=o(e.textures),h=o(e.images),d=o(e.shapes),u=o(e.skeletons),m=o(e.animations),g=o(e.nodes);a.length>0&&(n.geometries=a),c.length>0&&(n.materials=c),l.length>0&&(n.textures=l),h.length>0&&(n.images=h),d.length>0&&(n.shapes=d),u.length>0&&(n.skeletons=u),m.length>0&&(n.animations=m),g.length>0&&(n.nodes=g)}return n.object=i,n;function o(a){const c=[];for(const l in a){const h=a[l];delete h.metadata,c.push(h)}return c}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){const i=e.children[n];this.add(i.clone())}return this}}Ut.DEFAULT_UP=new P(0,1,0);Ut.DEFAULT_MATRIX_AUTO_UPDATE=!0;Ut.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const Vn=new P,li=new P,da=new P,hi=new P,gs=new P,_s=new P,zl=new P,ua=new P,fa=new P,pa=new P,ma=new vt,ga=new vt,_a=new vt;class Tn{constructor(e=new P,t=new P,n=new P){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,i){i.subVectors(n,t),Vn.subVectors(e,t),i.cross(Vn);const s=i.lengthSq();return s>0?i.multiplyScalar(1/Math.sqrt(s)):i.set(0,0,0)}static getBarycoord(e,t,n,i,s){Vn.subVectors(i,t),li.subVectors(n,t),da.subVectors(e,t);const o=Vn.dot(Vn),a=Vn.dot(li),c=Vn.dot(da),l=li.dot(li),h=li.dot(da),d=o*l-a*a;if(d===0)return s.set(0,0,0),null;const u=1/d,m=(l*c-a*h)*u,g=(o*h-a*c)*u;return s.set(1-m-g,g,m)}static containsPoint(e,t,n,i){return this.getBarycoord(e,t,n,i,hi)===null?!1:hi.x>=0&&hi.y>=0&&hi.x+hi.y<=1}static getInterpolation(e,t,n,i,s,o,a,c){return this.getBarycoord(e,t,n,i,hi)===null?(c.x=0,c.y=0,"z"in c&&(c.z=0),"w"in c&&(c.w=0),null):(c.setScalar(0),c.addScaledVector(s,hi.x),c.addScaledVector(o,hi.y),c.addScaledVector(a,hi.z),c)}static getInterpolatedAttribute(e,t,n,i,s,o){return ma.setScalar(0),ga.setScalar(0),_a.setScalar(0),ma.fromBufferAttribute(e,t),ga.fromBufferAttribute(e,n),_a.fromBufferAttribute(e,i),o.setScalar(0),o.addScaledVector(ma,s.x),o.addScaledVector(ga,s.y),o.addScaledVector(_a,s.z),o}static isFrontFacing(e,t,n,i){return Vn.subVectors(n,t),li.subVectors(e,t),Vn.cross(li).dot(i)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,i){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[i]),this}setFromAttributeAndIndices(e,t,n,i){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,i),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Vn.subVectors(this.c,this.b),li.subVectors(this.a,this.b),Vn.cross(li).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return Tn.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return Tn.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,i,s){return Tn.getInterpolation(e,this.a,this.b,this.c,t,n,i,s)}containsPoint(e){return Tn.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return Tn.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){const n=this.a,i=this.b,s=this.c;let o,a;gs.subVectors(i,n),_s.subVectors(s,n),ua.subVectors(e,n);const c=gs.dot(ua),l=_s.dot(ua);if(c<=0&&l<=0)return t.copy(n);fa.subVectors(e,i);const h=gs.dot(fa),d=_s.dot(fa);if(h>=0&&d<=h)return t.copy(i);const u=c*d-h*l;if(u<=0&&c>=0&&h<=0)return o=c/(c-h),t.copy(n).addScaledVector(gs,o);pa.subVectors(e,s);const m=gs.dot(pa),g=_s.dot(pa);if(g>=0&&m<=g)return t.copy(s);const _=m*l-c*g;if(_<=0&&l>=0&&g<=0)return a=l/(l-g),t.copy(n).addScaledVector(_s,a);const f=h*g-m*d;if(f<=0&&d-h>=0&&m-g>=0)return zl.subVectors(s,i),a=(d-h)/(d-h+(m-g)),t.copy(i).addScaledVector(zl,a);const p=1/(f+_+u);return o=_*p,a=u*p,t.copy(n).addScaledVector(gs,o).addScaledVector(_s,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}}const Ld={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Ci={h:0,s:0,l:0},Kr={h:0,s:0,l:0};function xa(r,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?r+(e-r)*6*t:t<1/2?e:t<2/3?r+(e-r)*6*(2/3-t):r}class qe{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){const i=e;i&&i.isColor?this.copy(i):typeof i=="number"?this.setHex(i):typeof i=="string"&&this.setStyle(i)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=It){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,gt.toWorkingColorSpace(this,t),this}setRGB(e,t,n,i=gt.workingColorSpace){return this.r=e,this.g=t,this.b=n,gt.toWorkingColorSpace(this,i),this}setHSL(e,t,n,i=gt.workingColorSpace){if(e=Jc(e,1),t=Zt(t,0,1),n=Zt(n,0,1),t===0)this.r=this.g=this.b=n;else{const s=n<=.5?n*(1+t):n+t-n*t,o=2*n-s;this.r=xa(o,s,e+1/3),this.g=xa(o,s,e),this.b=xa(o,s,e-1/3)}return gt.toWorkingColorSpace(this,i),this}setStyle(e,t=It){function n(s){s!==void 0&&parseFloat(s)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let i;if(i=/^(\w+)\(([^\)]*)\)/.exec(e)){let s;const o=i[1],a=i[2];switch(o){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,t);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,t);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(i=/^\#([A-Fa-f\d]+)$/.exec(e)){const s=i[1],o=s.length;if(o===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,t);if(o===6)return this.setHex(parseInt(s,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=It){const n=Ld[e.toLowerCase()];return n!==void 0?this.setHex(n,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=xi(e.r),this.g=xi(e.g),this.b=xi(e.b),this}copyLinearToSRGB(e){return this.r=Ds(e.r),this.g=Ds(e.g),this.b=Ds(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=It){return gt.fromWorkingColorSpace(an.copy(this),e),Math.round(Zt(an.r*255,0,255))*65536+Math.round(Zt(an.g*255,0,255))*256+Math.round(Zt(an.b*255,0,255))}getHexString(e=It){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=gt.workingColorSpace){gt.fromWorkingColorSpace(an.copy(this),t);const n=an.r,i=an.g,s=an.b,o=Math.max(n,i,s),a=Math.min(n,i,s);let c,l;const h=(a+o)/2;if(a===o)c=0,l=0;else{const d=o-a;switch(l=h<=.5?d/(o+a):d/(2-o-a),o){case n:c=(i-s)/d+(i<s?6:0);break;case i:c=(s-n)/d+2;break;case s:c=(n-i)/d+4;break}c/=6}return e.h=c,e.s=l,e.l=h,e}getRGB(e,t=gt.workingColorSpace){return gt.fromWorkingColorSpace(an.copy(this),t),e.r=an.r,e.g=an.g,e.b=an.b,e}getStyle(e=It){gt.fromWorkingColorSpace(an.copy(this),e);const t=an.r,n=an.g,i=an.b;return e!==It?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${i.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(i*255)})`}offsetHSL(e,t,n){return this.getHSL(Ci),this.setHSL(Ci.h+e,Ci.s+t,Ci.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Ci),e.getHSL(Kr);const n=yr(Ci.h,Kr.h,t),i=yr(Ci.s,Kr.s,t),s=yr(Ci.l,Kr.l,t);return this.setHSL(n,i,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){const t=this.r,n=this.g,i=this.b,s=e.elements;return this.r=s[0]*t+s[3]*n+s[6]*i,this.g=s[1]*t+s[4]*n+s[7]*i,this.b=s[2]*t+s[5]*n+s[8]*i,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const an=new qe;qe.NAMES=Ld;let Pf=0;class Ft extends Xs{static get type(){return"Material"}get type(){return this.constructor.type}set type(e){}constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Pf++}),this.uuid=Zn(),this.name="",this.blending=Ls,this.side=ln,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=$a,this.blendDst=Ka,this.blendEquation=Ki,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new qe(0,0,0),this.blendAlpha=0,this.depthFunc=Os,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Sl,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=cs,this.stencilZFail=cs,this.stencilZPass=cs,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(const t in e){const n=e[t];if(n===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}const i=this[t];if(i===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}i&&i.isColor?i.set(n):i&&i.isVector3&&n&&n.isVector3?i.copy(n):this[t]=n}}toJSON(e){const t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});const n={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==Ls&&(n.blending=this.blending),this.side!==ln&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==$a&&(n.blendSrc=this.blendSrc),this.blendDst!==Ka&&(n.blendDst=this.blendDst),this.blendEquation!==Ki&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==Os&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Sl&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==cs&&(n.stencilFail=this.stencilFail),this.stencilZFail!==cs&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==cs&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function i(s){const o=[];for(const a in s){const c=s[a];delete c.metadata,o.push(c)}return o}if(t){const s=i(e.textures),o=i(e.images);s.length>0&&(n.textures=s),o.length>0&&(n.images=o)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;const t=e.clippingPlanes;let n=null;if(t!==null){const i=t.length;n=new Array(i);for(let s=0;s!==i;++s)n[s]=t[s].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}onBuild(){console.warn("Material: onBuild() has been removed.")}}class rn extends Ft{static get type(){return"MeshBasicMaterial"}constructor(e){super(),this.isMeshBasicMaterial=!0,this.color=new qe(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Fn,this.combine=Xo,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}}const Xt=new P,Zr=new Ge;class yt{constructor(e,t,n=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=Dc,this.updateRanges=[],this.gpuType=$n,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let i=0,s=this.itemSize;i<s;i++)this.array[e+i]=t.array[n+i];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)Zr.fromBufferAttribute(this,t),Zr.applyMatrix3(e),this.setXY(t,Zr.x,Zr.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)Xt.fromBufferAttribute(this,t),Xt.applyMatrix3(e),this.setXYZ(t,Xt.x,Xt.y,Xt.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)Xt.fromBufferAttribute(this,t),Xt.applyMatrix4(e),this.setXYZ(t,Xt.x,Xt.y,Xt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Xt.fromBufferAttribute(this,t),Xt.applyNormalMatrix(e),this.setXYZ(t,Xt.x,Xt.y,Xt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Xt.fromBufferAttribute(this,t),Xt.transformDirection(e),this.setXYZ(t,Xt.x,Xt.y,Xt.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=qn(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=Rt(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=qn(t,this.array)),t}setX(e,t){return this.normalized&&(t=Rt(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=qn(t,this.array)),t}setY(e,t){return this.normalized&&(t=Rt(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=qn(t,this.array)),t}setZ(e,t){return this.normalized&&(t=Rt(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=qn(t,this.array)),t}setW(e,t){return this.normalized&&(t=Rt(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=Rt(t,this.array),n=Rt(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,i){return e*=this.itemSize,this.normalized&&(t=Rt(t,this.array),n=Rt(n,this.array),i=Rt(i,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=i,this}setXYZW(e,t,n,i,s){return e*=this.itemSize,this.normalized&&(t=Rt(t,this.array),n=Rt(n,this.array),i=Rt(i,this.array),s=Rt(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=i,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==Dc&&(e.usage=this.usage),e}}class Id extends yt{constructor(e,t,n){super(new Uint16Array(e),t,n)}}class Pd extends yt{constructor(e,t,n){super(new Uint32Array(e),t,n)}}class ot extends yt{constructor(e,t,n){super(new Float32Array(e),t,n)}}let Df=0;const Ln=new Ze,va=new Ut,xs=new P,wn=new Un,tr=new Un,Kt=new P;class at extends Xs{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Df++}),this.uuid=Zn(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Ad(e)?Pd:Id)(e,1):this.index=e,this}setIndirect(e){return this.indirect=e,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){const t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);const n=this.attributes.normal;if(n!==void 0){const s=new ft().getNormalMatrix(e);n.applyNormalMatrix(s),n.needsUpdate=!0}const i=this.attributes.tangent;return i!==void 0&&(i.transformDirection(e),i.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return Ln.makeRotationFromQuaternion(e),this.applyMatrix4(Ln),this}rotateX(e){return Ln.makeRotationX(e),this.applyMatrix4(Ln),this}rotateY(e){return Ln.makeRotationY(e),this.applyMatrix4(Ln),this}rotateZ(e){return Ln.makeRotationZ(e),this.applyMatrix4(Ln),this}translate(e,t,n){return Ln.makeTranslation(e,t,n),this.applyMatrix4(Ln),this}scale(e,t,n){return Ln.makeScale(e,t,n),this.applyMatrix4(Ln),this}lookAt(e){return va.lookAt(e),va.updateMatrix(),this.applyMatrix4(va.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(xs).negate(),this.translate(xs.x,xs.y,xs.z),this}setFromPoints(e){const t=this.getAttribute("position");if(t===void 0){const n=[];for(let i=0,s=e.length;i<s;i++){const o=e[i];n.push(o.x,o.y,o.z||0)}this.setAttribute("position",new ot(n,3))}else{for(let n=0,i=t.count;n<i;n++){const s=e[n];t.setXYZ(n,s.x,s.y,s.z||0)}e.length>t.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Un);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new P(-1/0,-1/0,-1/0),new P(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,i=t.length;n<i;n++){const s=t[n];wn.setFromBufferAttribute(s),this.morphTargetsRelative?(Kt.addVectors(this.boundingBox.min,wn.min),this.boundingBox.expandByPoint(Kt),Kt.addVectors(this.boundingBox.max,wn.max),this.boundingBox.expandByPoint(Kt)):(this.boundingBox.expandByPoint(wn.min),this.boundingBox.expandByPoint(wn.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new On);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new P,1/0);return}if(e){const n=this.boundingSphere.center;if(wn.setFromBufferAttribute(e),t)for(let s=0,o=t.length;s<o;s++){const a=t[s];tr.setFromBufferAttribute(a),this.morphTargetsRelative?(Kt.addVectors(wn.min,tr.min),wn.expandByPoint(Kt),Kt.addVectors(wn.max,tr.max),wn.expandByPoint(Kt)):(wn.expandByPoint(tr.min),wn.expandByPoint(tr.max))}wn.getCenter(n);let i=0;for(let s=0,o=e.count;s<o;s++)Kt.fromBufferAttribute(e,s),i=Math.max(i,n.distanceToSquared(Kt));if(t)for(let s=0,o=t.length;s<o;s++){const a=t[s],c=this.morphTargetsRelative;for(let l=0,h=a.count;l<h;l++)Kt.fromBufferAttribute(a,l),c&&(xs.fromBufferAttribute(e,l),Kt.add(xs)),i=Math.max(i,n.distanceToSquared(Kt))}this.boundingSphere.radius=Math.sqrt(i),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const n=t.position,i=t.normal,s=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new yt(new Float32Array(4*n.count),4));const o=this.getAttribute("tangent"),a=[],c=[];for(let O=0;O<n.count;O++)a[O]=new P,c[O]=new P;const l=new P,h=new P,d=new P,u=new Ge,m=new Ge,g=new Ge,_=new P,f=new P;function p(O,w,S){l.fromBufferAttribute(n,O),h.fromBufferAttribute(n,w),d.fromBufferAttribute(n,S),u.fromBufferAttribute(s,O),m.fromBufferAttribute(s,w),g.fromBufferAttribute(s,S),h.sub(l),d.sub(l),m.sub(u),g.sub(u);const U=1/(m.x*g.y-g.x*m.y);isFinite(U)&&(_.copy(h).multiplyScalar(g.y).addScaledVector(d,-m.y).multiplyScalar(U),f.copy(d).multiplyScalar(m.x).addScaledVector(h,-g.x).multiplyScalar(U),a[O].add(_),a[w].add(_),a[S].add(_),c[O].add(f),c[w].add(f),c[S].add(f))}let x=this.groups;x.length===0&&(x=[{start:0,count:e.count}]);for(let O=0,w=x.length;O<w;++O){const S=x[O],U=S.start,Z=S.count;for(let K=U,se=U+Z;K<se;K+=3)p(e.getX(K+0),e.getX(K+1),e.getX(K+2))}const y=new P,v=new P,F=new P,A=new P;function L(O){F.fromBufferAttribute(i,O),A.copy(F);const w=a[O];y.copy(w),y.sub(F.multiplyScalar(F.dot(w))).normalize(),v.crossVectors(A,w);const U=v.dot(c[O])<0?-1:1;o.setXYZW(O,y.x,y.y,y.z,U)}for(let O=0,w=x.length;O<w;++O){const S=x[O],U=S.start,Z=S.count;for(let K=U,se=U+Z;K<se;K+=3)L(e.getX(K+0)),L(e.getX(K+1)),L(e.getX(K+2))}}computeVertexNormals(){const e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new yt(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let u=0,m=n.count;u<m;u++)n.setXYZ(u,0,0,0);const i=new P,s=new P,o=new P,a=new P,c=new P,l=new P,h=new P,d=new P;if(e)for(let u=0,m=e.count;u<m;u+=3){const g=e.getX(u+0),_=e.getX(u+1),f=e.getX(u+2);i.fromBufferAttribute(t,g),s.fromBufferAttribute(t,_),o.fromBufferAttribute(t,f),h.subVectors(o,s),d.subVectors(i,s),h.cross(d),a.fromBufferAttribute(n,g),c.fromBufferAttribute(n,_),l.fromBufferAttribute(n,f),a.add(h),c.add(h),l.add(h),n.setXYZ(g,a.x,a.y,a.z),n.setXYZ(_,c.x,c.y,c.z),n.setXYZ(f,l.x,l.y,l.z)}else for(let u=0,m=t.count;u<m;u+=3)i.fromBufferAttribute(t,u+0),s.fromBufferAttribute(t,u+1),o.fromBufferAttribute(t,u+2),h.subVectors(o,s),d.subVectors(i,s),h.cross(d),n.setXYZ(u+0,h.x,h.y,h.z),n.setXYZ(u+1,h.x,h.y,h.z),n.setXYZ(u+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){const e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)Kt.fromBufferAttribute(e,t),Kt.normalize(),e.setXYZ(t,Kt.x,Kt.y,Kt.z)}toNonIndexed(){function e(a,c){const l=a.array,h=a.itemSize,d=a.normalized,u=new l.constructor(c.length*h);let m=0,g=0;for(let _=0,f=c.length;_<f;_++){a.isInterleavedBufferAttribute?m=c[_]*a.data.stride+a.offset:m=c[_]*h;for(let p=0;p<h;p++)u[g++]=l[m++]}return new yt(u,h,d)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const t=new at,n=this.index.array,i=this.attributes;for(const a in i){const c=i[a],l=e(c,n);t.setAttribute(a,l)}const s=this.morphAttributes;for(const a in s){const c=[],l=s[a];for(let h=0,d=l.length;h<d;h++){const u=l[h],m=e(u,n);c.push(m)}t.morphAttributes[a]=c}t.morphTargetsRelative=this.morphTargetsRelative;const o=this.groups;for(let a=0,c=o.length;a<c;a++){const l=o[a];t.addGroup(l.start,l.count,l.materialIndex)}return t}toJSON(){const e={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){const c=this.parameters;for(const l in c)c[l]!==void 0&&(e[l]=c[l]);return e}e.data={attributes:{}};const t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});const n=this.attributes;for(const c in n){const l=n[c];e.data.attributes[c]=l.toJSON(e.data)}const i={};let s=!1;for(const c in this.morphAttributes){const l=this.morphAttributes[c],h=[];for(let d=0,u=l.length;d<u;d++){const m=l[d];h.push(m.toJSON(e.data))}h.length>0&&(i[c]=h,s=!0)}s&&(e.data.morphAttributes=i,e.data.morphTargetsRelative=this.morphTargetsRelative);const o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));const a=this.boundingSphere;return a!==null&&(e.data.boundingSphere={center:a.center.toArray(),radius:a.radius}),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const t={};this.name=e.name;const n=e.index;n!==null&&this.setIndex(n.clone(t));const i=e.attributes;for(const l in i){const h=i[l];this.setAttribute(l,h.clone(t))}const s=e.morphAttributes;for(const l in s){const h=[],d=s[l];for(let u=0,m=d.length;u<m;u++)h.push(d[u].clone(t));this.morphAttributes[l]=h}this.morphTargetsRelative=e.morphTargetsRelative;const o=e.groups;for(let l=0,h=o.length;l<h;l++){const d=o[l];this.addGroup(d.start,d.count,d.materialIndex)}const a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());const c=e.boundingSphere;return c!==null&&(this.boundingSphere=c.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const Gl=new Ze,Vi=new Lr,Jr=new On,Hl=new P,Qr=new P,eo=new P,to=new P,ya=new P,no=new P,Vl=new P,io=new P;class rt extends Ut{constructor(e=new at,t=new rn){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=i.length;s<o;s++){const a=i[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}getVertexPosition(e,t){const n=this.geometry,i=n.attributes.position,s=n.morphAttributes.position,o=n.morphTargetsRelative;t.fromBufferAttribute(i,e);const a=this.morphTargetInfluences;if(s&&a){no.set(0,0,0);for(let c=0,l=s.length;c<l;c++){const h=a[c],d=s[c];h!==0&&(ya.fromBufferAttribute(d,e),o?no.addScaledVector(ya,h):no.addScaledVector(ya.sub(t),h))}t.add(no)}return t}raycast(e,t){const n=this.geometry,i=this.material,s=this.matrixWorld;i!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),Jr.copy(n.boundingSphere),Jr.applyMatrix4(s),Vi.copy(e.ray).recast(e.near),!(Jr.containsPoint(Vi.origin)===!1&&(Vi.intersectSphere(Jr,Hl)===null||Vi.origin.distanceToSquared(Hl)>(e.far-e.near)**2))&&(Gl.copy(s).invert(),Vi.copy(e.ray).applyMatrix4(Gl),!(n.boundingBox!==null&&Vi.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,Vi)))}_computeIntersections(e,t,n){let i;const s=this.geometry,o=this.material,a=s.index,c=s.attributes.position,l=s.attributes.uv,h=s.attributes.uv1,d=s.attributes.normal,u=s.groups,m=s.drawRange;if(a!==null)if(Array.isArray(o))for(let g=0,_=u.length;g<_;g++){const f=u[g],p=o[f.materialIndex],x=Math.max(f.start,m.start),y=Math.min(a.count,Math.min(f.start+f.count,m.start+m.count));for(let v=x,F=y;v<F;v+=3){const A=a.getX(v),L=a.getX(v+1),O=a.getX(v+2);i=so(this,p,e,n,l,h,d,A,L,O),i&&(i.faceIndex=Math.floor(v/3),i.face.materialIndex=f.materialIndex,t.push(i))}}else{const g=Math.max(0,m.start),_=Math.min(a.count,m.start+m.count);for(let f=g,p=_;f<p;f+=3){const x=a.getX(f),y=a.getX(f+1),v=a.getX(f+2);i=so(this,o,e,n,l,h,d,x,y,v),i&&(i.faceIndex=Math.floor(f/3),t.push(i))}}else if(c!==void 0)if(Array.isArray(o))for(let g=0,_=u.length;g<_;g++){const f=u[g],p=o[f.materialIndex],x=Math.max(f.start,m.start),y=Math.min(c.count,Math.min(f.start+f.count,m.start+m.count));for(let v=x,F=y;v<F;v+=3){const A=v,L=v+1,O=v+2;i=so(this,p,e,n,l,h,d,A,L,O),i&&(i.faceIndex=Math.floor(v/3),i.face.materialIndex=f.materialIndex,t.push(i))}}else{const g=Math.max(0,m.start),_=Math.min(c.count,m.start+m.count);for(let f=g,p=_;f<p;f+=3){const x=f,y=f+1,v=f+2;i=so(this,o,e,n,l,h,d,x,y,v),i&&(i.faceIndex=Math.floor(f/3),t.push(i))}}}}function Nf(r,e,t,n,i,s,o,a){let c;if(e.side===Jt?c=n.intersectTriangle(o,s,i,!0,a):c=n.intersectTriangle(i,s,o,e.side===ln,a),c===null)return null;io.copy(a),io.applyMatrix4(r.matrixWorld);const l=t.ray.origin.distanceTo(io);return l<t.near||l>t.far?null:{distance:l,point:io.clone(),object:r}}function so(r,e,t,n,i,s,o,a,c,l){r.getVertexPosition(a,Qr),r.getVertexPosition(c,eo),r.getVertexPosition(l,to);const h=Nf(r,e,t,n,Qr,eo,to,Vl);if(h){const d=new P;Tn.getBarycoord(Vl,Qr,eo,to,d),i&&(h.uv=Tn.getInterpolatedAttribute(i,a,c,l,d,new Ge)),s&&(h.uv1=Tn.getInterpolatedAttribute(s,a,c,l,d,new Ge)),o&&(h.normal=Tn.getInterpolatedAttribute(o,a,c,l,d,new P),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));const u={a,b:c,c:l,normal:new P,materialIndex:0};Tn.getNormal(Qr,eo,to,u.normal),h.face=u,h.barycoord=d}return h}class Ir extends at{constructor(e=1,t=1,n=1,i=1,s=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:i,heightSegments:s,depthSegments:o};const a=this;i=Math.floor(i),s=Math.floor(s),o=Math.floor(o);const c=[],l=[],h=[],d=[];let u=0,m=0;g("z","y","x",-1,-1,n,t,e,o,s,0),g("z","y","x",1,-1,n,t,-e,o,s,1),g("x","z","y",1,1,e,n,t,i,o,2),g("x","z","y",1,-1,e,n,-t,i,o,3),g("x","y","z",1,-1,e,t,n,i,s,4),g("x","y","z",-1,-1,e,t,-n,i,s,5),this.setIndex(c),this.setAttribute("position",new ot(l,3)),this.setAttribute("normal",new ot(h,3)),this.setAttribute("uv",new ot(d,2));function g(_,f,p,x,y,v,F,A,L,O,w){const S=v/L,U=F/O,Z=v/2,K=F/2,se=A/2,fe=L+1,z=O+1;let de=0,$=0;const D=new P;for(let B=0;B<z;B++){const j=B*U-K;for(let X=0;X<fe;X++){const Y=X*S-Z;D[_]=Y*x,D[f]=j*y,D[p]=se,l.push(D.x,D.y,D.z),D[_]=0,D[f]=0,D[p]=A>0?1:-1,h.push(D.x,D.y,D.z),d.push(X/L),d.push(1-B/O),de+=1}}for(let B=0;B<O;B++)for(let j=0;j<L;j++){const X=u+j+fe*B,Y=u+j+fe*(B+1),k=u+(j+1)+fe*(B+1),G=u+(j+1)+fe*B;c.push(X,Y,G),c.push(Y,k,G),$+=6}a.addGroup(m,$,w),m+=$,u+=de}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Ir(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}}function Vs(r){const e={};for(const t in r){e[t]={};for(const n in r[t]){const i=r[t][n];i&&(i.isColor||i.isMatrix3||i.isMatrix4||i.isVector2||i.isVector3||i.isVector4||i.isTexture||i.isQuaternion)?i.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=i.clone():Array.isArray(i)?e[t][n]=i.slice():e[t][n]=i}}return e}function fn(r){const e={};for(let t=0;t<r.length;t++){const n=Vs(r[t]);for(const i in n)e[i]=n[i]}return e}function Ff(r){const e=[];for(let t=0;t<r.length;t++)e.push(r[t].clone());return e}function Dd(r){const e=r.getRenderTarget();return e===null?r.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:gt.workingColorSpace}const el={clone:Vs,merge:fn};var Uf=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Of=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class yi extends Ft{static get type(){return"ShaderMaterial"}constructor(e){super(),this.isShaderMaterial=!0,this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Uf,this.fragmentShader=Of,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Vs(e.uniforms),this.uniformsGroups=Ff(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){const t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(const i in this.uniforms){const o=this.uniforms[i].value;o&&o.isTexture?t.uniforms[i]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?t.uniforms[i]={type:"c",value:o.getHex()}:o&&o.isVector2?t.uniforms[i]={type:"v2",value:o.toArray()}:o&&o.isVector3?t.uniforms[i]={type:"v3",value:o.toArray()}:o&&o.isVector4?t.uniforms[i]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?t.uniforms[i]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?t.uniforms[i]={type:"m4",value:o.toArray()}:t.uniforms[i]={value:o}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;const n={};for(const i in this.extensions)this.extensions[i]===!0&&(n[i]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}}class Nd extends Ut{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Ze,this.projectionMatrix=new Ze,this.projectionMatrixInverse=new Ze,this.coordinateSystem=gi}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}const Ri=new P,Wl=new Ge,Xl=new Ge;class nn extends Nd{constructor(e=50,t=1,n=.1,i=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=i,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){const t=.5*this.getFilmHeight()/e;this.fov=Hs*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){const e=Math.tan(Ps*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Hs*2*Math.atan(Math.tan(Ps*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){Ri.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(Ri.x,Ri.y).multiplyScalar(-e/Ri.z),Ri.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Ri.x,Ri.y).multiplyScalar(-e/Ri.z)}getViewSize(e,t){return this.getViewBounds(e,Wl,Xl),t.subVectors(Xl,Wl)}setViewOffset(e,t,n,i,s,o){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=i,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=this.near;let t=e*Math.tan(Ps*.5*this.fov)/this.zoom,n=2*t,i=this.aspect*n,s=-.5*i;const o=this.view;if(this.view!==null&&this.view.enabled){const c=o.fullWidth,l=o.fullHeight;s+=o.offsetX*i/c,t-=o.offsetY*n/l,i*=o.width/c,n*=o.height/l}const a=this.filmOffset;a!==0&&(s+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+i,t,t-n,e,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}}const vs=-90,ys=1;class kf extends Ut{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;const i=new nn(vs,ys,e,t);i.layers=this.layers,this.add(i);const s=new nn(vs,ys,e,t);s.layers=this.layers,this.add(s);const o=new nn(vs,ys,e,t);o.layers=this.layers,this.add(o);const a=new nn(vs,ys,e,t);a.layers=this.layers,this.add(a);const c=new nn(vs,ys,e,t);c.layers=this.layers,this.add(c);const l=new nn(vs,ys,e,t);l.layers=this.layers,this.add(l)}updateCoordinateSystem(){const e=this.coordinateSystem,t=this.children.concat(),[n,i,s,o,a,c]=t;for(const l of t)this.remove(l);if(e===gi)n.up.set(0,1,0),n.lookAt(1,0,0),i.up.set(0,1,0),i.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),c.up.set(0,1,0),c.lookAt(0,0,-1);else if(e===zo)n.up.set(0,-1,0),n.lookAt(-1,0,0),i.up.set(0,-1,0),i.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),c.up.set(0,-1,0),c.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(const l of t)this.add(l),l.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();const{renderTarget:n,activeMipmapLevel:i}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());const[s,o,a,c,l,h]=this.children,d=e.getRenderTarget(),u=e.getActiveCubeFace(),m=e.getActiveMipmapLevel(),g=e.xr.enabled;e.xr.enabled=!1;const _=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,e.setRenderTarget(n,0,i),e.render(t,s),e.setRenderTarget(n,1,i),e.render(t,o),e.setRenderTarget(n,2,i),e.render(t,a),e.setRenderTarget(n,3,i),e.render(t,c),e.setRenderTarget(n,4,i),e.render(t,l),n.texture.generateMipmaps=_,e.setRenderTarget(n,5,i),e.render(t,h),e.setRenderTarget(d,u,m),e.xr.enabled=g,n.texture.needsPMREMUpdate=!0}}class Fd extends jt{constructor(e,t,n,i,s,o,a,c,l,h){e=e!==void 0?e:[],t=t!==void 0?t:ks,super(e,t,n,i,s,o,a,c,l,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}}class Bf extends is{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;const n={width:e,height:e,depth:1},i=[n,n,n,n,n,n];this.texture=new Fd(i,t.mapping,t.wrapS,t.wrapT,t.magFilter,t.minFilter,t.format,t.type,t.anisotropy,t.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=t.generateMipmaps!==void 0?t.generateMipmaps:!1,this.texture.minFilter=t.minFilter!==void 0?t.minFilter:cn}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;const n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},i=new Ir(5,5,5),s=new yi({name:"CubemapFromEquirect",uniforms:Vs(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Jt,blending:Ui});s.uniforms.tEquirect.value=t;const o=new rt(i,s),a=t.minFilter;return t.minFilter===Yn&&(t.minFilter=cn),new kf(1,10,this).update(e,o),t.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,t,n,i){const s=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(t,n,i);e.setRenderTarget(s)}}const ba=new P,zf=new P,Gf=new ft;class jn{constructor(e=new P(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,i){return this.normal.set(e,t,n),this.constant=i,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){const i=ba.subVectors(n,t).cross(zf.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(i,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){const e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){const n=e.delta(ba),i=this.normal.dot(n);if(i===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;const s=-(e.start.dot(this.normal)+this.constant)/i;return s<0||s>1?null:t.copy(e.start).addScaledVector(n,s)}intersectsLine(e){const t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){const n=t||Gf.getNormalMatrix(e),i=this.coplanarPoint(ba).applyMatrix4(e),s=this.normal.applyMatrix3(n).normalize();return this.constant=-i.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}}const Wi=new On,ro=new P;class tl{constructor(e=new jn,t=new jn,n=new jn,i=new jn,s=new jn,o=new jn){this.planes=[e,t,n,i,s,o]}set(e,t,n,i,s,o){const a=this.planes;return a[0].copy(e),a[1].copy(t),a[2].copy(n),a[3].copy(i),a[4].copy(s),a[5].copy(o),this}copy(e){const t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=gi){const n=this.planes,i=e.elements,s=i[0],o=i[1],a=i[2],c=i[3],l=i[4],h=i[5],d=i[6],u=i[7],m=i[8],g=i[9],_=i[10],f=i[11],p=i[12],x=i[13],y=i[14],v=i[15];if(n[0].setComponents(c-s,u-l,f-m,v-p).normalize(),n[1].setComponents(c+s,u+l,f+m,v+p).normalize(),n[2].setComponents(c+o,u+h,f+g,v+x).normalize(),n[3].setComponents(c-o,u-h,f-g,v-x).normalize(),n[4].setComponents(c-a,u-d,f-_,v-y).normalize(),t===gi)n[5].setComponents(c+a,u+d,f+_,v+y).normalize();else if(t===zo)n[5].setComponents(a,d,_,y).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Wi.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{const t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),Wi.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Wi)}intersectsSprite(e){return Wi.center.set(0,0,0),Wi.radius=.7071067811865476,Wi.applyMatrix4(e.matrixWorld),this.intersectsSphere(Wi)}intersectsSphere(e){const t=this.planes,n=e.center,i=-e.radius;for(let s=0;s<6;s++)if(t[s].distanceToPoint(n)<i)return!1;return!0}intersectsBox(e){const t=this.planes;for(let n=0;n<6;n++){const i=t[n];if(ro.x=i.normal.x>0?e.max.x:e.min.x,ro.y=i.normal.y>0?e.max.y:e.min.y,ro.z=i.normal.z>0?e.max.z:e.min.z,i.distanceToPoint(ro)<0)return!1}return!0}containsPoint(e){const t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}function Ud(){let r=null,e=!1,t=null,n=null;function i(s,o){t(s,o),n=r.requestAnimationFrame(i)}return{start:function(){e!==!0&&t!==null&&(n=r.requestAnimationFrame(i),e=!0)},stop:function(){r.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(s){t=s},setContext:function(s){r=s}}}function Hf(r){const e=new WeakMap;function t(a,c){const l=a.array,h=a.usage,d=l.byteLength,u=r.createBuffer();r.bindBuffer(c,u),r.bufferData(c,l,h),a.onUploadCallback();let m;if(l instanceof Float32Array)m=r.FLOAT;else if(l instanceof Uint16Array)a.isFloat16BufferAttribute?m=r.HALF_FLOAT:m=r.UNSIGNED_SHORT;else if(l instanceof Int16Array)m=r.SHORT;else if(l instanceof Uint32Array)m=r.UNSIGNED_INT;else if(l instanceof Int32Array)m=r.INT;else if(l instanceof Int8Array)m=r.BYTE;else if(l instanceof Uint8Array)m=r.UNSIGNED_BYTE;else if(l instanceof Uint8ClampedArray)m=r.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+l);return{buffer:u,type:m,bytesPerElement:l.BYTES_PER_ELEMENT,version:a.version,size:d}}function n(a,c,l){const h=c.array,d=c.updateRanges;if(r.bindBuffer(l,a),d.length===0)r.bufferSubData(l,0,h);else{d.sort((m,g)=>m.start-g.start);let u=0;for(let m=1;m<d.length;m++){const g=d[u],_=d[m];_.start<=g.start+g.count+1?g.count=Math.max(g.count,_.start+_.count-g.start):(++u,d[u]=_)}d.length=u+1;for(let m=0,g=d.length;m<g;m++){const _=d[m];r.bufferSubData(l,_.start*h.BYTES_PER_ELEMENT,h,_.start,_.count)}c.clearUpdateRanges()}c.onUploadCallback()}function i(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function s(a){a.isInterleavedBufferAttribute&&(a=a.data);const c=e.get(a);c&&(r.deleteBuffer(c.buffer),e.delete(a))}function o(a,c){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){const h=e.get(a);(!h||h.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}const l=e.get(a);if(l===void 0)e.set(a,t(a,c));else if(l.version<a.version){if(l.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(l.buffer,a,c),l.version=a.version}}return{get:i,remove:s,update:o}}class Pr extends at{constructor(e=1,t=1,n=1,i=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:i};const s=e/2,o=t/2,a=Math.floor(n),c=Math.floor(i),l=a+1,h=c+1,d=e/a,u=t/c,m=[],g=[],_=[],f=[];for(let p=0;p<h;p++){const x=p*u-o;for(let y=0;y<l;y++){const v=y*d-s;g.push(v,-x,0),_.push(0,0,1),f.push(y/a),f.push(1-p/c)}}for(let p=0;p<c;p++)for(let x=0;x<a;x++){const y=x+l*p,v=x+l*(p+1),F=x+1+l*(p+1),A=x+1+l*p;m.push(y,v,A),m.push(v,F,A)}this.setIndex(m),this.setAttribute("position",new ot(g,3)),this.setAttribute("normal",new ot(_,3)),this.setAttribute("uv",new ot(f,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Pr(e.width,e.height,e.widthSegments,e.heightSegments)}}var Vf=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Wf=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,Xf=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,jf=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,qf=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,Yf=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,$f=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,Kf=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Zf=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,Jf=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Qf=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,ep=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,tp=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,np=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,ip=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,sp=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,rp=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,op=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,ap=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,cp=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,lp=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,hp=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,dp=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,up=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,fp=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,pp=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,mp=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,gp=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,_p=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,xp=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,vp="gl_FragColor = linearToOutputTexel( gl_FragColor );",yp=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,bp=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,Mp=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,Sp=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,wp=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,Ep=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,Tp=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,Ap=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Cp=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Rp=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Lp=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,Ip=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Pp=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Dp=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,Np=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,Fp=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,Up=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Op=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,kp=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Bp=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,zp=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,Gp=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,Hp=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,Vp=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,Wp=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Xp=`#if defined( USE_LOGDEPTHBUF )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,jp=`#if defined( USE_LOGDEPTHBUF )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,qp=`#ifdef USE_LOGDEPTHBUF
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Yp=`#ifdef USE_LOGDEPTHBUF
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,$p=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Kp=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Zp=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,Jp=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Qp=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,em=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,tm=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,nm=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,im=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,sm=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,rm=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,om=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,am=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,cm=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,lm=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,hm=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,dm=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,um=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,fm=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,pm=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,mm=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,gm=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,_m=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,xm=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,vm=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,ym=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,bm=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,Mm=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Sm=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,wm=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		float hard_shadow = step( compare , distribution.x );
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,Em=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,Tm=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,Am=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,Cm=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,Rm=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,Lm=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Im=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,Pm=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Dm=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,Nm=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Fm=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,Um=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,Om=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
		
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
		
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		
		#else
		
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,km=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Bm=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,zm=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,Gm=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const Hm=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Vm=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Wm=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Xm=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,jm=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,qm=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Ym=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,$m=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,Km=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,Zm=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,Jm=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Qm=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,eg=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,tg=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,ng=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,ig=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,sg=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,rg=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,og=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,ag=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,cg=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,lg=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,hg=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,dg=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,ug=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,fg=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,pg=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,mg=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,gg=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,_g=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,xg=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,vg=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,yg=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,bg=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,mt={alphahash_fragment:Vf,alphahash_pars_fragment:Wf,alphamap_fragment:Xf,alphamap_pars_fragment:jf,alphatest_fragment:qf,alphatest_pars_fragment:Yf,aomap_fragment:$f,aomap_pars_fragment:Kf,batching_pars_vertex:Zf,batching_vertex:Jf,begin_vertex:Qf,beginnormal_vertex:ep,bsdfs:tp,iridescence_fragment:np,bumpmap_pars_fragment:ip,clipping_planes_fragment:sp,clipping_planes_pars_fragment:rp,clipping_planes_pars_vertex:op,clipping_planes_vertex:ap,color_fragment:cp,color_pars_fragment:lp,color_pars_vertex:hp,color_vertex:dp,common:up,cube_uv_reflection_fragment:fp,defaultnormal_vertex:pp,displacementmap_pars_vertex:mp,displacementmap_vertex:gp,emissivemap_fragment:_p,emissivemap_pars_fragment:xp,colorspace_fragment:vp,colorspace_pars_fragment:yp,envmap_fragment:bp,envmap_common_pars_fragment:Mp,envmap_pars_fragment:Sp,envmap_pars_vertex:wp,envmap_physical_pars_fragment:Fp,envmap_vertex:Ep,fog_vertex:Tp,fog_pars_vertex:Ap,fog_fragment:Cp,fog_pars_fragment:Rp,gradientmap_pars_fragment:Lp,lightmap_pars_fragment:Ip,lights_lambert_fragment:Pp,lights_lambert_pars_fragment:Dp,lights_pars_begin:Np,lights_toon_fragment:Up,lights_toon_pars_fragment:Op,lights_phong_fragment:kp,lights_phong_pars_fragment:Bp,lights_physical_fragment:zp,lights_physical_pars_fragment:Gp,lights_fragment_begin:Hp,lights_fragment_maps:Vp,lights_fragment_end:Wp,logdepthbuf_fragment:Xp,logdepthbuf_pars_fragment:jp,logdepthbuf_pars_vertex:qp,logdepthbuf_vertex:Yp,map_fragment:$p,map_pars_fragment:Kp,map_particle_fragment:Zp,map_particle_pars_fragment:Jp,metalnessmap_fragment:Qp,metalnessmap_pars_fragment:em,morphinstance_vertex:tm,morphcolor_vertex:nm,morphnormal_vertex:im,morphtarget_pars_vertex:sm,morphtarget_vertex:rm,normal_fragment_begin:om,normal_fragment_maps:am,normal_pars_fragment:cm,normal_pars_vertex:lm,normal_vertex:hm,normalmap_pars_fragment:dm,clearcoat_normal_fragment_begin:um,clearcoat_normal_fragment_maps:fm,clearcoat_pars_fragment:pm,iridescence_pars_fragment:mm,opaque_fragment:gm,packing:_m,premultiplied_alpha_fragment:xm,project_vertex:vm,dithering_fragment:ym,dithering_pars_fragment:bm,roughnessmap_fragment:Mm,roughnessmap_pars_fragment:Sm,shadowmap_pars_fragment:wm,shadowmap_pars_vertex:Em,shadowmap_vertex:Tm,shadowmask_pars_fragment:Am,skinbase_vertex:Cm,skinning_pars_vertex:Rm,skinning_vertex:Lm,skinnormal_vertex:Im,specularmap_fragment:Pm,specularmap_pars_fragment:Dm,tonemapping_fragment:Nm,tonemapping_pars_fragment:Fm,transmission_fragment:Um,transmission_pars_fragment:Om,uv_pars_fragment:km,uv_pars_vertex:Bm,uv_vertex:zm,worldpos_vertex:Gm,background_vert:Hm,background_frag:Vm,backgroundCube_vert:Wm,backgroundCube_frag:Xm,cube_vert:jm,cube_frag:qm,depth_vert:Ym,depth_frag:$m,distanceRGBA_vert:Km,distanceRGBA_frag:Zm,equirect_vert:Jm,equirect_frag:Qm,linedashed_vert:eg,linedashed_frag:tg,meshbasic_vert:ng,meshbasic_frag:ig,meshlambert_vert:sg,meshlambert_frag:rg,meshmatcap_vert:og,meshmatcap_frag:ag,meshnormal_vert:cg,meshnormal_frag:lg,meshphong_vert:hg,meshphong_frag:dg,meshphysical_vert:ug,meshphysical_frag:fg,meshtoon_vert:pg,meshtoon_frag:mg,points_vert:gg,points_frag:_g,shadow_vert:xg,shadow_frag:vg,sprite_vert:yg,sprite_frag:bg},we={common:{diffuse:{value:new qe(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new ft},alphaMap:{value:null},alphaMapTransform:{value:new ft},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new ft}},envmap:{envMap:{value:null},envMapRotation:{value:new ft},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new ft}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new ft}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new ft},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new ft},normalScale:{value:new Ge(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new ft},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new ft}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new ft}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new ft}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new qe(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new qe(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new ft},alphaTest:{value:0},uvTransform:{value:new ft}},sprite:{diffuse:{value:new qe(16777215)},opacity:{value:1},center:{value:new Ge(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new ft},alphaMap:{value:null},alphaMapTransform:{value:new ft},alphaTest:{value:0}}},bn={basic:{uniforms:fn([we.common,we.specularmap,we.envmap,we.aomap,we.lightmap,we.fog]),vertexShader:mt.meshbasic_vert,fragmentShader:mt.meshbasic_frag},lambert:{uniforms:fn([we.common,we.specularmap,we.envmap,we.aomap,we.lightmap,we.emissivemap,we.bumpmap,we.normalmap,we.displacementmap,we.fog,we.lights,{emissive:{value:new qe(0)}}]),vertexShader:mt.meshlambert_vert,fragmentShader:mt.meshlambert_frag},phong:{uniforms:fn([we.common,we.specularmap,we.envmap,we.aomap,we.lightmap,we.emissivemap,we.bumpmap,we.normalmap,we.displacementmap,we.fog,we.lights,{emissive:{value:new qe(0)},specular:{value:new qe(1118481)},shininess:{value:30}}]),vertexShader:mt.meshphong_vert,fragmentShader:mt.meshphong_frag},standard:{uniforms:fn([we.common,we.envmap,we.aomap,we.lightmap,we.emissivemap,we.bumpmap,we.normalmap,we.displacementmap,we.roughnessmap,we.metalnessmap,we.fog,we.lights,{emissive:{value:new qe(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:mt.meshphysical_vert,fragmentShader:mt.meshphysical_frag},toon:{uniforms:fn([we.common,we.aomap,we.lightmap,we.emissivemap,we.bumpmap,we.normalmap,we.displacementmap,we.gradientmap,we.fog,we.lights,{emissive:{value:new qe(0)}}]),vertexShader:mt.meshtoon_vert,fragmentShader:mt.meshtoon_frag},matcap:{uniforms:fn([we.common,we.bumpmap,we.normalmap,we.displacementmap,we.fog,{matcap:{value:null}}]),vertexShader:mt.meshmatcap_vert,fragmentShader:mt.meshmatcap_frag},points:{uniforms:fn([we.points,we.fog]),vertexShader:mt.points_vert,fragmentShader:mt.points_frag},dashed:{uniforms:fn([we.common,we.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:mt.linedashed_vert,fragmentShader:mt.linedashed_frag},depth:{uniforms:fn([we.common,we.displacementmap]),vertexShader:mt.depth_vert,fragmentShader:mt.depth_frag},normal:{uniforms:fn([we.common,we.bumpmap,we.normalmap,we.displacementmap,{opacity:{value:1}}]),vertexShader:mt.meshnormal_vert,fragmentShader:mt.meshnormal_frag},sprite:{uniforms:fn([we.sprite,we.fog]),vertexShader:mt.sprite_vert,fragmentShader:mt.sprite_frag},background:{uniforms:{uvTransform:{value:new ft},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:mt.background_vert,fragmentShader:mt.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new ft}},vertexShader:mt.backgroundCube_vert,fragmentShader:mt.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:mt.cube_vert,fragmentShader:mt.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:mt.equirect_vert,fragmentShader:mt.equirect_frag},distanceRGBA:{uniforms:fn([we.common,we.displacementmap,{referencePosition:{value:new P},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:mt.distanceRGBA_vert,fragmentShader:mt.distanceRGBA_frag},shadow:{uniforms:fn([we.lights,we.fog,{color:{value:new qe(0)},opacity:{value:1}}]),vertexShader:mt.shadow_vert,fragmentShader:mt.shadow_frag}};bn.physical={uniforms:fn([bn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new ft},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new ft},clearcoatNormalScale:{value:new Ge(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new ft},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new ft},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new ft},sheen:{value:0},sheenColor:{value:new qe(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new ft},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new ft},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new ft},transmissionSamplerSize:{value:new Ge},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new ft},attenuationDistance:{value:0},attenuationColor:{value:new qe(0)},specularColor:{value:new qe(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new ft},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new ft},anisotropyVector:{value:new Ge},anisotropyMap:{value:null},anisotropyMapTransform:{value:new ft}}]),vertexShader:mt.meshphysical_vert,fragmentShader:mt.meshphysical_frag};const oo={r:0,b:0,g:0},Xi=new Fn,Mg=new Ze;function Sg(r,e,t,n,i,s,o){const a=new qe(0);let c=s===!0?0:1,l,h,d=null,u=0,m=null;function g(x){let y=x.isScene===!0?x.background:null;return y&&y.isTexture&&(y=(x.backgroundBlurriness>0?t:e).get(y)),y}function _(x){let y=!1;const v=g(x);v===null?p(a,c):v&&v.isColor&&(p(v,1),y=!0);const F=r.xr.getEnvironmentBlendMode();F==="additive"?n.buffers.color.setClear(0,0,0,1,o):F==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,o),(r.autoClear||y)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),r.clear(r.autoClearColor,r.autoClearDepth,r.autoClearStencil))}function f(x,y){const v=g(y);v&&(v.isCubeTexture||v.mapping===jo)?(h===void 0&&(h=new rt(new Ir(1,1,1),new yi({name:"BackgroundCubeMaterial",uniforms:Vs(bn.backgroundCube.uniforms),vertexShader:bn.backgroundCube.vertexShader,fragmentShader:bn.backgroundCube.fragmentShader,side:Jt,depthTest:!1,depthWrite:!1,fog:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(F,A,L){this.matrixWorld.copyPosition(L.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(h)),Xi.copy(y.backgroundRotation),Xi.x*=-1,Xi.y*=-1,Xi.z*=-1,v.isCubeTexture&&v.isRenderTargetTexture===!1&&(Xi.y*=-1,Xi.z*=-1),h.material.uniforms.envMap.value=v,h.material.uniforms.flipEnvMap.value=v.isCubeTexture&&v.isRenderTargetTexture===!1?-1:1,h.material.uniforms.backgroundBlurriness.value=y.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=y.backgroundIntensity,h.material.uniforms.backgroundRotation.value.setFromMatrix4(Mg.makeRotationFromEuler(Xi)),h.material.toneMapped=gt.getTransfer(v.colorSpace)!==Nt,(d!==v||u!==v.version||m!==r.toneMapping)&&(h.material.needsUpdate=!0,d=v,u=v.version,m=r.toneMapping),h.layers.enableAll(),x.unshift(h,h.geometry,h.material,0,0,null)):v&&v.isTexture&&(l===void 0&&(l=new rt(new Pr(2,2),new yi({name:"BackgroundMaterial",uniforms:Vs(bn.background.uniforms),vertexShader:bn.background.vertexShader,fragmentShader:bn.background.fragmentShader,side:ln,depthTest:!1,depthWrite:!1,fog:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=v,l.material.uniforms.backgroundIntensity.value=y.backgroundIntensity,l.material.toneMapped=gt.getTransfer(v.colorSpace)!==Nt,v.matrixAutoUpdate===!0&&v.updateMatrix(),l.material.uniforms.uvTransform.value.copy(v.matrix),(d!==v||u!==v.version||m!==r.toneMapping)&&(l.material.needsUpdate=!0,d=v,u=v.version,m=r.toneMapping),l.layers.enableAll(),x.unshift(l,l.geometry,l.material,0,0,null))}function p(x,y){x.getRGB(oo,Dd(r)),n.buffers.color.setClear(oo.r,oo.g,oo.b,y,o)}return{getClearColor:function(){return a},setClearColor:function(x,y=1){a.set(x),c=y,p(a,c)},getClearAlpha:function(){return c},setClearAlpha:function(x){c=x,p(a,c)},render:_,addToRenderList:f}}function wg(r,e){const t=r.getParameter(r.MAX_VERTEX_ATTRIBS),n={},i=u(null);let s=i,o=!1;function a(S,U,Z,K,se){let fe=!1;const z=d(K,Z,U);s!==z&&(s=z,l(s.object)),fe=m(S,K,Z,se),fe&&g(S,K,Z,se),se!==null&&e.update(se,r.ELEMENT_ARRAY_BUFFER),(fe||o)&&(o=!1,v(S,U,Z,K),se!==null&&r.bindBuffer(r.ELEMENT_ARRAY_BUFFER,e.get(se).buffer))}function c(){return r.createVertexArray()}function l(S){return r.bindVertexArray(S)}function h(S){return r.deleteVertexArray(S)}function d(S,U,Z){const K=Z.wireframe===!0;let se=n[S.id];se===void 0&&(se={},n[S.id]=se);let fe=se[U.id];fe===void 0&&(fe={},se[U.id]=fe);let z=fe[K];return z===void 0&&(z=u(c()),fe[K]=z),z}function u(S){const U=[],Z=[],K=[];for(let se=0;se<t;se++)U[se]=0,Z[se]=0,K[se]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:U,enabledAttributes:Z,attributeDivisors:K,object:S,attributes:{},index:null}}function m(S,U,Z,K){const se=s.attributes,fe=U.attributes;let z=0;const de=Z.getAttributes();for(const $ in de)if(de[$].location>=0){const B=se[$];let j=fe[$];if(j===void 0&&($==="instanceMatrix"&&S.instanceMatrix&&(j=S.instanceMatrix),$==="instanceColor"&&S.instanceColor&&(j=S.instanceColor)),B===void 0||B.attribute!==j||j&&B.data!==j.data)return!0;z++}return s.attributesNum!==z||s.index!==K}function g(S,U,Z,K){const se={},fe=U.attributes;let z=0;const de=Z.getAttributes();for(const $ in de)if(de[$].location>=0){let B=fe[$];B===void 0&&($==="instanceMatrix"&&S.instanceMatrix&&(B=S.instanceMatrix),$==="instanceColor"&&S.instanceColor&&(B=S.instanceColor));const j={};j.attribute=B,B&&B.data&&(j.data=B.data),se[$]=j,z++}s.attributes=se,s.attributesNum=z,s.index=K}function _(){const S=s.newAttributes;for(let U=0,Z=S.length;U<Z;U++)S[U]=0}function f(S){p(S,0)}function p(S,U){const Z=s.newAttributes,K=s.enabledAttributes,se=s.attributeDivisors;Z[S]=1,K[S]===0&&(r.enableVertexAttribArray(S),K[S]=1),se[S]!==U&&(r.vertexAttribDivisor(S,U),se[S]=U)}function x(){const S=s.newAttributes,U=s.enabledAttributes;for(let Z=0,K=U.length;Z<K;Z++)U[Z]!==S[Z]&&(r.disableVertexAttribArray(Z),U[Z]=0)}function y(S,U,Z,K,se,fe,z){z===!0?r.vertexAttribIPointer(S,U,Z,se,fe):r.vertexAttribPointer(S,U,Z,K,se,fe)}function v(S,U,Z,K){_();const se=K.attributes,fe=Z.getAttributes(),z=U.defaultAttributeValues;for(const de in fe){const $=fe[de];if($.location>=0){let D=se[de];if(D===void 0&&(de==="instanceMatrix"&&S.instanceMatrix&&(D=S.instanceMatrix),de==="instanceColor"&&S.instanceColor&&(D=S.instanceColor)),D!==void 0){const B=D.normalized,j=D.itemSize,X=e.get(D);if(X===void 0)continue;const Y=X.buffer,k=X.type,G=X.bytesPerElement,Q=k===r.INT||k===r.UNSIGNED_INT||D.gpuType===Xc;if(D.isInterleavedBufferAttribute){const ee=D.data,oe=ee.stride,ce=D.offset;if(ee.isInstancedInterleavedBuffer){for(let Me=0;Me<$.locationSize;Me++)p($.location+Me,ee.meshPerAttribute);S.isInstancedMesh!==!0&&K._maxInstanceCount===void 0&&(K._maxInstanceCount=ee.meshPerAttribute*ee.count)}else for(let Me=0;Me<$.locationSize;Me++)f($.location+Me);r.bindBuffer(r.ARRAY_BUFFER,Y);for(let Me=0;Me<$.locationSize;Me++)y($.location+Me,j/$.locationSize,k,B,oe*G,(ce+j/$.locationSize*Me)*G,Q)}else{if(D.isInstancedBufferAttribute){for(let ee=0;ee<$.locationSize;ee++)p($.location+ee,D.meshPerAttribute);S.isInstancedMesh!==!0&&K._maxInstanceCount===void 0&&(K._maxInstanceCount=D.meshPerAttribute*D.count)}else for(let ee=0;ee<$.locationSize;ee++)f($.location+ee);r.bindBuffer(r.ARRAY_BUFFER,Y);for(let ee=0;ee<$.locationSize;ee++)y($.location+ee,j/$.locationSize,k,B,j*G,j/$.locationSize*ee*G,Q)}}else if(z!==void 0){const B=z[de];if(B!==void 0)switch(B.length){case 2:r.vertexAttrib2fv($.location,B);break;case 3:r.vertexAttrib3fv($.location,B);break;case 4:r.vertexAttrib4fv($.location,B);break;default:r.vertexAttrib1fv($.location,B)}}}}x()}function F(){O();for(const S in n){const U=n[S];for(const Z in U){const K=U[Z];for(const se in K)h(K[se].object),delete K[se];delete U[Z]}delete n[S]}}function A(S){if(n[S.id]===void 0)return;const U=n[S.id];for(const Z in U){const K=U[Z];for(const se in K)h(K[se].object),delete K[se];delete U[Z]}delete n[S.id]}function L(S){for(const U in n){const Z=n[U];if(Z[S.id]===void 0)continue;const K=Z[S.id];for(const se in K)h(K[se].object),delete K[se];delete Z[S.id]}}function O(){w(),o=!0,s!==i&&(s=i,l(s.object))}function w(){i.geometry=null,i.program=null,i.wireframe=!1}return{setup:a,reset:O,resetDefaultState:w,dispose:F,releaseStatesOfGeometry:A,releaseStatesOfProgram:L,initAttributes:_,enableAttribute:f,disableUnusedAttributes:x}}function Eg(r,e,t){let n;function i(l){n=l}function s(l,h){r.drawArrays(n,l,h),t.update(h,n,1)}function o(l,h,d){d!==0&&(r.drawArraysInstanced(n,l,h,d),t.update(h,n,d))}function a(l,h,d){if(d===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,l,0,h,0,d);let m=0;for(let g=0;g<d;g++)m+=h[g];t.update(m,n,1)}function c(l,h,d,u){if(d===0)return;const m=e.get("WEBGL_multi_draw");if(m===null)for(let g=0;g<l.length;g++)o(l[g],h[g],u[g]);else{m.multiDrawArraysInstancedWEBGL(n,l,0,h,0,u,0,d);let g=0;for(let _=0;_<d;_++)g+=h[_]*u[_];t.update(g,n,1)}}this.setMode=i,this.render=s,this.renderInstances=o,this.renderMultiDraw=a,this.renderMultiDrawInstances=c}function Tg(r,e,t,n){let i;function s(){if(i!==void 0)return i;if(e.has("EXT_texture_filter_anisotropic")===!0){const L=e.get("EXT_texture_filter_anisotropic");i=r.getParameter(L.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else i=0;return i}function o(L){return!(L!==Nn&&n.convert(L)!==r.getParameter(r.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(L){const O=L===Rr&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(L!==vi&&n.convert(L)!==r.getParameter(r.IMPLEMENTATION_COLOR_READ_TYPE)&&L!==$n&&!O)}function c(L){if(L==="highp"){if(r.getShaderPrecisionFormat(r.VERTEX_SHADER,r.HIGH_FLOAT).precision>0&&r.getShaderPrecisionFormat(r.FRAGMENT_SHADER,r.HIGH_FLOAT).precision>0)return"highp";L="mediump"}return L==="mediump"&&r.getShaderPrecisionFormat(r.VERTEX_SHADER,r.MEDIUM_FLOAT).precision>0&&r.getShaderPrecisionFormat(r.FRAGMENT_SHADER,r.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let l=t.precision!==void 0?t.precision:"highp";const h=c(l);h!==l&&(console.warn("THREE.WebGLRenderer:",l,"not supported, using",h,"instead."),l=h);const d=t.logarithmicDepthBuffer===!0,u=t.reverseDepthBuffer===!0&&e.has("EXT_clip_control"),m=r.getParameter(r.MAX_TEXTURE_IMAGE_UNITS),g=r.getParameter(r.MAX_VERTEX_TEXTURE_IMAGE_UNITS),_=r.getParameter(r.MAX_TEXTURE_SIZE),f=r.getParameter(r.MAX_CUBE_MAP_TEXTURE_SIZE),p=r.getParameter(r.MAX_VERTEX_ATTRIBS),x=r.getParameter(r.MAX_VERTEX_UNIFORM_VECTORS),y=r.getParameter(r.MAX_VARYING_VECTORS),v=r.getParameter(r.MAX_FRAGMENT_UNIFORM_VECTORS),F=g>0,A=r.getParameter(r.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:c,textureFormatReadable:o,textureTypeReadable:a,precision:l,logarithmicDepthBuffer:d,reverseDepthBuffer:u,maxTextures:m,maxVertexTextures:g,maxTextureSize:_,maxCubemapSize:f,maxAttributes:p,maxVertexUniforms:x,maxVaryings:y,maxFragmentUniforms:v,vertexTextures:F,maxSamples:A}}function Ag(r){const e=this;let t=null,n=0,i=!1,s=!1;const o=new jn,a=new ft,c={value:null,needsUpdate:!1};this.uniform=c,this.numPlanes=0,this.numIntersection=0,this.init=function(d,u){const m=d.length!==0||u||n!==0||i;return i=u,n=d.length,m},this.beginShadows=function(){s=!0,h(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(d,u){t=h(d,u,0)},this.setState=function(d,u,m){const g=d.clippingPlanes,_=d.clipIntersection,f=d.clipShadows,p=r.get(d);if(!i||g===null||g.length===0||s&&!f)s?h(null):l();else{const x=s?0:n,y=x*4;let v=p.clippingState||null;c.value=v,v=h(g,u,y,m);for(let F=0;F!==y;++F)v[F]=t[F];p.clippingState=v,this.numIntersection=_?this.numPlanes:0,this.numPlanes+=x}};function l(){c.value!==t&&(c.value=t,c.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function h(d,u,m,g){const _=d!==null?d.length:0;let f=null;if(_!==0){if(f=c.value,g!==!0||f===null){const p=m+_*4,x=u.matrixWorldInverse;a.getNormalMatrix(x),(f===null||f.length<p)&&(f=new Float32Array(p));for(let y=0,v=m;y!==_;++y,v+=4)o.copy(d[y]).applyMatrix4(x,a),o.normal.toArray(f,v),f[v+3]=o.constant}c.value=f,c.needsUpdate=!0}return e.numPlanes=_,e.numIntersection=0,f}}function Cg(r){let e=new WeakMap;function t(o,a){return a===sc?o.mapping=ks:a===rc&&(o.mapping=Bs),o}function n(o){if(o&&o.isTexture){const a=o.mapping;if(a===sc||a===rc)if(e.has(o)){const c=e.get(o).texture;return t(c,o.mapping)}else{const c=o.image;if(c&&c.height>0){const l=new Bf(c.height);return l.fromEquirectangularTexture(r,o),e.set(o,l),o.addEventListener("dispose",i),t(l.texture,o.mapping)}else return null}}return o}function i(o){const a=o.target;a.removeEventListener("dispose",i);const c=e.get(a);c!==void 0&&(e.delete(a),c.dispose())}function s(){e=new WeakMap}return{get:n,dispose:s}}class Dr extends Nd{constructor(e=-1,t=1,n=1,i=-1,s=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=i,this.near=s,this.far=o,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,i,s,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=i,this.view.width=s,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,i=(this.top+this.bottom)/2;let s=n-e,o=n+e,a=i+t,c=i-t;if(this.view!==null&&this.view.enabled){const l=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=l*this.view.offsetX,o=s+l*this.view.width,a-=h*this.view.offsetY,c=a-h*this.view.height}this.projectionMatrix.makeOrthographic(s,o,a,c,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}}const Rs=4,jl=[.125,.215,.35,.446,.526,.582],Ji=20,Ma=new Dr,ql=new qe;let Sa=null,wa=0,Ea=0,Ta=!1;const Yi=(1+Math.sqrt(5))/2,bs=1/Yi,Yl=[new P(-Yi,bs,0),new P(Yi,bs,0),new P(-bs,0,Yi),new P(bs,0,Yi),new P(0,Yi,-bs),new P(0,Yi,bs),new P(-1,1,-1),new P(1,1,-1),new P(-1,1,1),new P(1,1,1)];class $l{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,n=.1,i=100){Sa=this._renderer.getRenderTarget(),wa=this._renderer.getActiveCubeFace(),Ea=this._renderer.getActiveMipmapLevel(),Ta=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(256);const s=this._allocateTargets();return s.depthBuffer=!0,this._sceneToCubeUV(e,n,i,s),t>0&&this._blur(s,0,0,t),this._applyPMREM(s),this._cleanup(s),s}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Jl(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Zl(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(Sa,wa,Ea),this._renderer.xr.enabled=Ta,e.scissorTest=!1,ao(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===ks||e.mapping===Bs?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Sa=this._renderer.getRenderTarget(),wa=this._renderer.getActiveCubeFace(),Ea=this._renderer.getActiveMipmapLevel(),Ta=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){const e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:cn,minFilter:cn,generateMipmaps:!1,type:Rr,format:Nn,colorSpace:mn,depthBuffer:!1},i=Kl(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Kl(e,t,n);const{_lodMax:s}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=Rg(s)),this._blurMaterial=Lg(s,e,t)}return i}_compileMaterial(e){const t=new rt(this._lodPlanes[0],e);this._renderer.compile(t,Ma)}_sceneToCubeUV(e,t,n,i){const a=new nn(90,1,t,n),c=[1,-1,1,1,1,1],l=[1,1,1,-1,-1,-1],h=this._renderer,d=h.autoClear,u=h.toneMapping;h.getClearColor(ql),h.toneMapping=_i,h.autoClear=!1;const m=new rn({name:"PMREM.Background",side:Jt,depthWrite:!1,depthTest:!1}),g=new rt(new Ir,m);let _=!1;const f=e.background;f?f.isColor&&(m.color.copy(f),e.background=null,_=!0):(m.color.copy(ql),_=!0);for(let p=0;p<6;p++){const x=p%3;x===0?(a.up.set(0,c[p],0),a.lookAt(l[p],0,0)):x===1?(a.up.set(0,0,c[p]),a.lookAt(0,l[p],0)):(a.up.set(0,c[p],0),a.lookAt(0,0,l[p]));const y=this._cubeSize;ao(i,x*y,p>2?y:0,y,y),h.setRenderTarget(i),_&&h.render(g,a),h.render(e,a)}g.geometry.dispose(),g.material.dispose(),h.toneMapping=u,h.autoClear=d,e.background=f}_textureToCubeUV(e,t){const n=this._renderer,i=e.mapping===ks||e.mapping===Bs;i?(this._cubemapMaterial===null&&(this._cubemapMaterial=Jl()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Zl());const s=i?this._cubemapMaterial:this._equirectMaterial,o=new rt(this._lodPlanes[0],s),a=s.uniforms;a.envMap.value=e;const c=this._cubeSize;ao(t,0,0,3*c,2*c),n.setRenderTarget(t),n.render(o,Ma)}_applyPMREM(e){const t=this._renderer,n=t.autoClear;t.autoClear=!1;const i=this._lodPlanes.length;for(let s=1;s<i;s++){const o=Math.sqrt(this._sigmas[s]*this._sigmas[s]-this._sigmas[s-1]*this._sigmas[s-1]),a=Yl[(i-s-1)%Yl.length];this._blur(e,s-1,s,o,a)}t.autoClear=n}_blur(e,t,n,i,s){const o=this._pingPongRenderTarget;this._halfBlur(e,o,t,n,i,"latitudinal",s),this._halfBlur(o,e,n,n,i,"longitudinal",s)}_halfBlur(e,t,n,i,s,o,a){const c=this._renderer,l=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const h=3,d=new rt(this._lodPlanes[i],l),u=l.uniforms,m=this._sizeLods[n]-1,g=isFinite(s)?Math.PI/(2*m):2*Math.PI/(2*Ji-1),_=s/g,f=isFinite(s)?1+Math.floor(h*_):Ji;f>Ji&&console.warn(`sigmaRadians, ${s}, is too large and will clip, as it requested ${f} samples when the maximum is set to ${Ji}`);const p=[];let x=0;for(let L=0;L<Ji;++L){const O=L/_,w=Math.exp(-O*O/2);p.push(w),L===0?x+=w:L<f&&(x+=2*w)}for(let L=0;L<p.length;L++)p[L]=p[L]/x;u.envMap.value=e.texture,u.samples.value=f,u.weights.value=p,u.latitudinal.value=o==="latitudinal",a&&(u.poleAxis.value=a);const{_lodMax:y}=this;u.dTheta.value=g,u.mipInt.value=y-n;const v=this._sizeLods[i],F=3*v*(i>y-Rs?i-y+Rs:0),A=4*(this._cubeSize-v);ao(t,F,A,3*v,2*v),c.setRenderTarget(t),c.render(d,Ma)}}function Rg(r){const e=[],t=[],n=[];let i=r;const s=r-Rs+1+jl.length;for(let o=0;o<s;o++){const a=Math.pow(2,i);t.push(a);let c=1/a;o>r-Rs?c=jl[o-r+Rs-1]:o===0&&(c=0),n.push(c);const l=1/(a-2),h=-l,d=1+l,u=[h,h,d,h,d,d,h,h,d,d,h,d],m=6,g=6,_=3,f=2,p=1,x=new Float32Array(_*g*m),y=new Float32Array(f*g*m),v=new Float32Array(p*g*m);for(let A=0;A<m;A++){const L=A%3*2/3-1,O=A>2?0:-1,w=[L,O,0,L+2/3,O,0,L+2/3,O+1,0,L,O,0,L+2/3,O+1,0,L,O+1,0];x.set(w,_*g*A),y.set(u,f*g*A);const S=[A,A,A,A,A,A];v.set(S,p*g*A)}const F=new at;F.setAttribute("position",new yt(x,_)),F.setAttribute("uv",new yt(y,f)),F.setAttribute("faceIndex",new yt(v,p)),e.push(F),i>Rs&&i--}return{lodPlanes:e,sizeLods:t,sigmas:n}}function Kl(r,e,t){const n=new is(r,e,t);return n.texture.mapping=jo,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function ao(r,e,t,n,i){r.viewport.set(e,t,n,i),r.scissor.set(e,t,n,i)}function Lg(r,e,t){const n=new Float32Array(Ji),i=new P(0,1,0);return new yi({name:"SphericalGaussianBlur",defines:{n:Ji,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${r}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:i}},vertexShader:nl(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Ui,depthTest:!1,depthWrite:!1})}function Zl(){return new yi({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:nl(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Ui,depthTest:!1,depthWrite:!1})}function Jl(){return new yi({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:nl(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Ui,depthTest:!1,depthWrite:!1})}function nl(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function Ig(r){let e=new WeakMap,t=null;function n(a){if(a&&a.isTexture){const c=a.mapping,l=c===sc||c===rc,h=c===ks||c===Bs;if(l||h){let d=e.get(a);const u=d!==void 0?d.texture.pmremVersion:0;if(a.isRenderTargetTexture&&a.pmremVersion!==u)return t===null&&(t=new $l(r)),d=l?t.fromEquirectangular(a,d):t.fromCubemap(a,d),d.texture.pmremVersion=a.pmremVersion,e.set(a,d),d.texture;if(d!==void 0)return d.texture;{const m=a.image;return l&&m&&m.height>0||h&&m&&i(m)?(t===null&&(t=new $l(r)),d=l?t.fromEquirectangular(a):t.fromCubemap(a),d.texture.pmremVersion=a.pmremVersion,e.set(a,d),a.addEventListener("dispose",s),d.texture):null}}}return a}function i(a){let c=0;const l=6;for(let h=0;h<l;h++)a[h]!==void 0&&c++;return c===l}function s(a){const c=a.target;c.removeEventListener("dispose",s);const l=e.get(c);l!==void 0&&(e.delete(c),l.dispose())}function o(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:n,dispose:o}}function Pg(r){const e={};function t(n){if(e[n]!==void 0)return e[n];let i;switch(n){case"WEBGL_depth_texture":i=r.getExtension("WEBGL_depth_texture")||r.getExtension("MOZ_WEBGL_depth_texture")||r.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":i=r.getExtension("EXT_texture_filter_anisotropic")||r.getExtension("MOZ_EXT_texture_filter_anisotropic")||r.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":i=r.getExtension("WEBGL_compressed_texture_s3tc")||r.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||r.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":i=r.getExtension("WEBGL_compressed_texture_pvrtc")||r.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:i=r.getExtension(n)}return e[n]=i,i}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){const i=t(n);return i===null&&fr("THREE.WebGLRenderer: "+n+" extension not supported."),i}}}function Dg(r,e,t,n){const i={},s=new WeakMap;function o(d){const u=d.target;u.index!==null&&e.remove(u.index);for(const g in u.attributes)e.remove(u.attributes[g]);for(const g in u.morphAttributes){const _=u.morphAttributes[g];for(let f=0,p=_.length;f<p;f++)e.remove(_[f])}u.removeEventListener("dispose",o),delete i[u.id];const m=s.get(u);m&&(e.remove(m),s.delete(u)),n.releaseStatesOfGeometry(u),u.isInstancedBufferGeometry===!0&&delete u._maxInstanceCount,t.memory.geometries--}function a(d,u){return i[u.id]===!0||(u.addEventListener("dispose",o),i[u.id]=!0,t.memory.geometries++),u}function c(d){const u=d.attributes;for(const g in u)e.update(u[g],r.ARRAY_BUFFER);const m=d.morphAttributes;for(const g in m){const _=m[g];for(let f=0,p=_.length;f<p;f++)e.update(_[f],r.ARRAY_BUFFER)}}function l(d){const u=[],m=d.index,g=d.attributes.position;let _=0;if(m!==null){const x=m.array;_=m.version;for(let y=0,v=x.length;y<v;y+=3){const F=x[y+0],A=x[y+1],L=x[y+2];u.push(F,A,A,L,L,F)}}else if(g!==void 0){const x=g.array;_=g.version;for(let y=0,v=x.length/3-1;y<v;y+=3){const F=y+0,A=y+1,L=y+2;u.push(F,A,A,L,L,F)}}else return;const f=new(Ad(u)?Pd:Id)(u,1);f.version=_;const p=s.get(d);p&&e.remove(p),s.set(d,f)}function h(d){const u=s.get(d);if(u){const m=d.index;m!==null&&u.version<m.version&&l(d)}else l(d);return s.get(d)}return{get:a,update:c,getWireframeAttribute:h}}function Ng(r,e,t){let n;function i(u){n=u}let s,o;function a(u){s=u.type,o=u.bytesPerElement}function c(u,m){r.drawElements(n,m,s,u*o),t.update(m,n,1)}function l(u,m,g){g!==0&&(r.drawElementsInstanced(n,m,s,u*o,g),t.update(m,n,g))}function h(u,m,g){if(g===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,m,0,s,u,0,g);let f=0;for(let p=0;p<g;p++)f+=m[p];t.update(f,n,1)}function d(u,m,g,_){if(g===0)return;const f=e.get("WEBGL_multi_draw");if(f===null)for(let p=0;p<u.length;p++)l(u[p]/o,m[p],_[p]);else{f.multiDrawElementsInstancedWEBGL(n,m,0,s,u,0,_,0,g);let p=0;for(let x=0;x<g;x++)p+=m[x]*_[x];t.update(p,n,1)}}this.setMode=i,this.setIndex=a,this.render=c,this.renderInstances=l,this.renderMultiDraw=h,this.renderMultiDrawInstances=d}function Fg(r){const e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(s,o,a){switch(t.calls++,o){case r.TRIANGLES:t.triangles+=a*(s/3);break;case r.LINES:t.lines+=a*(s/2);break;case r.LINE_STRIP:t.lines+=a*(s-1);break;case r.LINE_LOOP:t.lines+=a*s;break;case r.POINTS:t.points+=a*s;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function i(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:i,update:n}}function Ug(r,e,t){const n=new WeakMap,i=new vt;function s(o,a,c){const l=o.morphTargetInfluences,h=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,d=h!==void 0?h.length:0;let u=n.get(a);if(u===void 0||u.count!==d){let w=function(){L.dispose(),n.delete(a),a.removeEventListener("dispose",w)};u!==void 0&&u.texture.dispose();const m=a.morphAttributes.position!==void 0,g=a.morphAttributes.normal!==void 0,_=a.morphAttributes.color!==void 0,f=a.morphAttributes.position||[],p=a.morphAttributes.normal||[],x=a.morphAttributes.color||[];let y=0;m===!0&&(y=1),g===!0&&(y=2),_===!0&&(y=3);let v=a.attributes.position.count*y,F=1;v>e.maxTextureSize&&(F=Math.ceil(v/e.maxTextureSize),v=e.maxTextureSize);const A=new Float32Array(v*F*4*d),L=new Rd(A,v,F,d);L.type=$n,L.needsUpdate=!0;const O=y*4;for(let S=0;S<d;S++){const U=f[S],Z=p[S],K=x[S],se=v*F*4*S;for(let fe=0;fe<U.count;fe++){const z=fe*O;m===!0&&(i.fromBufferAttribute(U,fe),A[se+z+0]=i.x,A[se+z+1]=i.y,A[se+z+2]=i.z,A[se+z+3]=0),g===!0&&(i.fromBufferAttribute(Z,fe),A[se+z+4]=i.x,A[se+z+5]=i.y,A[se+z+6]=i.z,A[se+z+7]=0),_===!0&&(i.fromBufferAttribute(K,fe),A[se+z+8]=i.x,A[se+z+9]=i.y,A[se+z+10]=i.z,A[se+z+11]=K.itemSize===4?i.w:1)}}u={count:d,texture:L,size:new Ge(v,F)},n.set(a,u),a.addEventListener("dispose",w)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)c.getUniforms().setValue(r,"morphTexture",o.morphTexture,t);else{let m=0;for(let _=0;_<l.length;_++)m+=l[_];const g=a.morphTargetsRelative?1:1-m;c.getUniforms().setValue(r,"morphTargetBaseInfluence",g),c.getUniforms().setValue(r,"morphTargetInfluences",l)}c.getUniforms().setValue(r,"morphTargetsTexture",u.texture,t),c.getUniforms().setValue(r,"morphTargetsTextureSize",u.size)}return{update:s}}function Og(r,e,t,n){let i=new WeakMap;function s(c){const l=n.render.frame,h=c.geometry,d=e.get(c,h);if(i.get(d)!==l&&(e.update(d),i.set(d,l)),c.isInstancedMesh&&(c.hasEventListener("dispose",a)===!1&&c.addEventListener("dispose",a),i.get(c)!==l&&(t.update(c.instanceMatrix,r.ARRAY_BUFFER),c.instanceColor!==null&&t.update(c.instanceColor,r.ARRAY_BUFFER),i.set(c,l))),c.isSkinnedMesh){const u=c.skeleton;i.get(u)!==l&&(u.update(),i.set(u,l))}return d}function o(){i=new WeakMap}function a(c){const l=c.target;l.removeEventListener("dispose",a),t.remove(l.instanceMatrix),l.instanceColor!==null&&t.remove(l.instanceColor)}return{update:s,dispose:o}}class Od extends jt{constructor(e,t,n,i,s,o,a,c,l,h=Is){if(h!==Is&&h!==Gs)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");n===void 0&&h===Is&&(n=ns),n===void 0&&h===Gs&&(n=zs),super(null,i,s,o,a,c,h,n,l),this.isDepthTexture=!0,this.image={width:e,height:t},this.magFilter=a!==void 0?a:pn,this.minFilter=c!==void 0?c:pn,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.compareFunction=e.compareFunction,this}toJSON(e){const t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}}const kd=new jt,Ql=new Od(1,1),Bd=new Rd,zd=new wf,Gd=new Fd,eh=[],th=[],nh=new Float32Array(16),ih=new Float32Array(9),sh=new Float32Array(4);function js(r,e,t){const n=r[0];if(n<=0||n>0)return r;const i=e*t;let s=eh[i];if(s===void 0&&(s=new Float32Array(i),eh[i]=s),e!==0){n.toArray(s,0);for(let o=1,a=0;o!==e;++o)a+=t,r[o].toArray(s,a)}return s}function qt(r,e){if(r.length!==e.length)return!1;for(let t=0,n=r.length;t<n;t++)if(r[t]!==e[t])return!1;return!0}function Yt(r,e){for(let t=0,n=e.length;t<n;t++)r[t]=e[t]}function $o(r,e){let t=th[e];t===void 0&&(t=new Int32Array(e),th[e]=t);for(let n=0;n!==e;++n)t[n]=r.allocateTextureUnit();return t}function kg(r,e){const t=this.cache;t[0]!==e&&(r.uniform1f(this.addr,e),t[0]=e)}function Bg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(r.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(qt(t,e))return;r.uniform2fv(this.addr,e),Yt(t,e)}}function zg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(r.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(r.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(qt(t,e))return;r.uniform3fv(this.addr,e),Yt(t,e)}}function Gg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(r.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(qt(t,e))return;r.uniform4fv(this.addr,e),Yt(t,e)}}function Hg(r,e){const t=this.cache,n=e.elements;if(n===void 0){if(qt(t,e))return;r.uniformMatrix2fv(this.addr,!1,e),Yt(t,e)}else{if(qt(t,n))return;sh.set(n),r.uniformMatrix2fv(this.addr,!1,sh),Yt(t,n)}}function Vg(r,e){const t=this.cache,n=e.elements;if(n===void 0){if(qt(t,e))return;r.uniformMatrix3fv(this.addr,!1,e),Yt(t,e)}else{if(qt(t,n))return;ih.set(n),r.uniformMatrix3fv(this.addr,!1,ih),Yt(t,n)}}function Wg(r,e){const t=this.cache,n=e.elements;if(n===void 0){if(qt(t,e))return;r.uniformMatrix4fv(this.addr,!1,e),Yt(t,e)}else{if(qt(t,n))return;nh.set(n),r.uniformMatrix4fv(this.addr,!1,nh),Yt(t,n)}}function Xg(r,e){const t=this.cache;t[0]!==e&&(r.uniform1i(this.addr,e),t[0]=e)}function jg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(r.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(qt(t,e))return;r.uniform2iv(this.addr,e),Yt(t,e)}}function qg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(r.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(qt(t,e))return;r.uniform3iv(this.addr,e),Yt(t,e)}}function Yg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(r.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(qt(t,e))return;r.uniform4iv(this.addr,e),Yt(t,e)}}function $g(r,e){const t=this.cache;t[0]!==e&&(r.uniform1ui(this.addr,e),t[0]=e)}function Kg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(r.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(qt(t,e))return;r.uniform2uiv(this.addr,e),Yt(t,e)}}function Zg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(r.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(qt(t,e))return;r.uniform3uiv(this.addr,e),Yt(t,e)}}function Jg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(r.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(qt(t,e))return;r.uniform4uiv(this.addr,e),Yt(t,e)}}function Qg(r,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i);let s;this.type===r.SAMPLER_2D_SHADOW?(Ql.compareFunction=Td,s=Ql):s=kd,t.setTexture2D(e||s,i)}function e_(r,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i),t.setTexture3D(e||zd,i)}function t_(r,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i),t.setTextureCube(e||Gd,i)}function n_(r,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i),t.setTexture2DArray(e||Bd,i)}function i_(r){switch(r){case 5126:return kg;case 35664:return Bg;case 35665:return zg;case 35666:return Gg;case 35674:return Hg;case 35675:return Vg;case 35676:return Wg;case 5124:case 35670:return Xg;case 35667:case 35671:return jg;case 35668:case 35672:return qg;case 35669:case 35673:return Yg;case 5125:return $g;case 36294:return Kg;case 36295:return Zg;case 36296:return Jg;case 35678:case 36198:case 36298:case 36306:case 35682:return Qg;case 35679:case 36299:case 36307:return e_;case 35680:case 36300:case 36308:case 36293:return t_;case 36289:case 36303:case 36311:case 36292:return n_}}function s_(r,e){r.uniform1fv(this.addr,e)}function r_(r,e){const t=js(e,this.size,2);r.uniform2fv(this.addr,t)}function o_(r,e){const t=js(e,this.size,3);r.uniform3fv(this.addr,t)}function a_(r,e){const t=js(e,this.size,4);r.uniform4fv(this.addr,t)}function c_(r,e){const t=js(e,this.size,4);r.uniformMatrix2fv(this.addr,!1,t)}function l_(r,e){const t=js(e,this.size,9);r.uniformMatrix3fv(this.addr,!1,t)}function h_(r,e){const t=js(e,this.size,16);r.uniformMatrix4fv(this.addr,!1,t)}function d_(r,e){r.uniform1iv(this.addr,e)}function u_(r,e){r.uniform2iv(this.addr,e)}function f_(r,e){r.uniform3iv(this.addr,e)}function p_(r,e){r.uniform4iv(this.addr,e)}function m_(r,e){r.uniform1uiv(this.addr,e)}function g_(r,e){r.uniform2uiv(this.addr,e)}function __(r,e){r.uniform3uiv(this.addr,e)}function x_(r,e){r.uniform4uiv(this.addr,e)}function v_(r,e,t){const n=this.cache,i=e.length,s=$o(t,i);qt(n,s)||(r.uniform1iv(this.addr,s),Yt(n,s));for(let o=0;o!==i;++o)t.setTexture2D(e[o]||kd,s[o])}function y_(r,e,t){const n=this.cache,i=e.length,s=$o(t,i);qt(n,s)||(r.uniform1iv(this.addr,s),Yt(n,s));for(let o=0;o!==i;++o)t.setTexture3D(e[o]||zd,s[o])}function b_(r,e,t){const n=this.cache,i=e.length,s=$o(t,i);qt(n,s)||(r.uniform1iv(this.addr,s),Yt(n,s));for(let o=0;o!==i;++o)t.setTextureCube(e[o]||Gd,s[o])}function M_(r,e,t){const n=this.cache,i=e.length,s=$o(t,i);qt(n,s)||(r.uniform1iv(this.addr,s),Yt(n,s));for(let o=0;o!==i;++o)t.setTexture2DArray(e[o]||Bd,s[o])}function S_(r){switch(r){case 5126:return s_;case 35664:return r_;case 35665:return o_;case 35666:return a_;case 35674:return c_;case 35675:return l_;case 35676:return h_;case 5124:case 35670:return d_;case 35667:case 35671:return u_;case 35668:case 35672:return f_;case 35669:case 35673:return p_;case 5125:return m_;case 36294:return g_;case 36295:return __;case 36296:return x_;case 35678:case 36198:case 36298:case 36306:case 35682:return v_;case 35679:case 36299:case 36307:return y_;case 35680:case 36300:case 36308:case 36293:return b_;case 36289:case 36303:case 36311:case 36292:return M_}}class w_{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=i_(t.type)}}class E_{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=S_(t.type)}}class T_{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){const i=this.seq;for(let s=0,o=i.length;s!==o;++s){const a=i[s];a.setValue(e,t[a.id],n)}}}const Aa=/(\w+)(\])?(\[|\.)?/g;function rh(r,e){r.seq.push(e),r.map[e.id]=e}function A_(r,e,t){const n=r.name,i=n.length;for(Aa.lastIndex=0;;){const s=Aa.exec(n),o=Aa.lastIndex;let a=s[1];const c=s[2]==="]",l=s[3];if(c&&(a=a|0),l===void 0||l==="["&&o+2===i){rh(t,l===void 0?new w_(a,r,e):new E_(a,r,e));break}else{let d=t.map[a];d===void 0&&(d=new T_(a),rh(t,d)),t=d}}}class Uo{constructor(e,t){this.seq=[],this.map={};const n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let i=0;i<n;++i){const s=e.getActiveUniform(t,i),o=e.getUniformLocation(t,s.name);A_(s,o,this)}}setValue(e,t,n,i){const s=this.map[t];s!==void 0&&s.setValue(e,n,i)}setOptional(e,t,n){const i=t[n];i!==void 0&&this.setValue(e,n,i)}static upload(e,t,n,i){for(let s=0,o=t.length;s!==o;++s){const a=t[s],c=n[a.id];c.needsUpdate!==!1&&a.setValue(e,c.value,i)}}static seqWithValue(e,t){const n=[];for(let i=0,s=e.length;i!==s;++i){const o=e[i];o.id in t&&n.push(o)}return n}}function oh(r,e,t){const n=r.createShader(e);return r.shaderSource(n,t),r.compileShader(n),n}const C_=37297;let R_=0;function L_(r,e){const t=r.split(`
`),n=[],i=Math.max(e-6,0),s=Math.min(e+6,t.length);for(let o=i;o<s;o++){const a=o+1;n.push(`${a===e?">":" "} ${a}: ${t[o]}`)}return n.join(`
`)}const ah=new ft;function I_(r){gt._getMatrix(ah,gt.workingColorSpace,r);const e=`mat3( ${ah.elements.map(t=>t.toFixed(4))} )`;switch(gt.getTransfer(r)){case Yo:return[e,"LinearTransferOETF"];case Nt:return[e,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",r),[e,"LinearTransferOETF"]}}function ch(r,e,t){const n=r.getShaderParameter(e,r.COMPILE_STATUS),i=r.getShaderInfoLog(e).trim();if(n&&i==="")return"";const s=/ERROR: 0:(\d+)/.exec(i);if(s){const o=parseInt(s[1]);return t.toUpperCase()+`

`+i+`

`+L_(r.getShaderSource(e),o)}else return i}function P_(r,e){const t=I_(e);return[`vec4 ${r}( vec4 value ) {`,`	return ${t[1]}( vec4( value.rgb * ${t[0]}, value.a ) );`,"}"].join(`
`)}function D_(r,e){let t;switch(e){case Du:t="Linear";break;case Nu:t="Reinhard";break;case Fu:t="Cineon";break;case Uu:t="ACESFilmic";break;case ku:t="AgX";break;case Bu:t="Neutral";break;case Ou:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+r+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}const co=new P;function N_(){gt.getLuminanceCoefficients(co);const r=co.x.toFixed(4),e=co.y.toFixed(4),t=co.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${r}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function F_(r){return[r.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",r.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(pr).join(`
`)}function U_(r){const e=[];for(const t in r){const n=r[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function O_(r,e){const t={},n=r.getProgramParameter(e,r.ACTIVE_ATTRIBUTES);for(let i=0;i<n;i++){const s=r.getActiveAttrib(e,i),o=s.name;let a=1;s.type===r.FLOAT_MAT2&&(a=2),s.type===r.FLOAT_MAT3&&(a=3),s.type===r.FLOAT_MAT4&&(a=4),t[o]={type:s.type,location:r.getAttribLocation(e,o),locationSize:a}}return t}function pr(r){return r!==""}function lh(r,e){const t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return r.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function hh(r,e){return r.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}const k_=/^[ \t]*#include +<([\w\d./]+)>/gm;function Nc(r){return r.replace(k_,z_)}const B_=new Map;function z_(r,e){let t=mt[e];if(t===void 0){const n=B_.get(e);if(n!==void 0)t=mt[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return Nc(t)}const G_=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function dh(r){return r.replace(G_,H_)}function H_(r,e,t,n){let i="";for(let s=parseInt(e);s<parseInt(t);s++)i+=n.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return i}function uh(r){let e=`precision ${r.precision} float;
	precision ${r.precision} int;
	precision ${r.precision} sampler2D;
	precision ${r.precision} samplerCube;
	precision ${r.precision} sampler3D;
	precision ${r.precision} sampler2DArray;
	precision ${r.precision} sampler2DShadow;
	precision ${r.precision} samplerCubeShadow;
	precision ${r.precision} sampler2DArrayShadow;
	precision ${r.precision} isampler2D;
	precision ${r.precision} isampler3D;
	precision ${r.precision} isamplerCube;
	precision ${r.precision} isampler2DArray;
	precision ${r.precision} usampler2D;
	precision ${r.precision} usampler3D;
	precision ${r.precision} usamplerCube;
	precision ${r.precision} usampler2DArray;
	`;return r.precision==="highp"?e+=`
#define HIGH_PRECISION`:r.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:r.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function V_(r){let e="SHADOWMAP_TYPE_BASIC";return r.shadowMapType===ud?e="SHADOWMAP_TYPE_PCF":r.shadowMapType===fd?e="SHADOWMAP_TYPE_PCF_SOFT":r.shadowMapType===ui&&(e="SHADOWMAP_TYPE_VSM"),e}function W_(r){let e="ENVMAP_TYPE_CUBE";if(r.envMap)switch(r.envMapMode){case ks:case Bs:e="ENVMAP_TYPE_CUBE";break;case jo:e="ENVMAP_TYPE_CUBE_UV";break}return e}function X_(r){let e="ENVMAP_MODE_REFLECTION";if(r.envMap)switch(r.envMapMode){case Bs:e="ENVMAP_MODE_REFRACTION";break}return e}function j_(r){let e="ENVMAP_BLENDING_NONE";if(r.envMap)switch(r.combine){case Xo:e="ENVMAP_BLENDING_MULTIPLY";break;case Iu:e="ENVMAP_BLENDING_MIX";break;case Pu:e="ENVMAP_BLENDING_ADD";break}return e}function q_(r){const e=r.envMapCubeUVHeight;if(e===null)return null;const t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),112)),texelHeight:n,maxMip:t}}function Y_(r,e,t,n){const i=r.getContext(),s=t.defines;let o=t.vertexShader,a=t.fragmentShader;const c=V_(t),l=W_(t),h=X_(t),d=j_(t),u=q_(t),m=F_(t),g=U_(s),_=i.createProgram();let f,p,x=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(f=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter(pr).join(`
`),f.length>0&&(f+=`
`),p=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter(pr).join(`
`),p.length>0&&(p+=`
`)):(f=[uh(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+h:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+c:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(pr).join(`
`),p=[uh(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+l:"",t.envMap?"#define "+h:"",t.envMap?"#define "+d:"",u?"#define CUBEUV_TEXEL_WIDTH "+u.texelWidth:"",u?"#define CUBEUV_TEXEL_HEIGHT "+u.texelHeight:"",u?"#define CUBEUV_MAX_MIP "+u.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor||t.batchingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+c:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==_i?"#define TONE_MAPPING":"",t.toneMapping!==_i?mt.tonemapping_pars_fragment:"",t.toneMapping!==_i?D_("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",mt.colorspace_pars_fragment,P_("linearToOutputTexel",t.outputColorSpace),N_(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(pr).join(`
`)),o=Nc(o),o=lh(o,t),o=hh(o,t),a=Nc(a),a=lh(a,t),a=hh(a,t),o=dh(o),a=dh(a),t.isRawShaderMaterial!==!0&&(x=`#version 300 es
`,f=[m,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+f,p=["#define varying in",t.glslVersion===wl?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===wl?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+p);const y=x+f+o,v=x+p+a,F=oh(i,i.VERTEX_SHADER,y),A=oh(i,i.FRAGMENT_SHADER,v);i.attachShader(_,F),i.attachShader(_,A),t.index0AttributeName!==void 0?i.bindAttribLocation(_,0,t.index0AttributeName):t.morphTargets===!0&&i.bindAttribLocation(_,0,"position"),i.linkProgram(_);function L(U){if(r.debug.checkShaderErrors){const Z=i.getProgramInfoLog(_).trim(),K=i.getShaderInfoLog(F).trim(),se=i.getShaderInfoLog(A).trim();let fe=!0,z=!0;if(i.getProgramParameter(_,i.LINK_STATUS)===!1)if(fe=!1,typeof r.debug.onShaderError=="function")r.debug.onShaderError(i,_,F,A);else{const de=ch(i,F,"vertex"),$=ch(i,A,"fragment");console.error("THREE.WebGLProgram: Shader Error "+i.getError()+" - VALIDATE_STATUS "+i.getProgramParameter(_,i.VALIDATE_STATUS)+`

Material Name: `+U.name+`
Material Type: `+U.type+`

Program Info Log: `+Z+`
`+de+`
`+$)}else Z!==""?console.warn("THREE.WebGLProgram: Program Info Log:",Z):(K===""||se==="")&&(z=!1);z&&(U.diagnostics={runnable:fe,programLog:Z,vertexShader:{log:K,prefix:f},fragmentShader:{log:se,prefix:p}})}i.deleteShader(F),i.deleteShader(A),O=new Uo(i,_),w=O_(i,_)}let O;this.getUniforms=function(){return O===void 0&&L(this),O};let w;this.getAttributes=function(){return w===void 0&&L(this),w};let S=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return S===!1&&(S=i.getProgramParameter(_,C_)),S},this.destroy=function(){n.releaseStatesOfProgram(this),i.deleteProgram(_),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=R_++,this.cacheKey=e,this.usedTimes=1,this.program=_,this.vertexShader=F,this.fragmentShader=A,this}let $_=0;class K_{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){const t=e.vertexShader,n=e.fragmentShader,i=this._getShaderStage(t),s=this._getShaderStage(n),o=this._getShaderCacheForMaterial(e);return o.has(i)===!1&&(o.add(i),i.usedTimes++),o.has(s)===!1&&(o.add(s),s.usedTimes++),this}remove(e){const t=this.materialCache.get(e);for(const n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){const t=this.materialCache;let n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){const t=this.shaderCache;let n=t.get(e);return n===void 0&&(n=new Z_(e),t.set(e,n)),n}}class Z_{constructor(e){this.id=$_++,this.code=e,this.usedTimes=0}}function J_(r,e,t,n,i,s,o){const a=new Qc,c=new K_,l=new Set,h=[],d=i.logarithmicDepthBuffer,u=i.vertexTextures;let m=i.precision;const g={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(w){return l.add(w),w===0?"uv":`uv${w}`}function f(w,S,U,Z,K){const se=Z.fog,fe=K.geometry,z=w.isMeshStandardMaterial?Z.environment:null,de=(w.isMeshStandardMaterial?t:e).get(w.envMap||z),$=de&&de.mapping===jo?de.image.height:null,D=g[w.type];w.precision!==null&&(m=i.getMaxPrecision(w.precision),m!==w.precision&&console.warn("THREE.WebGLProgram.getParameters:",w.precision,"not supported, using",m,"instead."));const B=fe.morphAttributes.position||fe.morphAttributes.normal||fe.morphAttributes.color,j=B!==void 0?B.length:0;let X=0;fe.morphAttributes.position!==void 0&&(X=1),fe.morphAttributes.normal!==void 0&&(X=2),fe.morphAttributes.color!==void 0&&(X=3);let Y,k,G,Q;if(D){const ut=bn[D];Y=ut.vertexShader,k=ut.fragmentShader}else Y=w.vertexShader,k=w.fragmentShader,c.update(w),G=c.getVertexShaderID(w),Q=c.getFragmentShaderID(w);const ee=r.getRenderTarget(),oe=r.state.buffers.depth.getReversed(),ce=K.isInstancedMesh===!0,Me=K.isBatchedMesh===!0,$e=!!w.map,Je=!!w.matcap,_e=!!de,V=!!w.aoMap,Pt=!!w.lightMap,be=!!w.bumpMap,Te=!!w.normalMap,xe=!!w.displacementMap,ke=!!w.emissiveMap,Ue=!!w.metalnessMap,N=!!w.roughnessMap,E=w.anisotropy>0,J=w.clearcoat>0,ue=w.dispersion>0,me=w.iridescence>0,he=w.sheen>0,Oe=w.transmission>0,Ee=E&&!!w.anisotropyMap,De=J&&!!w.clearcoatMap,_t=J&&!!w.clearcoatNormalMap,ye=J&&!!w.clearcoatRoughnessMap,Ne=me&&!!w.iridescenceMap,Ye=me&&!!w.iridescenceThicknessMap,Qe=he&&!!w.sheenColorMap,Re=he&&!!w.sheenRoughnessMap,ct=!!w.specularMap,it=!!w.specularColorMap,St=!!w.specularIntensityMap,W=Oe&&!!w.transmissionMap,Ae=Oe&&!!w.thicknessMap,ae=!!w.gradientMap,pe=!!w.alphaMap,Pe=w.alphaTest>0,Le=!!w.alphaHash,lt=!!w.extensions;let Ot=_i;w.toneMapped&&(ee===null||ee.isXRRenderTarget===!0)&&(Ot=r.toneMapping);const $t={shaderID:D,shaderType:w.type,shaderName:w.name,vertexShader:Y,fragmentShader:k,defines:w.defines,customVertexShaderID:G,customFragmentShaderID:Q,isRawShaderMaterial:w.isRawShaderMaterial===!0,glslVersion:w.glslVersion,precision:m,batching:Me,batchingColor:Me&&K._colorsTexture!==null,instancing:ce,instancingColor:ce&&K.instanceColor!==null,instancingMorph:ce&&K.morphTexture!==null,supportsVertexTextures:u,outputColorSpace:ee===null?r.outputColorSpace:ee.isXRRenderTarget===!0?ee.texture.colorSpace:mn,alphaToCoverage:!!w.alphaToCoverage,map:$e,matcap:Je,envMap:_e,envMapMode:_e&&de.mapping,envMapCubeUVHeight:$,aoMap:V,lightMap:Pt,bumpMap:be,normalMap:Te,displacementMap:u&&xe,emissiveMap:ke,normalMapObjectSpace:Te&&w.normalMapType===Xu,normalMapTangentSpace:Te&&w.normalMapType===qo,metalnessMap:Ue,roughnessMap:N,anisotropy:E,anisotropyMap:Ee,clearcoat:J,clearcoatMap:De,clearcoatNormalMap:_t,clearcoatRoughnessMap:ye,dispersion:ue,iridescence:me,iridescenceMap:Ne,iridescenceThicknessMap:Ye,sheen:he,sheenColorMap:Qe,sheenRoughnessMap:Re,specularMap:ct,specularColorMap:it,specularIntensityMap:St,transmission:Oe,transmissionMap:W,thicknessMap:Ae,gradientMap:ae,opaque:w.transparent===!1&&w.blending===Ls&&w.alphaToCoverage===!1,alphaMap:pe,alphaTest:Pe,alphaHash:Le,combine:w.combine,mapUv:$e&&_(w.map.channel),aoMapUv:V&&_(w.aoMap.channel),lightMapUv:Pt&&_(w.lightMap.channel),bumpMapUv:be&&_(w.bumpMap.channel),normalMapUv:Te&&_(w.normalMap.channel),displacementMapUv:xe&&_(w.displacementMap.channel),emissiveMapUv:ke&&_(w.emissiveMap.channel),metalnessMapUv:Ue&&_(w.metalnessMap.channel),roughnessMapUv:N&&_(w.roughnessMap.channel),anisotropyMapUv:Ee&&_(w.anisotropyMap.channel),clearcoatMapUv:De&&_(w.clearcoatMap.channel),clearcoatNormalMapUv:_t&&_(w.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:ye&&_(w.clearcoatRoughnessMap.channel),iridescenceMapUv:Ne&&_(w.iridescenceMap.channel),iridescenceThicknessMapUv:Ye&&_(w.iridescenceThicknessMap.channel),sheenColorMapUv:Qe&&_(w.sheenColorMap.channel),sheenRoughnessMapUv:Re&&_(w.sheenRoughnessMap.channel),specularMapUv:ct&&_(w.specularMap.channel),specularColorMapUv:it&&_(w.specularColorMap.channel),specularIntensityMapUv:St&&_(w.specularIntensityMap.channel),transmissionMapUv:W&&_(w.transmissionMap.channel),thicknessMapUv:Ae&&_(w.thicknessMap.channel),alphaMapUv:pe&&_(w.alphaMap.channel),vertexTangents:!!fe.attributes.tangent&&(Te||E),vertexColors:w.vertexColors,vertexAlphas:w.vertexColors===!0&&!!fe.attributes.color&&fe.attributes.color.itemSize===4,pointsUvs:K.isPoints===!0&&!!fe.attributes.uv&&($e||pe),fog:!!se,useFog:w.fog===!0,fogExp2:!!se&&se.isFogExp2,flatShading:w.flatShading===!0,sizeAttenuation:w.sizeAttenuation===!0,logarithmicDepthBuffer:d,reverseDepthBuffer:oe,skinning:K.isSkinnedMesh===!0,morphTargets:fe.morphAttributes.position!==void 0,morphNormals:fe.morphAttributes.normal!==void 0,morphColors:fe.morphAttributes.color!==void 0,morphTargetsCount:j,morphTextureStride:X,numDirLights:S.directional.length,numPointLights:S.point.length,numSpotLights:S.spot.length,numSpotLightMaps:S.spotLightMap.length,numRectAreaLights:S.rectArea.length,numHemiLights:S.hemi.length,numDirLightShadows:S.directionalShadowMap.length,numPointLightShadows:S.pointShadowMap.length,numSpotLightShadows:S.spotShadowMap.length,numSpotLightShadowsWithMaps:S.numSpotLightShadowsWithMaps,numLightProbes:S.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:w.dithering,shadowMapEnabled:r.shadowMap.enabled&&U.length>0,shadowMapType:r.shadowMap.type,toneMapping:Ot,decodeVideoTexture:$e&&w.map.isVideoTexture===!0&&gt.getTransfer(w.map.colorSpace)===Nt,decodeVideoTextureEmissive:ke&&w.emissiveMap.isVideoTexture===!0&&gt.getTransfer(w.emissiveMap.colorSpace)===Nt,premultipliedAlpha:w.premultipliedAlpha,doubleSided:w.side===sn,flipSided:w.side===Jt,useDepthPacking:w.depthPacking>=0,depthPacking:w.depthPacking||0,index0AttributeName:w.index0AttributeName,extensionClipCullDistance:lt&&w.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(lt&&w.extensions.multiDraw===!0||Me)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:w.customProgramCacheKey()};return $t.vertexUv1s=l.has(1),$t.vertexUv2s=l.has(2),$t.vertexUv3s=l.has(3),l.clear(),$t}function p(w){const S=[];if(w.shaderID?S.push(w.shaderID):(S.push(w.customVertexShaderID),S.push(w.customFragmentShaderID)),w.defines!==void 0)for(const U in w.defines)S.push(U),S.push(w.defines[U]);return w.isRawShaderMaterial===!1&&(x(S,w),y(S,w),S.push(r.outputColorSpace)),S.push(w.customProgramCacheKey),S.join()}function x(w,S){w.push(S.precision),w.push(S.outputColorSpace),w.push(S.envMapMode),w.push(S.envMapCubeUVHeight),w.push(S.mapUv),w.push(S.alphaMapUv),w.push(S.lightMapUv),w.push(S.aoMapUv),w.push(S.bumpMapUv),w.push(S.normalMapUv),w.push(S.displacementMapUv),w.push(S.emissiveMapUv),w.push(S.metalnessMapUv),w.push(S.roughnessMapUv),w.push(S.anisotropyMapUv),w.push(S.clearcoatMapUv),w.push(S.clearcoatNormalMapUv),w.push(S.clearcoatRoughnessMapUv),w.push(S.iridescenceMapUv),w.push(S.iridescenceThicknessMapUv),w.push(S.sheenColorMapUv),w.push(S.sheenRoughnessMapUv),w.push(S.specularMapUv),w.push(S.specularColorMapUv),w.push(S.specularIntensityMapUv),w.push(S.transmissionMapUv),w.push(S.thicknessMapUv),w.push(S.combine),w.push(S.fogExp2),w.push(S.sizeAttenuation),w.push(S.morphTargetsCount),w.push(S.morphAttributeCount),w.push(S.numDirLights),w.push(S.numPointLights),w.push(S.numSpotLights),w.push(S.numSpotLightMaps),w.push(S.numHemiLights),w.push(S.numRectAreaLights),w.push(S.numDirLightShadows),w.push(S.numPointLightShadows),w.push(S.numSpotLightShadows),w.push(S.numSpotLightShadowsWithMaps),w.push(S.numLightProbes),w.push(S.shadowMapType),w.push(S.toneMapping),w.push(S.numClippingPlanes),w.push(S.numClipIntersection),w.push(S.depthPacking)}function y(w,S){a.disableAll(),S.supportsVertexTextures&&a.enable(0),S.instancing&&a.enable(1),S.instancingColor&&a.enable(2),S.instancingMorph&&a.enable(3),S.matcap&&a.enable(4),S.envMap&&a.enable(5),S.normalMapObjectSpace&&a.enable(6),S.normalMapTangentSpace&&a.enable(7),S.clearcoat&&a.enable(8),S.iridescence&&a.enable(9),S.alphaTest&&a.enable(10),S.vertexColors&&a.enable(11),S.vertexAlphas&&a.enable(12),S.vertexUv1s&&a.enable(13),S.vertexUv2s&&a.enable(14),S.vertexUv3s&&a.enable(15),S.vertexTangents&&a.enable(16),S.anisotropy&&a.enable(17),S.alphaHash&&a.enable(18),S.batching&&a.enable(19),S.dispersion&&a.enable(20),S.batchingColor&&a.enable(21),w.push(a.mask),a.disableAll(),S.fog&&a.enable(0),S.useFog&&a.enable(1),S.flatShading&&a.enable(2),S.logarithmicDepthBuffer&&a.enable(3),S.reverseDepthBuffer&&a.enable(4),S.skinning&&a.enable(5),S.morphTargets&&a.enable(6),S.morphNormals&&a.enable(7),S.morphColors&&a.enable(8),S.premultipliedAlpha&&a.enable(9),S.shadowMapEnabled&&a.enable(10),S.doubleSided&&a.enable(11),S.flipSided&&a.enable(12),S.useDepthPacking&&a.enable(13),S.dithering&&a.enable(14),S.transmission&&a.enable(15),S.sheen&&a.enable(16),S.opaque&&a.enable(17),S.pointsUvs&&a.enable(18),S.decodeVideoTexture&&a.enable(19),S.decodeVideoTextureEmissive&&a.enable(20),S.alphaToCoverage&&a.enable(21),w.push(a.mask)}function v(w){const S=g[w.type];let U;if(S){const Z=bn[S];U=el.clone(Z.uniforms)}else U=w.uniforms;return U}function F(w,S){let U;for(let Z=0,K=h.length;Z<K;Z++){const se=h[Z];if(se.cacheKey===S){U=se,++U.usedTimes;break}}return U===void 0&&(U=new Y_(r,S,w,s),h.push(U)),U}function A(w){if(--w.usedTimes===0){const S=h.indexOf(w);h[S]=h[h.length-1],h.pop(),w.destroy()}}function L(w){c.remove(w)}function O(){c.dispose()}return{getParameters:f,getProgramCacheKey:p,getUniforms:v,acquireProgram:F,releaseProgram:A,releaseShaderCache:L,programs:h,dispose:O}}function Q_(){let r=new WeakMap;function e(o){return r.has(o)}function t(o){let a=r.get(o);return a===void 0&&(a={},r.set(o,a)),a}function n(o){r.delete(o)}function i(o,a,c){r.get(o)[a]=c}function s(){r=new WeakMap}return{has:e,get:t,remove:n,update:i,dispose:s}}function ex(r,e){return r.groupOrder!==e.groupOrder?r.groupOrder-e.groupOrder:r.renderOrder!==e.renderOrder?r.renderOrder-e.renderOrder:r.material.id!==e.material.id?r.material.id-e.material.id:r.z!==e.z?r.z-e.z:r.id-e.id}function fh(r,e){return r.groupOrder!==e.groupOrder?r.groupOrder-e.groupOrder:r.renderOrder!==e.renderOrder?r.renderOrder-e.renderOrder:r.z!==e.z?e.z-r.z:r.id-e.id}function ph(){const r=[];let e=0;const t=[],n=[],i=[];function s(){e=0,t.length=0,n.length=0,i.length=0}function o(d,u,m,g,_,f){let p=r[e];return p===void 0?(p={id:d.id,object:d,geometry:u,material:m,groupOrder:g,renderOrder:d.renderOrder,z:_,group:f},r[e]=p):(p.id=d.id,p.object=d,p.geometry=u,p.material=m,p.groupOrder=g,p.renderOrder=d.renderOrder,p.z=_,p.group=f),e++,p}function a(d,u,m,g,_,f){const p=o(d,u,m,g,_,f);m.transmission>0?n.push(p):m.transparent===!0?i.push(p):t.push(p)}function c(d,u,m,g,_,f){const p=o(d,u,m,g,_,f);m.transmission>0?n.unshift(p):m.transparent===!0?i.unshift(p):t.unshift(p)}function l(d,u){t.length>1&&t.sort(d||ex),n.length>1&&n.sort(u||fh),i.length>1&&i.sort(u||fh)}function h(){for(let d=e,u=r.length;d<u;d++){const m=r[d];if(m.id===null)break;m.id=null,m.object=null,m.geometry=null,m.material=null,m.group=null}}return{opaque:t,transmissive:n,transparent:i,init:s,push:a,unshift:c,finish:h,sort:l}}function tx(){let r=new WeakMap;function e(n,i){const s=r.get(n);let o;return s===void 0?(o=new ph,r.set(n,[o])):i>=s.length?(o=new ph,s.push(o)):o=s[i],o}function t(){r=new WeakMap}return{get:e,dispose:t}}function nx(){const r={};return{get:function(e){if(r[e.id]!==void 0)return r[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new P,color:new qe};break;case"SpotLight":t={position:new P,direction:new P,color:new qe,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new P,color:new qe,distance:0,decay:0};break;case"HemisphereLight":t={direction:new P,skyColor:new qe,groundColor:new qe};break;case"RectAreaLight":t={color:new qe,position:new P,halfWidth:new P,halfHeight:new P};break}return r[e.id]=t,t}}}function ix(){const r={};return{get:function(e){if(r[e.id]!==void 0)return r[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ge};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ge};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ge,shadowCameraNear:1,shadowCameraFar:1e3};break}return r[e.id]=t,t}}}let sx=0;function rx(r,e){return(e.castShadow?2:0)-(r.castShadow?2:0)+(e.map?1:0)-(r.map?1:0)}function ox(r){const e=new nx,t=ix(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let l=0;l<9;l++)n.probe.push(new P);const i=new P,s=new Ze,o=new Ze;function a(l){let h=0,d=0,u=0;for(let w=0;w<9;w++)n.probe[w].set(0,0,0);let m=0,g=0,_=0,f=0,p=0,x=0,y=0,v=0,F=0,A=0,L=0;l.sort(rx);for(let w=0,S=l.length;w<S;w++){const U=l[w],Z=U.color,K=U.intensity,se=U.distance,fe=U.shadow&&U.shadow.map?U.shadow.map.texture:null;if(U.isAmbientLight)h+=Z.r*K,d+=Z.g*K,u+=Z.b*K;else if(U.isLightProbe){for(let z=0;z<9;z++)n.probe[z].addScaledVector(U.sh.coefficients[z],K);L++}else if(U.isDirectionalLight){const z=e.get(U);if(z.color.copy(U.color).multiplyScalar(U.intensity),U.castShadow){const de=U.shadow,$=t.get(U);$.shadowIntensity=de.intensity,$.shadowBias=de.bias,$.shadowNormalBias=de.normalBias,$.shadowRadius=de.radius,$.shadowMapSize=de.mapSize,n.directionalShadow[m]=$,n.directionalShadowMap[m]=fe,n.directionalShadowMatrix[m]=U.shadow.matrix,x++}n.directional[m]=z,m++}else if(U.isSpotLight){const z=e.get(U);z.position.setFromMatrixPosition(U.matrixWorld),z.color.copy(Z).multiplyScalar(K),z.distance=se,z.coneCos=Math.cos(U.angle),z.penumbraCos=Math.cos(U.angle*(1-U.penumbra)),z.decay=U.decay,n.spot[_]=z;const de=U.shadow;if(U.map&&(n.spotLightMap[F]=U.map,F++,de.updateMatrices(U),U.castShadow&&A++),n.spotLightMatrix[_]=de.matrix,U.castShadow){const $=t.get(U);$.shadowIntensity=de.intensity,$.shadowBias=de.bias,$.shadowNormalBias=de.normalBias,$.shadowRadius=de.radius,$.shadowMapSize=de.mapSize,n.spotShadow[_]=$,n.spotShadowMap[_]=fe,v++}_++}else if(U.isRectAreaLight){const z=e.get(U);z.color.copy(Z).multiplyScalar(K),z.halfWidth.set(U.width*.5,0,0),z.halfHeight.set(0,U.height*.5,0),n.rectArea[f]=z,f++}else if(U.isPointLight){const z=e.get(U);if(z.color.copy(U.color).multiplyScalar(U.intensity),z.distance=U.distance,z.decay=U.decay,U.castShadow){const de=U.shadow,$=t.get(U);$.shadowIntensity=de.intensity,$.shadowBias=de.bias,$.shadowNormalBias=de.normalBias,$.shadowRadius=de.radius,$.shadowMapSize=de.mapSize,$.shadowCameraNear=de.camera.near,$.shadowCameraFar=de.camera.far,n.pointShadow[g]=$,n.pointShadowMap[g]=fe,n.pointShadowMatrix[g]=U.shadow.matrix,y++}n.point[g]=z,g++}else if(U.isHemisphereLight){const z=e.get(U);z.skyColor.copy(U.color).multiplyScalar(K),z.groundColor.copy(U.groundColor).multiplyScalar(K),n.hemi[p]=z,p++}}f>0&&(r.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=we.LTC_FLOAT_1,n.rectAreaLTC2=we.LTC_FLOAT_2):(n.rectAreaLTC1=we.LTC_HALF_1,n.rectAreaLTC2=we.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=d,n.ambient[2]=u;const O=n.hash;(O.directionalLength!==m||O.pointLength!==g||O.spotLength!==_||O.rectAreaLength!==f||O.hemiLength!==p||O.numDirectionalShadows!==x||O.numPointShadows!==y||O.numSpotShadows!==v||O.numSpotMaps!==F||O.numLightProbes!==L)&&(n.directional.length=m,n.spot.length=_,n.rectArea.length=f,n.point.length=g,n.hemi.length=p,n.directionalShadow.length=x,n.directionalShadowMap.length=x,n.pointShadow.length=y,n.pointShadowMap.length=y,n.spotShadow.length=v,n.spotShadowMap.length=v,n.directionalShadowMatrix.length=x,n.pointShadowMatrix.length=y,n.spotLightMatrix.length=v+F-A,n.spotLightMap.length=F,n.numSpotLightShadowsWithMaps=A,n.numLightProbes=L,O.directionalLength=m,O.pointLength=g,O.spotLength=_,O.rectAreaLength=f,O.hemiLength=p,O.numDirectionalShadows=x,O.numPointShadows=y,O.numSpotShadows=v,O.numSpotMaps=F,O.numLightProbes=L,n.version=sx++)}function c(l,h){let d=0,u=0,m=0,g=0,_=0;const f=h.matrixWorldInverse;for(let p=0,x=l.length;p<x;p++){const y=l[p];if(y.isDirectionalLight){const v=n.directional[d];v.direction.setFromMatrixPosition(y.matrixWorld),i.setFromMatrixPosition(y.target.matrixWorld),v.direction.sub(i),v.direction.transformDirection(f),d++}else if(y.isSpotLight){const v=n.spot[m];v.position.setFromMatrixPosition(y.matrixWorld),v.position.applyMatrix4(f),v.direction.setFromMatrixPosition(y.matrixWorld),i.setFromMatrixPosition(y.target.matrixWorld),v.direction.sub(i),v.direction.transformDirection(f),m++}else if(y.isRectAreaLight){const v=n.rectArea[g];v.position.setFromMatrixPosition(y.matrixWorld),v.position.applyMatrix4(f),o.identity(),s.copy(y.matrixWorld),s.premultiply(f),o.extractRotation(s),v.halfWidth.set(y.width*.5,0,0),v.halfHeight.set(0,y.height*.5,0),v.halfWidth.applyMatrix4(o),v.halfHeight.applyMatrix4(o),g++}else if(y.isPointLight){const v=n.point[u];v.position.setFromMatrixPosition(y.matrixWorld),v.position.applyMatrix4(f),u++}else if(y.isHemisphereLight){const v=n.hemi[_];v.direction.setFromMatrixPosition(y.matrixWorld),v.direction.transformDirection(f),_++}}}return{setup:a,setupView:c,state:n}}function mh(r){const e=new ox(r),t=[],n=[];function i(h){l.camera=h,t.length=0,n.length=0}function s(h){t.push(h)}function o(h){n.push(h)}function a(){e.setup(t)}function c(h){e.setupView(t,h)}const l={lightsArray:t,shadowsArray:n,camera:null,lights:e,transmissionRenderTarget:{}};return{init:i,state:l,setupLights:a,setupLightsView:c,pushLight:s,pushShadow:o}}function ax(r){let e=new WeakMap;function t(i,s=0){const o=e.get(i);let a;return o===void 0?(a=new mh(r),e.set(i,[a])):s>=o.length?(a=new mh(r),o.push(a)):a=o[s],a}function n(){e=new WeakMap}return{get:t,dispose:n}}class cx extends Ft{static get type(){return"MeshDepthMaterial"}constructor(e){super(),this.isMeshDepthMaterial=!0,this.depthPacking=Vu,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}}class lx extends Ft{static get type(){return"MeshDistanceMaterial"}constructor(e){super(),this.isMeshDistanceMaterial=!0,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}}const hx=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,dx=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function ux(r,e,t){let n=new tl;const i=new Ge,s=new Ge,o=new vt,a=new cx({depthPacking:Wu}),c=new lx,l={},h=t.maxTextureSize,d={[ln]:Jt,[Jt]:ln,[sn]:sn},u=new yi({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ge},radius:{value:4}},vertexShader:hx,fragmentShader:dx}),m=u.clone();m.defines.HORIZONTAL_PASS=1;const g=new at;g.setAttribute("position",new yt(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const _=new rt(g,u),f=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=ud;let p=this.type;this.render=function(A,L,O){if(f.enabled===!1||f.autoUpdate===!1&&f.needsUpdate===!1||A.length===0)return;const w=r.getRenderTarget(),S=r.getActiveCubeFace(),U=r.getActiveMipmapLevel(),Z=r.state;Z.setBlending(Ui),Z.buffers.color.setClear(1,1,1,1),Z.buffers.depth.setTest(!0),Z.setScissorTest(!1);const K=p!==ui&&this.type===ui,se=p===ui&&this.type!==ui;for(let fe=0,z=A.length;fe<z;fe++){const de=A[fe],$=de.shadow;if($===void 0){console.warn("THREE.WebGLShadowMap:",de,"has no shadow.");continue}if($.autoUpdate===!1&&$.needsUpdate===!1)continue;i.copy($.mapSize);const D=$.getFrameExtents();if(i.multiply(D),s.copy($.mapSize),(i.x>h||i.y>h)&&(i.x>h&&(s.x=Math.floor(h/D.x),i.x=s.x*D.x,$.mapSize.x=s.x),i.y>h&&(s.y=Math.floor(h/D.y),i.y=s.y*D.y,$.mapSize.y=s.y)),$.map===null||K===!0||se===!0){const j=this.type!==ui?{minFilter:pn,magFilter:pn}:{};$.map!==null&&$.map.dispose(),$.map=new is(i.x,i.y,j),$.map.texture.name=de.name+".shadowMap",$.camera.updateProjectionMatrix()}r.setRenderTarget($.map),r.clear();const B=$.getViewportCount();for(let j=0;j<B;j++){const X=$.getViewport(j);o.set(s.x*X.x,s.y*X.y,s.x*X.z,s.y*X.w),Z.viewport(o),$.updateMatrices(de,j),n=$.getFrustum(),v(L,O,$.camera,de,this.type)}$.isPointLightShadow!==!0&&this.type===ui&&x($,O),$.needsUpdate=!1}p=this.type,f.needsUpdate=!1,r.setRenderTarget(w,S,U)};function x(A,L){const O=e.update(_);u.defines.VSM_SAMPLES!==A.blurSamples&&(u.defines.VSM_SAMPLES=A.blurSamples,m.defines.VSM_SAMPLES=A.blurSamples,u.needsUpdate=!0,m.needsUpdate=!0),A.mapPass===null&&(A.mapPass=new is(i.x,i.y)),u.uniforms.shadow_pass.value=A.map.texture,u.uniforms.resolution.value=A.mapSize,u.uniforms.radius.value=A.radius,r.setRenderTarget(A.mapPass),r.clear(),r.renderBufferDirect(L,null,O,u,_,null),m.uniforms.shadow_pass.value=A.mapPass.texture,m.uniforms.resolution.value=A.mapSize,m.uniforms.radius.value=A.radius,r.setRenderTarget(A.map),r.clear(),r.renderBufferDirect(L,null,O,m,_,null)}function y(A,L,O,w){let S=null;const U=O.isPointLight===!0?A.customDistanceMaterial:A.customDepthMaterial;if(U!==void 0)S=U;else if(S=O.isPointLight===!0?c:a,r.localClippingEnabled&&L.clipShadows===!0&&Array.isArray(L.clippingPlanes)&&L.clippingPlanes.length!==0||L.displacementMap&&L.displacementScale!==0||L.alphaMap&&L.alphaTest>0||L.map&&L.alphaTest>0){const Z=S.uuid,K=L.uuid;let se=l[Z];se===void 0&&(se={},l[Z]=se);let fe=se[K];fe===void 0&&(fe=S.clone(),se[K]=fe,L.addEventListener("dispose",F)),S=fe}if(S.visible=L.visible,S.wireframe=L.wireframe,w===ui?S.side=L.shadowSide!==null?L.shadowSide:L.side:S.side=L.shadowSide!==null?L.shadowSide:d[L.side],S.alphaMap=L.alphaMap,S.alphaTest=L.alphaTest,S.map=L.map,S.clipShadows=L.clipShadows,S.clippingPlanes=L.clippingPlanes,S.clipIntersection=L.clipIntersection,S.displacementMap=L.displacementMap,S.displacementScale=L.displacementScale,S.displacementBias=L.displacementBias,S.wireframeLinewidth=L.wireframeLinewidth,S.linewidth=L.linewidth,O.isPointLight===!0&&S.isMeshDistanceMaterial===!0){const Z=r.properties.get(S);Z.light=O}return S}function v(A,L,O,w,S){if(A.visible===!1)return;if(A.layers.test(L.layers)&&(A.isMesh||A.isLine||A.isPoints)&&(A.castShadow||A.receiveShadow&&S===ui)&&(!A.frustumCulled||n.intersectsObject(A))){A.modelViewMatrix.multiplyMatrices(O.matrixWorldInverse,A.matrixWorld);const K=e.update(A),se=A.material;if(Array.isArray(se)){const fe=K.groups;for(let z=0,de=fe.length;z<de;z++){const $=fe[z],D=se[$.materialIndex];if(D&&D.visible){const B=y(A,D,w,S);A.onBeforeShadow(r,A,L,O,K,B,$),r.renderBufferDirect(O,null,K,B,A,$),A.onAfterShadow(r,A,L,O,K,B,$)}}}else if(se.visible){const fe=y(A,se,w,S);A.onBeforeShadow(r,A,L,O,K,fe,null),r.renderBufferDirect(O,null,K,fe,A,null),A.onAfterShadow(r,A,L,O,K,fe,null)}}const Z=A.children;for(let K=0,se=Z.length;K<se;K++)v(Z[K],L,O,w,S)}function F(A){A.target.removeEventListener("dispose",F);for(const O in l){const w=l[O],S=A.target.uuid;S in w&&(w[S].dispose(),delete w[S])}}}const fx={[Za]:Ja,[Qa]:nc,[ec]:ic,[Os]:tc,[Ja]:Za,[nc]:Qa,[ic]:ec,[tc]:Os};function px(r,e){function t(){let W=!1;const Ae=new vt;let ae=null;const pe=new vt(0,0,0,0);return{setMask:function(Pe){ae!==Pe&&!W&&(r.colorMask(Pe,Pe,Pe,Pe),ae=Pe)},setLocked:function(Pe){W=Pe},setClear:function(Pe,Le,lt,Ot,$t){$t===!0&&(Pe*=Ot,Le*=Ot,lt*=Ot),Ae.set(Pe,Le,lt,Ot),pe.equals(Ae)===!1&&(r.clearColor(Pe,Le,lt,Ot),pe.copy(Ae))},reset:function(){W=!1,ae=null,pe.set(-1,0,0,0)}}}function n(){let W=!1,Ae=!1,ae=null,pe=null,Pe=null;return{setReversed:function(Le){if(Ae!==Le){const lt=e.get("EXT_clip_control");Ae?lt.clipControlEXT(lt.LOWER_LEFT_EXT,lt.ZERO_TO_ONE_EXT):lt.clipControlEXT(lt.LOWER_LEFT_EXT,lt.NEGATIVE_ONE_TO_ONE_EXT);const Ot=Pe;Pe=null,this.setClear(Ot)}Ae=Le},getReversed:function(){return Ae},setTest:function(Le){Le?ee(r.DEPTH_TEST):oe(r.DEPTH_TEST)},setMask:function(Le){ae!==Le&&!W&&(r.depthMask(Le),ae=Le)},setFunc:function(Le){if(Ae&&(Le=fx[Le]),pe!==Le){switch(Le){case Za:r.depthFunc(r.NEVER);break;case Ja:r.depthFunc(r.ALWAYS);break;case Qa:r.depthFunc(r.LESS);break;case Os:r.depthFunc(r.LEQUAL);break;case ec:r.depthFunc(r.EQUAL);break;case tc:r.depthFunc(r.GEQUAL);break;case nc:r.depthFunc(r.GREATER);break;case ic:r.depthFunc(r.NOTEQUAL);break;default:r.depthFunc(r.LEQUAL)}pe=Le}},setLocked:function(Le){W=Le},setClear:function(Le){Pe!==Le&&(Ae&&(Le=1-Le),r.clearDepth(Le),Pe=Le)},reset:function(){W=!1,ae=null,pe=null,Pe=null,Ae=!1}}}function i(){let W=!1,Ae=null,ae=null,pe=null,Pe=null,Le=null,lt=null,Ot=null,$t=null;return{setTest:function(ut){W||(ut?ee(r.STENCIL_TEST):oe(r.STENCIL_TEST))},setMask:function(ut){Ae!==ut&&!W&&(r.stencilMask(ut),Ae=ut)},setFunc:function(ut,gn,kn){(ae!==ut||pe!==gn||Pe!==kn)&&(r.stencilFunc(ut,gn,kn),ae=ut,pe=gn,Pe=kn)},setOp:function(ut,gn,kn){(Le!==ut||lt!==gn||Ot!==kn)&&(r.stencilOp(ut,gn,kn),Le=ut,lt=gn,Ot=kn)},setLocked:function(ut){W=ut},setClear:function(ut){$t!==ut&&(r.clearStencil(ut),$t=ut)},reset:function(){W=!1,Ae=null,ae=null,pe=null,Pe=null,Le=null,lt=null,Ot=null,$t=null}}}const s=new t,o=new n,a=new i,c=new WeakMap,l=new WeakMap;let h={},d={},u=new WeakMap,m=[],g=null,_=!1,f=null,p=null,x=null,y=null,v=null,F=null,A=null,L=new qe(0,0,0),O=0,w=!1,S=null,U=null,Z=null,K=null,se=null;const fe=r.getParameter(r.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let z=!1,de=0;const $=r.getParameter(r.VERSION);$.indexOf("WebGL")!==-1?(de=parseFloat(/^WebGL (\d)/.exec($)[1]),z=de>=1):$.indexOf("OpenGL ES")!==-1&&(de=parseFloat(/^OpenGL ES (\d)/.exec($)[1]),z=de>=2);let D=null,B={};const j=r.getParameter(r.SCISSOR_BOX),X=r.getParameter(r.VIEWPORT),Y=new vt().fromArray(j),k=new vt().fromArray(X);function G(W,Ae,ae,pe){const Pe=new Uint8Array(4),Le=r.createTexture();r.bindTexture(W,Le),r.texParameteri(W,r.TEXTURE_MIN_FILTER,r.NEAREST),r.texParameteri(W,r.TEXTURE_MAG_FILTER,r.NEAREST);for(let lt=0;lt<ae;lt++)W===r.TEXTURE_3D||W===r.TEXTURE_2D_ARRAY?r.texImage3D(Ae,0,r.RGBA,1,1,pe,0,r.RGBA,r.UNSIGNED_BYTE,Pe):r.texImage2D(Ae+lt,0,r.RGBA,1,1,0,r.RGBA,r.UNSIGNED_BYTE,Pe);return Le}const Q={};Q[r.TEXTURE_2D]=G(r.TEXTURE_2D,r.TEXTURE_2D,1),Q[r.TEXTURE_CUBE_MAP]=G(r.TEXTURE_CUBE_MAP,r.TEXTURE_CUBE_MAP_POSITIVE_X,6),Q[r.TEXTURE_2D_ARRAY]=G(r.TEXTURE_2D_ARRAY,r.TEXTURE_2D_ARRAY,1,1),Q[r.TEXTURE_3D]=G(r.TEXTURE_3D,r.TEXTURE_3D,1,1),s.setClear(0,0,0,1),o.setClear(1),a.setClear(0),ee(r.DEPTH_TEST),o.setFunc(Os),be(!1),Te(gl),ee(r.CULL_FACE),V(Ui);function ee(W){h[W]!==!0&&(r.enable(W),h[W]=!0)}function oe(W){h[W]!==!1&&(r.disable(W),h[W]=!1)}function ce(W,Ae){return d[W]!==Ae?(r.bindFramebuffer(W,Ae),d[W]=Ae,W===r.DRAW_FRAMEBUFFER&&(d[r.FRAMEBUFFER]=Ae),W===r.FRAMEBUFFER&&(d[r.DRAW_FRAMEBUFFER]=Ae),!0):!1}function Me(W,Ae){let ae=m,pe=!1;if(W){ae=u.get(Ae),ae===void 0&&(ae=[],u.set(Ae,ae));const Pe=W.textures;if(ae.length!==Pe.length||ae[0]!==r.COLOR_ATTACHMENT0){for(let Le=0,lt=Pe.length;Le<lt;Le++)ae[Le]=r.COLOR_ATTACHMENT0+Le;ae.length=Pe.length,pe=!0}}else ae[0]!==r.BACK&&(ae[0]=r.BACK,pe=!0);pe&&r.drawBuffers(ae)}function $e(W){return g!==W?(r.useProgram(W),g=W,!0):!1}const Je={[Ki]:r.FUNC_ADD,[pu]:r.FUNC_SUBTRACT,[mu]:r.FUNC_REVERSE_SUBTRACT};Je[gu]=r.MIN,Je[_u]=r.MAX;const _e={[xu]:r.ZERO,[vu]:r.ONE,[yu]:r.SRC_COLOR,[$a]:r.SRC_ALPHA,[Tu]:r.SRC_ALPHA_SATURATE,[wu]:r.DST_COLOR,[Mu]:r.DST_ALPHA,[bu]:r.ONE_MINUS_SRC_COLOR,[Ka]:r.ONE_MINUS_SRC_ALPHA,[Eu]:r.ONE_MINUS_DST_COLOR,[Su]:r.ONE_MINUS_DST_ALPHA,[Au]:r.CONSTANT_COLOR,[Cu]:r.ONE_MINUS_CONSTANT_COLOR,[Ru]:r.CONSTANT_ALPHA,[Lu]:r.ONE_MINUS_CONSTANT_ALPHA};function V(W,Ae,ae,pe,Pe,Le,lt,Ot,$t,ut){if(W===Ui){_===!0&&(oe(r.BLEND),_=!1);return}if(_===!1&&(ee(r.BLEND),_=!0),W!==fu){if(W!==f||ut!==w){if((p!==Ki||v!==Ki)&&(r.blendEquation(r.FUNC_ADD),p=Ki,v=Ki),ut)switch(W){case Ls:r.blendFuncSeparate(r.ONE,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA);break;case Ya:r.blendFunc(r.ONE,r.ONE);break;case _l:r.blendFuncSeparate(r.ZERO,r.ONE_MINUS_SRC_COLOR,r.ZERO,r.ONE);break;case xl:r.blendFuncSeparate(r.ZERO,r.SRC_COLOR,r.ZERO,r.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",W);break}else switch(W){case Ls:r.blendFuncSeparate(r.SRC_ALPHA,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA);break;case Ya:r.blendFunc(r.SRC_ALPHA,r.ONE);break;case _l:r.blendFuncSeparate(r.ZERO,r.ONE_MINUS_SRC_COLOR,r.ZERO,r.ONE);break;case xl:r.blendFunc(r.ZERO,r.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",W);break}x=null,y=null,F=null,A=null,L.set(0,0,0),O=0,f=W,w=ut}return}Pe=Pe||Ae,Le=Le||ae,lt=lt||pe,(Ae!==p||Pe!==v)&&(r.blendEquationSeparate(Je[Ae],Je[Pe]),p=Ae,v=Pe),(ae!==x||pe!==y||Le!==F||lt!==A)&&(r.blendFuncSeparate(_e[ae],_e[pe],_e[Le],_e[lt]),x=ae,y=pe,F=Le,A=lt),(Ot.equals(L)===!1||$t!==O)&&(r.blendColor(Ot.r,Ot.g,Ot.b,$t),L.copy(Ot),O=$t),f=W,w=!1}function Pt(W,Ae){W.side===sn?oe(r.CULL_FACE):ee(r.CULL_FACE);let ae=W.side===Jt;Ae&&(ae=!ae),be(ae),W.blending===Ls&&W.transparent===!1?V(Ui):V(W.blending,W.blendEquation,W.blendSrc,W.blendDst,W.blendEquationAlpha,W.blendSrcAlpha,W.blendDstAlpha,W.blendColor,W.blendAlpha,W.premultipliedAlpha),o.setFunc(W.depthFunc),o.setTest(W.depthTest),o.setMask(W.depthWrite),s.setMask(W.colorWrite);const pe=W.stencilWrite;a.setTest(pe),pe&&(a.setMask(W.stencilWriteMask),a.setFunc(W.stencilFunc,W.stencilRef,W.stencilFuncMask),a.setOp(W.stencilFail,W.stencilZFail,W.stencilZPass)),ke(W.polygonOffset,W.polygonOffsetFactor,W.polygonOffsetUnits),W.alphaToCoverage===!0?ee(r.SAMPLE_ALPHA_TO_COVERAGE):oe(r.SAMPLE_ALPHA_TO_COVERAGE)}function be(W){S!==W&&(W?r.frontFace(r.CW):r.frontFace(r.CCW),S=W)}function Te(W){W!==du?(ee(r.CULL_FACE),W!==U&&(W===gl?r.cullFace(r.BACK):W===uu?r.cullFace(r.FRONT):r.cullFace(r.FRONT_AND_BACK))):oe(r.CULL_FACE),U=W}function xe(W){W!==Z&&(z&&r.lineWidth(W),Z=W)}function ke(W,Ae,ae){W?(ee(r.POLYGON_OFFSET_FILL),(K!==Ae||se!==ae)&&(r.polygonOffset(Ae,ae),K=Ae,se=ae)):oe(r.POLYGON_OFFSET_FILL)}function Ue(W){W?ee(r.SCISSOR_TEST):oe(r.SCISSOR_TEST)}function N(W){W===void 0&&(W=r.TEXTURE0+fe-1),D!==W&&(r.activeTexture(W),D=W)}function E(W,Ae,ae){ae===void 0&&(D===null?ae=r.TEXTURE0+fe-1:ae=D);let pe=B[ae];pe===void 0&&(pe={type:void 0,texture:void 0},B[ae]=pe),(pe.type!==W||pe.texture!==Ae)&&(D!==ae&&(r.activeTexture(ae),D=ae),r.bindTexture(W,Ae||Q[W]),pe.type=W,pe.texture=Ae)}function J(){const W=B[D];W!==void 0&&W.type!==void 0&&(r.bindTexture(W.type,null),W.type=void 0,W.texture=void 0)}function ue(){try{r.compressedTexImage2D.apply(r,arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function me(){try{r.compressedTexImage3D.apply(r,arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function he(){try{r.texSubImage2D.apply(r,arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function Oe(){try{r.texSubImage3D.apply(r,arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function Ee(){try{r.compressedTexSubImage2D.apply(r,arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function De(){try{r.compressedTexSubImage3D.apply(r,arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function _t(){try{r.texStorage2D.apply(r,arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function ye(){try{r.texStorage3D.apply(r,arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function Ne(){try{r.texImage2D.apply(r,arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function Ye(){try{r.texImage3D.apply(r,arguments)}catch(W){console.error("THREE.WebGLState:",W)}}function Qe(W){Y.equals(W)===!1&&(r.scissor(W.x,W.y,W.z,W.w),Y.copy(W))}function Re(W){k.equals(W)===!1&&(r.viewport(W.x,W.y,W.z,W.w),k.copy(W))}function ct(W,Ae){let ae=l.get(Ae);ae===void 0&&(ae=new WeakMap,l.set(Ae,ae));let pe=ae.get(W);pe===void 0&&(pe=r.getUniformBlockIndex(Ae,W.name),ae.set(W,pe))}function it(W,Ae){const pe=l.get(Ae).get(W);c.get(Ae)!==pe&&(r.uniformBlockBinding(Ae,pe,W.__bindingPointIndex),c.set(Ae,pe))}function St(){r.disable(r.BLEND),r.disable(r.CULL_FACE),r.disable(r.DEPTH_TEST),r.disable(r.POLYGON_OFFSET_FILL),r.disable(r.SCISSOR_TEST),r.disable(r.STENCIL_TEST),r.disable(r.SAMPLE_ALPHA_TO_COVERAGE),r.blendEquation(r.FUNC_ADD),r.blendFunc(r.ONE,r.ZERO),r.blendFuncSeparate(r.ONE,r.ZERO,r.ONE,r.ZERO),r.blendColor(0,0,0,0),r.colorMask(!0,!0,!0,!0),r.clearColor(0,0,0,0),r.depthMask(!0),r.depthFunc(r.LESS),o.setReversed(!1),r.clearDepth(1),r.stencilMask(4294967295),r.stencilFunc(r.ALWAYS,0,4294967295),r.stencilOp(r.KEEP,r.KEEP,r.KEEP),r.clearStencil(0),r.cullFace(r.BACK),r.frontFace(r.CCW),r.polygonOffset(0,0),r.activeTexture(r.TEXTURE0),r.bindFramebuffer(r.FRAMEBUFFER,null),r.bindFramebuffer(r.DRAW_FRAMEBUFFER,null),r.bindFramebuffer(r.READ_FRAMEBUFFER,null),r.useProgram(null),r.lineWidth(1),r.scissor(0,0,r.canvas.width,r.canvas.height),r.viewport(0,0,r.canvas.width,r.canvas.height),h={},D=null,B={},d={},u=new WeakMap,m=[],g=null,_=!1,f=null,p=null,x=null,y=null,v=null,F=null,A=null,L=new qe(0,0,0),O=0,w=!1,S=null,U=null,Z=null,K=null,se=null,Y.set(0,0,r.canvas.width,r.canvas.height),k.set(0,0,r.canvas.width,r.canvas.height),s.reset(),o.reset(),a.reset()}return{buffers:{color:s,depth:o,stencil:a},enable:ee,disable:oe,bindFramebuffer:ce,drawBuffers:Me,useProgram:$e,setBlending:V,setMaterial:Pt,setFlipSided:be,setCullFace:Te,setLineWidth:xe,setPolygonOffset:ke,setScissorTest:Ue,activeTexture:N,bindTexture:E,unbindTexture:J,compressedTexImage2D:ue,compressedTexImage3D:me,texImage2D:Ne,texImage3D:Ye,updateUBOMapping:ct,uniformBlockBinding:it,texStorage2D:_t,texStorage3D:ye,texSubImage2D:he,texSubImage3D:Oe,compressedTexSubImage2D:Ee,compressedTexSubImage3D:De,scissor:Qe,viewport:Re,reset:St}}function gh(r,e,t,n){const i=mx(n);switch(t){case vd:return r*e;case bd:return r*e;case Md:return r*e*2;case Yc:return r*e/i.components*i.byteLength;case $c:return r*e/i.components*i.byteLength;case Sd:return r*e*2/i.components*i.byteLength;case Kc:return r*e*2/i.components*i.byteLength;case yd:return r*e*3/i.components*i.byteLength;case Nn:return r*e*4/i.components*i.byteLength;case Zc:return r*e*4/i.components*i.byteLength;case Io:case Po:return Math.floor((r+3)/4)*Math.floor((e+3)/4)*8;case Do:case No:return Math.floor((r+3)/4)*Math.floor((e+3)/4)*16;case ac:case lc:return Math.max(r,16)*Math.max(e,8)/4;case oc:case cc:return Math.max(r,8)*Math.max(e,8)/2;case hc:case dc:return Math.floor((r+3)/4)*Math.floor((e+3)/4)*8;case uc:return Math.floor((r+3)/4)*Math.floor((e+3)/4)*16;case fc:return Math.floor((r+3)/4)*Math.floor((e+3)/4)*16;case pc:return Math.floor((r+4)/5)*Math.floor((e+3)/4)*16;case mc:return Math.floor((r+4)/5)*Math.floor((e+4)/5)*16;case gc:return Math.floor((r+5)/6)*Math.floor((e+4)/5)*16;case _c:return Math.floor((r+5)/6)*Math.floor((e+5)/6)*16;case xc:return Math.floor((r+7)/8)*Math.floor((e+4)/5)*16;case vc:return Math.floor((r+7)/8)*Math.floor((e+5)/6)*16;case yc:return Math.floor((r+7)/8)*Math.floor((e+7)/8)*16;case bc:return Math.floor((r+9)/10)*Math.floor((e+4)/5)*16;case Mc:return Math.floor((r+9)/10)*Math.floor((e+5)/6)*16;case Sc:return Math.floor((r+9)/10)*Math.floor((e+7)/8)*16;case wc:return Math.floor((r+9)/10)*Math.floor((e+9)/10)*16;case Ec:return Math.floor((r+11)/12)*Math.floor((e+9)/10)*16;case Tc:return Math.floor((r+11)/12)*Math.floor((e+11)/12)*16;case Fo:case Ac:case Cc:return Math.ceil(r/4)*Math.ceil(e/4)*16;case wd:case Rc:return Math.ceil(r/4)*Math.ceil(e/4)*8;case Lc:case Ic:return Math.ceil(r/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function mx(r){switch(r){case vi:case gd:return{byteLength:1,components:1};case Sr:case _d:case Rr:return{byteLength:2,components:1};case jc:case qc:return{byteLength:2,components:4};case ns:case Xc:case $n:return{byteLength:4,components:1};case xd:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${r}.`)}function gx(r,e,t,n,i,s,o){const a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,c=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),l=new Ge,h=new WeakMap;let d;const u=new WeakMap;let m=!1;try{m=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function g(N,E){return m?new OffscreenCanvas(N,E):Tr("canvas")}function _(N,E,J){let ue=1;const me=Ue(N);if((me.width>J||me.height>J)&&(ue=J/Math.max(me.width,me.height)),ue<1)if(typeof HTMLImageElement<"u"&&N instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&N instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&N instanceof ImageBitmap||typeof VideoFrame<"u"&&N instanceof VideoFrame){const he=Math.floor(ue*me.width),Oe=Math.floor(ue*me.height);d===void 0&&(d=g(he,Oe));const Ee=E?g(he,Oe):d;return Ee.width=he,Ee.height=Oe,Ee.getContext("2d").drawImage(N,0,0,he,Oe),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+me.width+"x"+me.height+") to ("+he+"x"+Oe+")."),Ee}else return"data"in N&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+me.width+"x"+me.height+")."),N;return N}function f(N){return N.generateMipmaps}function p(N){r.generateMipmap(N)}function x(N){return N.isWebGLCubeRenderTarget?r.TEXTURE_CUBE_MAP:N.isWebGL3DRenderTarget?r.TEXTURE_3D:N.isWebGLArrayRenderTarget||N.isCompressedArrayTexture?r.TEXTURE_2D_ARRAY:r.TEXTURE_2D}function y(N,E,J,ue,me=!1){if(N!==null){if(r[N]!==void 0)return r[N];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+N+"'")}let he=E;if(E===r.RED&&(J===r.FLOAT&&(he=r.R32F),J===r.HALF_FLOAT&&(he=r.R16F),J===r.UNSIGNED_BYTE&&(he=r.R8)),E===r.RED_INTEGER&&(J===r.UNSIGNED_BYTE&&(he=r.R8UI),J===r.UNSIGNED_SHORT&&(he=r.R16UI),J===r.UNSIGNED_INT&&(he=r.R32UI),J===r.BYTE&&(he=r.R8I),J===r.SHORT&&(he=r.R16I),J===r.INT&&(he=r.R32I)),E===r.RG&&(J===r.FLOAT&&(he=r.RG32F),J===r.HALF_FLOAT&&(he=r.RG16F),J===r.UNSIGNED_BYTE&&(he=r.RG8)),E===r.RG_INTEGER&&(J===r.UNSIGNED_BYTE&&(he=r.RG8UI),J===r.UNSIGNED_SHORT&&(he=r.RG16UI),J===r.UNSIGNED_INT&&(he=r.RG32UI),J===r.BYTE&&(he=r.RG8I),J===r.SHORT&&(he=r.RG16I),J===r.INT&&(he=r.RG32I)),E===r.RGB_INTEGER&&(J===r.UNSIGNED_BYTE&&(he=r.RGB8UI),J===r.UNSIGNED_SHORT&&(he=r.RGB16UI),J===r.UNSIGNED_INT&&(he=r.RGB32UI),J===r.BYTE&&(he=r.RGB8I),J===r.SHORT&&(he=r.RGB16I),J===r.INT&&(he=r.RGB32I)),E===r.RGBA_INTEGER&&(J===r.UNSIGNED_BYTE&&(he=r.RGBA8UI),J===r.UNSIGNED_SHORT&&(he=r.RGBA16UI),J===r.UNSIGNED_INT&&(he=r.RGBA32UI),J===r.BYTE&&(he=r.RGBA8I),J===r.SHORT&&(he=r.RGBA16I),J===r.INT&&(he=r.RGBA32I)),E===r.RGB&&J===r.UNSIGNED_INT_5_9_9_9_REV&&(he=r.RGB9_E5),E===r.RGBA){const Oe=me?Yo:gt.getTransfer(ue);J===r.FLOAT&&(he=r.RGBA32F),J===r.HALF_FLOAT&&(he=r.RGBA16F),J===r.UNSIGNED_BYTE&&(he=Oe===Nt?r.SRGB8_ALPHA8:r.RGBA8),J===r.UNSIGNED_SHORT_4_4_4_4&&(he=r.RGBA4),J===r.UNSIGNED_SHORT_5_5_5_1&&(he=r.RGB5_A1)}return(he===r.R16F||he===r.R32F||he===r.RG16F||he===r.RG32F||he===r.RGBA16F||he===r.RGBA32F)&&e.get("EXT_color_buffer_float"),he}function v(N,E){let J;return N?E===null||E===ns||E===zs?J=r.DEPTH24_STENCIL8:E===$n?J=r.DEPTH32F_STENCIL8:E===Sr&&(J=r.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):E===null||E===ns||E===zs?J=r.DEPTH_COMPONENT24:E===$n?J=r.DEPTH_COMPONENT32F:E===Sr&&(J=r.DEPTH_COMPONENT16),J}function F(N,E){return f(N)===!0||N.isFramebufferTexture&&N.minFilter!==pn&&N.minFilter!==cn?Math.log2(Math.max(E.width,E.height))+1:N.mipmaps!==void 0&&N.mipmaps.length>0?N.mipmaps.length:N.isCompressedTexture&&Array.isArray(N.image)?E.mipmaps.length:1}function A(N){const E=N.target;E.removeEventListener("dispose",A),O(E),E.isVideoTexture&&h.delete(E)}function L(N){const E=N.target;E.removeEventListener("dispose",L),S(E)}function O(N){const E=n.get(N);if(E.__webglInit===void 0)return;const J=N.source,ue=u.get(J);if(ue){const me=ue[E.__cacheKey];me.usedTimes--,me.usedTimes===0&&w(N),Object.keys(ue).length===0&&u.delete(J)}n.remove(N)}function w(N){const E=n.get(N);r.deleteTexture(E.__webglTexture);const J=N.source,ue=u.get(J);delete ue[E.__cacheKey],o.memory.textures--}function S(N){const E=n.get(N);if(N.depthTexture&&(N.depthTexture.dispose(),n.remove(N.depthTexture)),N.isWebGLCubeRenderTarget)for(let ue=0;ue<6;ue++){if(Array.isArray(E.__webglFramebuffer[ue]))for(let me=0;me<E.__webglFramebuffer[ue].length;me++)r.deleteFramebuffer(E.__webglFramebuffer[ue][me]);else r.deleteFramebuffer(E.__webglFramebuffer[ue]);E.__webglDepthbuffer&&r.deleteRenderbuffer(E.__webglDepthbuffer[ue])}else{if(Array.isArray(E.__webglFramebuffer))for(let ue=0;ue<E.__webglFramebuffer.length;ue++)r.deleteFramebuffer(E.__webglFramebuffer[ue]);else r.deleteFramebuffer(E.__webglFramebuffer);if(E.__webglDepthbuffer&&r.deleteRenderbuffer(E.__webglDepthbuffer),E.__webglMultisampledFramebuffer&&r.deleteFramebuffer(E.__webglMultisampledFramebuffer),E.__webglColorRenderbuffer)for(let ue=0;ue<E.__webglColorRenderbuffer.length;ue++)E.__webglColorRenderbuffer[ue]&&r.deleteRenderbuffer(E.__webglColorRenderbuffer[ue]);E.__webglDepthRenderbuffer&&r.deleteRenderbuffer(E.__webglDepthRenderbuffer)}const J=N.textures;for(let ue=0,me=J.length;ue<me;ue++){const he=n.get(J[ue]);he.__webglTexture&&(r.deleteTexture(he.__webglTexture),o.memory.textures--),n.remove(J[ue])}n.remove(N)}let U=0;function Z(){U=0}function K(){const N=U;return N>=i.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+N+" texture units while this GPU supports only "+i.maxTextures),U+=1,N}function se(N){const E=[];return E.push(N.wrapS),E.push(N.wrapT),E.push(N.wrapR||0),E.push(N.magFilter),E.push(N.minFilter),E.push(N.anisotropy),E.push(N.internalFormat),E.push(N.format),E.push(N.type),E.push(N.generateMipmaps),E.push(N.premultiplyAlpha),E.push(N.flipY),E.push(N.unpackAlignment),E.push(N.colorSpace),E.join()}function fe(N,E){const J=n.get(N);if(N.isVideoTexture&&xe(N),N.isRenderTargetTexture===!1&&N.version>0&&J.__version!==N.version){const ue=N.image;if(ue===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(ue.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{k(J,N,E);return}}t.bindTexture(r.TEXTURE_2D,J.__webglTexture,r.TEXTURE0+E)}function z(N,E){const J=n.get(N);if(N.version>0&&J.__version!==N.version){k(J,N,E);return}t.bindTexture(r.TEXTURE_2D_ARRAY,J.__webglTexture,r.TEXTURE0+E)}function de(N,E){const J=n.get(N);if(N.version>0&&J.__version!==N.version){k(J,N,E);return}t.bindTexture(r.TEXTURE_3D,J.__webglTexture,r.TEXTURE0+E)}function $(N,E){const J=n.get(N);if(N.version>0&&J.__version!==N.version){G(J,N,E);return}t.bindTexture(r.TEXTURE_CUBE_MAP,J.__webglTexture,r.TEXTURE0+E)}const D={[ti]:r.REPEAT,[Dn]:r.CLAMP_TO_EDGE,[Bo]:r.MIRRORED_REPEAT},B={[pn]:r.NEAREST,[md]:r.NEAREST_MIPMAP_NEAREST,[ur]:r.NEAREST_MIPMAP_LINEAR,[cn]:r.LINEAR,[Lo]:r.LINEAR_MIPMAP_NEAREST,[Yn]:r.LINEAR_MIPMAP_LINEAR},j={[ju]:r.NEVER,[Ju]:r.ALWAYS,[qu]:r.LESS,[Td]:r.LEQUAL,[Yu]:r.EQUAL,[Zu]:r.GEQUAL,[$u]:r.GREATER,[Ku]:r.NOTEQUAL};function X(N,E){if(E.type===$n&&e.has("OES_texture_float_linear")===!1&&(E.magFilter===cn||E.magFilter===Lo||E.magFilter===ur||E.magFilter===Yn||E.minFilter===cn||E.minFilter===Lo||E.minFilter===ur||E.minFilter===Yn)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),r.texParameteri(N,r.TEXTURE_WRAP_S,D[E.wrapS]),r.texParameteri(N,r.TEXTURE_WRAP_T,D[E.wrapT]),(N===r.TEXTURE_3D||N===r.TEXTURE_2D_ARRAY)&&r.texParameteri(N,r.TEXTURE_WRAP_R,D[E.wrapR]),r.texParameteri(N,r.TEXTURE_MAG_FILTER,B[E.magFilter]),r.texParameteri(N,r.TEXTURE_MIN_FILTER,B[E.minFilter]),E.compareFunction&&(r.texParameteri(N,r.TEXTURE_COMPARE_MODE,r.COMPARE_REF_TO_TEXTURE),r.texParameteri(N,r.TEXTURE_COMPARE_FUNC,j[E.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(E.magFilter===pn||E.minFilter!==ur&&E.minFilter!==Yn||E.type===$n&&e.has("OES_texture_float_linear")===!1)return;if(E.anisotropy>1||n.get(E).__currentAnisotropy){const J=e.get("EXT_texture_filter_anisotropic");r.texParameterf(N,J.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(E.anisotropy,i.getMaxAnisotropy())),n.get(E).__currentAnisotropy=E.anisotropy}}}function Y(N,E){let J=!1;N.__webglInit===void 0&&(N.__webglInit=!0,E.addEventListener("dispose",A));const ue=E.source;let me=u.get(ue);me===void 0&&(me={},u.set(ue,me));const he=se(E);if(he!==N.__cacheKey){me[he]===void 0&&(me[he]={texture:r.createTexture(),usedTimes:0},o.memory.textures++,J=!0),me[he].usedTimes++;const Oe=me[N.__cacheKey];Oe!==void 0&&(me[N.__cacheKey].usedTimes--,Oe.usedTimes===0&&w(E)),N.__cacheKey=he,N.__webglTexture=me[he].texture}return J}function k(N,E,J){let ue=r.TEXTURE_2D;(E.isDataArrayTexture||E.isCompressedArrayTexture)&&(ue=r.TEXTURE_2D_ARRAY),E.isData3DTexture&&(ue=r.TEXTURE_3D);const me=Y(N,E),he=E.source;t.bindTexture(ue,N.__webglTexture,r.TEXTURE0+J);const Oe=n.get(he);if(he.version!==Oe.__version||me===!0){t.activeTexture(r.TEXTURE0+J);const Ee=gt.getPrimaries(gt.workingColorSpace),De=E.colorSpace===Di?null:gt.getPrimaries(E.colorSpace),_t=E.colorSpace===Di||Ee===De?r.NONE:r.BROWSER_DEFAULT_WEBGL;r.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,E.flipY),r.pixelStorei(r.UNPACK_PREMULTIPLY_ALPHA_WEBGL,E.premultiplyAlpha),r.pixelStorei(r.UNPACK_ALIGNMENT,E.unpackAlignment),r.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,_t);let ye=_(E.image,!1,i.maxTextureSize);ye=ke(E,ye);const Ne=s.convert(E.format,E.colorSpace),Ye=s.convert(E.type);let Qe=y(E.internalFormat,Ne,Ye,E.colorSpace,E.isVideoTexture);X(ue,E);let Re;const ct=E.mipmaps,it=E.isVideoTexture!==!0,St=Oe.__version===void 0||me===!0,W=he.dataReady,Ae=F(E,ye);if(E.isDepthTexture)Qe=v(E.format===Gs,E.type),St&&(it?t.texStorage2D(r.TEXTURE_2D,1,Qe,ye.width,ye.height):t.texImage2D(r.TEXTURE_2D,0,Qe,ye.width,ye.height,0,Ne,Ye,null));else if(E.isDataTexture)if(ct.length>0){it&&St&&t.texStorage2D(r.TEXTURE_2D,Ae,Qe,ct[0].width,ct[0].height);for(let ae=0,pe=ct.length;ae<pe;ae++)Re=ct[ae],it?W&&t.texSubImage2D(r.TEXTURE_2D,ae,0,0,Re.width,Re.height,Ne,Ye,Re.data):t.texImage2D(r.TEXTURE_2D,ae,Qe,Re.width,Re.height,0,Ne,Ye,Re.data);E.generateMipmaps=!1}else it?(St&&t.texStorage2D(r.TEXTURE_2D,Ae,Qe,ye.width,ye.height),W&&t.texSubImage2D(r.TEXTURE_2D,0,0,0,ye.width,ye.height,Ne,Ye,ye.data)):t.texImage2D(r.TEXTURE_2D,0,Qe,ye.width,ye.height,0,Ne,Ye,ye.data);else if(E.isCompressedTexture)if(E.isCompressedArrayTexture){it&&St&&t.texStorage3D(r.TEXTURE_2D_ARRAY,Ae,Qe,ct[0].width,ct[0].height,ye.depth);for(let ae=0,pe=ct.length;ae<pe;ae++)if(Re=ct[ae],E.format!==Nn)if(Ne!==null)if(it){if(W)if(E.layerUpdates.size>0){const Pe=gh(Re.width,Re.height,E.format,E.type);for(const Le of E.layerUpdates){const lt=Re.data.subarray(Le*Pe/Re.data.BYTES_PER_ELEMENT,(Le+1)*Pe/Re.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(r.TEXTURE_2D_ARRAY,ae,0,0,Le,Re.width,Re.height,1,Ne,lt)}E.clearLayerUpdates()}else t.compressedTexSubImage3D(r.TEXTURE_2D_ARRAY,ae,0,0,0,Re.width,Re.height,ye.depth,Ne,Re.data)}else t.compressedTexImage3D(r.TEXTURE_2D_ARRAY,ae,Qe,Re.width,Re.height,ye.depth,0,Re.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else it?W&&t.texSubImage3D(r.TEXTURE_2D_ARRAY,ae,0,0,0,Re.width,Re.height,ye.depth,Ne,Ye,Re.data):t.texImage3D(r.TEXTURE_2D_ARRAY,ae,Qe,Re.width,Re.height,ye.depth,0,Ne,Ye,Re.data)}else{it&&St&&t.texStorage2D(r.TEXTURE_2D,Ae,Qe,ct[0].width,ct[0].height);for(let ae=0,pe=ct.length;ae<pe;ae++)Re=ct[ae],E.format!==Nn?Ne!==null?it?W&&t.compressedTexSubImage2D(r.TEXTURE_2D,ae,0,0,Re.width,Re.height,Ne,Re.data):t.compressedTexImage2D(r.TEXTURE_2D,ae,Qe,Re.width,Re.height,0,Re.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):it?W&&t.texSubImage2D(r.TEXTURE_2D,ae,0,0,Re.width,Re.height,Ne,Ye,Re.data):t.texImage2D(r.TEXTURE_2D,ae,Qe,Re.width,Re.height,0,Ne,Ye,Re.data)}else if(E.isDataArrayTexture)if(it){if(St&&t.texStorage3D(r.TEXTURE_2D_ARRAY,Ae,Qe,ye.width,ye.height,ye.depth),W)if(E.layerUpdates.size>0){const ae=gh(ye.width,ye.height,E.format,E.type);for(const pe of E.layerUpdates){const Pe=ye.data.subarray(pe*ae/ye.data.BYTES_PER_ELEMENT,(pe+1)*ae/ye.data.BYTES_PER_ELEMENT);t.texSubImage3D(r.TEXTURE_2D_ARRAY,0,0,0,pe,ye.width,ye.height,1,Ne,Ye,Pe)}E.clearLayerUpdates()}else t.texSubImage3D(r.TEXTURE_2D_ARRAY,0,0,0,0,ye.width,ye.height,ye.depth,Ne,Ye,ye.data)}else t.texImage3D(r.TEXTURE_2D_ARRAY,0,Qe,ye.width,ye.height,ye.depth,0,Ne,Ye,ye.data);else if(E.isData3DTexture)it?(St&&t.texStorage3D(r.TEXTURE_3D,Ae,Qe,ye.width,ye.height,ye.depth),W&&t.texSubImage3D(r.TEXTURE_3D,0,0,0,0,ye.width,ye.height,ye.depth,Ne,Ye,ye.data)):t.texImage3D(r.TEXTURE_3D,0,Qe,ye.width,ye.height,ye.depth,0,Ne,Ye,ye.data);else if(E.isFramebufferTexture){if(St)if(it)t.texStorage2D(r.TEXTURE_2D,Ae,Qe,ye.width,ye.height);else{let ae=ye.width,pe=ye.height;for(let Pe=0;Pe<Ae;Pe++)t.texImage2D(r.TEXTURE_2D,Pe,Qe,ae,pe,0,Ne,Ye,null),ae>>=1,pe>>=1}}else if(ct.length>0){if(it&&St){const ae=Ue(ct[0]);t.texStorage2D(r.TEXTURE_2D,Ae,Qe,ae.width,ae.height)}for(let ae=0,pe=ct.length;ae<pe;ae++)Re=ct[ae],it?W&&t.texSubImage2D(r.TEXTURE_2D,ae,0,0,Ne,Ye,Re):t.texImage2D(r.TEXTURE_2D,ae,Qe,Ne,Ye,Re);E.generateMipmaps=!1}else if(it){if(St){const ae=Ue(ye);t.texStorage2D(r.TEXTURE_2D,Ae,Qe,ae.width,ae.height)}W&&t.texSubImage2D(r.TEXTURE_2D,0,0,0,Ne,Ye,ye)}else t.texImage2D(r.TEXTURE_2D,0,Qe,Ne,Ye,ye);f(E)&&p(ue),Oe.__version=he.version,E.onUpdate&&E.onUpdate(E)}N.__version=E.version}function G(N,E,J){if(E.image.length!==6)return;const ue=Y(N,E),me=E.source;t.bindTexture(r.TEXTURE_CUBE_MAP,N.__webglTexture,r.TEXTURE0+J);const he=n.get(me);if(me.version!==he.__version||ue===!0){t.activeTexture(r.TEXTURE0+J);const Oe=gt.getPrimaries(gt.workingColorSpace),Ee=E.colorSpace===Di?null:gt.getPrimaries(E.colorSpace),De=E.colorSpace===Di||Oe===Ee?r.NONE:r.BROWSER_DEFAULT_WEBGL;r.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,E.flipY),r.pixelStorei(r.UNPACK_PREMULTIPLY_ALPHA_WEBGL,E.premultiplyAlpha),r.pixelStorei(r.UNPACK_ALIGNMENT,E.unpackAlignment),r.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,De);const _t=E.isCompressedTexture||E.image[0].isCompressedTexture,ye=E.image[0]&&E.image[0].isDataTexture,Ne=[];for(let pe=0;pe<6;pe++)!_t&&!ye?Ne[pe]=_(E.image[pe],!0,i.maxCubemapSize):Ne[pe]=ye?E.image[pe].image:E.image[pe],Ne[pe]=ke(E,Ne[pe]);const Ye=Ne[0],Qe=s.convert(E.format,E.colorSpace),Re=s.convert(E.type),ct=y(E.internalFormat,Qe,Re,E.colorSpace),it=E.isVideoTexture!==!0,St=he.__version===void 0||ue===!0,W=me.dataReady;let Ae=F(E,Ye);X(r.TEXTURE_CUBE_MAP,E);let ae;if(_t){it&&St&&t.texStorage2D(r.TEXTURE_CUBE_MAP,Ae,ct,Ye.width,Ye.height);for(let pe=0;pe<6;pe++){ae=Ne[pe].mipmaps;for(let Pe=0;Pe<ae.length;Pe++){const Le=ae[Pe];E.format!==Nn?Qe!==null?it?W&&t.compressedTexSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+pe,Pe,0,0,Le.width,Le.height,Qe,Le.data):t.compressedTexImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+pe,Pe,ct,Le.width,Le.height,0,Le.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):it?W&&t.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+pe,Pe,0,0,Le.width,Le.height,Qe,Re,Le.data):t.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+pe,Pe,ct,Le.width,Le.height,0,Qe,Re,Le.data)}}}else{if(ae=E.mipmaps,it&&St){ae.length>0&&Ae++;const pe=Ue(Ne[0]);t.texStorage2D(r.TEXTURE_CUBE_MAP,Ae,ct,pe.width,pe.height)}for(let pe=0;pe<6;pe++)if(ye){it?W&&t.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+pe,0,0,0,Ne[pe].width,Ne[pe].height,Qe,Re,Ne[pe].data):t.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+pe,0,ct,Ne[pe].width,Ne[pe].height,0,Qe,Re,Ne[pe].data);for(let Pe=0;Pe<ae.length;Pe++){const lt=ae[Pe].image[pe].image;it?W&&t.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+pe,Pe+1,0,0,lt.width,lt.height,Qe,Re,lt.data):t.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+pe,Pe+1,ct,lt.width,lt.height,0,Qe,Re,lt.data)}}else{it?W&&t.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+pe,0,0,0,Qe,Re,Ne[pe]):t.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+pe,0,ct,Qe,Re,Ne[pe]);for(let Pe=0;Pe<ae.length;Pe++){const Le=ae[Pe];it?W&&t.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+pe,Pe+1,0,0,Qe,Re,Le.image[pe]):t.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+pe,Pe+1,ct,Qe,Re,Le.image[pe])}}}f(E)&&p(r.TEXTURE_CUBE_MAP),he.__version=me.version,E.onUpdate&&E.onUpdate(E)}N.__version=E.version}function Q(N,E,J,ue,me,he){const Oe=s.convert(J.format,J.colorSpace),Ee=s.convert(J.type),De=y(J.internalFormat,Oe,Ee,J.colorSpace),_t=n.get(E),ye=n.get(J);if(ye.__renderTarget=E,!_t.__hasExternalTextures){const Ne=Math.max(1,E.width>>he),Ye=Math.max(1,E.height>>he);me===r.TEXTURE_3D||me===r.TEXTURE_2D_ARRAY?t.texImage3D(me,he,De,Ne,Ye,E.depth,0,Oe,Ee,null):t.texImage2D(me,he,De,Ne,Ye,0,Oe,Ee,null)}t.bindFramebuffer(r.FRAMEBUFFER,N),Te(E)?a.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,ue,me,ye.__webglTexture,0,be(E)):(me===r.TEXTURE_2D||me>=r.TEXTURE_CUBE_MAP_POSITIVE_X&&me<=r.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&r.framebufferTexture2D(r.FRAMEBUFFER,ue,me,ye.__webglTexture,he),t.bindFramebuffer(r.FRAMEBUFFER,null)}function ee(N,E,J){if(r.bindRenderbuffer(r.RENDERBUFFER,N),E.depthBuffer){const ue=E.depthTexture,me=ue&&ue.isDepthTexture?ue.type:null,he=v(E.stencilBuffer,me),Oe=E.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,Ee=be(E);Te(E)?a.renderbufferStorageMultisampleEXT(r.RENDERBUFFER,Ee,he,E.width,E.height):J?r.renderbufferStorageMultisample(r.RENDERBUFFER,Ee,he,E.width,E.height):r.renderbufferStorage(r.RENDERBUFFER,he,E.width,E.height),r.framebufferRenderbuffer(r.FRAMEBUFFER,Oe,r.RENDERBUFFER,N)}else{const ue=E.textures;for(let me=0;me<ue.length;me++){const he=ue[me],Oe=s.convert(he.format,he.colorSpace),Ee=s.convert(he.type),De=y(he.internalFormat,Oe,Ee,he.colorSpace),_t=be(E);J&&Te(E)===!1?r.renderbufferStorageMultisample(r.RENDERBUFFER,_t,De,E.width,E.height):Te(E)?a.renderbufferStorageMultisampleEXT(r.RENDERBUFFER,_t,De,E.width,E.height):r.renderbufferStorage(r.RENDERBUFFER,De,E.width,E.height)}}r.bindRenderbuffer(r.RENDERBUFFER,null)}function oe(N,E){if(E&&E.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(r.FRAMEBUFFER,N),!(E.depthTexture&&E.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");const ue=n.get(E.depthTexture);ue.__renderTarget=E,(!ue.__webglTexture||E.depthTexture.image.width!==E.width||E.depthTexture.image.height!==E.height)&&(E.depthTexture.image.width=E.width,E.depthTexture.image.height=E.height,E.depthTexture.needsUpdate=!0),fe(E.depthTexture,0);const me=ue.__webglTexture,he=be(E);if(E.depthTexture.format===Is)Te(E)?a.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,r.DEPTH_ATTACHMENT,r.TEXTURE_2D,me,0,he):r.framebufferTexture2D(r.FRAMEBUFFER,r.DEPTH_ATTACHMENT,r.TEXTURE_2D,me,0);else if(E.depthTexture.format===Gs)Te(E)?a.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,r.DEPTH_STENCIL_ATTACHMENT,r.TEXTURE_2D,me,0,he):r.framebufferTexture2D(r.FRAMEBUFFER,r.DEPTH_STENCIL_ATTACHMENT,r.TEXTURE_2D,me,0);else throw new Error("Unknown depthTexture format")}function ce(N){const E=n.get(N),J=N.isWebGLCubeRenderTarget===!0;if(E.__boundDepthTexture!==N.depthTexture){const ue=N.depthTexture;if(E.__depthDisposeCallback&&E.__depthDisposeCallback(),ue){const me=()=>{delete E.__boundDepthTexture,delete E.__depthDisposeCallback,ue.removeEventListener("dispose",me)};ue.addEventListener("dispose",me),E.__depthDisposeCallback=me}E.__boundDepthTexture=ue}if(N.depthTexture&&!E.__autoAllocateDepthBuffer){if(J)throw new Error("target.depthTexture not supported in Cube render targets");oe(E.__webglFramebuffer,N)}else if(J){E.__webglDepthbuffer=[];for(let ue=0;ue<6;ue++)if(t.bindFramebuffer(r.FRAMEBUFFER,E.__webglFramebuffer[ue]),E.__webglDepthbuffer[ue]===void 0)E.__webglDepthbuffer[ue]=r.createRenderbuffer(),ee(E.__webglDepthbuffer[ue],N,!1);else{const me=N.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,he=E.__webglDepthbuffer[ue];r.bindRenderbuffer(r.RENDERBUFFER,he),r.framebufferRenderbuffer(r.FRAMEBUFFER,me,r.RENDERBUFFER,he)}}else if(t.bindFramebuffer(r.FRAMEBUFFER,E.__webglFramebuffer),E.__webglDepthbuffer===void 0)E.__webglDepthbuffer=r.createRenderbuffer(),ee(E.__webglDepthbuffer,N,!1);else{const ue=N.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,me=E.__webglDepthbuffer;r.bindRenderbuffer(r.RENDERBUFFER,me),r.framebufferRenderbuffer(r.FRAMEBUFFER,ue,r.RENDERBUFFER,me)}t.bindFramebuffer(r.FRAMEBUFFER,null)}function Me(N,E,J){const ue=n.get(N);E!==void 0&&Q(ue.__webglFramebuffer,N,N.texture,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,0),J!==void 0&&ce(N)}function $e(N){const E=N.texture,J=n.get(N),ue=n.get(E);N.addEventListener("dispose",L);const me=N.textures,he=N.isWebGLCubeRenderTarget===!0,Oe=me.length>1;if(Oe||(ue.__webglTexture===void 0&&(ue.__webglTexture=r.createTexture()),ue.__version=E.version,o.memory.textures++),he){J.__webglFramebuffer=[];for(let Ee=0;Ee<6;Ee++)if(E.mipmaps&&E.mipmaps.length>0){J.__webglFramebuffer[Ee]=[];for(let De=0;De<E.mipmaps.length;De++)J.__webglFramebuffer[Ee][De]=r.createFramebuffer()}else J.__webglFramebuffer[Ee]=r.createFramebuffer()}else{if(E.mipmaps&&E.mipmaps.length>0){J.__webglFramebuffer=[];for(let Ee=0;Ee<E.mipmaps.length;Ee++)J.__webglFramebuffer[Ee]=r.createFramebuffer()}else J.__webglFramebuffer=r.createFramebuffer();if(Oe)for(let Ee=0,De=me.length;Ee<De;Ee++){const _t=n.get(me[Ee]);_t.__webglTexture===void 0&&(_t.__webglTexture=r.createTexture(),o.memory.textures++)}if(N.samples>0&&Te(N)===!1){J.__webglMultisampledFramebuffer=r.createFramebuffer(),J.__webglColorRenderbuffer=[],t.bindFramebuffer(r.FRAMEBUFFER,J.__webglMultisampledFramebuffer);for(let Ee=0;Ee<me.length;Ee++){const De=me[Ee];J.__webglColorRenderbuffer[Ee]=r.createRenderbuffer(),r.bindRenderbuffer(r.RENDERBUFFER,J.__webglColorRenderbuffer[Ee]);const _t=s.convert(De.format,De.colorSpace),ye=s.convert(De.type),Ne=y(De.internalFormat,_t,ye,De.colorSpace,N.isXRRenderTarget===!0),Ye=be(N);r.renderbufferStorageMultisample(r.RENDERBUFFER,Ye,Ne,N.width,N.height),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+Ee,r.RENDERBUFFER,J.__webglColorRenderbuffer[Ee])}r.bindRenderbuffer(r.RENDERBUFFER,null),N.depthBuffer&&(J.__webglDepthRenderbuffer=r.createRenderbuffer(),ee(J.__webglDepthRenderbuffer,N,!0)),t.bindFramebuffer(r.FRAMEBUFFER,null)}}if(he){t.bindTexture(r.TEXTURE_CUBE_MAP,ue.__webglTexture),X(r.TEXTURE_CUBE_MAP,E);for(let Ee=0;Ee<6;Ee++)if(E.mipmaps&&E.mipmaps.length>0)for(let De=0;De<E.mipmaps.length;De++)Q(J.__webglFramebuffer[Ee][De],N,E,r.COLOR_ATTACHMENT0,r.TEXTURE_CUBE_MAP_POSITIVE_X+Ee,De);else Q(J.__webglFramebuffer[Ee],N,E,r.COLOR_ATTACHMENT0,r.TEXTURE_CUBE_MAP_POSITIVE_X+Ee,0);f(E)&&p(r.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(Oe){for(let Ee=0,De=me.length;Ee<De;Ee++){const _t=me[Ee],ye=n.get(_t);t.bindTexture(r.TEXTURE_2D,ye.__webglTexture),X(r.TEXTURE_2D,_t),Q(J.__webglFramebuffer,N,_t,r.COLOR_ATTACHMENT0+Ee,r.TEXTURE_2D,0),f(_t)&&p(r.TEXTURE_2D)}t.unbindTexture()}else{let Ee=r.TEXTURE_2D;if((N.isWebGL3DRenderTarget||N.isWebGLArrayRenderTarget)&&(Ee=N.isWebGL3DRenderTarget?r.TEXTURE_3D:r.TEXTURE_2D_ARRAY),t.bindTexture(Ee,ue.__webglTexture),X(Ee,E),E.mipmaps&&E.mipmaps.length>0)for(let De=0;De<E.mipmaps.length;De++)Q(J.__webglFramebuffer[De],N,E,r.COLOR_ATTACHMENT0,Ee,De);else Q(J.__webglFramebuffer,N,E,r.COLOR_ATTACHMENT0,Ee,0);f(E)&&p(Ee),t.unbindTexture()}N.depthBuffer&&ce(N)}function Je(N){const E=N.textures;for(let J=0,ue=E.length;J<ue;J++){const me=E[J];if(f(me)){const he=x(N),Oe=n.get(me).__webglTexture;t.bindTexture(he,Oe),p(he),t.unbindTexture()}}}const _e=[],V=[];function Pt(N){if(N.samples>0){if(Te(N)===!1){const E=N.textures,J=N.width,ue=N.height;let me=r.COLOR_BUFFER_BIT;const he=N.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,Oe=n.get(N),Ee=E.length>1;if(Ee)for(let De=0;De<E.length;De++)t.bindFramebuffer(r.FRAMEBUFFER,Oe.__webglMultisampledFramebuffer),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+De,r.RENDERBUFFER,null),t.bindFramebuffer(r.FRAMEBUFFER,Oe.__webglFramebuffer),r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0+De,r.TEXTURE_2D,null,0);t.bindFramebuffer(r.READ_FRAMEBUFFER,Oe.__webglMultisampledFramebuffer),t.bindFramebuffer(r.DRAW_FRAMEBUFFER,Oe.__webglFramebuffer);for(let De=0;De<E.length;De++){if(N.resolveDepthBuffer&&(N.depthBuffer&&(me|=r.DEPTH_BUFFER_BIT),N.stencilBuffer&&N.resolveStencilBuffer&&(me|=r.STENCIL_BUFFER_BIT)),Ee){r.framebufferRenderbuffer(r.READ_FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.RENDERBUFFER,Oe.__webglColorRenderbuffer[De]);const _t=n.get(E[De]).__webglTexture;r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,_t,0)}r.blitFramebuffer(0,0,J,ue,0,0,J,ue,me,r.NEAREST),c===!0&&(_e.length=0,V.length=0,_e.push(r.COLOR_ATTACHMENT0+De),N.depthBuffer&&N.resolveDepthBuffer===!1&&(_e.push(he),V.push(he),r.invalidateFramebuffer(r.DRAW_FRAMEBUFFER,V)),r.invalidateFramebuffer(r.READ_FRAMEBUFFER,_e))}if(t.bindFramebuffer(r.READ_FRAMEBUFFER,null),t.bindFramebuffer(r.DRAW_FRAMEBUFFER,null),Ee)for(let De=0;De<E.length;De++){t.bindFramebuffer(r.FRAMEBUFFER,Oe.__webglMultisampledFramebuffer),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+De,r.RENDERBUFFER,Oe.__webglColorRenderbuffer[De]);const _t=n.get(E[De]).__webglTexture;t.bindFramebuffer(r.FRAMEBUFFER,Oe.__webglFramebuffer),r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0+De,r.TEXTURE_2D,_t,0)}t.bindFramebuffer(r.DRAW_FRAMEBUFFER,Oe.__webglMultisampledFramebuffer)}else if(N.depthBuffer&&N.resolveDepthBuffer===!1&&c){const E=N.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT;r.invalidateFramebuffer(r.DRAW_FRAMEBUFFER,[E])}}}function be(N){return Math.min(i.maxSamples,N.samples)}function Te(N){const E=n.get(N);return N.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&E.__useRenderToTexture!==!1}function xe(N){const E=o.render.frame;h.get(N)!==E&&(h.set(N,E),N.update())}function ke(N,E){const J=N.colorSpace,ue=N.format,me=N.type;return N.isCompressedTexture===!0||N.isVideoTexture===!0||J!==mn&&J!==Di&&(gt.getTransfer(J)===Nt?(ue!==Nn||me!==vi)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",J)),E}function Ue(N){return typeof HTMLImageElement<"u"&&N instanceof HTMLImageElement?(l.width=N.naturalWidth||N.width,l.height=N.naturalHeight||N.height):typeof VideoFrame<"u"&&N instanceof VideoFrame?(l.width=N.displayWidth,l.height=N.displayHeight):(l.width=N.width,l.height=N.height),l}this.allocateTextureUnit=K,this.resetTextureUnits=Z,this.setTexture2D=fe,this.setTexture2DArray=z,this.setTexture3D=de,this.setTextureCube=$,this.rebindTextures=Me,this.setupRenderTarget=$e,this.updateRenderTargetMipmap=Je,this.updateMultisampleRenderTarget=Pt,this.setupDepthRenderbuffer=ce,this.setupFrameBufferTexture=Q,this.useMultisampledRTT=Te}function _x(r,e){function t(n,i=Di){let s;const o=gt.getTransfer(i);if(n===vi)return r.UNSIGNED_BYTE;if(n===jc)return r.UNSIGNED_SHORT_4_4_4_4;if(n===qc)return r.UNSIGNED_SHORT_5_5_5_1;if(n===xd)return r.UNSIGNED_INT_5_9_9_9_REV;if(n===gd)return r.BYTE;if(n===_d)return r.SHORT;if(n===Sr)return r.UNSIGNED_SHORT;if(n===Xc)return r.INT;if(n===ns)return r.UNSIGNED_INT;if(n===$n)return r.FLOAT;if(n===Rr)return r.HALF_FLOAT;if(n===vd)return r.ALPHA;if(n===yd)return r.RGB;if(n===Nn)return r.RGBA;if(n===bd)return r.LUMINANCE;if(n===Md)return r.LUMINANCE_ALPHA;if(n===Is)return r.DEPTH_COMPONENT;if(n===Gs)return r.DEPTH_STENCIL;if(n===Yc)return r.RED;if(n===$c)return r.RED_INTEGER;if(n===Sd)return r.RG;if(n===Kc)return r.RG_INTEGER;if(n===Zc)return r.RGBA_INTEGER;if(n===Io||n===Po||n===Do||n===No)if(o===Nt)if(s=e.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(n===Io)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Po)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===Do)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===No)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=e.get("WEBGL_compressed_texture_s3tc"),s!==null){if(n===Io)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Po)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===Do)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===No)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===oc||n===ac||n===cc||n===lc)if(s=e.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(n===oc)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===ac)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===cc)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===lc)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===hc||n===dc||n===uc)if(s=e.get("WEBGL_compressed_texture_etc"),s!==null){if(n===hc||n===dc)return o===Nt?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(n===uc)return o===Nt?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===fc||n===pc||n===mc||n===gc||n===_c||n===xc||n===vc||n===yc||n===bc||n===Mc||n===Sc||n===wc||n===Ec||n===Tc)if(s=e.get("WEBGL_compressed_texture_astc"),s!==null){if(n===fc)return o===Nt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===pc)return o===Nt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===mc)return o===Nt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===gc)return o===Nt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===_c)return o===Nt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===xc)return o===Nt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===vc)return o===Nt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===yc)return o===Nt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===bc)return o===Nt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===Mc)return o===Nt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===Sc)return o===Nt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===wc)return o===Nt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===Ec)return o===Nt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===Tc)return o===Nt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Fo||n===Ac||n===Cc)if(s=e.get("EXT_texture_compression_bptc"),s!==null){if(n===Fo)return o===Nt?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===Ac)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===Cc)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===wd||n===Rc||n===Lc||n===Ic)if(s=e.get("EXT_texture_compression_rgtc"),s!==null){if(n===Fo)return s.COMPRESSED_RED_RGTC1_EXT;if(n===Rc)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===Lc)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===Ic)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===zs?r.UNSIGNED_INT_24_8:r[n]!==void 0?r[n]:null}return{convert:t}}class xx extends nn{constructor(e=[]){super(),this.isArrayCamera=!0,this.cameras=e}}class Bt extends Ut{constructor(){super(),this.isGroup=!0,this.type="Group"}}const vx={type:"move"};class Ca{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Bt,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Bt,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new P,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new P),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Bt,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new P,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new P),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){const t=this._hand;if(t)for(const n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let i=null,s=null,o=null;const a=this._targetRay,c=this._grip,l=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(l&&e.hand){o=!0;for(const _ of e.hand.values()){const f=t.getJointPose(_,n),p=this._getHandJoint(l,_);f!==null&&(p.matrix.fromArray(f.transform.matrix),p.matrix.decompose(p.position,p.rotation,p.scale),p.matrixWorldNeedsUpdate=!0,p.jointRadius=f.radius),p.visible=f!==null}const h=l.joints["index-finger-tip"],d=l.joints["thumb-tip"],u=h.position.distanceTo(d.position),m=.02,g=.005;l.inputState.pinching&&u>m+g?(l.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!l.inputState.pinching&&u<=m-g&&(l.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else c!==null&&e.gripSpace&&(s=t.getPose(e.gripSpace,n),s!==null&&(c.matrix.fromArray(s.transform.matrix),c.matrix.decompose(c.position,c.rotation,c.scale),c.matrixWorldNeedsUpdate=!0,s.linearVelocity?(c.hasLinearVelocity=!0,c.linearVelocity.copy(s.linearVelocity)):c.hasLinearVelocity=!1,s.angularVelocity?(c.hasAngularVelocity=!0,c.angularVelocity.copy(s.angularVelocity)):c.hasAngularVelocity=!1));a!==null&&(i=t.getPose(e.targetRaySpace,n),i===null&&s!==null&&(i=s),i!==null&&(a.matrix.fromArray(i.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,i.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(i.linearVelocity)):a.hasLinearVelocity=!1,i.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(i.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(vx)))}return a!==null&&(a.visible=i!==null),c!==null&&(c.visible=s!==null),l!==null&&(l.visible=o!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){const n=new Bt;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}}const yx=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,bx=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class Mx{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t,n){if(this.texture===null){const i=new jt,s=e.properties.get(i);s.__webglTexture=t.texture,(t.depthNear!=n.depthNear||t.depthFar!=n.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=i}}getMesh(e){if(this.texture!==null&&this.mesh===null){const t=e.cameras[0].viewport,n=new yi({vertexShader:yx,fragmentShader:bx,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new rt(new Pr(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class Sx extends Xs{constructor(e,t){super();const n=this;let i=null,s=1,o=null,a="local-floor",c=1,l=null,h=null,d=null,u=null,m=null,g=null;const _=new Mx,f=t.getContextAttributes();let p=null,x=null;const y=[],v=[],F=new Ge;let A=null;const L=new nn;L.viewport=new vt;const O=new nn;O.viewport=new vt;const w=[L,O],S=new xx;let U=null,Z=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(k){let G=y[k];return G===void 0&&(G=new Ca,y[k]=G),G.getTargetRaySpace()},this.getControllerGrip=function(k){let G=y[k];return G===void 0&&(G=new Ca,y[k]=G),G.getGripSpace()},this.getHand=function(k){let G=y[k];return G===void 0&&(G=new Ca,y[k]=G),G.getHandSpace()};function K(k){const G=v.indexOf(k.inputSource);if(G===-1)return;const Q=y[G];Q!==void 0&&(Q.update(k.inputSource,k.frame,l||o),Q.dispatchEvent({type:k.type,data:k.inputSource}))}function se(){i.removeEventListener("select",K),i.removeEventListener("selectstart",K),i.removeEventListener("selectend",K),i.removeEventListener("squeeze",K),i.removeEventListener("squeezestart",K),i.removeEventListener("squeezeend",K),i.removeEventListener("end",se),i.removeEventListener("inputsourceschange",fe);for(let k=0;k<y.length;k++){const G=v[k];G!==null&&(v[k]=null,y[k].disconnect(G))}U=null,Z=null,_.reset(),e.setRenderTarget(p),m=null,u=null,d=null,i=null,x=null,Y.stop(),n.isPresenting=!1,e.setPixelRatio(A),e.setSize(F.width,F.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(k){s=k,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(k){a=k,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return l||o},this.setReferenceSpace=function(k){l=k},this.getBaseLayer=function(){return u!==null?u:m},this.getBinding=function(){return d},this.getFrame=function(){return g},this.getSession=function(){return i},this.setSession=async function(k){if(i=k,i!==null){if(p=e.getRenderTarget(),i.addEventListener("select",K),i.addEventListener("selectstart",K),i.addEventListener("selectend",K),i.addEventListener("squeeze",K),i.addEventListener("squeezestart",K),i.addEventListener("squeezeend",K),i.addEventListener("end",se),i.addEventListener("inputsourceschange",fe),f.xrCompatible!==!0&&await t.makeXRCompatible(),A=e.getPixelRatio(),e.getSize(F),i.renderState.layers===void 0){const G={antialias:f.antialias,alpha:!0,depth:f.depth,stencil:f.stencil,framebufferScaleFactor:s};m=new XRWebGLLayer(i,t,G),i.updateRenderState({baseLayer:m}),e.setPixelRatio(1),e.setSize(m.framebufferWidth,m.framebufferHeight,!1),x=new is(m.framebufferWidth,m.framebufferHeight,{format:Nn,type:vi,colorSpace:e.outputColorSpace,stencilBuffer:f.stencil})}else{let G=null,Q=null,ee=null;f.depth&&(ee=f.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,G=f.stencil?Gs:Is,Q=f.stencil?zs:ns);const oe={colorFormat:t.RGBA8,depthFormat:ee,scaleFactor:s};d=new XRWebGLBinding(i,t),u=d.createProjectionLayer(oe),i.updateRenderState({layers:[u]}),e.setPixelRatio(1),e.setSize(u.textureWidth,u.textureHeight,!1),x=new is(u.textureWidth,u.textureHeight,{format:Nn,type:vi,depthTexture:new Od(u.textureWidth,u.textureHeight,Q,void 0,void 0,void 0,void 0,void 0,void 0,G),stencilBuffer:f.stencil,colorSpace:e.outputColorSpace,samples:f.antialias?4:0,resolveDepthBuffer:u.ignoreDepthValues===!1})}x.isXRRenderTarget=!0,this.setFoveation(c),l=null,o=await i.requestReferenceSpace(a),Y.setContext(i),Y.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(i!==null)return i.environmentBlendMode},this.getDepthTexture=function(){return _.getDepthTexture()};function fe(k){for(let G=0;G<k.removed.length;G++){const Q=k.removed[G],ee=v.indexOf(Q);ee>=0&&(v[ee]=null,y[ee].disconnect(Q))}for(let G=0;G<k.added.length;G++){const Q=k.added[G];let ee=v.indexOf(Q);if(ee===-1){for(let ce=0;ce<y.length;ce++)if(ce>=v.length){v.push(Q),ee=ce;break}else if(v[ce]===null){v[ce]=Q,ee=ce;break}if(ee===-1)break}const oe=y[ee];oe&&oe.connect(Q)}}const z=new P,de=new P;function $(k,G,Q){z.setFromMatrixPosition(G.matrixWorld),de.setFromMatrixPosition(Q.matrixWorld);const ee=z.distanceTo(de),oe=G.projectionMatrix.elements,ce=Q.projectionMatrix.elements,Me=oe[14]/(oe[10]-1),$e=oe[14]/(oe[10]+1),Je=(oe[9]+1)/oe[5],_e=(oe[9]-1)/oe[5],V=(oe[8]-1)/oe[0],Pt=(ce[8]+1)/ce[0],be=Me*V,Te=Me*Pt,xe=ee/(-V+Pt),ke=xe*-V;if(G.matrixWorld.decompose(k.position,k.quaternion,k.scale),k.translateX(ke),k.translateZ(xe),k.matrixWorld.compose(k.position,k.quaternion,k.scale),k.matrixWorldInverse.copy(k.matrixWorld).invert(),oe[10]===-1)k.projectionMatrix.copy(G.projectionMatrix),k.projectionMatrixInverse.copy(G.projectionMatrixInverse);else{const Ue=Me+xe,N=$e+xe,E=be-ke,J=Te+(ee-ke),ue=Je*$e/N*Ue,me=_e*$e/N*Ue;k.projectionMatrix.makePerspective(E,J,ue,me,Ue,N),k.projectionMatrixInverse.copy(k.projectionMatrix).invert()}}function D(k,G){G===null?k.matrixWorld.copy(k.matrix):k.matrixWorld.multiplyMatrices(G.matrixWorld,k.matrix),k.matrixWorldInverse.copy(k.matrixWorld).invert()}this.updateCamera=function(k){if(i===null)return;let G=k.near,Q=k.far;_.texture!==null&&(_.depthNear>0&&(G=_.depthNear),_.depthFar>0&&(Q=_.depthFar)),S.near=O.near=L.near=G,S.far=O.far=L.far=Q,(U!==S.near||Z!==S.far)&&(i.updateRenderState({depthNear:S.near,depthFar:S.far}),U=S.near,Z=S.far),L.layers.mask=k.layers.mask|2,O.layers.mask=k.layers.mask|4,S.layers.mask=L.layers.mask|O.layers.mask;const ee=k.parent,oe=S.cameras;D(S,ee);for(let ce=0;ce<oe.length;ce++)D(oe[ce],ee);oe.length===2?$(S,L,O):S.projectionMatrix.copy(L.projectionMatrix),B(k,S,ee)};function B(k,G,Q){Q===null?k.matrix.copy(G.matrixWorld):(k.matrix.copy(Q.matrixWorld),k.matrix.invert(),k.matrix.multiply(G.matrixWorld)),k.matrix.decompose(k.position,k.quaternion,k.scale),k.updateMatrixWorld(!0),k.projectionMatrix.copy(G.projectionMatrix),k.projectionMatrixInverse.copy(G.projectionMatrixInverse),k.isPerspectiveCamera&&(k.fov=Hs*2*Math.atan(1/k.projectionMatrix.elements[5]),k.zoom=1)}this.getCamera=function(){return S},this.getFoveation=function(){if(!(u===null&&m===null))return c},this.setFoveation=function(k){c=k,u!==null&&(u.fixedFoveation=k),m!==null&&m.fixedFoveation!==void 0&&(m.fixedFoveation=k)},this.hasDepthSensing=function(){return _.texture!==null},this.getDepthSensingMesh=function(){return _.getMesh(S)};let j=null;function X(k,G){if(h=G.getViewerPose(l||o),g=G,h!==null){const Q=h.views;m!==null&&(e.setRenderTargetFramebuffer(x,m.framebuffer),e.setRenderTarget(x));let ee=!1;Q.length!==S.cameras.length&&(S.cameras.length=0,ee=!0);for(let ce=0;ce<Q.length;ce++){const Me=Q[ce];let $e=null;if(m!==null)$e=m.getViewport(Me);else{const _e=d.getViewSubImage(u,Me);$e=_e.viewport,ce===0&&(e.setRenderTargetTextures(x,_e.colorTexture,u.ignoreDepthValues?void 0:_e.depthStencilTexture),e.setRenderTarget(x))}let Je=w[ce];Je===void 0&&(Je=new nn,Je.layers.enable(ce),Je.viewport=new vt,w[ce]=Je),Je.matrix.fromArray(Me.transform.matrix),Je.matrix.decompose(Je.position,Je.quaternion,Je.scale),Je.projectionMatrix.fromArray(Me.projectionMatrix),Je.projectionMatrixInverse.copy(Je.projectionMatrix).invert(),Je.viewport.set($e.x,$e.y,$e.width,$e.height),ce===0&&(S.matrix.copy(Je.matrix),S.matrix.decompose(S.position,S.quaternion,S.scale)),ee===!0&&S.cameras.push(Je)}const oe=i.enabledFeatures;if(oe&&oe.includes("depth-sensing")){const ce=d.getDepthInformation(Q[0]);ce&&ce.isValid&&ce.texture&&_.init(e,ce,i.renderState)}}for(let Q=0;Q<y.length;Q++){const ee=v[Q],oe=y[Q];ee!==null&&oe!==void 0&&oe.update(ee,G,l||o)}j&&j(k,G),G.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:G}),g=null}const Y=new Ud;Y.setAnimationLoop(X),this.setAnimationLoop=function(k){j=k},this.dispose=function(){}}}const ji=new Fn,wx=new Ze;function Ex(r,e){function t(f,p){f.matrixAutoUpdate===!0&&f.updateMatrix(),p.value.copy(f.matrix)}function n(f,p){p.color.getRGB(f.fogColor.value,Dd(r)),p.isFog?(f.fogNear.value=p.near,f.fogFar.value=p.far):p.isFogExp2&&(f.fogDensity.value=p.density)}function i(f,p,x,y,v){p.isMeshBasicMaterial||p.isMeshLambertMaterial?s(f,p):p.isMeshToonMaterial?(s(f,p),d(f,p)):p.isMeshPhongMaterial?(s(f,p),h(f,p)):p.isMeshStandardMaterial?(s(f,p),u(f,p),p.isMeshPhysicalMaterial&&m(f,p,v)):p.isMeshMatcapMaterial?(s(f,p),g(f,p)):p.isMeshDepthMaterial?s(f,p):p.isMeshDistanceMaterial?(s(f,p),_(f,p)):p.isMeshNormalMaterial?s(f,p):p.isLineBasicMaterial?(o(f,p),p.isLineDashedMaterial&&a(f,p)):p.isPointsMaterial?c(f,p,x,y):p.isSpriteMaterial?l(f,p):p.isShadowMaterial?(f.color.value.copy(p.color),f.opacity.value=p.opacity):p.isShaderMaterial&&(p.uniformsNeedUpdate=!1)}function s(f,p){f.opacity.value=p.opacity,p.color&&f.diffuse.value.copy(p.color),p.emissive&&f.emissive.value.copy(p.emissive).multiplyScalar(p.emissiveIntensity),p.map&&(f.map.value=p.map,t(p.map,f.mapTransform)),p.alphaMap&&(f.alphaMap.value=p.alphaMap,t(p.alphaMap,f.alphaMapTransform)),p.bumpMap&&(f.bumpMap.value=p.bumpMap,t(p.bumpMap,f.bumpMapTransform),f.bumpScale.value=p.bumpScale,p.side===Jt&&(f.bumpScale.value*=-1)),p.normalMap&&(f.normalMap.value=p.normalMap,t(p.normalMap,f.normalMapTransform),f.normalScale.value.copy(p.normalScale),p.side===Jt&&f.normalScale.value.negate()),p.displacementMap&&(f.displacementMap.value=p.displacementMap,t(p.displacementMap,f.displacementMapTransform),f.displacementScale.value=p.displacementScale,f.displacementBias.value=p.displacementBias),p.emissiveMap&&(f.emissiveMap.value=p.emissiveMap,t(p.emissiveMap,f.emissiveMapTransform)),p.specularMap&&(f.specularMap.value=p.specularMap,t(p.specularMap,f.specularMapTransform)),p.alphaTest>0&&(f.alphaTest.value=p.alphaTest);const x=e.get(p),y=x.envMap,v=x.envMapRotation;y&&(f.envMap.value=y,ji.copy(v),ji.x*=-1,ji.y*=-1,ji.z*=-1,y.isCubeTexture&&y.isRenderTargetTexture===!1&&(ji.y*=-1,ji.z*=-1),f.envMapRotation.value.setFromMatrix4(wx.makeRotationFromEuler(ji)),f.flipEnvMap.value=y.isCubeTexture&&y.isRenderTargetTexture===!1?-1:1,f.reflectivity.value=p.reflectivity,f.ior.value=p.ior,f.refractionRatio.value=p.refractionRatio),p.lightMap&&(f.lightMap.value=p.lightMap,f.lightMapIntensity.value=p.lightMapIntensity,t(p.lightMap,f.lightMapTransform)),p.aoMap&&(f.aoMap.value=p.aoMap,f.aoMapIntensity.value=p.aoMapIntensity,t(p.aoMap,f.aoMapTransform))}function o(f,p){f.diffuse.value.copy(p.color),f.opacity.value=p.opacity,p.map&&(f.map.value=p.map,t(p.map,f.mapTransform))}function a(f,p){f.dashSize.value=p.dashSize,f.totalSize.value=p.dashSize+p.gapSize,f.scale.value=p.scale}function c(f,p,x,y){f.diffuse.value.copy(p.color),f.opacity.value=p.opacity,f.size.value=p.size*x,f.scale.value=y*.5,p.map&&(f.map.value=p.map,t(p.map,f.uvTransform)),p.alphaMap&&(f.alphaMap.value=p.alphaMap,t(p.alphaMap,f.alphaMapTransform)),p.alphaTest>0&&(f.alphaTest.value=p.alphaTest)}function l(f,p){f.diffuse.value.copy(p.color),f.opacity.value=p.opacity,f.rotation.value=p.rotation,p.map&&(f.map.value=p.map,t(p.map,f.mapTransform)),p.alphaMap&&(f.alphaMap.value=p.alphaMap,t(p.alphaMap,f.alphaMapTransform)),p.alphaTest>0&&(f.alphaTest.value=p.alphaTest)}function h(f,p){f.specular.value.copy(p.specular),f.shininess.value=Math.max(p.shininess,1e-4)}function d(f,p){p.gradientMap&&(f.gradientMap.value=p.gradientMap)}function u(f,p){f.metalness.value=p.metalness,p.metalnessMap&&(f.metalnessMap.value=p.metalnessMap,t(p.metalnessMap,f.metalnessMapTransform)),f.roughness.value=p.roughness,p.roughnessMap&&(f.roughnessMap.value=p.roughnessMap,t(p.roughnessMap,f.roughnessMapTransform)),p.envMap&&(f.envMapIntensity.value=p.envMapIntensity)}function m(f,p,x){f.ior.value=p.ior,p.sheen>0&&(f.sheenColor.value.copy(p.sheenColor).multiplyScalar(p.sheen),f.sheenRoughness.value=p.sheenRoughness,p.sheenColorMap&&(f.sheenColorMap.value=p.sheenColorMap,t(p.sheenColorMap,f.sheenColorMapTransform)),p.sheenRoughnessMap&&(f.sheenRoughnessMap.value=p.sheenRoughnessMap,t(p.sheenRoughnessMap,f.sheenRoughnessMapTransform))),p.clearcoat>0&&(f.clearcoat.value=p.clearcoat,f.clearcoatRoughness.value=p.clearcoatRoughness,p.clearcoatMap&&(f.clearcoatMap.value=p.clearcoatMap,t(p.clearcoatMap,f.clearcoatMapTransform)),p.clearcoatRoughnessMap&&(f.clearcoatRoughnessMap.value=p.clearcoatRoughnessMap,t(p.clearcoatRoughnessMap,f.clearcoatRoughnessMapTransform)),p.clearcoatNormalMap&&(f.clearcoatNormalMap.value=p.clearcoatNormalMap,t(p.clearcoatNormalMap,f.clearcoatNormalMapTransform),f.clearcoatNormalScale.value.copy(p.clearcoatNormalScale),p.side===Jt&&f.clearcoatNormalScale.value.negate())),p.dispersion>0&&(f.dispersion.value=p.dispersion),p.iridescence>0&&(f.iridescence.value=p.iridescence,f.iridescenceIOR.value=p.iridescenceIOR,f.iridescenceThicknessMinimum.value=p.iridescenceThicknessRange[0],f.iridescenceThicknessMaximum.value=p.iridescenceThicknessRange[1],p.iridescenceMap&&(f.iridescenceMap.value=p.iridescenceMap,t(p.iridescenceMap,f.iridescenceMapTransform)),p.iridescenceThicknessMap&&(f.iridescenceThicknessMap.value=p.iridescenceThicknessMap,t(p.iridescenceThicknessMap,f.iridescenceThicknessMapTransform))),p.transmission>0&&(f.transmission.value=p.transmission,f.transmissionSamplerMap.value=x.texture,f.transmissionSamplerSize.value.set(x.width,x.height),p.transmissionMap&&(f.transmissionMap.value=p.transmissionMap,t(p.transmissionMap,f.transmissionMapTransform)),f.thickness.value=p.thickness,p.thicknessMap&&(f.thicknessMap.value=p.thicknessMap,t(p.thicknessMap,f.thicknessMapTransform)),f.attenuationDistance.value=p.attenuationDistance,f.attenuationColor.value.copy(p.attenuationColor)),p.anisotropy>0&&(f.anisotropyVector.value.set(p.anisotropy*Math.cos(p.anisotropyRotation),p.anisotropy*Math.sin(p.anisotropyRotation)),p.anisotropyMap&&(f.anisotropyMap.value=p.anisotropyMap,t(p.anisotropyMap,f.anisotropyMapTransform))),f.specularIntensity.value=p.specularIntensity,f.specularColor.value.copy(p.specularColor),p.specularColorMap&&(f.specularColorMap.value=p.specularColorMap,t(p.specularColorMap,f.specularColorMapTransform)),p.specularIntensityMap&&(f.specularIntensityMap.value=p.specularIntensityMap,t(p.specularIntensityMap,f.specularIntensityMapTransform))}function g(f,p){p.matcap&&(f.matcap.value=p.matcap)}function _(f,p){const x=e.get(p).light;f.referencePosition.value.setFromMatrixPosition(x.matrixWorld),f.nearDistance.value=x.shadow.camera.near,f.farDistance.value=x.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:i}}function Tx(r,e,t,n){let i={},s={},o=[];const a=r.getParameter(r.MAX_UNIFORM_BUFFER_BINDINGS);function c(x,y){const v=y.program;n.uniformBlockBinding(x,v)}function l(x,y){let v=i[x.id];v===void 0&&(g(x),v=h(x),i[x.id]=v,x.addEventListener("dispose",f));const F=y.program;n.updateUBOMapping(x,F);const A=e.render.frame;s[x.id]!==A&&(u(x),s[x.id]=A)}function h(x){const y=d();x.__bindingPointIndex=y;const v=r.createBuffer(),F=x.__size,A=x.usage;return r.bindBuffer(r.UNIFORM_BUFFER,v),r.bufferData(r.UNIFORM_BUFFER,F,A),r.bindBuffer(r.UNIFORM_BUFFER,null),r.bindBufferBase(r.UNIFORM_BUFFER,y,v),v}function d(){for(let x=0;x<a;x++)if(o.indexOf(x)===-1)return o.push(x),x;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function u(x){const y=i[x.id],v=x.uniforms,F=x.__cache;r.bindBuffer(r.UNIFORM_BUFFER,y);for(let A=0,L=v.length;A<L;A++){const O=Array.isArray(v[A])?v[A]:[v[A]];for(let w=0,S=O.length;w<S;w++){const U=O[w];if(m(U,A,w,F)===!0){const Z=U.__offset,K=Array.isArray(U.value)?U.value:[U.value];let se=0;for(let fe=0;fe<K.length;fe++){const z=K[fe],de=_(z);typeof z=="number"||typeof z=="boolean"?(U.__data[0]=z,r.bufferSubData(r.UNIFORM_BUFFER,Z+se,U.__data)):z.isMatrix3?(U.__data[0]=z.elements[0],U.__data[1]=z.elements[1],U.__data[2]=z.elements[2],U.__data[3]=0,U.__data[4]=z.elements[3],U.__data[5]=z.elements[4],U.__data[6]=z.elements[5],U.__data[7]=0,U.__data[8]=z.elements[6],U.__data[9]=z.elements[7],U.__data[10]=z.elements[8],U.__data[11]=0):(z.toArray(U.__data,se),se+=de.storage/Float32Array.BYTES_PER_ELEMENT)}r.bufferSubData(r.UNIFORM_BUFFER,Z,U.__data)}}}r.bindBuffer(r.UNIFORM_BUFFER,null)}function m(x,y,v,F){const A=x.value,L=y+"_"+v;if(F[L]===void 0)return typeof A=="number"||typeof A=="boolean"?F[L]=A:F[L]=A.clone(),!0;{const O=F[L];if(typeof A=="number"||typeof A=="boolean"){if(O!==A)return F[L]=A,!0}else if(O.equals(A)===!1)return O.copy(A),!0}return!1}function g(x){const y=x.uniforms;let v=0;const F=16;for(let L=0,O=y.length;L<O;L++){const w=Array.isArray(y[L])?y[L]:[y[L]];for(let S=0,U=w.length;S<U;S++){const Z=w[S],K=Array.isArray(Z.value)?Z.value:[Z.value];for(let se=0,fe=K.length;se<fe;se++){const z=K[se],de=_(z),$=v%F,D=$%de.boundary,B=$+D;v+=D,B!==0&&F-B<de.storage&&(v+=F-B),Z.__data=new Float32Array(de.storage/Float32Array.BYTES_PER_ELEMENT),Z.__offset=v,v+=de.storage}}}const A=v%F;return A>0&&(v+=F-A),x.__size=v,x.__cache={},this}function _(x){const y={boundary:0,storage:0};return typeof x=="number"||typeof x=="boolean"?(y.boundary=4,y.storage=4):x.isVector2?(y.boundary=8,y.storage=8):x.isVector3||x.isColor?(y.boundary=16,y.storage=12):x.isVector4?(y.boundary=16,y.storage=16):x.isMatrix3?(y.boundary=48,y.storage=48):x.isMatrix4?(y.boundary=64,y.storage=64):x.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",x),y}function f(x){const y=x.target;y.removeEventListener("dispose",f);const v=o.indexOf(y.__bindingPointIndex);o.splice(v,1),r.deleteBuffer(i[y.id]),delete i[y.id],delete s[y.id]}function p(){for(const x in i)r.deleteBuffer(i[x]);o=[],i={},s={}}return{bind:c,update:l,dispose:p}}class Ax{constructor(e={}){const{canvas:t=gf(),context:n=null,depth:i=!0,stencil:s=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:c=!0,preserveDrawingBuffer:l=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:d=!1,reverseDepthBuffer:u=!1}=e;this.isWebGLRenderer=!0;let m;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");m=n.getContextAttributes().alpha}else m=o;const g=new Uint32Array(4),_=new Int32Array(4);let f=null,p=null;const x=[],y=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this._outputColorSpace=It,this.toneMapping=_i,this.toneMappingExposure=1;const v=this;let F=!1,A=0,L=0,O=null,w=-1,S=null;const U=new vt,Z=new vt;let K=null;const se=new qe(0);let fe=0,z=t.width,de=t.height,$=1,D=null,B=null;const j=new vt(0,0,z,de),X=new vt(0,0,z,de);let Y=!1;const k=new tl;let G=!1,Q=!1;const ee=new Ze,oe=new Ze,ce=new P,Me=new vt,$e={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let Je=!1;function _e(){return O===null?$:1}let V=n;function Pt(R,q){return t.getContext(R,q)}try{const R={alpha:!0,depth:i,stencil:s,antialias:a,premultipliedAlpha:c,preserveDrawingBuffer:l,powerPreference:h,failIfMajorPerformanceCaveat:d};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${Wc}`),t.addEventListener("webglcontextlost",pe,!1),t.addEventListener("webglcontextrestored",Pe,!1),t.addEventListener("webglcontextcreationerror",Le,!1),V===null){const q="webgl2";if(V=Pt(q,R),V===null)throw Pt(q)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(R){throw console.error("THREE.WebGLRenderer: "+R.message),R}let be,Te,xe,ke,Ue,N,E,J,ue,me,he,Oe,Ee,De,_t,ye,Ne,Ye,Qe,Re,ct,it,St,W;function Ae(){be=new Pg(V),be.init(),it=new _x(V,be),Te=new Tg(V,be,e,it),xe=new px(V,be),Te.reverseDepthBuffer&&u&&xe.buffers.depth.setReversed(!0),ke=new Fg(V),Ue=new Q_,N=new gx(V,be,xe,Ue,Te,it,ke),E=new Cg(v),J=new Ig(v),ue=new Hf(V),St=new wg(V,ue),me=new Dg(V,ue,ke,St),he=new Og(V,me,ue,ke),Qe=new Ug(V,Te,N),ye=new Ag(Ue),Oe=new J_(v,E,J,be,Te,St,ye),Ee=new Ex(v,Ue),De=new tx,_t=new ax(be),Ye=new Sg(v,E,J,xe,he,m,c),Ne=new ux(v,he,Te),W=new Tx(V,ke,Te,xe),Re=new Eg(V,be,ke),ct=new Ng(V,be,ke),ke.programs=Oe.programs,v.capabilities=Te,v.extensions=be,v.properties=Ue,v.renderLists=De,v.shadowMap=Ne,v.state=xe,v.info=ke}Ae();const ae=new Sx(v,V);this.xr=ae,this.getContext=function(){return V},this.getContextAttributes=function(){return V.getContextAttributes()},this.forceContextLoss=function(){const R=be.get("WEBGL_lose_context");R&&R.loseContext()},this.forceContextRestore=function(){const R=be.get("WEBGL_lose_context");R&&R.restoreContext()},this.getPixelRatio=function(){return $},this.setPixelRatio=function(R){R!==void 0&&($=R,this.setSize(z,de,!1))},this.getSize=function(R){return R.set(z,de)},this.setSize=function(R,q,ne=!0){if(ae.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}z=R,de=q,t.width=Math.floor(R*$),t.height=Math.floor(q*$),ne===!0&&(t.style.width=R+"px",t.style.height=q+"px"),this.setViewport(0,0,R,q)},this.getDrawingBufferSize=function(R){return R.set(z*$,de*$).floor()},this.setDrawingBufferSize=function(R,q,ne){z=R,de=q,$=ne,t.width=Math.floor(R*ne),t.height=Math.floor(q*ne),this.setViewport(0,0,R,q)},this.getCurrentViewport=function(R){return R.copy(U)},this.getViewport=function(R){return R.copy(j)},this.setViewport=function(R,q,ne,ie){R.isVector4?j.set(R.x,R.y,R.z,R.w):j.set(R,q,ne,ie),xe.viewport(U.copy(j).multiplyScalar($).round())},this.getScissor=function(R){return R.copy(X)},this.setScissor=function(R,q,ne,ie){R.isVector4?X.set(R.x,R.y,R.z,R.w):X.set(R,q,ne,ie),xe.scissor(Z.copy(X).multiplyScalar($).round())},this.getScissorTest=function(){return Y},this.setScissorTest=function(R){xe.setScissorTest(Y=R)},this.setOpaqueSort=function(R){D=R},this.setTransparentSort=function(R){B=R},this.getClearColor=function(R){return R.copy(Ye.getClearColor())},this.setClearColor=function(){Ye.setClearColor.apply(Ye,arguments)},this.getClearAlpha=function(){return Ye.getClearAlpha()},this.setClearAlpha=function(){Ye.setClearAlpha.apply(Ye,arguments)},this.clear=function(R=!0,q=!0,ne=!0){let ie=0;if(R){let H=!1;if(O!==null){const ve=O.texture.format;H=ve===Zc||ve===Kc||ve===$c}if(H){const ve=O.texture.type,Ce=ve===vi||ve===ns||ve===Sr||ve===zs||ve===jc||ve===qc,ze=Ye.getClearColor(),He=Ye.getClearAlpha(),nt=ze.r,ht=ze.g,Ve=ze.b;Ce?(g[0]=nt,g[1]=ht,g[2]=Ve,g[3]=He,V.clearBufferuiv(V.COLOR,0,g)):(_[0]=nt,_[1]=ht,_[2]=Ve,_[3]=He,V.clearBufferiv(V.COLOR,0,_))}else ie|=V.COLOR_BUFFER_BIT}q&&(ie|=V.DEPTH_BUFFER_BIT),ne&&(ie|=V.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),V.clear(ie)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",pe,!1),t.removeEventListener("webglcontextrestored",Pe,!1),t.removeEventListener("webglcontextcreationerror",Le,!1),De.dispose(),_t.dispose(),Ue.dispose(),E.dispose(),J.dispose(),he.dispose(),St.dispose(),W.dispose(),Oe.dispose(),ae.dispose(),ae.removeEventListener("sessionstart",Ur),ae.removeEventListener("sessionend",Or),si.stop()};function pe(R){R.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),F=!0}function Pe(){console.log("THREE.WebGLRenderer: Context Restored."),F=!1;const R=ke.autoReset,q=Ne.enabled,ne=Ne.autoUpdate,ie=Ne.needsUpdate,H=Ne.type;Ae(),ke.autoReset=R,Ne.enabled=q,Ne.autoUpdate=ne,Ne.needsUpdate=ie,Ne.type=H}function Le(R){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",R.statusMessage)}function lt(R){const q=R.target;q.removeEventListener("dispose",lt),Ot(q)}function Ot(R){$t(R),Ue.remove(R)}function $t(R){const q=Ue.get(R).programs;q!==void 0&&(q.forEach(function(ne){Oe.releaseProgram(ne)}),R.isShaderMaterial&&Oe.releaseShaderCache(R))}this.renderBufferDirect=function(R,q,ne,ie,H,ve){q===null&&(q=$e);const Ce=H.isMesh&&H.matrixWorld.determinant()<0,ze=Jo(R,q,ne,ie,H);xe.setMaterial(ie,Ce);let He=ne.index,nt=1;if(ie.wireframe===!0){if(He=me.getWireframeAttribute(ne),He===void 0)return;nt=2}const ht=ne.drawRange,Ve=ne.attributes.position;let bt=ht.start*nt,At=(ht.start+ht.count)*nt;ve!==null&&(bt=Math.max(bt,ve.start*nt),At=Math.min(At,(ve.start+ve.count)*nt)),He!==null?(bt=Math.max(bt,0),At=Math.min(At,He.count)):Ve!=null&&(bt=Math.max(bt,0),At=Math.min(At,Ve.count));const Dt=At-bt;if(Dt<0||Dt===1/0)return;St.setup(H,ie,ze,ne,He);let Wt,wt=Re;if(He!==null&&(Wt=ue.get(He),wt=ct,wt.setIndex(Wt)),H.isMesh)ie.wireframe===!0?(xe.setLineWidth(ie.wireframeLinewidth*_e()),wt.setMode(V.LINES)):wt.setMode(V.TRIANGLES);else if(H.isLine){let We=ie.linewidth;We===void 0&&(We=1),xe.setLineWidth(We*_e()),H.isLineSegments?wt.setMode(V.LINES):H.isLineLoop?wt.setMode(V.LINE_LOOP):wt.setMode(V.LINE_STRIP)}else H.isPoints?wt.setMode(V.POINTS):H.isSprite&&wt.setMode(V.TRIANGLES);if(H.isBatchedMesh)if(H._multiDrawInstances!==null)wt.renderMultiDrawInstances(H._multiDrawStarts,H._multiDrawCounts,H._multiDrawCount,H._multiDrawInstances);else if(be.get("WEBGL_multi_draw"))wt.renderMultiDraw(H._multiDrawStarts,H._multiDrawCounts,H._multiDrawCount);else{const We=H._multiDrawStarts,Bn=H._multiDrawCounts,Mt=H._multiDrawCount,Mn=He?ue.get(He).bytesPerElement:1,Mi=Ue.get(ie).currentProgram.getUniforms();for(let hn=0;hn<Mt;hn++)Mi.setValue(V,"_gl_DrawID",hn),wt.render(We[hn]/Mn,Bn[hn])}else if(H.isInstancedMesh)wt.renderInstances(bt,Dt,H.count);else if(ne.isInstancedBufferGeometry){const We=ne._maxInstanceCount!==void 0?ne._maxInstanceCount:1/0,Bn=Math.min(ne.instanceCount,We);wt.renderInstances(bt,Dt,Bn)}else wt.render(bt,Dt)};function ut(R,q,ne){R.transparent===!0&&R.side===sn&&R.forceSinglePass===!1?(R.side=Jt,R.needsUpdate=!0,os(R,q,ne),R.side=ln,R.needsUpdate=!0,os(R,q,ne),R.side=sn):os(R,q,ne)}this.compile=function(R,q,ne=null){ne===null&&(ne=R),p=_t.get(ne),p.init(q),y.push(p),ne.traverseVisible(function(H){H.isLight&&H.layers.test(q.layers)&&(p.pushLight(H),H.castShadow&&p.pushShadow(H))}),R!==ne&&R.traverseVisible(function(H){H.isLight&&H.layers.test(q.layers)&&(p.pushLight(H),H.castShadow&&p.pushShadow(H))}),p.setupLights();const ie=new Set;return R.traverse(function(H){if(!(H.isMesh||H.isPoints||H.isLine||H.isSprite))return;const ve=H.material;if(ve)if(Array.isArray(ve))for(let Ce=0;Ce<ve.length;Ce++){const ze=ve[Ce];ut(ze,ne,H),ie.add(ze)}else ut(ve,ne,H),ie.add(ve)}),y.pop(),p=null,ie},this.compileAsync=function(R,q,ne=null){const ie=this.compile(R,q,ne);return new Promise(H=>{function ve(){if(ie.forEach(function(Ce){Ue.get(Ce).currentProgram.isReady()&&ie.delete(Ce)}),ie.size===0){H(R);return}setTimeout(ve,10)}be.get("KHR_parallel_shader_compile")!==null?ve():setTimeout(ve,10)})};let gn=null;function kn(R){gn&&gn(R)}function Ur(){si.stop()}function Or(){si.start()}const si=new Ud;si.setAnimationLoop(kn),typeof self<"u"&&si.setContext(self),this.setAnimationLoop=function(R){gn=R,ae.setAnimationLoop(R),R===null?si.stop():si.start()},ae.addEventListener("sessionstart",Ur),ae.addEventListener("sessionend",Or),this.render=function(R,q){if(q!==void 0&&q.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(F===!0)return;if(R.matrixWorldAutoUpdate===!0&&R.updateMatrixWorld(),q.parent===null&&q.matrixWorldAutoUpdate===!0&&q.updateMatrixWorld(),ae.enabled===!0&&ae.isPresenting===!0&&(ae.cameraAutoUpdate===!0&&ae.updateCamera(q),q=ae.getCamera()),R.isScene===!0&&R.onBeforeRender(v,R,q,O),p=_t.get(R,y.length),p.init(q),y.push(p),oe.multiplyMatrices(q.projectionMatrix,q.matrixWorldInverse),k.setFromProjectionMatrix(oe),Q=this.localClippingEnabled,G=ye.init(this.clippingPlanes,Q),f=De.get(R,x.length),f.init(),x.push(f),ae.enabled===!0&&ae.isPresenting===!0){const ve=v.xr.getDepthSensingMesh();ve!==null&&$s(ve,q,-1/0,v.sortObjects)}$s(R,q,0,v.sortObjects),f.finish(),v.sortObjects===!0&&f.sort(D,B),Je=ae.enabled===!1||ae.isPresenting===!1||ae.hasDepthSensing()===!1,Je&&Ye.addToRenderList(f,R),this.info.render.frame++,G===!0&&ye.beginShadows();const ne=p.state.shadowsArray;Ne.render(ne,R,q),G===!0&&ye.endShadows(),this.info.autoReset===!0&&this.info.reset();const ie=f.opaque,H=f.transmissive;if(p.setupLights(),q.isArrayCamera){const ve=q.cameras;if(H.length>0)for(let Ce=0,ze=ve.length;Ce<ze;Ce++){const He=ve[Ce];Ks(ie,H,R,He)}Je&&Ye.render(R);for(let Ce=0,ze=ve.length;Ce<ze;Ce++){const He=ve[Ce];kr(f,R,He,He.viewport)}}else H.length>0&&Ks(ie,H,R,q),Je&&Ye.render(R),kr(f,R,q);O!==null&&(N.updateMultisampleRenderTarget(O),N.updateRenderTargetMipmap(O)),R.isScene===!0&&R.onAfterRender(v,R,q),St.resetDefaultState(),w=-1,S=null,y.pop(),y.length>0?(p=y[y.length-1],G===!0&&ye.setGlobalState(v.clippingPlanes,p.state.camera)):p=null,x.pop(),x.length>0?f=x[x.length-1]:f=null};function $s(R,q,ne,ie){if(R.visible===!1)return;if(R.layers.test(q.layers)){if(R.isGroup)ne=R.renderOrder;else if(R.isLOD)R.autoUpdate===!0&&R.update(q);else if(R.isLight)p.pushLight(R),R.castShadow&&p.pushShadow(R);else if(R.isSprite){if(!R.frustumCulled||k.intersectsSprite(R)){ie&&Me.setFromMatrixPosition(R.matrixWorld).applyMatrix4(oe);const Ce=he.update(R),ze=R.material;ze.visible&&f.push(R,Ce,ze,ne,Me.z,null)}}else if((R.isMesh||R.isLine||R.isPoints)&&(!R.frustumCulled||k.intersectsObject(R))){const Ce=he.update(R),ze=R.material;if(ie&&(R.boundingSphere!==void 0?(R.boundingSphere===null&&R.computeBoundingSphere(),Me.copy(R.boundingSphere.center)):(Ce.boundingSphere===null&&Ce.computeBoundingSphere(),Me.copy(Ce.boundingSphere.center)),Me.applyMatrix4(R.matrixWorld).applyMatrix4(oe)),Array.isArray(ze)){const He=Ce.groups;for(let nt=0,ht=He.length;nt<ht;nt++){const Ve=He[nt],bt=ze[Ve.materialIndex];bt&&bt.visible&&f.push(R,Ce,bt,ne,Me.z,Ve)}}else ze.visible&&f.push(R,Ce,ze,ne,Me.z,null)}}const ve=R.children;for(let Ce=0,ze=ve.length;Ce<ze;Ce++)$s(ve[Ce],q,ne,ie)}function kr(R,q,ne,ie){const H=R.opaque,ve=R.transmissive,Ce=R.transparent;p.setupLightsView(ne),G===!0&&ye.setGlobalState(v.clippingPlanes,ne),ie&&xe.viewport(U.copy(ie)),H.length>0&&rs(H,q,ne),ve.length>0&&rs(ve,q,ne),Ce.length>0&&rs(Ce,q,ne),xe.buffers.depth.setTest(!0),xe.buffers.depth.setMask(!0),xe.buffers.color.setMask(!0),xe.setPolygonOffset(!1)}function Ks(R,q,ne,ie){if((ne.isScene===!0?ne.overrideMaterial:null)!==null)return;p.state.transmissionRenderTarget[ie.id]===void 0&&(p.state.transmissionRenderTarget[ie.id]=new is(1,1,{generateMipmaps:!0,type:be.has("EXT_color_buffer_half_float")||be.has("EXT_color_buffer_float")?Rr:vi,minFilter:Yn,samples:4,stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:gt.workingColorSpace}));const ve=p.state.transmissionRenderTarget[ie.id],Ce=ie.viewport||U;ve.setSize(Ce.z,Ce.w);const ze=v.getRenderTarget();v.setRenderTarget(ve),v.getClearColor(se),fe=v.getClearAlpha(),fe<1&&v.setClearColor(16777215,.5),v.clear(),Je&&Ye.render(ne);const He=v.toneMapping;v.toneMapping=_i;const nt=ie.viewport;if(ie.viewport!==void 0&&(ie.viewport=void 0),p.setupLightsView(ie),G===!0&&ye.setGlobalState(v.clippingPlanes,ie),rs(R,ne,ie),N.updateMultisampleRenderTarget(ve),N.updateRenderTargetMipmap(ve),be.has("WEBGL_multisampled_render_to_texture")===!1){let ht=!1;for(let Ve=0,bt=q.length;Ve<bt;Ve++){const At=q[Ve],Dt=At.object,Wt=At.geometry,wt=At.material,We=At.group;if(wt.side===sn&&Dt.layers.test(ie.layers)){const Bn=wt.side;wt.side=Jt,wt.needsUpdate=!0,Zs(Dt,ne,ie,Wt,wt,We),wt.side=Bn,wt.needsUpdate=!0,ht=!0}}ht===!0&&(N.updateMultisampleRenderTarget(ve),N.updateRenderTargetMipmap(ve))}v.setRenderTarget(ze),v.setClearColor(se,fe),nt!==void 0&&(ie.viewport=nt),v.toneMapping=He}function rs(R,q,ne){const ie=q.isScene===!0?q.overrideMaterial:null;for(let H=0,ve=R.length;H<ve;H++){const Ce=R[H],ze=Ce.object,He=Ce.geometry,nt=ie===null?Ce.material:ie,ht=Ce.group;ze.layers.test(ne.layers)&&Zs(ze,q,ne,He,nt,ht)}}function Zs(R,q,ne,ie,H,ve){R.onBeforeRender(v,q,ne,ie,H,ve),R.modelViewMatrix.multiplyMatrices(ne.matrixWorldInverse,R.matrixWorld),R.normalMatrix.getNormalMatrix(R.modelViewMatrix),H.onBeforeRender(v,q,ne,ie,R,ve),H.transparent===!0&&H.side===sn&&H.forceSinglePass===!1?(H.side=Jt,H.needsUpdate=!0,v.renderBufferDirect(ne,q,ie,H,R,ve),H.side=ln,H.needsUpdate=!0,v.renderBufferDirect(ne,q,ie,H,R,ve),H.side=sn):v.renderBufferDirect(ne,q,ie,H,R,ve),R.onAfterRender(v,q,ne,ie,H,ve)}function os(R,q,ne){q.isScene!==!0&&(q=$e);const ie=Ue.get(R),H=p.state.lights,ve=p.state.shadowsArray,Ce=H.state.version,ze=Oe.getParameters(R,H.state,ve,q,ne),He=Oe.getProgramCacheKey(ze);let nt=ie.programs;ie.environment=R.isMeshStandardMaterial?q.environment:null,ie.fog=q.fog,ie.envMap=(R.isMeshStandardMaterial?J:E).get(R.envMap||ie.environment),ie.envMapRotation=ie.environment!==null&&R.envMap===null?q.environmentRotation:R.envMapRotation,nt===void 0&&(R.addEventListener("dispose",lt),nt=new Map,ie.programs=nt);let ht=nt.get(He);if(ht!==void 0){if(ie.currentProgram===ht&&ie.lightsStateVersion===Ce)return zr(R,ze),ht}else ze.uniforms=Oe.getUniforms(R),R.onBeforeCompile(ze,v),ht=Oe.acquireProgram(ze,He),nt.set(He,ht),ie.uniforms=ze.uniforms;const Ve=ie.uniforms;return(!R.isShaderMaterial&&!R.isRawShaderMaterial||R.clipping===!0)&&(Ve.clippingPlanes=ye.uniform),zr(R,ze),ie.needsLights=ea(R),ie.lightsStateVersion=Ce,ie.needsLights&&(Ve.ambientLightColor.value=H.state.ambient,Ve.lightProbe.value=H.state.probe,Ve.directionalLights.value=H.state.directional,Ve.directionalLightShadows.value=H.state.directionalShadow,Ve.spotLights.value=H.state.spot,Ve.spotLightShadows.value=H.state.spotShadow,Ve.rectAreaLights.value=H.state.rectArea,Ve.ltc_1.value=H.state.rectAreaLTC1,Ve.ltc_2.value=H.state.rectAreaLTC2,Ve.pointLights.value=H.state.point,Ve.pointLightShadows.value=H.state.pointShadow,Ve.hemisphereLights.value=H.state.hemi,Ve.directionalShadowMap.value=H.state.directionalShadowMap,Ve.directionalShadowMatrix.value=H.state.directionalShadowMatrix,Ve.spotShadowMap.value=H.state.spotShadowMap,Ve.spotLightMatrix.value=H.state.spotLightMatrix,Ve.spotLightMap.value=H.state.spotLightMap,Ve.pointShadowMap.value=H.state.pointShadowMap,Ve.pointShadowMatrix.value=H.state.pointShadowMatrix),ie.currentProgram=ht,ie.uniformsList=null,ht}function Br(R){if(R.uniformsList===null){const q=R.currentProgram.getUniforms();R.uniformsList=Uo.seqWithValue(q.seq,R.uniforms)}return R.uniformsList}function zr(R,q){const ne=Ue.get(R);ne.outputColorSpace=q.outputColorSpace,ne.batching=q.batching,ne.batchingColor=q.batchingColor,ne.instancing=q.instancing,ne.instancingColor=q.instancingColor,ne.instancingMorph=q.instancingMorph,ne.skinning=q.skinning,ne.morphTargets=q.morphTargets,ne.morphNormals=q.morphNormals,ne.morphColors=q.morphColors,ne.morphTargetsCount=q.morphTargetsCount,ne.numClippingPlanes=q.numClippingPlanes,ne.numIntersection=q.numClipIntersection,ne.vertexAlphas=q.vertexAlphas,ne.vertexTangents=q.vertexTangents,ne.toneMapping=q.toneMapping}function Jo(R,q,ne,ie,H){q.isScene!==!0&&(q=$e),N.resetTextureUnits();const ve=q.fog,Ce=ie.isMeshStandardMaterial?q.environment:null,ze=O===null?v.outputColorSpace:O.isXRRenderTarget===!0?O.texture.colorSpace:mn,He=(ie.isMeshStandardMaterial?J:E).get(ie.envMap||Ce),nt=ie.vertexColors===!0&&!!ne.attributes.color&&ne.attributes.color.itemSize===4,ht=!!ne.attributes.tangent&&(!!ie.normalMap||ie.anisotropy>0),Ve=!!ne.morphAttributes.position,bt=!!ne.morphAttributes.normal,At=!!ne.morphAttributes.color;let Dt=_i;ie.toneMapped&&(O===null||O.isXRRenderTarget===!0)&&(Dt=v.toneMapping);const Wt=ne.morphAttributes.position||ne.morphAttributes.normal||ne.morphAttributes.color,wt=Wt!==void 0?Wt.length:0,We=Ue.get(ie),Bn=p.state.lights;if(G===!0&&(Q===!0||R!==S)){const dn=R===S&&ie.id===w;ye.setState(ie,R,dn)}let Mt=!1;ie.version===We.__version?(We.needsLights&&We.lightsStateVersion!==Bn.state.version||We.outputColorSpace!==ze||H.isBatchedMesh&&We.batching===!1||!H.isBatchedMesh&&We.batching===!0||H.isBatchedMesh&&We.batchingColor===!0&&H.colorTexture===null||H.isBatchedMesh&&We.batchingColor===!1&&H.colorTexture!==null||H.isInstancedMesh&&We.instancing===!1||!H.isInstancedMesh&&We.instancing===!0||H.isSkinnedMesh&&We.skinning===!1||!H.isSkinnedMesh&&We.skinning===!0||H.isInstancedMesh&&We.instancingColor===!0&&H.instanceColor===null||H.isInstancedMesh&&We.instancingColor===!1&&H.instanceColor!==null||H.isInstancedMesh&&We.instancingMorph===!0&&H.morphTexture===null||H.isInstancedMesh&&We.instancingMorph===!1&&H.morphTexture!==null||We.envMap!==He||ie.fog===!0&&We.fog!==ve||We.numClippingPlanes!==void 0&&(We.numClippingPlanes!==ye.numPlanes||We.numIntersection!==ye.numIntersection)||We.vertexAlphas!==nt||We.vertexTangents!==ht||We.morphTargets!==Ve||We.morphNormals!==bt||We.morphColors!==At||We.toneMapping!==Dt||We.morphTargetsCount!==wt)&&(Mt=!0):(Mt=!0,We.__version=ie.version);let Mn=We.currentProgram;Mt===!0&&(Mn=os(ie,q,H));let Mi=!1,hn=!1,Si=!1;const st=Mn.getUniforms(),_n=We.uniforms;if(xe.useProgram(Mn.program)&&(Mi=!0,hn=!0,Si=!0),ie.id!==w&&(w=ie.id,hn=!0),Mi||S!==R){xe.buffers.depth.getReversed()?(ee.copy(R.projectionMatrix),xf(ee),vf(ee),st.setValue(V,"projectionMatrix",ee)):st.setValue(V,"projectionMatrix",R.projectionMatrix),st.setValue(V,"viewMatrix",R.matrixWorldInverse);const zn=st.map.cameraPosition;zn!==void 0&&zn.setValue(V,ce.setFromMatrixPosition(R.matrixWorld)),Te.logarithmicDepthBuffer&&st.setValue(V,"logDepthBufFC",2/(Math.log(R.far+1)/Math.LN2)),(ie.isMeshPhongMaterial||ie.isMeshToonMaterial||ie.isMeshLambertMaterial||ie.isMeshBasicMaterial||ie.isMeshStandardMaterial||ie.isShaderMaterial)&&st.setValue(V,"isOrthographic",R.isOrthographicCamera===!0),S!==R&&(S=R,hn=!0,Si=!0)}if(H.isSkinnedMesh){st.setOptional(V,H,"bindMatrix"),st.setOptional(V,H,"bindMatrixInverse");const dn=H.skeleton;dn&&(dn.boneTexture===null&&dn.computeBoneTexture(),st.setValue(V,"boneTexture",dn.boneTexture,N))}H.isBatchedMesh&&(st.setOptional(V,H,"batchingTexture"),st.setValue(V,"batchingTexture",H._matricesTexture,N),st.setOptional(V,H,"batchingIdTexture"),st.setValue(V,"batchingIdTexture",H._indirectTexture,N),st.setOptional(V,H,"batchingColorTexture"),H._colorsTexture!==null&&st.setValue(V,"batchingColorTexture",H._colorsTexture,N));const Bi=ne.morphAttributes;if((Bi.position!==void 0||Bi.normal!==void 0||Bi.color!==void 0)&&Qe.update(H,ne,Mn),(hn||We.receiveShadow!==H.receiveShadow)&&(We.receiveShadow=H.receiveShadow,st.setValue(V,"receiveShadow",H.receiveShadow)),ie.isMeshGouraudMaterial&&ie.envMap!==null&&(_n.envMap.value=He,_n.flipEnvMap.value=He.isCubeTexture&&He.isRenderTargetTexture===!1?-1:1),ie.isMeshStandardMaterial&&ie.envMap===null&&q.environment!==null&&(_n.envMapIntensity.value=q.environmentIntensity),hn&&(st.setValue(V,"toneMappingExposure",v.toneMappingExposure),We.needsLights&&Qo(_n,Si),ve&&ie.fog===!0&&Ee.refreshFogUniforms(_n,ve),Ee.refreshMaterialUniforms(_n,ie,$,de,p.state.transmissionRenderTarget[R.id]),Uo.upload(V,Br(We),_n,N)),ie.isShaderMaterial&&ie.uniformsNeedUpdate===!0&&(Uo.upload(V,Br(We),_n,N),ie.uniformsNeedUpdate=!1),ie.isSpriteMaterial&&st.setValue(V,"center",H.center),st.setValue(V,"modelViewMatrix",H.modelViewMatrix),st.setValue(V,"normalMatrix",H.normalMatrix),st.setValue(V,"modelMatrix",H.matrixWorld),ie.isShaderMaterial||ie.isRawShaderMaterial){const dn=ie.uniformsGroups;for(let zn=0,Rn=dn.length;zn<Rn;zn++){const zi=dn[zn];W.update(zi,Mn),W.bind(zi,Mn)}}return Mn}function Qo(R,q){R.ambientLightColor.needsUpdate=q,R.lightProbe.needsUpdate=q,R.directionalLights.needsUpdate=q,R.directionalLightShadows.needsUpdate=q,R.pointLights.needsUpdate=q,R.pointLightShadows.needsUpdate=q,R.spotLights.needsUpdate=q,R.spotLightShadows.needsUpdate=q,R.rectAreaLights.needsUpdate=q,R.hemisphereLights.needsUpdate=q}function ea(R){return R.isMeshLambertMaterial||R.isMeshToonMaterial||R.isMeshPhongMaterial||R.isMeshStandardMaterial||R.isShadowMaterial||R.isShaderMaterial&&R.lights===!0}this.getActiveCubeFace=function(){return A},this.getActiveMipmapLevel=function(){return L},this.getRenderTarget=function(){return O},this.setRenderTargetTextures=function(R,q,ne){Ue.get(R.texture).__webglTexture=q,Ue.get(R.depthTexture).__webglTexture=ne;const ie=Ue.get(R);ie.__hasExternalTextures=!0,ie.__autoAllocateDepthBuffer=ne===void 0,ie.__autoAllocateDepthBuffer||be.has("WEBGL_multisampled_render_to_texture")===!0&&(console.warn("THREE.WebGLRenderer: Render-to-texture extension was disabled because an external texture was provided"),ie.__useRenderToTexture=!1)},this.setRenderTargetFramebuffer=function(R,q){const ne=Ue.get(R);ne.__webglFramebuffer=q,ne.__useDefaultFramebuffer=q===void 0},this.setRenderTarget=function(R,q=0,ne=0){O=R,A=q,L=ne;let ie=!0,H=null,ve=!1,Ce=!1;if(R){const He=Ue.get(R);if(He.__useDefaultFramebuffer!==void 0)xe.bindFramebuffer(V.FRAMEBUFFER,null),ie=!1;else if(He.__webglFramebuffer===void 0)N.setupRenderTarget(R);else if(He.__hasExternalTextures)N.rebindTextures(R,Ue.get(R.texture).__webglTexture,Ue.get(R.depthTexture).__webglTexture);else if(R.depthBuffer){const Ve=R.depthTexture;if(He.__boundDepthTexture!==Ve){if(Ve!==null&&Ue.has(Ve)&&(R.width!==Ve.image.width||R.height!==Ve.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");N.setupDepthRenderbuffer(R)}}const nt=R.texture;(nt.isData3DTexture||nt.isDataArrayTexture||nt.isCompressedArrayTexture)&&(Ce=!0);const ht=Ue.get(R).__webglFramebuffer;R.isWebGLCubeRenderTarget?(Array.isArray(ht[q])?H=ht[q][ne]:H=ht[q],ve=!0):R.samples>0&&N.useMultisampledRTT(R)===!1?H=Ue.get(R).__webglMultisampledFramebuffer:Array.isArray(ht)?H=ht[ne]:H=ht,U.copy(R.viewport),Z.copy(R.scissor),K=R.scissorTest}else U.copy(j).multiplyScalar($).floor(),Z.copy(X).multiplyScalar($).floor(),K=Y;if(xe.bindFramebuffer(V.FRAMEBUFFER,H)&&ie&&xe.drawBuffers(R,H),xe.viewport(U),xe.scissor(Z),xe.setScissorTest(K),ve){const He=Ue.get(R.texture);V.framebufferTexture2D(V.FRAMEBUFFER,V.COLOR_ATTACHMENT0,V.TEXTURE_CUBE_MAP_POSITIVE_X+q,He.__webglTexture,ne)}else if(Ce){const He=Ue.get(R.texture),nt=q||0;V.framebufferTextureLayer(V.FRAMEBUFFER,V.COLOR_ATTACHMENT0,He.__webglTexture,ne||0,nt)}w=-1},this.readRenderTargetPixels=function(R,q,ne,ie,H,ve,Ce){if(!(R&&R.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let ze=Ue.get(R).__webglFramebuffer;if(R.isWebGLCubeRenderTarget&&Ce!==void 0&&(ze=ze[Ce]),ze){xe.bindFramebuffer(V.FRAMEBUFFER,ze);try{const He=R.texture,nt=He.format,ht=He.type;if(!Te.textureFormatReadable(nt)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!Te.textureTypeReadable(ht)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}q>=0&&q<=R.width-ie&&ne>=0&&ne<=R.height-H&&V.readPixels(q,ne,ie,H,it.convert(nt),it.convert(ht),ve)}finally{const He=O!==null?Ue.get(O).__webglFramebuffer:null;xe.bindFramebuffer(V.FRAMEBUFFER,He)}}},this.readRenderTargetPixelsAsync=async function(R,q,ne,ie,H,ve,Ce){if(!(R&&R.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let ze=Ue.get(R).__webglFramebuffer;if(R.isWebGLCubeRenderTarget&&Ce!==void 0&&(ze=ze[Ce]),ze){const He=R.texture,nt=He.format,ht=He.type;if(!Te.textureFormatReadable(nt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!Te.textureTypeReadable(ht))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");if(q>=0&&q<=R.width-ie&&ne>=0&&ne<=R.height-H){xe.bindFramebuffer(V.FRAMEBUFFER,ze);const Ve=V.createBuffer();V.bindBuffer(V.PIXEL_PACK_BUFFER,Ve),V.bufferData(V.PIXEL_PACK_BUFFER,ve.byteLength,V.STREAM_READ),V.readPixels(q,ne,ie,H,it.convert(nt),it.convert(ht),0);const bt=O!==null?Ue.get(O).__webglFramebuffer:null;xe.bindFramebuffer(V.FRAMEBUFFER,bt);const At=V.fenceSync(V.SYNC_GPU_COMMANDS_COMPLETE,0);return V.flush(),await _f(V,At,4),V.bindBuffer(V.PIXEL_PACK_BUFFER,Ve),V.getBufferSubData(V.PIXEL_PACK_BUFFER,0,ve),V.deleteBuffer(Ve),V.deleteSync(At),ve}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")}},this.copyFramebufferToTexture=function(R,q=null,ne=0){R.isTexture!==!0&&(fr("WebGLRenderer: copyFramebufferToTexture function signature has changed."),q=arguments[0]||null,R=arguments[1]);const ie=Math.pow(2,-ne),H=Math.floor(R.image.width*ie),ve=Math.floor(R.image.height*ie),Ce=q!==null?q.x:0,ze=q!==null?q.y:0;N.setTexture2D(R,0),V.copyTexSubImage2D(V.TEXTURE_2D,ne,0,0,Ce,ze,H,ve),xe.unbindTexture()},this.copyTextureToTexture=function(R,q,ne=null,ie=null,H=0){R.isTexture!==!0&&(fr("WebGLRenderer: copyTextureToTexture function signature has changed."),ie=arguments[0]||null,R=arguments[1],q=arguments[2],H=arguments[3]||0,ne=null);let ve,Ce,ze,He,nt,ht,Ve,bt,At;const Dt=R.isCompressedTexture?R.mipmaps[H]:R.image;ne!==null?(ve=ne.max.x-ne.min.x,Ce=ne.max.y-ne.min.y,ze=ne.isBox3?ne.max.z-ne.min.z:1,He=ne.min.x,nt=ne.min.y,ht=ne.isBox3?ne.min.z:0):(ve=Dt.width,Ce=Dt.height,ze=Dt.depth||1,He=0,nt=0,ht=0),ie!==null?(Ve=ie.x,bt=ie.y,At=ie.z):(Ve=0,bt=0,At=0);const Wt=it.convert(q.format),wt=it.convert(q.type);let We;q.isData3DTexture?(N.setTexture3D(q,0),We=V.TEXTURE_3D):q.isDataArrayTexture||q.isCompressedArrayTexture?(N.setTexture2DArray(q,0),We=V.TEXTURE_2D_ARRAY):(N.setTexture2D(q,0),We=V.TEXTURE_2D),V.pixelStorei(V.UNPACK_FLIP_Y_WEBGL,q.flipY),V.pixelStorei(V.UNPACK_PREMULTIPLY_ALPHA_WEBGL,q.premultiplyAlpha),V.pixelStorei(V.UNPACK_ALIGNMENT,q.unpackAlignment);const Bn=V.getParameter(V.UNPACK_ROW_LENGTH),Mt=V.getParameter(V.UNPACK_IMAGE_HEIGHT),Mn=V.getParameter(V.UNPACK_SKIP_PIXELS),Mi=V.getParameter(V.UNPACK_SKIP_ROWS),hn=V.getParameter(V.UNPACK_SKIP_IMAGES);V.pixelStorei(V.UNPACK_ROW_LENGTH,Dt.width),V.pixelStorei(V.UNPACK_IMAGE_HEIGHT,Dt.height),V.pixelStorei(V.UNPACK_SKIP_PIXELS,He),V.pixelStorei(V.UNPACK_SKIP_ROWS,nt),V.pixelStorei(V.UNPACK_SKIP_IMAGES,ht);const Si=R.isDataArrayTexture||R.isData3DTexture,st=q.isDataArrayTexture||q.isData3DTexture;if(R.isRenderTargetTexture||R.isDepthTexture){const _n=Ue.get(R),Bi=Ue.get(q),dn=Ue.get(_n.__renderTarget),zn=Ue.get(Bi.__renderTarget);xe.bindFramebuffer(V.READ_FRAMEBUFFER,dn.__webglFramebuffer),xe.bindFramebuffer(V.DRAW_FRAMEBUFFER,zn.__webglFramebuffer);for(let Rn=0;Rn<ze;Rn++)Si&&V.framebufferTextureLayer(V.READ_FRAMEBUFFER,V.COLOR_ATTACHMENT0,Ue.get(R).__webglTexture,H,ht+Rn),R.isDepthTexture?(st&&V.framebufferTextureLayer(V.DRAW_FRAMEBUFFER,V.COLOR_ATTACHMENT0,Ue.get(q).__webglTexture,H,At+Rn),V.blitFramebuffer(He,nt,ve,Ce,Ve,bt,ve,Ce,V.DEPTH_BUFFER_BIT,V.NEAREST)):st?V.copyTexSubImage3D(We,H,Ve,bt,At+Rn,He,nt,ve,Ce):V.copyTexSubImage2D(We,H,Ve,bt,At+Rn,He,nt,ve,Ce);xe.bindFramebuffer(V.READ_FRAMEBUFFER,null),xe.bindFramebuffer(V.DRAW_FRAMEBUFFER,null)}else st?R.isDataTexture||R.isData3DTexture?V.texSubImage3D(We,H,Ve,bt,At,ve,Ce,ze,Wt,wt,Dt.data):q.isCompressedArrayTexture?V.compressedTexSubImage3D(We,H,Ve,bt,At,ve,Ce,ze,Wt,Dt.data):V.texSubImage3D(We,H,Ve,bt,At,ve,Ce,ze,Wt,wt,Dt):R.isDataTexture?V.texSubImage2D(V.TEXTURE_2D,H,Ve,bt,ve,Ce,Wt,wt,Dt.data):R.isCompressedTexture?V.compressedTexSubImage2D(V.TEXTURE_2D,H,Ve,bt,Dt.width,Dt.height,Wt,Dt.data):V.texSubImage2D(V.TEXTURE_2D,H,Ve,bt,ve,Ce,Wt,wt,Dt);V.pixelStorei(V.UNPACK_ROW_LENGTH,Bn),V.pixelStorei(V.UNPACK_IMAGE_HEIGHT,Mt),V.pixelStorei(V.UNPACK_SKIP_PIXELS,Mn),V.pixelStorei(V.UNPACK_SKIP_ROWS,Mi),V.pixelStorei(V.UNPACK_SKIP_IMAGES,hn),H===0&&q.generateMipmaps&&V.generateMipmap(We),xe.unbindTexture()},this.copyTextureToTexture3D=function(R,q,ne=null,ie=null,H=0){return R.isTexture!==!0&&(fr("WebGLRenderer: copyTextureToTexture3D function signature has changed."),ne=arguments[0]||null,ie=arguments[1]||null,R=arguments[2],q=arguments[3],H=arguments[4]||0),fr('WebGLRenderer: copyTextureToTexture3D function has been deprecated. Use "copyTextureToTexture" instead.'),this.copyTextureToTexture(R,q,ne,ie,H)},this.initRenderTarget=function(R){Ue.get(R).__webglFramebuffer===void 0&&N.setupRenderTarget(R)},this.initTexture=function(R){R.isCubeTexture?N.setTextureCube(R,0):R.isData3DTexture?N.setTexture3D(R,0):R.isDataArrayTexture||R.isCompressedArrayTexture?N.setTexture2DArray(R,0):N.setTexture2D(R,0),xe.unbindTexture()},this.resetState=function(){A=0,L=0,O=null,xe.reset(),St.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return gi}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;const t=this.getContext();t.drawingBufferColorspace=gt._getDrawingBufferColorSpace(e),t.unpackColorSpace=gt._getUnpackColorSpace()}}class Hd extends Ut{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Fn,this.environmentIntensity=1,this.environmentRotation=new Fn,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){const t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}}class il{constructor(e,t){this.isInterleavedBuffer=!0,this.array=e,this.stride=t,this.count=e!==void 0?e.length/t:0,this.usage=Dc,this.updateRanges=[],this.version=0,this.uuid=Zn()}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.array=new e.array.constructor(e.array),this.count=e.count,this.stride=e.stride,this.usage=e.usage,this}copyAt(e,t,n){e*=this.stride,n*=t.stride;for(let i=0,s=this.stride;i<s;i++)this.array[e+i]=t.array[n+i];return this}set(e,t=0){return this.array.set(e,t),this}clone(e){e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=Zn()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);const t=new this.array.constructor(e.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(t,this.stride);return n.setUsage(this.usage),n}onUpload(e){return this.onUploadCallback=e,this}toJSON(e){return e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=Zn()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}}const un=new P;class Kn{constructor(e,t,n,i=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=e,this.itemSize=t,this.offset=n,this.normalized=i}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(e){this.data.needsUpdate=e}applyMatrix4(e){for(let t=0,n=this.data.count;t<n;t++)un.fromBufferAttribute(this,t),un.applyMatrix4(e),this.setXYZ(t,un.x,un.y,un.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)un.fromBufferAttribute(this,t),un.applyNormalMatrix(e),this.setXYZ(t,un.x,un.y,un.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)un.fromBufferAttribute(this,t),un.transformDirection(e),this.setXYZ(t,un.x,un.y,un.z);return this}getComponent(e,t){let n=this.array[e*this.data.stride+this.offset+t];return this.normalized&&(n=qn(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=Rt(n,this.array)),this.data.array[e*this.data.stride+this.offset+t]=n,this}setX(e,t){return this.normalized&&(t=Rt(t,this.array)),this.data.array[e*this.data.stride+this.offset]=t,this}setY(e,t){return this.normalized&&(t=Rt(t,this.array)),this.data.array[e*this.data.stride+this.offset+1]=t,this}setZ(e,t){return this.normalized&&(t=Rt(t,this.array)),this.data.array[e*this.data.stride+this.offset+2]=t,this}setW(e,t){return this.normalized&&(t=Rt(t,this.array)),this.data.array[e*this.data.stride+this.offset+3]=t,this}getX(e){let t=this.data.array[e*this.data.stride+this.offset];return this.normalized&&(t=qn(t,this.array)),t}getY(e){let t=this.data.array[e*this.data.stride+this.offset+1];return this.normalized&&(t=qn(t,this.array)),t}getZ(e){let t=this.data.array[e*this.data.stride+this.offset+2];return this.normalized&&(t=qn(t,this.array)),t}getW(e){let t=this.data.array[e*this.data.stride+this.offset+3];return this.normalized&&(t=qn(t,this.array)),t}setXY(e,t,n){return e=e*this.data.stride+this.offset,this.normalized&&(t=Rt(t,this.array),n=Rt(n,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this}setXYZ(e,t,n,i){return e=e*this.data.stride+this.offset,this.normalized&&(t=Rt(t,this.array),n=Rt(n,this.array),i=Rt(i,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=i,this}setXYZW(e,t,n,i,s){return e=e*this.data.stride+this.offset,this.normalized&&(t=Rt(t,this.array),n=Rt(n,this.array),i=Rt(i,this.array),s=Rt(s,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=i,this.data.array[e+3]=s,this}clone(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");const t=[];for(let n=0;n<this.count;n++){const i=n*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)t.push(this.data.array[i+s])}return new yt(new this.array.constructor(t),this.itemSize,this.normalized)}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.clone(e)),new Kn(e.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");const t=[];for(let n=0;n<this.count;n++){const i=n*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)t.push(this.data.array[i+s])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:t,normalized:this.normalized}}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.toJSON(e)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}}class Vd extends Ft{static get type(){return"SpriteMaterial"}constructor(e){super(),this.isSpriteMaterial=!0,this.color=new qe(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.rotation=e.rotation,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}}let Ms;const nr=new P,Ss=new P,ws=new P,Es=new Ge,ir=new Ge,Wd=new Ze,lo=new P,sr=new P,ho=new P,_h=new Ge,Ra=new Ge,xh=new Ge;class Cx extends Ut{constructor(e=new Vd){if(super(),this.isSprite=!0,this.type="Sprite",Ms===void 0){Ms=new at;const t=new Float32Array([-.5,-.5,0,0,0,.5,-.5,0,1,0,.5,.5,0,1,1,-.5,.5,0,0,1]),n=new il(t,5);Ms.setIndex([0,1,2,0,2,3]),Ms.setAttribute("position",new Kn(n,3,0,!1)),Ms.setAttribute("uv",new Kn(n,2,3,!1))}this.geometry=Ms,this.material=e,this.center=new Ge(.5,.5)}raycast(e,t){e.camera===null&&console.error('THREE.Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'),Ss.setFromMatrixScale(this.matrixWorld),Wd.copy(e.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(e.camera.matrixWorldInverse,this.matrixWorld),ws.setFromMatrixPosition(this.modelViewMatrix),e.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1&&Ss.multiplyScalar(-ws.z);const n=this.material.rotation;let i,s;n!==0&&(s=Math.cos(n),i=Math.sin(n));const o=this.center;uo(lo.set(-.5,-.5,0),ws,o,Ss,i,s),uo(sr.set(.5,-.5,0),ws,o,Ss,i,s),uo(ho.set(.5,.5,0),ws,o,Ss,i,s),_h.set(0,0),Ra.set(1,0),xh.set(1,1);let a=e.ray.intersectTriangle(lo,sr,ho,!1,nr);if(a===null&&(uo(sr.set(-.5,.5,0),ws,o,Ss,i,s),Ra.set(0,1),a=e.ray.intersectTriangle(lo,ho,sr,!1,nr),a===null))return;const c=e.ray.origin.distanceTo(nr);c<e.near||c>e.far||t.push({distance:c,point:nr.clone(),uv:Tn.getInterpolation(nr,lo,sr,ho,_h,Ra,xh,new Ge),face:null,object:this})}copy(e,t){return super.copy(e,t),e.center!==void 0&&this.center.copy(e.center),this.material=e.material,this}}function uo(r,e,t,n,i,s){Es.subVectors(r,t).addScalar(.5).multiply(n),i!==void 0?(ir.x=s*Es.x-i*Es.y,ir.y=i*Es.x+s*Es.y):ir.copy(Es),r.copy(e),r.x+=ir.x,r.y+=ir.y,r.applyMatrix4(Wd)}const vh=new P,yh=new vt,bh=new vt,Rx=new P,Mh=new Ze,fo=new P,La=new On,Sh=new Ze,Ia=new Lr;class Xd extends rt{constructor(e,t){super(e,t),this.isSkinnedMesh=!0,this.type="SkinnedMesh",this.bindMode=vl,this.bindMatrix=new Ze,this.bindMatrixInverse=new Ze,this.boundingBox=null,this.boundingSphere=null}computeBoundingBox(){const e=this.geometry;this.boundingBox===null&&(this.boundingBox=new Un),this.boundingBox.makeEmpty();const t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,fo),this.boundingBox.expandByPoint(fo)}computeBoundingSphere(){const e=this.geometry;this.boundingSphere===null&&(this.boundingSphere=new On),this.boundingSphere.makeEmpty();const t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,fo),this.boundingSphere.expandByPoint(fo)}copy(e,t){return super.copy(e,t),this.bindMode=e.bindMode,this.bindMatrix.copy(e.bindMatrix),this.bindMatrixInverse.copy(e.bindMatrixInverse),this.skeleton=e.skeleton,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}raycast(e,t){const n=this.material,i=this.matrixWorld;n!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),La.copy(this.boundingSphere),La.applyMatrix4(i),e.ray.intersectsSphere(La)!==!1&&(Sh.copy(i).invert(),Ia.copy(e.ray).applyMatrix4(Sh),!(this.boundingBox!==null&&Ia.intersectsBox(this.boundingBox)===!1)&&this._computeIntersections(e,t,Ia)))}getVertexPosition(e,t){return super.getVertexPosition(e,t),this.applyBoneTransform(e,t),t}bind(e,t){this.skeleton=e,t===void 0&&(this.updateMatrixWorld(!0),this.skeleton.calculateInverses(),t=this.matrixWorld),this.bindMatrix.copy(t),this.bindMatrixInverse.copy(t).invert()}pose(){this.skeleton.pose()}normalizeSkinWeights(){const e=new vt,t=this.geometry.attributes.skinWeight;for(let n=0,i=t.count;n<i;n++){e.fromBufferAttribute(t,n);const s=1/e.manhattanLength();s!==1/0?e.multiplyScalar(s):e.set(1,0,0,0),t.setXYZW(n,e.x,e.y,e.z,e.w)}}updateMatrixWorld(e){super.updateMatrixWorld(e),this.bindMode===vl?this.bindMatrixInverse.copy(this.matrixWorld).invert():this.bindMode===zu?this.bindMatrixInverse.copy(this.bindMatrix).invert():console.warn("THREE.SkinnedMesh: Unrecognized bindMode: "+this.bindMode)}applyBoneTransform(e,t){const n=this.skeleton,i=this.geometry;yh.fromBufferAttribute(i.attributes.skinIndex,e),bh.fromBufferAttribute(i.attributes.skinWeight,e),vh.copy(t).applyMatrix4(this.bindMatrix),t.set(0,0,0);for(let s=0;s<4;s++){const o=bh.getComponent(s);if(o!==0){const a=yh.getComponent(s);Mh.multiplyMatrices(n.bones[a].matrixWorld,n.boneInverses[a]),t.addScaledVector(Rx.copy(vh).applyMatrix4(Mh),o)}}return t.applyMatrix4(this.bindMatrixInverse)}}class sl extends Ut{constructor(){super(),this.isBone=!0,this.type="Bone"}}class rl extends jt{constructor(e=null,t=1,n=1,i,s,o,a,c,l=pn,h=pn,d,u){super(null,o,a,c,l,h,i,s,d,u),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}const wh=new Ze,Lx=new Ze;class Ko{constructor(e=[],t=[]){this.uuid=Zn(),this.bones=e.slice(0),this.boneInverses=t,this.boneMatrices=null,this.boneTexture=null,this.init()}init(){const e=this.bones,t=this.boneInverses;if(this.boneMatrices=new Float32Array(e.length*16),t.length===0)this.calculateInverses();else if(e.length!==t.length){console.warn("THREE.Skeleton: Number of inverse bone matrices does not match amount of bones."),this.boneInverses=[];for(let n=0,i=this.bones.length;n<i;n++)this.boneInverses.push(new Ze)}}calculateInverses(){this.boneInverses.length=0;for(let e=0,t=this.bones.length;e<t;e++){const n=new Ze;this.bones[e]&&n.copy(this.bones[e].matrixWorld).invert(),this.boneInverses.push(n)}}pose(){for(let e=0,t=this.bones.length;e<t;e++){const n=this.bones[e];n&&n.matrixWorld.copy(this.boneInverses[e]).invert()}for(let e=0,t=this.bones.length;e<t;e++){const n=this.bones[e];n&&(n.parent&&n.parent.isBone?(n.matrix.copy(n.parent.matrixWorld).invert(),n.matrix.multiply(n.matrixWorld)):n.matrix.copy(n.matrixWorld),n.matrix.decompose(n.position,n.quaternion,n.scale))}}update(){const e=this.bones,t=this.boneInverses,n=this.boneMatrices,i=this.boneTexture;for(let s=0,o=e.length;s<o;s++){const a=e[s]?e[s].matrixWorld:Lx;wh.multiplyMatrices(a,t[s]),wh.toArray(n,s*16)}i!==null&&(i.needsUpdate=!0)}clone(){return new Ko(this.bones,this.boneInverses)}computeBoneTexture(){let e=Math.sqrt(this.bones.length*4);e=Math.ceil(e/4)*4,e=Math.max(e,4);const t=new Float32Array(e*e*4);t.set(this.boneMatrices);const n=new rl(t,e,e,Nn,$n);return n.needsUpdate=!0,this.boneMatrices=t,this.boneTexture=n,this}getBoneByName(e){for(let t=0,n=this.bones.length;t<n;t++){const i=this.bones[t];if(i.name===e)return i}}dispose(){this.boneTexture!==null&&(this.boneTexture.dispose(),this.boneTexture=null)}fromJSON(e,t){this.uuid=e.uuid;for(let n=0,i=e.bones.length;n<i;n++){const s=e.bones[n];let o=t[s];o===void 0&&(console.warn("THREE.Skeleton: No bone found with UUID:",s),o=new sl),this.bones.push(o),this.boneInverses.push(new Ze().fromArray(e.boneInverses[n]))}return this.init(),this}toJSON(){const e={metadata:{version:4.6,type:"Skeleton",generator:"Skeleton.toJSON"},bones:[],boneInverses:[]};e.uuid=this.uuid;const t=this.bones,n=this.boneInverses;for(let i=0,s=t.length;i<s;i++){const o=t[i];e.bones.push(o.uuid);const a=n[i];e.boneInverses.push(a.toArray())}return e}}class Fc extends yt{constructor(e,t,n,i=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=i}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){const e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}}const Ts=new Ze,Eh=new Ze,po=[],Th=new Un,Ix=new Ze,rr=new rt,or=new On;class Px extends rt{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new Fc(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let i=0;i<n;i++)this.setMatrixAt(i,Ix)}computeBoundingBox(){const e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new Un),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Ts),Th.copy(e.boundingBox).applyMatrix4(Ts),this.boundingBox.union(Th)}computeBoundingSphere(){const e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new On),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Ts),or.copy(e.boundingSphere).applyMatrix4(Ts),this.boundingSphere.union(or)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),e.morphTexture!==null&&(this.morphTexture=e.morphTexture.clone()),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,t){t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){t.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,t){const n=t.morphTargetInfluences,i=this.morphTexture.source.data.data,s=n.length+1,o=e*s+1;for(let a=0;a<n.length;a++)n[a]=i[o+a]}raycast(e,t){const n=this.matrixWorld,i=this.count;if(rr.geometry=this.geometry,rr.material=this.material,rr.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),or.copy(this.boundingSphere),or.applyMatrix4(n),e.ray.intersectsSphere(or)!==!1))for(let s=0;s<i;s++){this.getMatrixAt(s,Ts),Eh.multiplyMatrices(n,Ts),rr.matrixWorld=Eh,rr.raycast(e,po);for(let o=0,a=po.length;o<a;o++){const c=po[o];c.instanceId=s,c.object=this,t.push(c)}po.length=0}}setColorAt(e,t){this.instanceColor===null&&(this.instanceColor=new Fc(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),t.toArray(this.instanceColor.array,e*3)}setMatrixAt(e,t){t.toArray(this.instanceMatrix.array,e*16)}setMorphAt(e,t){const n=t.morphTargetInfluences,i=n.length+1;this.morphTexture===null&&(this.morphTexture=new rl(new Float32Array(i*this.count),i,this.count,Yc,$n));const s=this.morphTexture.source.data.data;let o=0;for(let l=0;l<n.length;l++)o+=n[l];const a=this.geometry.morphTargetsRelative?1:1-o,c=i*e;s[c]=a,s.set(n,c+1)}updateMorphTargets(){}dispose(){return this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null),this}}class zt extends Ft{static get type(){return"LineBasicMaterial"}constructor(e){super(),this.isLineBasicMaterial=!0,this.color=new qe(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}}const Go=new P,Ho=new P,Ah=new Ze,ar=new Lr,mo=new On,Pa=new P,Ch=new P;class An extends Ut{constructor(e=new at,t=new zt){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){const e=this.geometry;if(e.index===null){const t=e.attributes.position,n=[0];for(let i=1,s=t.count;i<s;i++)Go.fromBufferAttribute(t,i-1),Ho.fromBufferAttribute(t,i),n[i]=n[i-1],n[i]+=Go.distanceTo(Ho);e.setAttribute("lineDistance",new ot(n,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(e,t){const n=this.geometry,i=this.matrixWorld,s=e.params.Line.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),mo.copy(n.boundingSphere),mo.applyMatrix4(i),mo.radius+=s,e.ray.intersectsSphere(mo)===!1)return;Ah.copy(i).invert(),ar.copy(e.ray).applyMatrix4(Ah);const a=s/((this.scale.x+this.scale.y+this.scale.z)/3),c=a*a,l=this.isLineSegments?2:1,h=n.index,u=n.attributes.position;if(h!==null){const m=Math.max(0,o.start),g=Math.min(h.count,o.start+o.count);for(let _=m,f=g-1;_<f;_+=l){const p=h.getX(_),x=h.getX(_+1),y=go(this,e,ar,c,p,x);y&&t.push(y)}if(this.isLineLoop){const _=h.getX(g-1),f=h.getX(m),p=go(this,e,ar,c,_,f);p&&t.push(p)}}else{const m=Math.max(0,o.start),g=Math.min(u.count,o.start+o.count);for(let _=m,f=g-1;_<f;_+=l){const p=go(this,e,ar,c,_,_+1);p&&t.push(p)}if(this.isLineLoop){const _=go(this,e,ar,c,g-1,m);_&&t.push(_)}}}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=i.length;s<o;s++){const a=i[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}}function go(r,e,t,n,i,s){const o=r.geometry.attributes.position;if(Go.fromBufferAttribute(o,i),Ho.fromBufferAttribute(o,s),t.distanceSqToSegment(Go,Ho,Pa,Ch)>n)return;Pa.applyMatrix4(r.matrixWorld);const c=e.ray.origin.distanceTo(Pa);if(!(c<e.near||c>e.far))return{distance:c,point:Ch.clone().applyMatrix4(r.matrixWorld),index:i,face:null,faceIndex:null,barycoord:null,object:r}}const Rh=new P,Lh=new P;class Vt extends An{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){const e=this.geometry;if(e.index===null){const t=e.attributes.position,n=[];for(let i=0,s=t.count;i<s;i+=2)Rh.fromBufferAttribute(t,i),Lh.fromBufferAttribute(t,i+1),n[i]=i===0?0:n[i-1],n[i+1]=n[i]+Rh.distanceTo(Lh);e.setAttribute("lineDistance",new ot(n,1))}else console.warn("THREE.LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}}class Dx extends An{constructor(e,t){super(e,t),this.isLineLoop=!0,this.type="LineLoop"}}class Ni extends Ft{static get type(){return"PointsMaterial"}constructor(e){super(),this.isPointsMaterial=!0,this.color=new qe(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.size=e.size,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}}const Ih=new Ze,Uc=new Lr,_o=new On,xo=new P;class Ns extends Ut{constructor(e=new at,t=new Ni){super(),this.isPoints=!0,this.type="Points",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}raycast(e,t){const n=this.geometry,i=this.matrixWorld,s=e.params.Points.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),_o.copy(n.boundingSphere),_o.applyMatrix4(i),_o.radius+=s,e.ray.intersectsSphere(_o)===!1)return;Ih.copy(i).invert(),Uc.copy(e.ray).applyMatrix4(Ih);const a=s/((this.scale.x+this.scale.y+this.scale.z)/3),c=a*a,l=n.index,d=n.attributes.position;if(l!==null){const u=Math.max(0,o.start),m=Math.min(l.count,o.start+o.count);for(let g=u,_=m;g<_;g++){const f=l.getX(g);xo.fromBufferAttribute(d,f),Ph(xo,f,c,i,e,t,this)}}else{const u=Math.max(0,o.start),m=Math.min(d.count,o.start+o.count);for(let g=u,_=m;g<_;g++)xo.fromBufferAttribute(d,g),Ph(xo,g,c,i,e,t,this)}}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,o=i.length;s<o;s++){const a=i[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=s}}}}}function Ph(r,e,t,n,i,s,o){const a=Uc.distanceSqToPoint(r);if(a<t){const c=new P;Uc.closestPointToPoint(r,c),c.applyMatrix4(n);const l=i.ray.origin.distanceTo(c);if(l<i.near||l>i.far)return;s.push({distance:l,distanceToRay:Math.sqrt(a),point:c,index:e,face:null,faceIndex:null,barycoord:null,object:o})}}class Dh extends jt{constructor(e,t,n,i,s,o,a,c,l){super(e,t,n,i,s,o,a,c,l),this.isCanvasTexture=!0,this.needsUpdate=!0}}class ol extends at{constructor(e=1,t=1,n=1,i=32,s=1,o=!1,a=0,c=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:t,height:n,radialSegments:i,heightSegments:s,openEnded:o,thetaStart:a,thetaLength:c};const l=this;i=Math.floor(i),s=Math.floor(s);const h=[],d=[],u=[],m=[];let g=0;const _=[],f=n/2;let p=0;x(),o===!1&&(e>0&&y(!0),t>0&&y(!1)),this.setIndex(h),this.setAttribute("position",new ot(d,3)),this.setAttribute("normal",new ot(u,3)),this.setAttribute("uv",new ot(m,2));function x(){const v=new P,F=new P;let A=0;const L=(t-e)/n;for(let O=0;O<=s;O++){const w=[],S=O/s,U=S*(t-e)+e;for(let Z=0;Z<=i;Z++){const K=Z/i,se=K*c+a,fe=Math.sin(se),z=Math.cos(se);F.x=U*fe,F.y=-S*n+f,F.z=U*z,d.push(F.x,F.y,F.z),v.set(fe,L,z).normalize(),u.push(v.x,v.y,v.z),m.push(K,1-S),w.push(g++)}_.push(w)}for(let O=0;O<i;O++)for(let w=0;w<s;w++){const S=_[w][O],U=_[w+1][O],Z=_[w+1][O+1],K=_[w][O+1];(e>0||w!==0)&&(h.push(S,U,K),A+=3),(t>0||w!==s-1)&&(h.push(U,Z,K),A+=3)}l.addGroup(p,A,0),p+=A}function y(v){const F=g,A=new Ge,L=new P;let O=0;const w=v===!0?e:t,S=v===!0?1:-1;for(let Z=1;Z<=i;Z++)d.push(0,f*S,0),u.push(0,S,0),m.push(.5,.5),g++;const U=g;for(let Z=0;Z<=i;Z++){const se=Z/i*c+a,fe=Math.cos(se),z=Math.sin(se);L.x=w*z,L.y=f*S,L.z=w*fe,d.push(L.x,L.y,L.z),u.push(0,S,0),A.x=fe*.5+.5,A.y=z*.5*S+.5,m.push(A.x,A.y),g++}for(let Z=0;Z<i;Z++){const K=F+Z,se=U+Z;v===!0?h.push(se,se+1,K):h.push(se+1,se,K),O+=3}l.addGroup(p,O,v===!0?1:2),p+=O}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new ol(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}}const vo=new P,yo=new P,Da=new P,bo=new Tn;class jd extends at{constructor(e=null,t=1){if(super(),this.type="EdgesGeometry",this.parameters={geometry:e,thresholdAngle:t},e!==null){const i=Math.pow(10,4),s=Math.cos(Ps*t),o=e.getIndex(),a=e.getAttribute("position"),c=o?o.count:a.count,l=[0,0,0],h=["a","b","c"],d=new Array(3),u={},m=[];for(let g=0;g<c;g+=3){o?(l[0]=o.getX(g),l[1]=o.getX(g+1),l[2]=o.getX(g+2)):(l[0]=g,l[1]=g+1,l[2]=g+2);const{a:_,b:f,c:p}=bo;if(_.fromBufferAttribute(a,l[0]),f.fromBufferAttribute(a,l[1]),p.fromBufferAttribute(a,l[2]),bo.getNormal(Da),d[0]=`${Math.round(_.x*i)},${Math.round(_.y*i)},${Math.round(_.z*i)}`,d[1]=`${Math.round(f.x*i)},${Math.round(f.y*i)},${Math.round(f.z*i)}`,d[2]=`${Math.round(p.x*i)},${Math.round(p.y*i)},${Math.round(p.z*i)}`,!(d[0]===d[1]||d[1]===d[2]||d[2]===d[0]))for(let x=0;x<3;x++){const y=(x+1)%3,v=d[x],F=d[y],A=bo[h[x]],L=bo[h[y]],O=`${v}_${F}`,w=`${F}_${v}`;w in u&&u[w]?(Da.dot(u[w].normal)<=s&&(m.push(A.x,A.y,A.z),m.push(L.x,L.y,L.z)),u[w]=null):O in u||(u[O]={index0:l[x],index1:l[y],normal:Da.clone()})}}for(const g in u)if(u[g]){const{index0:_,index1:f}=u[g];vo.fromBufferAttribute(a,_),yo.fromBufferAttribute(a,f),m.push(vo.x,vo.y,vo.z),m.push(yo.x,yo.y,yo.z)}this.setAttribute("position",new ot(m,3))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}}class Nx extends at{constructor(e=null){if(super(),this.type="WireframeGeometry",this.parameters={geometry:e},e!==null){const t=[],n=new Set,i=new P,s=new P;if(e.index!==null){const o=e.attributes.position,a=e.index;let c=e.groups;c.length===0&&(c=[{start:0,count:a.count,materialIndex:0}]);for(let l=0,h=c.length;l<h;++l){const d=c[l],u=d.start,m=d.count;for(let g=u,_=u+m;g<_;g+=3)for(let f=0;f<3;f++){const p=a.getX(g+f),x=a.getX(g+(f+1)%3);i.fromBufferAttribute(o,p),s.fromBufferAttribute(o,x),Nh(i,s,n)===!0&&(t.push(i.x,i.y,i.z),t.push(s.x,s.y,s.z))}}}else{const o=e.attributes.position;for(let a=0,c=o.count/3;a<c;a++)for(let l=0;l<3;l++){const h=3*a+l,d=3*a+(l+1)%3;i.fromBufferAttribute(o,h),s.fromBufferAttribute(o,d),Nh(i,s,n)===!0&&(t.push(i.x,i.y,i.z),t.push(s.x,s.y,s.z))}}this.setAttribute("position",new ot(t,3))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}}function Nh(r,e,t){const n=`${r.x},${r.y},${r.z}-${e.x},${e.y},${e.z}`,i=`${e.x},${e.y},${e.z}-${r.x},${r.y},${r.z}`;return t.has(n)===!0||t.has(i)===!0?!1:(t.add(n),t.add(i),!0)}class Qi extends Ft{static get type(){return"MeshStandardMaterial"}constructor(e){super(),this.isMeshStandardMaterial=!0,this.defines={STANDARD:""},this.color=new qe(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new qe(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=qo,this.normalScale=new Ge(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Fn,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}}class ni extends Qi{static get type(){return"MeshPhysicalMaterial"}constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new Ge(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return Zt(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(t){this.ior=(1+.4*t)/(1-.4*t)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new qe(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new qe(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new qe(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get dispersion(){return this._dispersion}set dispersion(e){this._dispersion>0!=e>0&&this.version++,this._dispersion=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}copy(e){return super.copy(e),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.dispersion=e.dispersion,this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessRange=[...e.iridescenceThicknessRange],this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}}class Ar extends Ft{static get type(){return"MeshPhongMaterial"}constructor(e){super(),this.isMeshPhongMaterial=!0,this.color=new qe(16777215),this.specular=new qe(1118481),this.shininess=30,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new qe(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=qo,this.normalScale=new Ge(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Fn,this.combine=Xo,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.specular.copy(e.specular),this.shininess=e.shininess,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}}class Fx extends Ft{static get type(){return"MeshLambertMaterial"}constructor(e){super(),this.isMeshLambertMaterial=!0,this.color=new qe(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new qe(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=qo,this.normalScale=new Ge(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Fn,this.combine=Xo,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}}class Oc extends zt{static get type(){return"LineDashedMaterial"}constructor(e){super(),this.isLineDashedMaterial=!0,this.scale=1,this.dashSize=3,this.gapSize=1,this.setValues(e)}copy(e){return super.copy(e),this.scale=e.scale,this.dashSize=e.dashSize,this.gapSize=e.gapSize,this}}function Mo(r,e,t){return!r||!t&&r.constructor===e?r:typeof e.BYTES_PER_ELEMENT=="number"?new e(r):Array.prototype.slice.call(r)}function Ux(r){return ArrayBuffer.isView(r)&&!(r instanceof DataView)}function Ox(r){function e(i,s){return r[i]-r[s]}const t=r.length,n=new Array(t);for(let i=0;i!==t;++i)n[i]=i;return n.sort(e),n}function Fh(r,e,t){const n=r.length,i=new r.constructor(n);for(let s=0,o=0;o!==n;++s){const a=t[s]*e;for(let c=0;c!==e;++c)i[o++]=r[a+c]}return i}function qd(r,e,t,n){let i=1,s=r[0];for(;s!==void 0&&s[n]===void 0;)s=r[i++];if(s===void 0)return;let o=s[n];if(o!==void 0)if(Array.isArray(o))do o=s[n],o!==void 0&&(e.push(s.time),t.push.apply(t,o)),s=r[i++];while(s!==void 0);else if(o.toArray!==void 0)do o=s[n],o!==void 0&&(e.push(s.time),o.toArray(t,t.length)),s=r[i++];while(s!==void 0);else do o=s[n],o!==void 0&&(e.push(s.time),t.push(o)),s=r[i++];while(s!==void 0)}class Nr{constructor(e,t,n,i){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=i!==void 0?i:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){const t=this.parameterPositions;let n=this._cachedIndex,i=t[n],s=t[n-1];e:{t:{let o;n:{i:if(!(e<i)){for(let a=n+2;;){if(i===void 0){if(e<s)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===a)break;if(s=i,i=t[++n],e<i)break t}o=t.length;break n}if(!(e>=s)){const a=t[1];e<a&&(n=2,s=a);for(let c=n-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===c)break;if(i=s,s=t[--n-1],e>=s)break t}o=n,n=0;break n}break e}for(;n<o;){const a=n+o>>>1;e<t[a]?o=a:n=a+1}if(i=t[n],s=t[n-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,s,i)}return this.interpolate_(n,s,e,i)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){const t=this.resultBuffer,n=this.sampleValues,i=this.valueSize,s=e*i;for(let o=0;o!==i;++o)t[o]=n[s+o];return t}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}}class kx extends Nr{constructor(e,t,n,i){super(e,t,n,i),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:yl,endingEnd:yl}}intervalChanged_(e,t,n){const i=this.parameterPositions;let s=e-2,o=e+1,a=i[s],c=i[o];if(a===void 0)switch(this.getSettings_().endingStart){case bl:s=e,a=2*t-n;break;case Ml:s=i.length-2,a=t+i[s]-i[s+1];break;default:s=e,a=n}if(c===void 0)switch(this.getSettings_().endingEnd){case bl:o=e,c=2*n-t;break;case Ml:o=1,c=n+i[1]-i[0];break;default:o=e-1,c=t}const l=(n-t)*.5,h=this.valueSize;this._weightPrev=l/(t-a),this._weightNext=l/(c-n),this._offsetPrev=s*h,this._offsetNext=o*h}interpolate_(e,t,n,i){const s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=e*a,l=c-a,h=this._offsetPrev,d=this._offsetNext,u=this._weightPrev,m=this._weightNext,g=(n-t)/(i-t),_=g*g,f=_*g,p=-u*f+2*u*_-u*g,x=(1+u)*f+(-1.5-2*u)*_+(-.5+u)*g+1,y=(-1-m)*f+(1.5+m)*_+.5*g,v=m*f-m*_;for(let F=0;F!==a;++F)s[F]=p*o[h+F]+x*o[l+F]+y*o[c+F]+v*o[d+F];return s}}class Bx extends Nr{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e,t,n,i){const s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=e*a,l=c-a,h=(n-t)/(i-t),d=1-h;for(let u=0;u!==a;++u)s[u]=o[l+u]*d+o[c+u]*h;return s}}class zx extends Nr{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e){return this.copySampleValue_(e-1)}}class ii{constructor(e,t,n,i){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=Mo(t,this.TimeBufferType),this.values=Mo(n,this.ValueBufferType),this.setInterpolation(i||this.DefaultInterpolation)}static toJSON(e){const t=e.constructor;let n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:Mo(e.times,Array),values:Mo(e.values,Array)};const i=e.getInterpolation();i!==e.DefaultInterpolation&&(n.interpolation=i)}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new zx(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new Bx(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new kx(this.times,this.values,this.getValueSize(),e)}setInterpolation(e){let t;switch(e){case wr:t=this.InterpolantFactoryMethodDiscrete;break;case Er:t=this.InterpolantFactoryMethodLinear;break;case ta:t=this.InterpolantFactoryMethodSmooth;break}if(t===void 0){const n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return console.warn("THREE.KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return wr;case this.InterpolantFactoryMethodLinear:return Er;case this.InterpolantFactoryMethodSmooth:return ta}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){const t=this.times;for(let n=0,i=t.length;n!==i;++n)t[n]+=e}return this}scale(e){if(e!==1){const t=this.times;for(let n=0,i=t.length;n!==i;++n)t[n]*=e}return this}trim(e,t){const n=this.times,i=n.length;let s=0,o=i-1;for(;s!==i&&n[s]<e;)++s;for(;o!==-1&&n[o]>t;)--o;if(++o,s!==0||o!==i){s>=o&&(o=Math.max(o,1),s=o-1);const a=this.getValueSize();this.times=n.slice(s,o),this.values=this.values.slice(s*a,o*a)}return this}validate(){let e=!0;const t=this.getValueSize();t-Math.floor(t)!==0&&(console.error("THREE.KeyframeTrack: Invalid value size in track.",this),e=!1);const n=this.times,i=this.values,s=n.length;s===0&&(console.error("THREE.KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==s;a++){const c=n[a];if(typeof c=="number"&&isNaN(c)){console.error("THREE.KeyframeTrack: Time is not a valid number.",this,a,c),e=!1;break}if(o!==null&&o>c){console.error("THREE.KeyframeTrack: Out of order keys.",this,a,c,o),e=!1;break}o=c}if(i!==void 0&&Ux(i))for(let a=0,c=i.length;a!==c;++a){const l=i[a];if(isNaN(l)){console.error("THREE.KeyframeTrack: Value is not a valid number.",this,a,l),e=!1;break}}return e}optimize(){const e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),i=this.getInterpolation()===ta,s=e.length-1;let o=1;for(let a=1;a<s;++a){let c=!1;const l=e[a],h=e[a+1];if(l!==h&&(a!==1||l!==e[0]))if(i)c=!0;else{const d=a*n,u=d-n,m=d+n;for(let g=0;g!==n;++g){const _=t[d+g];if(_!==t[u+g]||_!==t[m+g]){c=!0;break}}}if(c){if(a!==o){e[o]=e[a];const d=a*n,u=o*n;for(let m=0;m!==n;++m)t[u+m]=t[d+m]}++o}}if(s>0){e[o]=e[s];for(let a=s*n,c=o*n,l=0;l!==n;++l)t[c+l]=t[a+l];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=t.slice(0,o*n)):(this.times=e,this.values=t),this}clone(){const e=this.times.slice(),t=this.values.slice(),n=this.constructor,i=new n(this.name,e,t);return i.createInterpolant=this.createInterpolant,i}}ii.prototype.TimeBufferType=Float32Array;ii.prototype.ValueBufferType=Float32Array;ii.prototype.DefaultInterpolation=Er;class qs extends ii{constructor(e,t,n){super(e,t,n)}}qs.prototype.ValueTypeName="bool";qs.prototype.ValueBufferType=Array;qs.prototype.DefaultInterpolation=wr;qs.prototype.InterpolantFactoryMethodLinear=void 0;qs.prototype.InterpolantFactoryMethodSmooth=void 0;class Yd extends ii{}Yd.prototype.ValueTypeName="color";class Ws extends ii{}Ws.prototype.ValueTypeName="number";class Gx extends Nr{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e,t,n,i){const s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=(n-t)/(i-t);let l=e*a;for(let h=l+a;l!==h;l+=4)bi.slerpFlat(s,0,o,l-a,o,l,c);return s}}class ss extends ii{InterpolantFactoryMethodLinear(e){return new Gx(this.times,this.values,this.getValueSize(),e)}}ss.prototype.ValueTypeName="quaternion";ss.prototype.InterpolantFactoryMethodSmooth=void 0;class Ys extends ii{constructor(e,t,n){super(e,t,n)}}Ys.prototype.ValueTypeName="string";Ys.prototype.ValueBufferType=Array;Ys.prototype.DefaultInterpolation=wr;Ys.prototype.InterpolantFactoryMethodLinear=void 0;Ys.prototype.InterpolantFactoryMethodSmooth=void 0;class Oi extends ii{}Oi.prototype.ValueTypeName="vector";class kc{constructor(e="",t=-1,n=[],i=Gu){this.name=e,this.tracks=n,this.duration=t,this.blendMode=i,this.uuid=Zn(),this.duration<0&&this.resetDuration()}static parse(e){const t=[],n=e.tracks,i=1/(e.fps||1);for(let o=0,a=n.length;o!==a;++o)t.push(Vx(n[o]).scale(i));const s=new this(e.name,e.duration,t,e.blendMode);return s.uuid=e.uuid,s}static toJSON(e){const t=[],n=e.tracks,i={name:e.name,duration:e.duration,tracks:t,uuid:e.uuid,blendMode:e.blendMode};for(let s=0,o=n.length;s!==o;++s)t.push(ii.toJSON(n[s]));return i}static CreateFromMorphTargetSequence(e,t,n,i){const s=t.length,o=[];for(let a=0;a<s;a++){let c=[],l=[];c.push((a+s-1)%s,a,(a+1)%s),l.push(0,1,0);const h=Ox(c);c=Fh(c,1,h),l=Fh(l,1,h),!i&&c[0]===0&&(c.push(s),l.push(l[0])),o.push(new Ws(".morphTargetInfluences["+t[a].name+"]",c,l).scale(1/n))}return new this(e,-1,o)}static findByName(e,t){let n=e;if(!Array.isArray(e)){const i=e;n=i.geometry&&i.geometry.animations||i.animations}for(let i=0;i<n.length;i++)if(n[i].name===t)return n[i];return null}static CreateClipsFromMorphTargetSequences(e,t,n){const i={},s=/^([\w-]*?)([\d]+)$/;for(let a=0,c=e.length;a<c;a++){const l=e[a],h=l.name.match(s);if(h&&h.length>1){const d=h[1];let u=i[d];u||(i[d]=u=[]),u.push(l)}}const o=[];for(const a in i)o.push(this.CreateFromMorphTargetSequence(a,i[a],t,n));return o}static parseAnimation(e,t){if(!e)return console.error("THREE.AnimationClip: No animation in JSONLoader data."),null;const n=function(d,u,m,g,_){if(m.length!==0){const f=[],p=[];qd(m,f,p,g),f.length!==0&&_.push(new d(u,f,p))}},i=[],s=e.name||"default",o=e.fps||30,a=e.blendMode;let c=e.length||-1;const l=e.hierarchy||[];for(let d=0;d<l.length;d++){const u=l[d].keys;if(!(!u||u.length===0))if(u[0].morphTargets){const m={};let g;for(g=0;g<u.length;g++)if(u[g].morphTargets)for(let _=0;_<u[g].morphTargets.length;_++)m[u[g].morphTargets[_]]=-1;for(const _ in m){const f=[],p=[];for(let x=0;x!==u[g].morphTargets.length;++x){const y=u[g];f.push(y.time),p.push(y.morphTarget===_?1:0)}i.push(new Ws(".morphTargetInfluence["+_+"]",f,p))}c=m.length*o}else{const m=".bones["+t[d].name+"]";n(Oi,m+".position",u,"pos",i),n(ss,m+".quaternion",u,"rot",i),n(Oi,m+".scale",u,"scl",i)}}return i.length===0?null:new this(s,c,i,a)}resetDuration(){const e=this.tracks;let t=0;for(let n=0,i=e.length;n!==i;++n){const s=this.tracks[n];t=Math.max(t,s.times[s.times.length-1])}return this.duration=t,this}trim(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].trim(0,this.duration);return this}validate(){let e=!0;for(let t=0;t<this.tracks.length;t++)e=e&&this.tracks[t].validate();return e}optimize(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].optimize();return this}clone(){const e=[];for(let t=0;t<this.tracks.length;t++)e.push(this.tracks[t].clone());return new this.constructor(this.name,this.duration,e,this.blendMode)}toJSON(){return this.constructor.toJSON(this)}}function Hx(r){switch(r.toLowerCase()){case"scalar":case"double":case"float":case"number":case"integer":return Ws;case"vector":case"vector2":case"vector3":case"vector4":return Oi;case"color":return Yd;case"quaternion":return ss;case"bool":case"boolean":return qs;case"string":return Ys}throw new Error("THREE.KeyframeTrack: Unsupported typeName: "+r)}function Vx(r){if(r.type===void 0)throw new Error("THREE.KeyframeTrack: track type undefined, can not parse");const e=Hx(r.type);if(r.times===void 0){const t=[],n=[];qd(r.keys,t,n,"value"),r.times=t,r.values=n}return e.parse!==void 0?e.parse(r):new e(r.name,r.times,r.values,r.interpolation)}const Fi={enabled:!1,files:{},add:function(r,e){this.enabled!==!1&&(this.files[r]=e)},get:function(r){if(this.enabled!==!1)return this.files[r]},remove:function(r){delete this.files[r]},clear:function(){this.files={}}};class Wx{constructor(e,t,n){const i=this;let s=!1,o=0,a=0,c;const l=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this.itemStart=function(h){a++,s===!1&&i.onStart!==void 0&&i.onStart(h,o,a),s=!0},this.itemEnd=function(h){o++,i.onProgress!==void 0&&i.onProgress(h,o,a),o===a&&(s=!1,i.onLoad!==void 0&&i.onLoad())},this.itemError=function(h){i.onError!==void 0&&i.onError(h)},this.resolveURL=function(h){return c?c(h):h},this.setURLModifier=function(h){return c=h,this},this.addHandler=function(h,d){return l.push(h,d),this},this.removeHandler=function(h){const d=l.indexOf(h);return d!==-1&&l.splice(d,2),this},this.getHandler=function(h){for(let d=0,u=l.length;d<u;d+=2){const m=l[d],g=l[d+1];if(m.global&&(m.lastIndex=0),m.test(h))return g}return null}}}const Xx=new Wx;class Cn{constructor(e){this.manager=e!==void 0?e:Xx,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(e,t){const n=this;return new Promise(function(i,s){n.load(e,i,t,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}}Cn.DEFAULT_MATERIAL_NAME="__DEFAULT";const di={};class jx extends Error{constructor(e,t){super(e),this.response=t}}class ki extends Cn{constructor(e){super(e)}load(e,t,n,i){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);const s=Fi.get(e);if(s!==void 0)return this.manager.itemStart(e),setTimeout(()=>{t&&t(s),this.manager.itemEnd(e)},0),s;if(di[e]!==void 0){di[e].push({onLoad:t,onProgress:n,onError:i});return}di[e]=[],di[e].push({onLoad:t,onProgress:n,onError:i});const o=new Request(e,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?"include":"same-origin"}),a=this.mimeType,c=this.responseType;fetch(o).then(l=>{if(l.status===200||l.status===0){if(l.status===0&&console.warn("THREE.FileLoader: HTTP Status 0 received."),typeof ReadableStream>"u"||l.body===void 0||l.body.getReader===void 0)return l;const h=di[e],d=l.body.getReader(),u=l.headers.get("X-File-Size")||l.headers.get("Content-Length"),m=u?parseInt(u):0,g=m!==0;let _=0;const f=new ReadableStream({start(p){x();function x(){d.read().then(({done:y,value:v})=>{if(y)p.close();else{_+=v.byteLength;const F=new ProgressEvent("progress",{lengthComputable:g,loaded:_,total:m});for(let A=0,L=h.length;A<L;A++){const O=h[A];O.onProgress&&O.onProgress(F)}p.enqueue(v),x()}},y=>{p.error(y)})}}});return new Response(f)}else throw new jx(`fetch for "${l.url}" responded with ${l.status}: ${l.statusText}`,l)}).then(l=>{switch(c){case"arraybuffer":return l.arrayBuffer();case"blob":return l.blob();case"document":return l.text().then(h=>new DOMParser().parseFromString(h,a));case"json":return l.json();default:if(a===void 0)return l.text();{const d=/charset="?([^;"\s]*)"?/i.exec(a),u=d&&d[1]?d[1].toLowerCase():void 0,m=new TextDecoder(u);return l.arrayBuffer().then(g=>m.decode(g))}}}).then(l=>{Fi.add(e,l);const h=di[e];delete di[e];for(let d=0,u=h.length;d<u;d++){const m=h[d];m.onLoad&&m.onLoad(l)}}).catch(l=>{const h=di[e];if(h===void 0)throw this.manager.itemError(e),l;delete di[e];for(let d=0,u=h.length;d<u;d++){const m=h[d];m.onError&&m.onError(l)}this.manager.itemError(e)}).finally(()=>{this.manager.itemEnd(e)}),this.manager.itemStart(e)}setResponseType(e){return this.responseType=e,this}setMimeType(e){return this.mimeType=e,this}}class qx extends Cn{constructor(e){super(e)}load(e,t,n,i){this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);const s=this,o=Fi.get(e);if(o!==void 0)return s.manager.itemStart(e),setTimeout(function(){t&&t(o),s.manager.itemEnd(e)},0),o;const a=Tr("img");function c(){h(),Fi.add(e,this),t&&t(this),s.manager.itemEnd(e)}function l(d){h(),i&&i(d),s.manager.itemError(e),s.manager.itemEnd(e)}function h(){a.removeEventListener("load",c,!1),a.removeEventListener("error",l,!1)}return a.addEventListener("load",c,!1),a.addEventListener("error",l,!1),e.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(a.crossOrigin=this.crossOrigin),s.manager.itemStart(e),a.src=e,a}}class Yx extends Cn{constructor(e){super(e)}load(e,t,n,i){const s=this,o=new rl,a=new ki(this.manager);return a.setResponseType("arraybuffer"),a.setRequestHeader(this.requestHeader),a.setPath(this.path),a.setWithCredentials(s.withCredentials),a.load(e,function(c){let l;try{l=s.parse(c)}catch(h){if(i!==void 0)i(h);else{console.error(h);return}}l.image!==void 0?o.image=l.image:l.data!==void 0&&(o.image.width=l.width,o.image.height=l.height,o.image.data=l.data),o.wrapS=l.wrapS!==void 0?l.wrapS:Dn,o.wrapT=l.wrapT!==void 0?l.wrapT:Dn,o.magFilter=l.magFilter!==void 0?l.magFilter:cn,o.minFilter=l.minFilter!==void 0?l.minFilter:cn,o.anisotropy=l.anisotropy!==void 0?l.anisotropy:1,l.colorSpace!==void 0&&(o.colorSpace=l.colorSpace),l.flipY!==void 0&&(o.flipY=l.flipY),l.format!==void 0&&(o.format=l.format),l.type!==void 0&&(o.type=l.type),l.mipmaps!==void 0&&(o.mipmaps=l.mipmaps,o.minFilter=Yn),l.mipmapCount===1&&(o.minFilter=cn),l.generateMipmaps!==void 0&&(o.generateMipmaps=l.generateMipmaps),o.needsUpdate=!0,t&&t(o,l)},n,i),o}}class al extends Cn{constructor(e){super(e)}load(e,t,n,i){const s=new jt,o=new qx(this.manager);return o.setCrossOrigin(this.crossOrigin),o.setPath(this.path),o.load(e,function(a){s.image=a,s.needsUpdate=!0,t!==void 0&&t(s)},n,i),s}}class Fr extends Ut{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new qe(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){const t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(t.object.target=this.target.uuid),t}}class $x extends Fr{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(Ut.DEFAULT_UP),this.updateMatrix(),this.groundColor=new qe(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}}const Na=new Ze,Uh=new P,Oh=new P;class cl{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ge(512,512),this.map=null,this.mapPass=null,this.matrix=new Ze,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new tl,this._frameExtents=new Ge(1,1),this._viewportCount=1,this._viewports=[new vt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){const t=this.camera,n=this.matrix;Uh.setFromMatrixPosition(e.matrixWorld),t.position.copy(Uh),Oh.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(Oh),t.updateMatrixWorld(),Na.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Na),n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Na)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}}class Kx extends cl{constructor(){super(new nn(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1}updateMatrices(e){const t=this.camera,n=Hs*2*e.angle*this.focus,i=this.mapSize.width/this.mapSize.height,s=e.distance||t.far;(n!==t.fov||i!==t.aspect||s!==t.far)&&(t.fov=n,t.aspect=i,t.far=s,t.updateProjectionMatrix()),super.updateMatrices(e)}copy(e){return super.copy(e),this.focus=e.focus,this}}class $d extends Fr{constructor(e,t,n=0,i=Math.PI/3,s=0,o=2){super(e,t),this.isSpotLight=!0,this.type="SpotLight",this.position.copy(Ut.DEFAULT_UP),this.updateMatrix(),this.target=new Ut,this.distance=n,this.angle=i,this.penumbra=s,this.decay=o,this.map=null,this.shadow=new Kx}get power(){return this.intensity*Math.PI}set power(e){this.intensity=e/Math.PI}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.angle=e.angle,this.penumbra=e.penumbra,this.decay=e.decay,this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}}const kh=new Ze,cr=new P,Fa=new P;class Zx extends cl{constructor(){super(new nn(90,1,.5,500)),this.isPointLightShadow=!0,this._frameExtents=new Ge(4,2),this._viewportCount=6,this._viewports=[new vt(2,1,1,1),new vt(0,1,1,1),new vt(3,1,1,1),new vt(1,1,1,1),new vt(3,0,1,1),new vt(1,0,1,1)],this._cubeDirections=[new P(1,0,0),new P(-1,0,0),new P(0,0,1),new P(0,0,-1),new P(0,1,0),new P(0,-1,0)],this._cubeUps=[new P(0,1,0),new P(0,1,0),new P(0,1,0),new P(0,1,0),new P(0,0,1),new P(0,0,-1)]}updateMatrices(e,t=0){const n=this.camera,i=this.matrix,s=e.distance||n.far;s!==n.far&&(n.far=s,n.updateProjectionMatrix()),cr.setFromMatrixPosition(e.matrixWorld),n.position.copy(cr),Fa.copy(n.position),Fa.add(this._cubeDirections[t]),n.up.copy(this._cubeUps[t]),n.lookAt(Fa),n.updateMatrixWorld(),i.makeTranslation(-cr.x,-cr.y,-cr.z),kh.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(kh)}}class Kd extends Fr{constructor(e,t,n=0,i=2){super(e,t),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=i,this.shadow=new Zx}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}}class Jx extends cl{constructor(){super(new Dr(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class Vo extends Fr{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(Ut.DEFAULT_UP),this.updateMatrix(),this.target=new Ut,this.shadow=new Jx}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}}class Zd extends Fr{constructor(e,t){super(e,t),this.isAmbientLight=!0,this.type="AmbientLight"}}class es{static decodeText(e){if(console.warn("THREE.LoaderUtils: decodeText() has been deprecated with r165 and will be removed with r175. Use TextDecoder instead."),typeof TextDecoder<"u")return new TextDecoder().decode(e);let t="";for(let n=0,i=e.length;n<i;n++)t+=String.fromCharCode(e[n]);try{return decodeURIComponent(escape(t))}catch{return t}}static extractUrlBase(e){const t=e.lastIndexOf("/");return t===-1?"./":e.slice(0,t+1)}static resolveURL(e,t){return typeof e!="string"||e===""?"":(/^https?:\/\//i.test(t)&&/^\//.test(e)&&(t=t.replace(/(^https?:\/\/[^\/]+).*/i,"$1")),/^(https?:)?\/\//i.test(e)||/^data:.*,.*$/i.test(e)||/^blob:.*$/i.test(e)?e:t+e)}}class Qx extends at{constructor(){super(),this.isInstancedBufferGeometry=!0,this.type="InstancedBufferGeometry",this.instanceCount=1/0}copy(e){return super.copy(e),this.instanceCount=e.instanceCount,this}toJSON(){const e=super.toJSON();return e.instanceCount=this.instanceCount,e.isInstancedBufferGeometry=!0,e}}class e0 extends Cn{constructor(e){super(e),this.isImageBitmapLoader=!0,typeof createImageBitmap>"u"&&console.warn("THREE.ImageBitmapLoader: createImageBitmap() not supported."),typeof fetch>"u"&&console.warn("THREE.ImageBitmapLoader: fetch() not supported."),this.options={premultiplyAlpha:"none"}}setOptions(e){return this.options=e,this}load(e,t,n,i){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);const s=this,o=Fi.get(e);if(o!==void 0){if(s.manager.itemStart(e),o.then){o.then(l=>{t&&t(l),s.manager.itemEnd(e)}).catch(l=>{i&&i(l)});return}return setTimeout(function(){t&&t(o),s.manager.itemEnd(e)},0),o}const a={};a.credentials=this.crossOrigin==="anonymous"?"same-origin":"include",a.headers=this.requestHeader;const c=fetch(e,a).then(function(l){return l.blob()}).then(function(l){return createImageBitmap(l,Object.assign(s.options,{colorSpaceConversion:"none"}))}).then(function(l){return Fi.add(e,l),t&&t(l),s.manager.itemEnd(e),l}).catch(function(l){i&&i(l),Fi.remove(e),s.manager.itemError(e),s.manager.itemEnd(e)});Fi.add(e,c),s.manager.itemStart(e)}}const ll="\\[\\]\\.:\\/",t0=new RegExp("["+ll+"]","g"),hl="[^"+ll+"]",n0="[^"+ll.replace("\\.","")+"]",i0=/((?:WC+[\/:])*)/.source.replace("WC",hl),s0=/(WCOD+)?/.source.replace("WCOD",n0),r0=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",hl),o0=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",hl),a0=new RegExp("^"+i0+s0+r0+o0+"$"),c0=["material","materials","bones","map"];class l0{constructor(e,t,n){const i=n||Lt.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,i)}getValue(e,t){this.bind();const n=this._targetGroup.nCachedObjects_,i=this._bindings[n];i!==void 0&&i.getValue(e,t)}setValue(e,t){const n=this._bindings;for(let i=this._targetGroup.nCachedObjects_,s=n.length;i!==s;++i)n[i].setValue(e,t)}bind(){const e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){const e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}}class Lt{constructor(e,t,n){this.path=t,this.parsedPath=n||Lt.parseTrackName(t),this.node=Lt.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new Lt.Composite(e,t,n):new Lt(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(t0,"")}static parseTrackName(e){const t=a0.exec(e);if(t===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);const n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},i=n.nodeName&&n.nodeName.lastIndexOf(".");if(i!==void 0&&i!==-1){const s=n.nodeName.substring(i+1);c0.indexOf(s)!==-1&&(n.nodeName=n.nodeName.substring(0,i),n.objectName=s)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){const n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){const n=function(s){for(let o=0;o<s.length;o++){const a=s[o];if(a.name===t||a.uuid===t)return a;const c=n(a.children);if(c)return c}return null},i=n(e.children);if(i)return i}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){const n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)e[t++]=n[i]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){const n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)n[i]=e[t++]}_setValue_array_setNeedsUpdate(e,t){const n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)n[i]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){const n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)n[i]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node;const t=this.parsedPath,n=t.objectName,i=t.propertyName;let s=t.propertyIndex;if(e||(e=Lt.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){console.warn("THREE.PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let l=t.objectIndex;switch(n){case"materials":if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let h=0;h<e.length;h++)if(e[h].name===l){l=h;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){console.error("THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(l!==void 0){if(e[l]===void 0){console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[l]}}const o=e[i];if(o===void 0){const l=t.nodeName;console.error("THREE.PropertyBinding: Trying to update property for track: "+l+"."+i+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.needsUpdate!==void 0?a=this.Versioning.NeedsUpdate:e.matrixWorldNeedsUpdate!==void 0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let c=this.BindingType.Direct;if(s!==void 0){if(i==="morphTargetInfluences"){if(!e.geometry){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}c=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=s}else o.fromArray!==void 0&&o.toArray!==void 0?(c=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(c=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=i;this.getValue=this.GetterByBindingType[c],this.setValue=this.SetterByBindingTypeAndVersioning[c][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}}Lt.Composite=l0;Lt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};Lt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};Lt.prototype.GetterByBindingType=[Lt.prototype._getValue_direct,Lt.prototype._getValue_array,Lt.prototype._getValue_arrayElement,Lt.prototype._getValue_toArray];Lt.prototype.SetterByBindingTypeAndVersioning=[[Lt.prototype._setValue_direct,Lt.prototype._setValue_direct_setNeedsUpdate,Lt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[Lt.prototype._setValue_array,Lt.prototype._setValue_array_setNeedsUpdate,Lt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[Lt.prototype._setValue_arrayElement,Lt.prototype._setValue_arrayElement_setNeedsUpdate,Lt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[Lt.prototype._setValue_fromArray,Lt.prototype._setValue_fromArray_setNeedsUpdate,Lt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];class Bc extends il{constructor(e,t,n=1){super(e,t),this.isInstancedInterleavedBuffer=!0,this.meshPerAttribute=n}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}clone(e){const t=super.clone(e);return t.meshPerAttribute=this.meshPerAttribute,t}toJSON(e){const t=super.toJSON(e);return t.isInstancedInterleavedBuffer=!0,t.meshPerAttribute=this.meshPerAttribute,t}}const Bh=new Ze;class Zo{constructor(e,t,n=0,i=1/0){this.ray=new Lr(e,t),this.near=n,this.far=i,this.camera=null,this.layers=new Qc,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,t){this.ray.set(e,t)}setFromCamera(e,t){t.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(t).sub(this.ray.origin).normalize(),this.camera=t):t.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,(t.near+t.far)/(t.near-t.far)).unproject(t),this.ray.direction.set(0,0,-1).transformDirection(t.matrixWorld),this.camera=t):console.error("THREE.Raycaster: Unsupported camera type: "+t.type)}setFromXRController(e){return Bh.identity().extractRotation(e.matrixWorld),this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(Bh),this}intersectObject(e,t=!0,n=[]){return zc(e,this,n,t),n.sort(zh),n}intersectObjects(e,t=!0,n=[]){for(let i=0,s=e.length;i<s;i++)zc(e[i],this,n,t);return n.sort(zh),n}}function zh(r,e){return r.distance-e.distance}function zc(r,e,t,n){let i=!0;if(r.layers.test(e.layers)&&r.raycast(e,t)===!1&&(i=!1),i===!0&&n===!0){const s=r.children;for(let o=0,a=s.length;o<a;o++)zc(s[o],e,t,!0)}}class h0{constructor(e=1,t=0,n=0){return this.radius=e,this.phi=t,this.theta=n,this}set(e,t,n){return this.radius=e,this.phi=t,this.theta=n,this}copy(e){return this.radius=e.radius,this.phi=e.phi,this.theta=e.theta,this}makeSafe(){return this.phi=Math.max(1e-6,Math.min(Math.PI-1e-6,this.phi)),this}setFromVector3(e){return this.setFromCartesianCoords(e.x,e.y,e.z)}setFromCartesianCoords(e,t,n){return this.radius=Math.sqrt(e*e+t*t+n*n),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(e,n),this.phi=Math.acos(Zt(t/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}}const Gh=new P,So=new P;class d0{constructor(e=new P,t=new P){this.start=e,this.end=t}set(e,t){return this.start.copy(e),this.end.copy(t),this}copy(e){return this.start.copy(e.start),this.end.copy(e.end),this}getCenter(e){return e.addVectors(this.start,this.end).multiplyScalar(.5)}delta(e){return e.subVectors(this.end,this.start)}distanceSq(){return this.start.distanceToSquared(this.end)}distance(){return this.start.distanceTo(this.end)}at(e,t){return this.delta(t).multiplyScalar(e).add(this.start)}closestPointToPointParameter(e,t){Gh.subVectors(e,this.start),So.subVectors(this.end,this.start);const n=So.dot(So);let s=So.dot(Gh)/n;return t&&(s=Zt(s,0,1)),s}closestPointToPoint(e,t,n){const i=this.closestPointToPointParameter(e,t);return this.delta(n).multiplyScalar(i).add(this.start)}applyMatrix4(e){return this.start.applyMatrix4(e),this.end.applyMatrix4(e),this}equals(e){return e.start.equals(this.start)&&e.end.equals(this.end)}clone(){return new this.constructor().copy(this)}}const Hh=new P;let wo,Ua;class u0 extends Ut{constructor(e=new P(0,0,1),t=new P(0,0,0),n=1,i=16776960,s=n*.2,o=s*.2){super(),this.type="ArrowHelper",wo===void 0&&(wo=new at,wo.setAttribute("position",new ot([0,0,0,0,1,0],3)),Ua=new ol(0,.5,1,5,1),Ua.translate(0,-.5,0)),this.position.copy(t),this.line=new An(wo,new zt({color:i,toneMapped:!1})),this.line.matrixAutoUpdate=!1,this.add(this.line),this.cone=new rt(Ua,new rn({color:i,toneMapped:!1})),this.cone.matrixAutoUpdate=!1,this.add(this.cone),this.setDirection(e),this.setLength(n,s,o)}setDirection(e){if(e.y>.99999)this.quaternion.set(0,0,0,1);else if(e.y<-.99999)this.quaternion.set(1,0,0,0);else{Hh.set(e.z,0,-e.x).normalize();const t=Math.acos(e.y);this.quaternion.setFromAxisAngle(Hh,t)}}setLength(e,t=e*.2,n=t*.2){this.line.scale.set(1,Math.max(1e-4,e-t),1),this.line.updateMatrix(),this.cone.scale.set(n,t,n),this.cone.position.y=e,this.cone.updateMatrix()}setColor(e){this.line.material.color.set(e),this.cone.material.color.set(e)}copy(e){return super.copy(e,!1),this.line.copy(e.line),this.cone.copy(e.cone),this}dispose(){this.line.geometry.dispose(),this.line.material.dispose(),this.cone.geometry.dispose(),this.cone.material.dispose()}}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Wc}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Wc);const Vh=new Un,Eo=new P;class Jd extends Qx{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type="LineSegmentsGeometry";const e=[-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],t=[-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],n=[0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5];this.setIndex(n),this.setAttribute("position",new ot(e,3)),this.setAttribute("uv",new ot(t,2))}applyMatrix4(e){const t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));const n=new Bc(t,6,1);return this.setAttribute("instanceStart",new Kn(n,3,0)),this.setAttribute("instanceEnd",new Kn(n,3,3)),this.instanceCount=this.attributes.instanceStart.count,this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));const n=new Bc(t,6,1);return this.setAttribute("instanceColorStart",new Kn(n,3,0)),this.setAttribute("instanceColorEnd",new Kn(n,3,3)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new Nx(e.geometry)),this}fromLineSegments(e){const t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Un);const e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),Vh.setFromBufferAttribute(t),this.boundingBox.union(Vh))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new On),this.boundingBox===null&&this.computeBoundingBox();const e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){const n=this.boundingSphere.center;this.boundingBox.getCenter(n);let i=0;for(let s=0,o=e.count;s<o;s++)Eo.fromBufferAttribute(e,s),i=Math.max(i,n.distanceToSquared(Eo)),Eo.fromBufferAttribute(t,s),i=Math.max(i,n.distanceToSquared(Eo));this.boundingSphere.radius=Math.sqrt(i),isNaN(this.boundingSphere.radius)&&console.error("THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.",this)}}toJSON(){}applyMatrix(e){return console.warn("THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4()."),this.applyMatrix4(e)}}we.line={worldUnits:{value:1},linewidth:{value:1},resolution:{value:new Ge(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}};bn.line={uniforms:el.merge([we.common,we.fog,we.line]),vertexShader:`
		#include <common>
		#include <color_pars_vertex>
		#include <fog_pars_vertex>
		#include <logdepthbuf_pars_vertex>
		#include <clipping_planes_pars_vertex>

		uniform float linewidth;
		uniform vec2 resolution;

		attribute vec3 instanceStart;
		attribute vec3 instanceEnd;

		attribute vec3 instanceColorStart;
		attribute vec3 instanceColorEnd;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#ifdef USE_DASH

			uniform float dashScale;
			attribute float instanceDistanceStart;
			attribute float instanceDistanceEnd;
			varying float vLineDistance;

		#endif

		void trimSegment( const in vec4 start, inout vec4 end ) {

			// trim end segment so it terminates between the camera plane and the near plane

			// conservative estimate of the near plane
			float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
			float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column
			float nearEstimate = - 0.5 * b / a;

			float alpha = ( nearEstimate - start.z ) / ( end.z - start.z );

			end.xyz = mix( start.xyz, end.xyz, alpha );

		}

		void main() {

			#ifdef USE_COLOR

				vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

			#endif

			#ifdef USE_DASH

				vLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;
				vUv = uv;

			#endif

			float aspect = resolution.x / resolution.y;

			// camera space
			vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
			vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

			#ifdef WORLD_UNITS

				worldStart = start.xyz;
				worldEnd = end.xyz;

			#else

				vUv = uv;

			#endif

			// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
			// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
			// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
			// perhaps there is a more elegant solution -- WestLangley

			bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

			if ( perspective ) {

				if ( start.z < 0.0 && end.z >= 0.0 ) {

					trimSegment( start, end );

				} else if ( end.z < 0.0 && start.z >= 0.0 ) {

					trimSegment( end, start );

				}

			}

			// clip space
			vec4 clipStart = projectionMatrix * start;
			vec4 clipEnd = projectionMatrix * end;

			// ndc space
			vec3 ndcStart = clipStart.xyz / clipStart.w;
			vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

			// direction
			vec2 dir = ndcEnd.xy - ndcStart.xy;

			// account for clip-space aspect ratio
			dir.x *= aspect;
			dir = normalize( dir );

			#ifdef WORLD_UNITS

				vec3 worldDir = normalize( end.xyz - start.xyz );
				vec3 tmpFwd = normalize( mix( start.xyz, end.xyz, 0.5 ) );
				vec3 worldUp = normalize( cross( worldDir, tmpFwd ) );
				vec3 worldFwd = cross( worldDir, worldUp );
				worldPos = position.y < 0.5 ? start: end;

				// height offset
				float hw = linewidth * 0.5;
				worldPos.xyz += position.x < 0.0 ? hw * worldUp : - hw * worldUp;

				// don't extend the line if we're rendering dashes because we
				// won't be rendering the endcaps
				#ifndef USE_DASH

					// cap extension
					worldPos.xyz += position.y < 0.5 ? - hw * worldDir : hw * worldDir;

					// add width to the box
					worldPos.xyz += worldFwd * hw;

					// endcaps
					if ( position.y > 1.0 || position.y < 0.0 ) {

						worldPos.xyz -= worldFwd * 2.0 * hw;

					}

				#endif

				// project the worldpos
				vec4 clip = projectionMatrix * worldPos;

				// shift the depth of the projected points so the line
				// segments overlap neatly
				vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
				clip.z = clipPose.z * clip.w;

			#else

				vec2 offset = vec2( dir.y, - dir.x );
				// undo aspect ratio adjustment
				dir.x /= aspect;
				offset.x /= aspect;

				// sign flip
				if ( position.x < 0.0 ) offset *= - 1.0;

				// endcaps
				if ( position.y < 0.0 ) {

					offset += - dir;

				} else if ( position.y > 1.0 ) {

					offset += dir;

				}

				// adjust for linewidth
				offset *= linewidth;

				// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
				offset /= resolution.y;

				// select end
				vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

				// back to clip space
				offset *= clip.w;

				clip.xy += offset;

			#endif

			gl_Position = clip;

			vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

			#include <logdepthbuf_vertex>
			#include <clipping_planes_vertex>
			#include <fog_vertex>

		}
		`,fragmentShader:`
		uniform vec3 diffuse;
		uniform float opacity;
		uniform float linewidth;

		#ifdef USE_DASH

			uniform float dashOffset;
			uniform float dashSize;
			uniform float gapSize;

		#endif

		varying float vLineDistance;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#include <common>
		#include <color_pars_fragment>
		#include <fog_pars_fragment>
		#include <logdepthbuf_pars_fragment>
		#include <clipping_planes_pars_fragment>

		vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

			float mua;
			float mub;

			vec3 p13 = p1 - p3;
			vec3 p43 = p4 - p3;

			vec3 p21 = p2 - p1;

			float d1343 = dot( p13, p43 );
			float d4321 = dot( p43, p21 );
			float d1321 = dot( p13, p21 );
			float d4343 = dot( p43, p43 );
			float d2121 = dot( p21, p21 );

			float denom = d2121 * d4343 - d4321 * d4321;

			float numer = d1343 * d4321 - d1321 * d4343;

			mua = numer / denom;
			mua = clamp( mua, 0.0, 1.0 );
			mub = ( d1343 + d4321 * ( mua ) ) / d4343;
			mub = clamp( mub, 0.0, 1.0 );

			return vec2( mua, mub );

		}

		void main() {

			#include <clipping_planes_fragment>

			#ifdef USE_DASH

				if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

				if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

			#endif

			float alpha = opacity;

			#ifdef WORLD_UNITS

				// Find the closest points on the view ray and the line segment
				vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
				vec3 lineDir = worldEnd - worldStart;
				vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

				vec3 p1 = worldStart + lineDir * params.x;
				vec3 p2 = rayEnd * params.y;
				vec3 delta = p1 - p2;
				float len = length( delta );
				float norm = len / linewidth;

				#ifndef USE_DASH

					#ifdef USE_ALPHA_TO_COVERAGE

						float dnorm = fwidth( norm );
						alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

					#else

						if ( norm > 0.5 ) {

							discard;

						}

					#endif

				#endif

			#else

				#ifdef USE_ALPHA_TO_COVERAGE

					// artifacts appear on some hardware if a derivative is taken within a conditional
					float a = vUv.x;
					float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
					float len2 = a * a + b * b;
					float dlen = fwidth( len2 );

					if ( abs( vUv.y ) > 1.0 ) {

						alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

					}

				#else

					if ( abs( vUv.y ) > 1.0 ) {

						float a = vUv.x;
						float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
						float len2 = a * a + b * b;

						if ( len2 > 1.0 ) discard;

					}

				#endif

			#endif

			vec4 diffuseColor = vec4( diffuse, alpha );

			#include <logdepthbuf_fragment>
			#include <color_fragment>

			gl_FragColor = vec4( diffuseColor.rgb, alpha );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>
			#include <fog_fragment>
			#include <premultiplied_alpha_fragment>

		}
		`};class Pi extends yi{static get type(){return"LineMaterial"}constructor(e){super({uniforms:el.clone(bn.line.uniforms),vertexShader:bn.line.vertexShader,fragmentShader:bn.line.fragmentShader,clipping:!0}),this.isLineMaterial=!0,this.setValues(e)}get color(){return this.uniforms.diffuse.value}set color(e){this.uniforms.diffuse.value=e}get worldUnits(){return"WORLD_UNITS"in this.defines}set worldUnits(e){e===!0?this.defines.WORLD_UNITS="":delete this.defines.WORLD_UNITS}get linewidth(){return this.uniforms.linewidth.value}set linewidth(e){this.uniforms.linewidth&&(this.uniforms.linewidth.value=e)}get dashed(){return"USE_DASH"in this.defines}set dashed(e){e===!0!==this.dashed&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH="":delete this.defines.USE_DASH}get dashScale(){return this.uniforms.dashScale.value}set dashScale(e){this.uniforms.dashScale.value=e}get dashSize(){return this.uniforms.dashSize.value}set dashSize(e){this.uniforms.dashSize.value=e}get dashOffset(){return this.uniforms.dashOffset.value}set dashOffset(e){this.uniforms.dashOffset.value=e}get gapSize(){return this.uniforms.gapSize.value}set gapSize(e){this.uniforms.gapSize.value=e}get opacity(){return this.uniforms.opacity.value}set opacity(e){this.uniforms&&(this.uniforms.opacity.value=e)}get resolution(){return this.uniforms.resolution.value}set resolution(e){this.uniforms.resolution.value.copy(e)}get alphaToCoverage(){return"USE_ALPHA_TO_COVERAGE"in this.defines}set alphaToCoverage(e){this.defines&&(e===!0!==this.alphaToCoverage&&(this.needsUpdate=!0),e===!0?this.defines.USE_ALPHA_TO_COVERAGE="":delete this.defines.USE_ALPHA_TO_COVERAGE)}}const Oa=new vt,Wh=new P,Xh=new P,Qt=new vt,en=new vt,Jn=new vt,ka=new P,Ba=new Ze,tn=new d0,jh=new P,To=new Un,Ao=new On,Qn=new vt;let ei,ts;function qh(r,e,t){return Qn.set(0,0,-e,1).applyMatrix4(r.projectionMatrix),Qn.multiplyScalar(1/Qn.w),Qn.x=ts/t.width,Qn.y=ts/t.height,Qn.applyMatrix4(r.projectionMatrixInverse),Qn.multiplyScalar(1/Qn.w),Math.abs(Math.max(Qn.x,Qn.y))}function f0(r,e){const t=r.matrixWorld,n=r.geometry,i=n.attributes.instanceStart,s=n.attributes.instanceEnd,o=Math.min(n.instanceCount,i.count);for(let a=0,c=o;a<c;a++){tn.start.fromBufferAttribute(i,a),tn.end.fromBufferAttribute(s,a),tn.applyMatrix4(t);const l=new P,h=new P;ei.distanceSqToSegment(tn.start,tn.end,h,l),h.distanceTo(l)<ts*.5&&e.push({point:h,pointOnLine:l,distance:ei.origin.distanceTo(h),object:r,face:null,faceIndex:a,uv:null,uv1:null})}}function p0(r,e,t){const n=e.projectionMatrix,s=r.material.resolution,o=r.matrixWorld,a=r.geometry,c=a.attributes.instanceStart,l=a.attributes.instanceEnd,h=Math.min(a.instanceCount,c.count),d=-e.near;ei.at(1,Jn),Jn.w=1,Jn.applyMatrix4(e.matrixWorldInverse),Jn.applyMatrix4(n),Jn.multiplyScalar(1/Jn.w),Jn.x*=s.x/2,Jn.y*=s.y/2,Jn.z=0,ka.copy(Jn),Ba.multiplyMatrices(e.matrixWorldInverse,o);for(let u=0,m=h;u<m;u++){if(Qt.fromBufferAttribute(c,u),en.fromBufferAttribute(l,u),Qt.w=1,en.w=1,Qt.applyMatrix4(Ba),en.applyMatrix4(Ba),Qt.z>d&&en.z>d)continue;if(Qt.z>d){const y=Qt.z-en.z,v=(Qt.z-d)/y;Qt.lerp(en,v)}else if(en.z>d){const y=en.z-Qt.z,v=(en.z-d)/y;en.lerp(Qt,v)}Qt.applyMatrix4(n),en.applyMatrix4(n),Qt.multiplyScalar(1/Qt.w),en.multiplyScalar(1/en.w),Qt.x*=s.x/2,Qt.y*=s.y/2,en.x*=s.x/2,en.y*=s.y/2,tn.start.copy(Qt),tn.start.z=0,tn.end.copy(en),tn.end.z=0;const _=tn.closestPointToPointParameter(ka,!0);tn.at(_,jh);const f=Zi.lerp(Qt.z,en.z,_),p=f>=-1&&f<=1,x=ka.distanceTo(jh)<ts*.5;if(p&&x){tn.start.fromBufferAttribute(c,u),tn.end.fromBufferAttribute(l,u),tn.start.applyMatrix4(o),tn.end.applyMatrix4(o);const y=new P,v=new P;ei.distanceSqToSegment(tn.start,tn.end,v,y),t.push({point:v,pointOnLine:y,distance:ei.origin.distanceTo(v),object:r,face:null,faceIndex:u,uv:null,uv1:null})}}}class m0 extends rt{constructor(e=new Jd,t=new Pi({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type="LineSegments2"}computeLineDistances(){const e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,i=new Float32Array(2*t.count);for(let o=0,a=0,c=t.count;o<c;o++,a+=2)Wh.fromBufferAttribute(t,o),Xh.fromBufferAttribute(n,o),i[a]=a===0?0:i[a-1],i[a+1]=i[a]+Wh.distanceTo(Xh);const s=new Bc(i,2,1);return e.setAttribute("instanceDistanceStart",new Kn(s,1,0)),e.setAttribute("instanceDistanceEnd",new Kn(s,1,1)),this}raycast(e,t){const n=this.material.worldUnits,i=e.camera;i===null&&!n&&console.error('LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.');const s=e.params.Line2!==void 0&&e.params.Line2.threshold||0;ei=e.ray;const o=this.matrixWorld,a=this.geometry,c=this.material;ts=c.linewidth+s,a.boundingSphere===null&&a.computeBoundingSphere(),Ao.copy(a.boundingSphere).applyMatrix4(o);let l;if(n)l=ts*.5;else{const d=Math.max(i.near,Ao.distanceToPoint(ei.origin));l=qh(i,d,c.resolution)}if(Ao.radius+=l,ei.intersectsSphere(Ao)===!1)return;a.boundingBox===null&&a.computeBoundingBox(),To.copy(a.boundingBox).applyMatrix4(o);let h;if(n)h=ts*.5;else{const d=Math.max(i.near,To.distanceToPoint(ei.origin));h=qh(i,d,c.resolution)}To.expandByScalar(h),ei.intersectsBox(To)!==!1&&(n?f0(this,t):p0(this,i,t))}onBeforeRender(e){const t=this.material.uniforms;t&&t.resolution&&(e.getViewport(Oa),this.material.uniforms.resolution.value.set(Oa.z,Oa.w))}}class As extends Jd{constructor(){super(),this.isLineGeometry=!0,this.type="LineGeometry"}setPositions(e){const t=e.length-3,n=new Float32Array(2*t);for(let i=0;i<t;i+=3)n[2*i]=e[i],n[2*i+1]=e[i+1],n[2*i+2]=e[i+2],n[2*i+3]=e[i+3],n[2*i+4]=e[i+4],n[2*i+5]=e[i+5];return super.setPositions(n),this}setColors(e){const t=e.length-3,n=new Float32Array(2*t);for(let i=0;i<t;i+=3)n[2*i]=e[i],n[2*i+1]=e[i+1],n[2*i+2]=e[i+2],n[2*i+3]=e[i+3],n[2*i+4]=e[i+4],n[2*i+5]=e[i+5];return super.setColors(n),this}fromLine(e){const t=e.geometry;return this.setPositions(t.attributes.position.array),this}}class Li extends m0{constructor(e=new As,t=new Pi({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type="Line2"}}var Qd=(r=>(r.Point="point",r.Line="line",r.Face="face",r.Volume="volume",r.Xia="xia",r))(Qd||{});const g0={point:{state:"point",label:"점",labelEn:"Point",description:"위치만 존재 (L=0, W=0, H=0)",color:"#888888",icon:"·"},line:{state:"line",label:"선",labelEn:"Line",description:"길이만 존재 (H=0)",color:"#ff9800",icon:"─"},face:{state:"face",label:"면",labelEn:"Face",description:"L × W (H=0)",color:"#2196f3",icon:"▢"},volume:{state:"volume",label:"체적",labelEn:"Volume",description:"L × W × H (Appearance)",color:"#9c27b0",icon:"⬡"},xia:{state:"xia",label:"XIA",labelEn:"XIA",description:"Volume + Material (물체)",color:"#4caf50",icon:"◆"}},_0=[{id:"concrete",rustId:1,name:"콘크리트",nameEn:"Concrete",category:"concrete",physical:{density:2400,thermalConductivity:1.6,fireRating:"incombustible"},visual:{color:11579568,roughness:.9,metalness:0,opacity:1},builtIn:!0},{id:"steel",rustId:2,name:"철강",nameEn:"Steel",category:"metal",physical:{density:7850,thermalConductivity:50,fireRating:"incombustible"},visual:{color:8952234,roughness:.3,metalness:.8,opacity:1},builtIn:!0},{id:"wood",rustId:3,name:"목재",nameEn:"Wood",category:"wood",physical:{density:600,thermalConductivity:.15,fireRating:"retardant"},visual:{color:12884588,roughness:.7,metalness:0,opacity:1},builtIn:!0},{id:"glass",rustId:4,name:"유리",nameEn:"Glass",category:"glass",physical:{density:2500,thermalConductivity:1,fireRating:"incombustible"},visual:{color:11197934,roughness:.1,metalness:0,opacity:.4},builtIn:!0},{id:"brick",rustId:5,name:"벽돌",nameEn:"Brick",category:"stone",physical:{density:1800,thermalConductivity:.8,fireRating:"incombustible"},visual:{color:12868154,roughness:.85,metalness:0,opacity:1},builtIn:!0},{id:"aluminum",rustId:6,name:"알루미늄",nameEn:"Aluminum",category:"metal",physical:{density:2700,thermalConductivity:160,fireRating:"incombustible"},visual:{color:13421789,roughness:.2,metalness:.9,opacity:1},builtIn:!0},{id:"stone",rustId:7,name:"석재",nameEn:"Stone",category:"stone",physical:{density:2600,thermalConductivity:2.3,fireRating:"incombustible"},visual:{color:10066312,roughness:.8,metalness:0,opacity:1},builtIn:!0},{id:"gypsum",rustId:8,name:"석고보드",nameEn:"Gypsum Board",category:"composite",physical:{density:800,thermalConductivity:.16,fireRating:"incombustible"},visual:{color:15658734,roughness:.95,metalness:0,opacity:1},builtIn:!0},{id:"insulation",rustId:9,name:"단열재",nameEn:"Insulation",category:"insulation",physical:{density:30,thermalConductivity:.035,fireRating:"retardant"},visual:{color:16772744,roughness:.95,metalness:0,opacity:1},builtIn:!0},{id:"water",rustId:10,name:"물",nameEn:"Water",category:"custom",physical:{density:1e3,thermalConductivity:.6,fireRating:"incombustible"},visual:{color:4491468,roughness:0,metalness:0,opacity:.5},builtIn:!0},{id:"soil",rustId:11,name:"토양",nameEn:"Soil",category:"custom",physical:{density:1600,thermalConductivity:1.5,fireRating:"incombustible"},visual:{color:9136404,roughness:.95,metalness:0,opacity:1},builtIn:!0},{id:"tile",rustId:12,name:"타일",nameEn:"Tile",category:"composite",physical:{density:2e3,thermalConductivity:1.3,fireRating:"incombustible"},visual:{color:14538956,roughness:.4,metalness:0,opacity:1},builtIn:!0}];class eu{constructor(){this.materials=new Map,this.assignments=new Map,this.listeners=[],this.bridge=null;for(const e of _0)this.materials.set(e.id,e)}setBridge(e){this.bridge=e}get(e){return this.materials.get(e)}getAll(){return Array.from(this.materials.values())}getBuiltIn(){return this.getAll().filter(e=>e.builtIn)}getCustom(){return this.getAll().filter(e=>!e.builtIn)}getByCategory(e){return this.getAll().filter(t=>t.category===e)}addCustom(e){const t={...e,builtIn:!1};return this.materials.set(t.id,t),this.notifyListeners(),t}removeCustom(e){const t=this.materials.get(e);if(!t||t.builtIn)return!1;this.materials.delete(e);for(const[n,i]of this.assignments)i===e&&this.assignments.delete(n);return this.notifyListeners(),!0}assignToFaces(e,t){const n=this.materials.get(t);if(!n)return!1;for(const i of e)this.assignments.set(i,t);if(this.bridge?.assignMaterial){const i=new Uint32Array(e);this.bridge.assignMaterial(i,n.rustId)}return this.notifyListeners(),!0}unassignFromFaces(e){for(const t of e)this.assignments.delete(t);if(this.bridge?.removeMaterial){const t=new Uint32Array(e);this.bridge.removeMaterial(t)}this.notifyListeners()}getMaterialForFace(e){const t=this.assignments.get(e);return t?this.materials.get(t):void 0}getCommonMaterial(e){if(e.length===0)return;const t=this.assignments.get(e[0]);if(t){for(let n=1;n<e.length;n++)if(this.assignments.get(e[n])!==t)return;return this.materials.get(t)}}hasMaterial(e){return e.some(t=>this.assignments.has(t))}computePhysics(e,t){const n=this.materials.get(t);if(!n)return null;const i=e/1e9,s=n.physical.density,o=i*s,a=o*9.81;return{volumeM3:i,density:s,mass:o,weight:a}}determineState(e,t){return e.faceCount===0?"point":e.faceCount===1||e.height===0?"face":e.faceCount>=4&&e.height>0?this.hasMaterial(t)?"xia":"volume":"face"}onChange(e){return this.listeners.push(e),()=>{this.listeners=this.listeners.filter(t=>t!==e)}}notifyListeners(){for(const e of this.listeners)e()}syncFromRust(){if(!this.bridge?.getFaceMaterial)return;const e=new Map;for(const i of this.materials.values())i.rustId&&e.set(i.rustId,i.id);let t=!1;const n=new Map;for(const[i]of this.assignments){const s=this.bridge.getFaceMaterial(i);if(s>0){const o=e.get(s);o?(n.set(i,o),this.assignments.get(i)!==o&&(t=!0)):t=!0}else t=!0}t&&(this.assignments=n,this.notifyListeners())}toJSON(){return{custom:this.getCustom(),assignments:Array.from(this.assignments.entries())}}fromJSON(e){if(e.custom)for(const t of e.custom)this.materials.set(t.id,{...t,builtIn:!1});if(e.assignments)for(const[t,n]of e.assignments)this.assignments.set(t,n);this.notifyListeners()}}let za=null;function Cr(){return za||(za=new eu),za}const x0=Object.freeze(Object.defineProperty({__proto__:null,GEOMETRY_STATES:g0,GeometryState:Qd,MaterialLibrary:eu,getMaterialLibrary:Cr},Symbol.toStringTag,{value:"Module"})),Yh=new P,$h=new P;class v0{constructor(e){this._viewMode="3d",this.orthoZoom=1e4,this.axisLines=[],this._bgMode="gradient2",this._bgSkyColor="#8eaac4",this._bgMidColor="#b0c4d8",this._bgGroundColor="#d8dce2",this._frontColor=15263976,this._backColor=8952251,this._edgeColor=3355494,this._faceOpacity=1,this._edgeVisible=!0,this._profileEdge=!0,this.bgCanvas=null,this._resizeObserver=null,this._boundHandlers=[],this.isOrbiting=!1,this.isPanning=!1,this.lastMouse=new Ge,this.orbitTarget=new P(0,0,0),this.spherical=new h0(6e4,Math.PI/4,Math.PI/4),this._verts=0,this._edges=0,this._faces=0,this.raycaster=new Zo,this.faceMap=new Uint32Array(0),this.indexBuffer=new Uint32Array(0),this.frontMesh=null,this.colorAttribute=null,this.colorsDirty=!1,this.container=e,this.renderer=new Ax({antialias:!0,alpha:!1,logarithmicDepthBuffer:!0}),this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2)),this.renderer.setSize(e.clientWidth,e.clientHeight),this.renderer.shadowMap.enabled=!0,this.renderer.shadowMap.type=fd,this.renderer.toneMapping=_i,this.renderer.toneMappingExposure=1,e.appendChild(this.renderer.domElement),this.scene=new Hd,this.updateBackground(),this.camera=new nn(50,e.clientWidth/e.clientHeight,1,1e9),this.updateCameraFromSpherical();const t=e.clientWidth/e.clientHeight;this.orthoCamera=new Dr(-this.orthoZoom*t,this.orthoZoom*t,this.orthoZoom,-this.orthoZoom,1,2e6);const n=new Zd(4210752,2);this.scene.add(n);const i=new Vo(16777215,1.5);i.position.set(5e3,1e4,7e3),this.scene.add(i);const s=new Vo(16777215,.5);s.position.set(-5e3,5e3,-7e3),this.scene.add(s);const o=new $x(8900331,3550553,.6);this.scene.add(o),this.infiniteGrid=this.createInfiniteGrid(),this.scene.add(this.infiniteGrid),this.createAxisLines(),this.createAxisArrows(),this.meshGroup=new Bt,this.meshGroup.name="mesh-group",this.scene.add(this.meshGroup),this.setupEvents()}createAxisLines(){const t=[[[0,0,0,1e8,0,0],16729156],[[0,0,0,0,0,-1e8],4508740]];for(const[n,i]of t){const s=new As;s.setPositions(n);const o=new Pi({color:i,linewidth:1,resolution:new Ge(this.container.clientWidth,this.container.clientHeight)}),a=new Li(s,o);a.computeLineDistances(),this.scene.add(a),this.axisLines.push(a)}}createAxisArrows(){this.axisGroup=new Bt,this.axisGroup.name="axis-arrows";const e=1,t=.25,n=.1,i=[{dir:new P(1,0,0),color:16729156,label:"X"},{dir:new P(0,0,-1),color:4508740,label:"Y"},{dir:new P(0,1,0),color:4491519,label:"Z"}];for(const{dir:s,color:o,label:a}of i){const c=new u0(s,new P(0,0,0),e,o,t,n);this.axisGroup.add(c);const l=document.createElement("canvas");l.width=64,l.height=64;const h=l.getContext("2d");h.fillStyle="#"+o.toString(16).padStart(6,"0"),h.font="bold 48px Arial",h.textAlign="center",h.textBaseline="middle",h.fillText(a,32,32);const d=new Dh(l),u=new Vd({map:d,depthTest:!1,sizeAttenuation:!0,opacity:.7,transparent:!0}),m=new Cx(u),g=s.clone().multiplyScalar(e+.28);m.position.copy(g),m.scale.set(.35,.35,1),this.axisGroup.add(m)}this.scene.add(this.axisGroup),this.updateAxisScale()}updateAxisScale(){if(!this.axisGroup)return;const e=this._viewMode==="3d"?this.spherical.radius*.08:this.orthoZoom*.08;this.axisGroup.scale.set(e,e,e)}updateGridSpacing(e,t){}createInfiniteGrid(){const e=new Bt;e.userData.isGround=!0,e.userData.noPick=!0;const t=1e3,n=5e3,i=1e5,s=Math.floor(i/t),o=Math.floor(i/n),a=new Ge(this.container.clientWidth,this.container.clientHeight);for(let c=-s;c<=s;c++){const l=c*t;if(l%n===0)continue;const h=new As;h.setPositions([-i,0,l,i,0,l]);const d=new Pi({color:11184810,linewidth:.5,transparent:!0,opacity:.3,resolution:a}),u=new Li(h,d);u.computeLineDistances(),u.userData.noPick=!0,e.add(u);const m=new As;m.setPositions([l,0,-i,l,0,i]);const g=new Pi({color:11184810,linewidth:.5,transparent:!0,opacity:.3,resolution:a}),_=new Li(m,g);_.computeLineDistances(),_.userData.noPick=!0,e.add(_)}for(let c=-o;c<=o;c++){const l=c*n;if(l===0)continue;const h=new As;h.setPositions([-i,0,l,i,0,l]);const d=new Pi({color:10066329,linewidth:1,transparent:!0,opacity:.5,resolution:a}),u=new Li(h,d);u.computeLineDistances(),u.userData.noPick=!0,e.add(u);const m=new As;m.setPositions([l,0,-i,l,0,i]);const g=new Pi({color:10066329,linewidth:1,transparent:!0,opacity:.5,resolution:a}),_=new Li(m,g);_.computeLineDistances(),_.userData.noPick=!0,e.add(_)}return e}setupEvents(){const e=this.renderer.domElement,t=[];this.scene.traverse(a=>{a instanceof Li&&a.material instanceof Pi&&t.push(a.material)}),this._resizeObserver=new ResizeObserver(()=>{const a=this.container.clientWidth,c=this.container.clientHeight,l=a/c;this.camera.aspect=l,this.camera.updateProjectionMatrix(),this.orthoCamera.left=-this.orthoZoom*l,this.orthoCamera.right=this.orthoZoom*l,this.orthoCamera.top=this.orthoZoom,this.orthoCamera.bottom=-this.orthoZoom,this.orthoCamera.updateProjectionMatrix(),this.renderer.setSize(a,c);for(const h of t)h.resolution.set(a,c)}),this._resizeObserver.observe(this.container);let n=0,i={x:0,y:0};const s=300,o=5;e.addEventListener("mousedown",a=>{a.button===1?(this._viewMode!=="3d"?this.isPanning=!0:this.isOrbiting=!0,this.lastMouse.set(a.clientX,a.clientY),a.preventDefault()):a.button===2&&(n=Date.now(),i={x:a.clientX,y:a.clientY},this.lastMouse.set(a.clientX,a.clientY),a.preventDefault())}),window.addEventListener("mousemove",a=>{const c=a.clientX-this.lastMouse.x,l=a.clientY-this.lastMouse.y;if(this.lastMouse.set(a.clientX,a.clientY),this.isOrbiting)this.spherical.theta-=c*.01,this.spherical.phi=Math.max(.01,Math.min(Math.PI-.01,this.spherical.phi-l*.01)),this.updateCameraFromSpherical();else if(this.isPanning)if(this._viewMode!=="3d")this.panOrtho(c,l);else{const h=.005*this.spherical.radius;Yh.setFromMatrixColumn(this.camera.matrixWorld,0),$h.setFromMatrixColumn(this.camera.matrixWorld,1),this.orbitTarget.addScaledVector(Yh,-c*h),this.orbitTarget.addScaledVector($h,l*h),this.updateCameraFromSpherical()}a.buttons&2&&Math.hypot(a.clientX-i.x,a.clientY-i.y)>o&&!this.isPanning&&!this.isOrbiting&&(this.isPanning=!0)}),window.addEventListener("mouseup",a=>{if(a.button===2){const c=Date.now()-n,l=Math.hypot(a.clientX-i.x,a.clientY-i.y);c<s&&l<o&&this.showContextMenu(a.clientX,a.clientY)}this.isOrbiting=!1,this.isPanning=!1}),e.addEventListener("wheel",a=>{a.preventDefault();const c=a.deltaY>0?1.1:.9;this._viewMode!=="3d"?(this.orthoZoom=Math.max(50,Math.min(5e8,this.orthoZoom*c)),this.updateOrthoCamera()):(this.spherical.radius=Math.max(100,Math.min(5e8,this.spherical.radius*c)),this.updateCameraFromSpherical())},{passive:!1}),document.addEventListener("contextmenu",a=>a.preventDefault())}onContextMenu(e){this._onContextMenu=e}showContextMenu(e,t){this._onContextMenu?.(e,t)}dispose(){this._resizeObserver&&(this._resizeObserver.disconnect(),this._resizeObserver=null);for(const{target:e,type:t,handler:n}of this._boundHandlers)e.removeEventListener(t,n);this._boundHandlers.length=0,this.renderer.dispose(),this.scene.traverse(e=>{(e instanceof rt||e instanceof Vt||e instanceof Li)&&(e.geometry.dispose(),e.material instanceof Ft&&e.material.dispose())})}updateCameraFromSpherical(){const e=new P().setFromSpherical(this.spherical);this.camera.position.copy(e.add(this.orbitTarget)),this.camera.lookAt(this.orbitTarget),this.updateAxisScale()}get activeCamera(){return this._viewMode==="3d"?this.camera:this.orthoCamera}get viewMode(){return this._viewMode}onViewModeChange(e){this._onViewModeChange=e}setViewMode(e){if(this._viewMode=e,e==="3d")this.updateCameraFromSpherical();else{const n=this.orthoCamera;switch(e){case"top":n.position.set(this.orbitTarget.x,5e8,this.orbitTarget.z),n.up.set(0,0,-1);break;case"bottom":n.position.set(this.orbitTarget.x,-5e8,this.orbitTarget.z),n.up.set(0,0,1);break;case"front":n.position.set(this.orbitTarget.x,this.orbitTarget.y,this.orbitTarget.z+5e8),n.up.set(0,1,0);break;case"back":n.position.set(this.orbitTarget.x,this.orbitTarget.y,this.orbitTarget.z-5e8),n.up.set(0,1,0);break;case"right":n.position.set(this.orbitTarget.x+5e8,this.orbitTarget.y,this.orbitTarget.z),n.up.set(0,1,0);break;case"left":n.position.set(this.orbitTarget.x-5e8,this.orbitTarget.y,this.orbitTarget.z),n.up.set(0,1,0);break}n.lookAt(this.orbitTarget),this.updateOrthoCamera()}this._onViewModeChange?.(e)}updateOrthoCamera(){const e=this.container.clientWidth/this.container.clientHeight;this.orthoCamera.left=-this.orthoZoom*e,this.orthoCamera.right=this.orthoZoom*e,this.orthoCamera.top=this.orthoZoom,this.orthoCamera.bottom=-this.orthoZoom,this.orthoCamera.updateProjectionMatrix(),this.updateAxisScale()}panOrtho(e,t){const n=this.orthoZoom*2/this.container.clientHeight,i=this.orthoCamera,s=new P,o=new P;s.setFromMatrixColumn(i.matrixWorld,0).normalize(),o.setFromMatrixColumn(i.matrixWorld,1).normalize(),this.orbitTarget.addScaledVector(s,-e*n),this.orbitTarget.addScaledVector(o,t*n),i.position.addScaledVector(s,-e*n),i.position.addScaledVector(o,t*n),i.lookAt(this.orbitTarget),i.updateProjectionMatrix()}updateMesh(e,t,n,i,s){for(;this.meshGroup.children.length>0;){const o=this.meshGroup.children[0];this.meshGroup.remove(o),(o instanceof rt||o instanceof Vt)&&(o.geometry.dispose(),o.material instanceof Ft&&o.material.dispose())}if(e.length>0){const o=new at;o.setAttribute("position",new yt(new Float32Array(e),3)),o.setAttribute("normal",new yt(new Float32Array(t),3)),o.setIndex(new yt(new Uint32Array(n),1)),o.computeBoundingBox(),o.computeBoundingSphere(),this.smoothNormals(o,30),this.indexBuffer=new Uint32Array(n),s?(this.faceMap=s,this.createColorAttribute(o,s,e.length)):this.faceMap=new Uint32Array(0);const a=this.colorAttribute!==null,c=new Qi({color:a?16777215:15263976,side:ln,roughness:.6,metalness:.1,polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:1,vertexColors:a}),l=new rt(o,c);l.name="front-mesh",l.castShadow=!0,l.receiveShadow=!0,this.meshGroup.add(l),this.frontMesh=l;const h=new rn({color:a?11579592:10000564,side:Jt,polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:1,vertexColors:a}),d=new rt(o,h);d.name="back-mesh",this.meshGroup.add(d);const u=new zt({color:this._edgeColor}),m=new jd(o,30),g=new Vt(m,u);g.visible=this._edgeVisible,this.meshGroup.add(g)}}smoothNormals(e,t){const n=e.getAttribute("position"),i=e.getAttribute("normal"),s=e.getIndex();if(!n||!i||!s)return;const o=Math.cos(t*Math.PI/180),a=n.count,c=s.array,l=Math.floor(c.length/3),h=new Float32Array(l*3),d=new Float32Array(l*3);for(let f=0;f<l;f++){const p=c[f*3],x=c[f*3+1],y=c[f*3+2],v=n.getX(p),F=n.getY(p),A=n.getZ(p),L=n.getX(x),O=n.getY(x),w=n.getZ(x),S=n.getX(y),U=n.getY(y),Z=n.getZ(y),K=L-v,se=O-F,fe=w-A,z=S-v,de=U-F,$=Z-A,D=se*$-fe*de,B=fe*z-K*$,j=K*de-se*z;h[f*3]=D,h[f*3+1]=B,h[f*3+2]=j;const X=Math.sqrt(D*D+B*B+j*j);X>1e-10&&(d[f*3]=D/X,d[f*3+1]=B/X,d[f*3+2]=j/X)}const u=new Array(a);for(let f=0;f<a;f++)u[f]=[];for(let f=0;f<l;f++)u[c[f*3]].push(f),u[c[f*3+1]].push(f),u[c[f*3+2]].push(f);const m=new Map,g=.01;for(let f=0;f<a;f++){const p=Math.round(n.getX(f)/g)*g,x=Math.round(n.getY(f)/g)*g,y=Math.round(n.getZ(f)/g)*g,v=`${p},${x},${y}`;let F=m.get(v);F||(F=[],m.set(v,F)),F.push(f)}const _=new Float32Array(a*3);for(const f of m.values()){const p=new Set;for(const x of f)for(const y of u[x])p.add(y);for(const x of f){if(u[x].length===0)continue;const y=u[x][0],v=d[y*3],F=d[y*3+1],A=d[y*3+2];let L=0,O=0,w=0;for(const U of p){const Z=d[U*3],K=d[U*3+1],se=d[U*3+2];v*Z+F*K+A*se>=o&&(L+=h[U*3],O+=h[U*3+1],w+=h[U*3+2])}const S=Math.sqrt(L*L+O*O+w*w);S>1e-10?(_[x*3]=L/S,_[x*3+1]=O/S,_[x*3+2]=w/S):(_[x*3]=i.getX(x),_[x*3+1]=i.getY(x),_[x*3+2]=i.getZ(x))}}i.set(_),i.needsUpdate=!0}createColorAttribute(e,t,n){const i=Cr(),s=Math.floor(n/3),o=new Float32Array(s*3),a=15263976,c=(a>>16&255)/255,l=(a>>8&255)/255,h=(a&255)/255;for(let u=0;u<s;u++)o[u*3]=c,o[u*3+1]=l,o[u*3+2]=h;const d=this.indexBuffer;for(let u=0;u<t.length;u++){const m=t[u],g=i.getMaterialForFace(m);if(!g)continue;const _=g.visual.color,f=(_>>16&255)/255,p=(_>>8&255)/255,x=(_&255)/255;for(let y=0;y<3;y++){const F=d[u*3+y]*3;o[F]=f,o[F+1]=p,o[F+2]=x}}this.colorAttribute=new yt(o,3),e.setAttribute("color",this.colorAttribute)}refreshMaterialColors(){if(!this.frontMesh||!this.colorAttribute||this.faceMap.length===0)return;const e=Cr(),t=this.colorAttribute.array,n=15263976,i=this.indexBuffer;let s=!1;for(let o=0;o<this.faceMap.length;o++){const a=this.faceMap[o],c=e.getMaterialForFace(a);let l=n;c&&(l=c.visual.color);const h=(l>>16&255)/255,d=(l>>8&255)/255,u=(l&255)/255;for(let m=0;m<3;m++){const _=i[o*3+m]*3;(t[_]!==h||t[_+1]!==d||t[_+2]!==u)&&(t[_]=h,t[_+1]=d,t[_+2]=u,s=!0)}}s&&(this.colorAttribute.needsUpdate=!0)}pick(e,t){const n=this.renderer.domElement.getBoundingClientRect(),i=new Ge((e-n.left)/n.width*2-1,-((t-n.top)/n.height)*2+1);this.raycaster.setFromCamera(i,this.activeCamera);const s=this.meshGroup.children.filter(c=>c instanceof rt),o=this.raycaster.intersectObjects(s,!1);return o.length===0?null:o.find(c=>{const l=c.object.material;return l&&l.side!==Jt})||o[0]}pickEdge(e,t){const n=this.renderer.domElement.getBoundingClientRect(),i=new Ge((e-n.left)/n.width*2-1,-((t-n.top)/n.height)*2+1);this.raycaster.setFromCamera(i,this.activeCamera);const o=this.activeCamera.position.length(),a=Math.max(o*.005,10),c=this.raycaster.params.Line?.threshold??1;this.raycaster.params.Line||(this.raycaster.params.Line={threshold:1}),this.raycaster.params.Line.threshold=a;const l=this.meshGroup.children.filter(d=>d instanceof Vt),h=this.raycaster.intersectObjects(l,!1);return this.raycaster.params.Line.threshold=c,h.length>0?h[0]:null}backupFaceIndices(){const e=this.meshGroup.children.find(n=>n instanceof rt&&n.name==="front-mesh");if(!e)return null;const t=e.geometry.getIndex();return t?new Uint32Array(t.array):null}hideFace(e,t){const n=this.meshGroup.children.find(c=>c instanceof rt&&c.name==="front-mesh");if(!n)return;const i=n.geometry,s=i.getIndex();if(!s)return;const o=s.array,a=[];for(let c=0;c<e.length;c++)if(e[c]!==t){const l=c*3;l+2<o.length&&a.push(o[l],o[l+1],o[l+2])}i.setIndex(a)}restoreFace(e){const t=this.meshGroup.children.find(n=>n instanceof rt&&n.name==="front-mesh");t&&t.geometry.setIndex(new yt(e,1))}setStats(e,t){this._verts=e,this._faces=t}getStats(){return{verts:this._verts,edges:this._edges,faces:this._faces}}getCameraState(){return{viewMode:this._viewMode,radius:this.spherical.radius,phi:this.spherical.phi,theta:this.spherical.theta,targetX:this.orbitTarget.x,targetY:this.orbitTarget.y,targetZ:this.orbitTarget.z,orthoZoom:this.orthoZoom}}setCameraState(e){e.radius!==void 0&&(this.spherical.radius=e.radius),e.phi!==void 0&&(this.spherical.phi=e.phi),e.theta!==void 0&&(this.spherical.theta=e.theta),e.targetX!==void 0&&(this.orbitTarget.x=e.targetX),e.targetY!==void 0&&(this.orbitTarget.y=e.targetY),e.targetZ!==void 0&&(this.orbitTarget.z=e.targetZ),e.orthoZoom!==void 0&&(this.orthoZoom=e.orthoZoom),e.viewMode?this.setViewMode(e.viewMode):this.updateCameraFromSpherical()}resetCamera(){this.orbitTarget.set(0,0,0),this.spherical.set(6e4,Math.PI/4,Math.PI/4),this._viewMode==="3d"?this.updateCameraFromSpherical():this.setViewMode(this._viewMode)}updateBackground(e,t,n,i){if(e!==void 0&&(this._bgMode=e),t!==void 0&&(this._bgSkyColor=t),n!==void 0&&(this._bgGroundColor=n),i!==void 0&&(this._bgMidColor=i),this._bgMode==="solid"){this.scene.background=new qe(this._bgSkyColor);return}this.bgCanvas||(this.bgCanvas=document.createElement("canvas"),this.bgCanvas.width=2,this.bgCanvas.height=512);const s=this.bgCanvas.getContext("2d"),o=s.createLinearGradient(0,0,0,512);this._bgMode==="gradient2"?(o.addColorStop(0,this._bgSkyColor),o.addColorStop(1,this._bgGroundColor)):(o.addColorStop(0,this._bgSkyColor),o.addColorStop(.5,this._bgMidColor),o.addColorStop(1,this._bgGroundColor)),s.fillStyle=o,s.fillRect(0,0,2,512);const a=new Dh(this.bgCanvas);a.needsUpdate=!0,this.scene.background instanceof jt&&this.scene.background.dispose(),this.scene.background=a}setFaceColors(e,t){e!==void 0&&(this._frontColor=e),t!==void 0&&(this._backColor=t);for(const n of this.meshGroup.children)if(n instanceof rt){const i=n.material;i.side===ln?i.color.setHex(this._frontColor):i.side===Jt&&i.color.setHex(this._backColor)}}setFaceOpacity(e){this._faceOpacity=e;for(const t of this.meshGroup.children)if(t instanceof rt){const n=t.material;n.transparent=e<1,n.opacity=e,n.needsUpdate=!0}}setEdgeStyle(e){e.color!==void 0&&(this._edgeColor=e.color),e.visible!==void 0&&(this._edgeVisible=e.visible),e.profileEdge!==void 0&&(this._profileEdge=e.profileEdge);for(const t of this.meshGroup.children)t instanceof Vt&&(t.visible=this._edgeVisible,t.material.color.setHex(this._edgeColor))}setGridVisible(e){this.infiniteGrid.visible=e}setGridColor(e){const t=new qe(e);this.infiniteGrid.traverse(n=>{n instanceof Li&&(n.material.color=t)})}setAxisVisible(e){this.axisGroup&&(this.axisGroup.visible=e);for(const t of this.axisLines)t.visible=e}getStyleSettings(){return{bgMode:this._bgMode,bgSkyColor:this._bgSkyColor,bgMidColor:this._bgMidColor,bgGroundColor:this._bgGroundColor,frontColor:this._frontColor,backColor:this._backColor,edgeColor:this._edgeColor,faceOpacity:this._faceOpacity,edgeVisible:this._edgeVisible,profileEdge:this._profileEdge,gridVisible:this.infiniteGrid.visible,axisVisible:this.axisGroup?this.axisGroup.visible:!0}}applyStylePreset(e){this.updateBackground(e.bgMode,e.bgSkyColor,e.bgGroundColor,e.bgMidColor),this.setFaceColors(e.frontColor,e.backColor),this.setEdgeStyle({color:e.edgeColor})}start(){const e=()=>{requestAnimationFrame(e),this.renderer.render(this.scene,this.activeCamera)};e()}}class y0{constructor(e){this.labels=[],this.container=e,this.overlay=document.createElement("div"),this.overlay.id="dim-overlay",this.overlay.style.cssText=`
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none; z-index: 200; overflow: hidden;
    `,e.appendChild(this.overlay),this.canvas=document.createElement("canvas"),this.canvas.id="dim-canvas",this.canvas.style.cssText=`
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none; z-index: 199;
    `,e.appendChild(this.canvas),this.ctx=this.canvas.getContext("2d"),new ResizeObserver(()=>{this.canvas.width=e.clientWidth*window.devicePixelRatio,this.canvas.height=e.clientHeight*window.devicePixelRatio,this.canvas.style.width=e.clientWidth+"px",this.canvas.style.height=e.clientHeight+"px",this.ctx.scale(window.devicePixelRatio,window.devicePixelRatio)}).observe(e)}update(e,t){const n=this.container.clientWidth,i=this.container.clientHeight;for(this.ctx.save(),this.ctx.setTransform(window.devicePixelRatio,0,0,window.devicePixelRatio,0,0),this.ctx.clearRect(0,0,n,i);this.labels.length>t.length;){const s=this.labels.pop();this.overlay.removeChild(s)}for(;this.labels.length<t.length;){const s=document.createElement("div");s.className="dim-label",this.overlay.appendChild(s),this.labels.push(s)}for(let s=0;s<t.length;s++){const o=t[s],a=this.labels[s],c=o.color||"#4ac1ff",l=this.toScreen(o.from,e,n,i),h=this.toScreen(o.to,e,n,i);if(!l||!h){a.style.display="none";continue}this.ctx.strokeStyle=c,this.ctx.lineWidth=1.5,this.ctx.setLineDash([4,3]),this.ctx.beginPath(),this.ctx.moveTo(l.x,l.y),this.ctx.lineTo(h.x,h.y),this.ctx.stroke(),this.ctx.setLineDash([]),this.drawEndpoint(l.x,l.y,c),this.drawEndpoint(h.x,h.y,c);const d=h.x-l.x,u=h.y-l.y,m=Math.sqrt(d*d+u*u);let g=Math.atan2(u,d);g>Math.PI/2&&(g-=Math.PI),g<-Math.PI/2&&(g+=Math.PI);const _=m>0?-u/m:0,f=m>0?d/m:-1,p=14,x=(l.x+h.x)/2+_*p,y=(l.y+h.y)/2+f*p;a.textContent=o.text,a.style.display="block",a.style.left=x+"px",a.style.top=y+"px",a.style.transform=`translate(-50%, -50%) rotate(${g}rad)`,a.style.setProperty("--dim-color",c)}this.ctx.restore()}showAtCursor(e,t,n,i="#4ac1ff"){const s=this.container.clientWidth,o=this.container.clientHeight;for(this.ctx.save(),this.ctx.setTransform(window.devicePixelRatio,0,0,window.devicePixelRatio,0,0),this.ctx.clearRect(0,0,s,o),this.ctx.restore();this.labels.length>1;){const c=this.labels.pop();this.overlay.removeChild(c)}if(this.labels.length===0){const c=document.createElement("div");c.className="dim-label",this.overlay.appendChild(c),this.labels.push(c)}const a=this.toScreen(t,e,s,o);if(!a){this.labels[0].style.display="none";return}this.labels[0].textContent=n,this.labels[0].style.display="block",this.labels[0].style.left=a.x+20+"px",this.labels[0].style.top=a.y-14+"px",this.labels[0].style.setProperty("--dim-color",i)}showAtScreen(e,t,n,i="#4ac1ff"){const s=this.container.clientWidth,o=this.container.clientHeight;for(this.ctx.save(),this.ctx.setTransform(window.devicePixelRatio,0,0,window.devicePixelRatio,0,0),this.ctx.clearRect(0,0,s,o),this.ctx.restore();this.labels.length>1;){const l=this.labels.pop();this.overlay.removeChild(l)}if(this.labels.length===0){const l=document.createElement("div");l.className="dim-label",this.overlay.appendChild(l),this.labels.push(l)}const a=Math.min(e+20,s-120),c=Math.max(t-14,10);this.labels[0].textContent=n,this.labels[0].style.display="block",this.labels[0].style.left=a+"px",this.labels[0].style.top=c+"px",this.labels[0].style.setProperty("--dim-color",i)}clear(){for(const n of this.labels)n.style.display="none";const e=this.container.clientWidth,t=this.container.clientHeight;this.ctx.save(),this.ctx.setTransform(window.devicePixelRatio,0,0,window.devicePixelRatio,0,0),this.ctx.clearRect(0,0,e,t),this.ctx.restore()}toScreen(e,t,n,i){const s=e.clone().project(t);return s.z<-1||s.z>1?null:{x:(s.x*.5+.5)*n,y:(-s.y*.5+.5)*i}}drawEndpoint(e,t,n){this.ctx.fillStyle=n,this.ctx.beginPath(),this.ctx.moveTo(e,t-3),this.ctx.lineTo(e+3,t),this.ctx.lineTo(e,t+3),this.ctx.lineTo(e-3,t),this.ctx.closePath(),this.ctx.fill()}}const lr={mm:{type:"mm",label:"mm",labelLong:"밀리미터 (mm)",fromMM:1,toMM:1},cm:{type:"cm",label:"cm",labelLong:"센티미터 (cm)",fromMM:.1,toMM:10},m:{type:"m",label:"m",labelLong:"미터 (m)",fromMM:.001,toMM:1e3},in:{type:"in",label:"in",labelLong:"인치 (in)",fromMM:1/25.4,toMM:25.4},ft:{type:"ft",label:"ft",labelLong:"피트 (ft)",fromMM:1/304.8,toMM:304.8}};class dl{constructor(){this._unit="mm",this._precision=4,this._gridSnap=!0,this._snapInterval=1,this._listeners=[],this.loadFromStorage()}get unit(){return this._unit}set unit(e){this._unit!==e&&lr[e]&&(this._unit=e,this.saveToStorage(),this.notifyListeners())}get precision(){return this._precision}set precision(e){const t=Math.max(0,Math.min(8,Math.round(e)));this._precision!==t&&(this._precision=t,this.saveToStorage(),this.notifyListeners())}get gridSnap(){return this._gridSnap}set gridSnap(e){this._gridSnap=e,this.saveToStorage(),this.notifyListeners()}get snapInterval(){return this._snapInterval}set snapInterval(e){this._snapInterval=Math.max(1e-4,e),this.saveToStorage(),this.notifyListeners()}get config(){return lr[this._unit]}static get allUnits(){return Object.values(lr)}fromInternal(e){return e*this.config.fromMM}toInternal(e){return e*this.config.toMM}format(e,t=!0){const i=this.fromInternal(e).toFixed(this._precision);return t?`${i} ${this.config.label}`:i}snap(e){return!this._gridSnap||this._snapInterval<=0?e:Math.round(e/this._snapInterval)*this._snapInterval}parseInput(e){const t=e.trim().toLowerCase();for(const[i,s]of Object.entries(lr))if(t.endsWith(i)){const o=t.slice(0,-i.length).trim(),a=parseFloat(o);return isNaN(a)?null:a*s.toMM}const n=parseFloat(t);return isNaN(n)?null:this.toInternal(n)}onChange(e){return this._listeners.push(e),()=>{this._listeners=this._listeners.filter(t=>t!==e)}}notifyListeners(){for(const e of this._listeners)e()}saveToStorage(){try{const e={unit:this._unit,precision:this._precision,gridSnap:this._gridSnap,snapInterval:this._snapInterval};localStorage.setItem("axia3d-units",JSON.stringify(e))}catch{}}loadFromStorage(){try{const e=localStorage.getItem("axia3d-units");if(!e)return;const t=JSON.parse(e);t.unit&&lr[t.unit]&&(this._unit=t.unit),typeof t.precision=="number"&&(this._precision=Math.max(0,Math.min(8,t.precision))),typeof t.gridSnap=="boolean"&&(this._gridSnap=t.gridSnap),typeof t.snapInterval=="number"&&(this._snapInterval=Math.max(1e-4,t.snapInterval))}catch{}}}const En="#FF3333",Ga="#FF3333",b0="#FF3333",Kh={endpoint:{shape:"square",color:En,label:"끝점",labelEn:"Endpoint"},midpoint:{shape:"triangle",color:En,label:"중간점",labelEn:"Midpoint"},intersection:{shape:"x",color:En,label:"교차점",labelEn:"Intersection"},apparent:{shape:"apparent",color:En,label:"가상 교차점",labelEn:"Apparent Int."},extension:{shape:"extension",color:En,label:"연장선",labelEn:"Extension"},center:{shape:"circle",color:En,label:"중심점",labelEn:"Center"},geometric:{shape:"geometric",color:En,label:"기하학적 중심",labelEn:"Geo. Center"},quadrant:{shape:"diamond",color:En,label:"사분점",labelEn:"Quadrant"},tangent:{shape:"circle",color:En,label:"접점",labelEn:"Tangent"},perpendicular:{shape:"perpendicular",color:En,label:"수직점",labelEn:"Perpendicular"},parallel:{shape:"parallel",color:En,label:"평행",labelEn:"Parallel"},node:{shape:"dot",color:En,label:"노드",labelEn:"Node"},insertion:{shape:"plus",color:En,label:"삽입",labelEn:"Insertion"},nearest:{shape:"x",color:Ga,label:"근처점",labelEn:"Nearest"},tempTrack:{shape:"plus",color:Ga,label:"임시 추적점",labelEn:"Temp Track"},from:{shape:"dot",color:b0,label:"시작점",labelEn:"From"},mid2p:{shape:"triangle",color:Ga,label:"2점 중간",labelEn:"Mid 2 Points"}},Zh={endpoint:0,intersection:1,midpoint:2,apparent:3,center:4,geometric:5,quadrant:6,perpendicular:7,tangent:8,parallel:9,extension:10,node:11,insertion:12,nearest:13,tempTrack:14,from:16,mid2p:17};class M0{constructor(){this.vertices=[],this.edges=[],this.faceCenters=[],this.faceData=new Map,this.referencePoint=null,this.hoveredEdge=null,this.parallelRef=null,this.trackPoints=[],this.mid2pFirst=null,this._lastSnap=null,this.config={enabled:!0,modes:new Set(["endpoint","intersection","center","perpendicular"]),pixelThreshold:15,gridSpacing:1e3,showTooltip:!0,showMarker:!0,magnetStrength:1}}get enabled(){return this.config.enabled}set enabled(e){this.config.enabled=e}get modes(){return this.config.modes}get lastSnap(){return this._lastSnap}get pixelThreshold(){return this.config.pixelThreshold}set pixelThreshold(e){this.config.pixelThreshold=e}get showTooltip(){return this.config.showTooltip}set showTooltip(e){this.config.showTooltip=e}get showMarker(){return this.config.showMarker}set showMarker(e){this.config.showMarker=e}toggleMode(e){return this.config.modes.has(e)?(this.config.modes.delete(e),!1):(this.config.modes.add(e),!0)}setMode(e,t){t?this.config.modes.add(e):this.config.modes.delete(e)}isActive(e){return this.config.modes.has(e)}toggle(){return this.config.enabled=!this.config.enabled,this.config.enabled}setReferencePoint(e){this.referencePoint=e?e.clone():null}setParallelRef(e){this.parallelRef=e?e.clone().normalize():null}addTrackPoint(e){this.trackPoints.push(e.clone())}clearTrackPoints(){this.trackPoints=[],this.mid2pFirst=null}setMid2pFirst(e){this.mid2pFirst=e?e.clone():null}onSnapChange(e){this._onSnapChange=e}updateFromMesh(e,t,n,i){this.vertices=[],this.edges=[],this.faceCenters=[],this.faceData.clear();const s=new Map;if(e.length>0){const l=e.length/3;for(let h=0;h<l;h++){const d=new P(e[h*3],e[h*3+1],e[h*3+2]),u=`${d.x.toFixed(1)},${d.y.toFixed(1)},${d.z.toFixed(1)}`;s.has(u)||s.set(u,d)}}if(i&&i.length>=6)for(let l=0;l<i.length;l+=6){const h=new P(i[l],i[l+1],i[l+2]),d=new P(i[l+3],i[l+4],i[l+5]);this.edges.push({a:h,b:d});const u=`${h.x.toFixed(1)},${h.y.toFixed(1)},${h.z.toFixed(1)}`,m=`${d.x.toFixed(1)},${d.y.toFixed(1)},${d.z.toFixed(1)}`;s.has(u)||s.set(u,h.clone()),s.has(m)||s.set(m,d.clone())}else if(e.length>0){const l=new Map,h=(u,m)=>{const g=`${u.x.toFixed(1)},${u.y.toFixed(1)},${u.z.toFixed(1)}`,_=`${m.x.toFixed(1)},${m.y.toFixed(1)},${m.z.toFixed(1)}`;return g<_?`${g}|${_}`:`${_}|${g}`},d=t.length/3;for(let u=0;u<d;u++){const[m,g,_]=[t[u*3],t[u*3+1],t[u*3+2]],f=[m,g,_].map(p=>new P(e[p*3],e[p*3+1],e[p*3+2]));for(const[p,x]of[[f[0],f[1]],[f[1],f[2]],[f[2],f[0]]]){const y=h(p,x),v=l.get(y);v?v.count++:l.set(y,{a:p.clone(),b:x.clone(),count:1})}}for(const[,u]of l)this.edges.push({a:u.a,b:u.b})}if(this.vertices=Array.from(s.values()),e.length===0&&this.edges.length===0)return;const o=new Map,a=new Map,c=t.length/3;for(let l=0;l<c;l++){const h=n[l];o.has(h)||(o.set(h,new Set),a.set(h,[]));const d=o.get(h),u=a.get(h);for(let m=0;m<3;m++){const g=t[l*3+m],_=new P(e[g*3],e[g*3+1],e[g*3+2]),f=`${_.x.toFixed(1)},${_.y.toFixed(1)},${_.z.toFixed(1)}`;d.has(f)||(d.add(f),u.push(_))}}for(const[l,h]of a){const d=new P;for(const u of h)d.add(u);d.divideScalar(h.length),this.faceCenters.push(d),this.faceData.set(l,{center:d,verts:[...h]})}}findSnap(e,t,n,i,s){if(!this.config.enabled)return this.setResult(null),null;const o=i.getBoundingClientRect(),a=new Ge(e,t),c=this.config.pixelThreshold,l=[],h=g=>{const _=g.clone().project(n);return _.z<-1||_.z>1?null:new Ge((_.x*.5+.5)*o.width+o.left,(-_.y*.5+.5)*o.height+o.top)},d=(g,_,f,p)=>{const x=a.distanceTo(f);l.push({type:g,position:_.clone(),screenPos:f.clone(),distance:x,edgeRef:p?{a:p.a.clone(),b:p.b.clone()}:void 0})},u=this.config.modes;if(u.has("endpoint"))for(const g of this.vertices){const _=h(g);_&&a.distanceTo(_)<=c&&d("endpoint",g,_)}if(u.has("midpoint"))for(const g of this.edges){const _=g.a.clone().add(g.b).multiplyScalar(.5),f=h(_);f&&a.distanceTo(f)<=c&&d("midpoint",_,f,g)}if(u.has("intersection")){const g=Math.min(this.edges.length,200);for(let _=0;_<g;_++)for(let f=_+1;f<g;f++){const p=this.segmentIntersection(this.edges[_],this.edges[f]);if(!p)continue;const x=h(p);x&&a.distanceTo(x)<=c&&d("intersection",p,x)}}if(u.has("apparent")){const g=Math.min(this.edges.length,100);for(let _=0;_<g;_++)for(let f=_+1;f<g;f++){const p=this.apparentIntersection(this.edges[_],this.edges[f],n,o);if(!p)continue;const x=h(p);x&&a.distanceTo(x)<=c&&d("apparent",p,x)}}if(u.has("extension")&&s)for(const g of this.edges){const _=this.extensionSnap(s,g,c,h,a);_&&d("extension",_.position,_.screenPx,g)}if(u.has("center"))for(const g of this.faceCenters){const _=h(g);_&&a.distanceTo(_)<=c&&d("center",g,_)}if(u.has("geometric"))for(const[,g]of this.faceData){const _=h(g.center);_&&a.distanceTo(_)<=c&&d("geometric",g.center,_)}if(u.has("quadrant"))for(const[,g]of this.faceData){if(g.verts.length<8)continue;const _=this.quadrantPoints(g.center,g.verts);for(const f of _){const p=h(f);p&&a.distanceTo(p)<=c&&d("quadrant",f,p)}}if(u.has("perpendicular")&&this.referencePoint)for(const g of this.edges){const _=this.perpendicularPoint(this.referencePoint,g.a,g.b);if(!_)continue;const f=h(_);f&&a.distanceTo(f)<=c&&d("perpendicular",_,f,g)}if(u.has("parallel")&&this.referencePoint&&s)for(const g of this.edges){const _=this.parallelSnap(this.referencePoint,s,g);if(!_)continue;const f=h(_);f&&a.distanceTo(f)<=c*1.5&&d("parallel",_,f,g)}if(u.has("nearest")&&s){let g=null;for(const _ of this.edges){const f=this.closestPointOnSegment(s,_.a,_.b),p=h(f);if(!p)continue;const x=a.distanceTo(p);x<=c&&(!g||x<g.dist)&&(g={pos:f,dist:x,edge:_})}g&&d("nearest",g.pos,h(g.pos),g.edge)}if(l.length===0)return this.setResult(null),null;l.sort((g,_)=>{const f=Zh[g.type],p=Zh[_.type];return f!==p?f-p:(g.distance||0)-(_.distance||0)});const m=l[0];return this.setResult(m),m}findSnapOverride(e,t,n,i,s,o){const a=this.config.enabled,c=new Set(this.config.modes);this.config.enabled=!0,this.config.modes=new Set([e]);const l=this.findSnap(t,n,i,s,o);return this.config.enabled=a,this.config.modes=c,l}setResult(e){this._lastSnap=e,this._onSnapChange?.(e)}closestPointOnSegment(e,t,n){const i=n.clone().sub(t),s=i.dot(i);if(s<1e-10)return t.clone();let o=e.clone().sub(t).dot(i)/s;return o=Math.max(0,Math.min(1,o)),t.clone().add(i.multiplyScalar(o))}perpendicularPoint(e,t,n){const i=n.clone().sub(t),s=i.dot(i);if(s<1e-10)return null;const o=e.clone().sub(t).dot(i)/s;return o<-.01||o>1.01?null:t.clone().add(i.multiplyScalar(Math.max(0,Math.min(1,o))))}segmentIntersection(e,t){const n=e.b.clone().sub(e.a),i=t.b.clone().sub(t.a),s=e.a.clone().sub(t.a),o=n.dot(n),a=i.dot(i),c=n.dot(i),l=s.dot(n),h=s.dot(i),d=o*a-c*c;if(Math.abs(d)<1e-10)return null;const u=(c*h-a*l)/d,m=(o*h-c*l)/d;if(u<-.01||u>1.01||m<-.01||m>1.01)return null;const g=e.a.clone().add(n.multiplyScalar(u)),_=t.a.clone().add(i.multiplyScalar(m));return g.distanceTo(_)>1?null:g.add(_).multiplyScalar(.5)}apparentIntersection(e,t,n,i){const s=e.b.clone().sub(e.a),o=t.b.clone().sub(t.a),a=e.a.clone().sub(t.a),c=s.dot(s),l=o.dot(o),h=s.dot(o),d=a.dot(s),u=a.dot(o),m=c*l-h*h;if(Math.abs(m)<1e-10)return null;const g=(h*u-l*d)/m,_=(c*u-h*d)/m;if(g>=-.01&&g<=1.01&&_>=-.01&&_<=1.01||Math.abs(g)>3||Math.abs(_)>3)return null;const f=e.a.clone().add(s.multiplyScalar(g)),p=t.a.clone().add(o.multiplyScalar(_));return f.distanceTo(p)>5?null:f.add(p).multiplyScalar(.5)}extensionSnap(e,t,n,i,s){const o=t.b.clone().sub(t.a).normalize(),a=t.a.distanceTo(t.b);for(const[c,l]of[[t.b,1],[t.a,-1]]){const d=e.clone().sub(c).dot(o)*l;if(d<=0||d>a*3)continue;const u=c.clone().add(o.clone().multiplyScalar(d*l)),m=i(u);if(!m)continue;if(s.distanceTo(m)<=n)return{position:u,screenPx:m}}return null}parallelSnap(e,t,n){const i=n.b.clone().sub(n.a).normalize(),o=t.clone().sub(e).dot(i);if(Math.abs(o)<1)return null;const a=e.clone().add(i.multiplyScalar(o)),c=a.distanceTo(t),l=Math.max(50,Math.abs(o)*.05);return c<l?a:null}quadrantPoints(e,t){if(t.length<4)return[];const n=t[0].clone().sub(e),i=t[1].clone().sub(e),s=n.clone().cross(i).normalize();let o=n.clone().normalize(),a=s.clone().cross(o).normalize(),c=0;for(const h of t)c+=h.distanceTo(e);const l=c/t.length;return[e.clone().add(o.clone().multiplyScalar(l)),e.clone().add(a.clone().multiplyScalar(l)),e.clone().add(o.clone().multiplyScalar(-l)),e.clone().add(a.clone().multiplyScalar(-l))]}}class S0{constructor(e){this.markerSize=8,this.tooltipVisible=!0,this.container=e,this.canvas=document.createElement("canvas"),this.canvas.style.position="absolute",this.canvas.style.top="0",this.canvas.style.left="0",this.canvas.style.width="100%",this.canvas.style.height="100%",this.canvas.style.pointerEvents="none",this.canvas.style.zIndex="50",e.appendChild(this.canvas),this.ctx=this.canvas.getContext("2d"),this.resize(),new ResizeObserver(()=>this.resize()).observe(e)}resize(){const e=window.devicePixelRatio||1,t=this.container.clientWidth,n=this.container.clientHeight;this.canvas.width=t*e,this.canvas.height=n*e,this.ctx.setTransform(e,0,0,e,0,0)}update(e,t,n){if(this.clear(),!e||!e.screenPos)return;const i=this.container.getBoundingClientRect(),s=e.screenPos.x-i.left,o=e.screenPos.y-i.top,a=Kh[e.type];a&&(e.type==="extension"&&e.edgeRef&&t&&this.drawExtensionLine(e,t),this.drawMarker(e.type,s,o,a.color),this.tooltipVisible&&this.drawTooltip(a.label,s,o,a.color))}clear(){this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height)}setTooltipVisible(e){this.tooltipVisible=e}getMarkerSize(){return this.markerSize}setMarkerSize(e){this.markerSize=e}drawMarker(e,t,n,i){const s=this.ctx,o=this.markerSize;switch(s.strokeStyle=i,s.fillStyle=i,s.lineWidth=1.2,s.lineCap="square",s.lineJoin="miter",Kh[e].shape){case"square":this.drawSquare(t,n,o,i);break;case"triangle":this.drawTriangle(t,n,o,i);break;case"x":this.drawX(t,n,o,i);break;case"circle":this.drawCircle(t,n,o,i);break;case"diamond":this.drawDiamond(t,n,o,i);break;case"perpendicular":this.drawPerpendicular(t,n,o,i);break;case"parallel":this.drawParallel(t,n,o,i);break;case"dot":this.drawDot(t,n,o,i);break;case"plus":this.drawPlus(t,n,o,i);break;case"extension":this.drawExtensionMarker(t,n,o,i);break;case"apparent":this.drawApparent(t,n,o,i);break;case"geometric":this.drawGeometric(t,n,o,i);break}}drawSquare(e,t,n,i){const s=this.ctx;s.strokeStyle=i,s.lineWidth=1.2,s.strokeRect(e-n,t-n,n*2,n*2)}drawTriangle(e,t,n,i){const s=this.ctx;s.strokeStyle=i,s.lineWidth=1.2,s.beginPath(),s.moveTo(e,t-n),s.lineTo(e-n,t+n*.8),s.lineTo(e+n,t+n*.8),s.closePath(),s.stroke()}drawX(e,t,n,i){const s=this.ctx;s.strokeStyle=i,s.lineWidth=1.2,s.beginPath(),s.moveTo(e-n,t-n),s.lineTo(e+n,t+n),s.moveTo(e+n,t-n),s.lineTo(e-n,t+n),s.stroke()}drawCircle(e,t,n,i){const s=this.ctx;s.strokeStyle=i,s.lineWidth=1.2,s.beginPath(),s.arc(e,t,n,0,Math.PI*2),s.stroke()}drawDiamond(e,t,n,i){const s=this.ctx;s.strokeStyle=i,s.lineWidth=1.2,s.beginPath(),s.moveTo(e,t-n),s.lineTo(e+n,t),s.lineTo(e,t+n),s.lineTo(e-n,t),s.closePath(),s.stroke()}drawPerpendicular(e,t,n,i){const s=this.ctx;s.strokeStyle=i,s.lineWidth=1.2,s.beginPath(),s.moveTo(e-n,t-n),s.lineTo(e-n,t+n),s.lineTo(e+n,t+n),s.stroke();const o=n*.4;s.beginPath(),s.moveTo(e-n,t+n-o),s.lineTo(e-n+o,t+n-o),s.lineTo(e-n+o,t+n),s.stroke()}drawParallel(e,t,n,i){const s=this.ctx;s.strokeStyle=i,s.lineWidth=1.2;const o=n*.3;s.beginPath(),s.moveTo(e-n+o,t-n),s.lineTo(e+n+o,t+n),s.moveTo(e-n-o,t-n),s.lineTo(e+n-o,t+n),s.stroke()}drawDot(e,t,n,i){const s=this.ctx;s.fillStyle=i,s.beginPath(),s.arc(e,t,n*.35,0,Math.PI*2),s.fill(),s.strokeStyle=i,s.lineWidth=1.2,s.beginPath(),s.arc(e,t,n,0,Math.PI*2),s.stroke()}drawPlus(e,t,n,i){const s=this.ctx;s.strokeStyle=i,s.lineWidth=1.2,s.beginPath(),s.moveTo(e-n,t),s.lineTo(e+n,t),s.moveTo(e,t-n),s.lineTo(e,t+n),s.stroke()}drawExtensionMarker(e,t,n,i){const s=this.ctx;s.strokeStyle=i,s.lineWidth=1.2,s.setLineDash([3,3]),s.beginPath(),s.moveTo(e-n,t),s.lineTo(e+n,t),s.moveTo(e,t-n),s.lineTo(e,t+n),s.stroke(),s.setLineDash([])}drawApparent(e,t,n,i){this.drawX(e,t,n*.65,i);const s=this.ctx;s.strokeStyle=i,s.lineWidth=1.2,s.strokeRect(e-n,t-n,n*2,n*2)}drawGeometric(e,t,n,i){const s=this.ctx;s.strokeStyle=i,s.lineWidth=1.2,s.strokeRect(e-n,t-n,n*2,n*2),s.fillStyle=i,s.beginPath(),s.arc(e,t,2.5,0,Math.PI*2),s.fill()}drawTooltip(e,t,n,i){const s=this.ctx,o=11;s.font=`100 ${o}px "Pretendard Variable", Pretendard, sans-serif`;const a=t+this.markerSize+6,c=n+this.markerSize+14;s.fillStyle="rgba(0, 0, 0, 0.7)",s.textBaseline="top",s.fillText(e,a+1,c+1),s.fillStyle=i,s.fillText(e,a,c)}drawExtensionLine(e,t){if(!e.edgeRef)return;const n=this.ctx,i=this.container.getBoundingClientRect(),s=h=>{const d=h.clone().project(t);return d.z<-1||d.z>1?null:new Ge((d.x*.5+.5)*i.width,(-d.y*.5+.5)*i.height)},o=s(e.edgeRef.a),a=s(e.edgeRef.b);if(!e.screenPos)return;const c=new Ge(e.screenPos.x-i.left,e.screenPos.y-i.top);let l=null;if(o&&a){const h=o.distanceTo(c),d=a.distanceTo(c);l=h>d?a:o}else l=o||a;l&&(n.strokeStyle="rgba(255, 51, 51, 0.5)",n.lineWidth=1,n.setLineDash([6,4]),n.beginPath(),n.moveTo(l.x,l.y),n.lineTo(c.x,c.y),n.stroke(),n.setLineDash([]))}dispose(){this.canvas.remove()}}class fi{constructor(e){this.selected=new Set,this.selectedEdges=new Set,this.hovered=-1,this.hoveredEdgeSegIndex=-1,this.hoverMesh=null,this.hoverOutline=null,this.selectionMesh=null,this.selectionOutline=null,this.edgeSelectionLine=null,this.edgeHoverLine=null,this.isXiaSelected=!1,this.xiaDotPoints=null,this.xiaBBoxLines=null,this.groups=new Map,this.faceToGroup=new Map,this.nextGroupId=1,this.editingGroupId=null,this.groupBBoxLines=null,this.faceMap=new Uint32Array(0),this.positions=new Float32Array(0),this.indices=new Uint32Array(0),this.edgeLines=null,this.edgeMap=null,this.bridge=null,this.selectionChangeListeners=[],this.highlightGroup=new Bt,this.highlightGroup.name="selection-highlights",this.highlightGroup.renderOrder=1,e.add(this.highlightGroup)}static{this.HOVER_COLOR=5227511}static{this.HOVER_OPACITY=.08}static{this.SELECT_COLOR=2201331}static{this.SELECT_OPACITY=.18}setBridge(e){this.bridge=e}updateBuffers(e,t,n){this.positions=e,this.indices=t,this.faceMap=n;const i=new Set;for(let s=0;s<n.length;s++)i.add(n[s]);for(const s of this.selected)i.has(s)||this.selected.delete(s);this.rebuildSelectionMesh(),this.isXiaSelected&&this.rebuildXiaDots()}updateEdgeBuffers(e,t){if(this.edgeLines=e,this.edgeMap=t,t){const n=new Set;for(let i=0;i<t.length;i++)n.add(t[i]);for(const i of this.selectedEdges)n.has(i)||this.selectedEdges.delete(i)}else this.selectedEdges.clear();this.rebuildEdgeSelectionLine()}onChange(e){this.selectionChangeListeners.push(e)}handleClick(e,t,n){if(e<0){this.clearSelection();return}this.clearXiaDots();const i=this.findSmoothGroup(e);if(t)for(const s of i)this.selected.add(s);else if(n)if([...i].every(o=>this.selected.has(o)))for(const o of i)this.selected.delete(o);else for(const o of i)this.selected.add(o);else{this.selected.clear();for(const s of i)this.selected.add(s)}this.rebuildSelectionMesh(),this.notifyChange()}handleEdgeClick(e,t,n){if(e<0){this.selectedEdges.clear(),this.rebuildEdgeSelectionLine(),this.notifyChange();return}t?this.selectedEdges.add(e):n?this.selectedEdges.has(e)?this.selectedEdges.delete(e):this.selectedEdges.add(e):(this.selected.clear(),this.rebuildSelectionMesh(),this.selectedEdges.clear(),this.selectedEdges.add(e)),this.rebuildEdgeSelectionLine(),this.notifyChange()}getSelectedEdges(){return Array.from(this.selectedEdges)}setEdgeHover(e){e!==this.hoveredEdgeSegIndex&&(this.hoveredEdgeSegIndex=e,this.rebuildEdgeHoverLine())}clearEdgeHover(){this.hoveredEdgeSegIndex<0||(this.hoveredEdgeSegIndex=-1,this.rebuildEdgeHoverLine())}selectFaceWithEdges(e){e<0||(this.clearXiaDots(),this.selected.clear(),this.selectedEdges.clear(),this.selected.add(e),this.edgeMap&&this.edgeLines&&this.addBorderEdgesForFaces(new Set([e])),this.rebuildSelectionMesh(),this.rebuildEdgeSelectionLine(),this.notifyChange())}selectAll(e){if(e<0)return;const n=this.getGroupFaces(e)??this.findConnectedFaces(e);this.selected.clear(),this.selectedEdges.clear();for(const i of n)this.selected.add(i);this.edgeMap&&this.edgeLines&&this.addBorderEdgesForFaces(n),this.isXiaSelected=!0,this.rebuildSelectionMesh(),this.rebuildEdgeSelectionLine(),this.rebuildXiaDots(),this.notifyChange()}addBorderEdgesForFaces(e){if(!this.edgeMap||!this.edgeLines)return;const t=new Set;for(let n=0;n<this.faceMap.length;n++){if(!e.has(this.faceMap[n]))continue;const i=n*3;if(!(i+2>=this.indices.length))for(let s=0;s<3;s++){const o=this.indices[i+s],a=this.positions[o*3],c=this.positions[o*3+1],l=this.positions[o*3+2];t.add(`${a.toFixed(1)},${c.toFixed(1)},${l.toFixed(1)}`)}}for(let n=0;n<this.edgeMap.length;n++){const i=n*6;if(i+5>=this.edgeLines.length)continue;const s=`${this.edgeLines[i].toFixed(1)},${this.edgeLines[i+1].toFixed(1)},${this.edgeLines[i+2].toFixed(1)}`,o=`${this.edgeLines[i+3].toFixed(1)},${this.edgeLines[i+4].toFixed(1)},${this.edgeLines[i+5].toFixed(1)}`;t.has(s)&&t.has(o)&&this.selectedEdges.add(this.edgeMap[n])}}selectAdjacentEdges(e){if(e<0||!this.edgeMap||!this.edgeLines)return;const t=new Set([e]);this.addBorderEdgesForFaces(t),this.rebuildEdgeSelectionLine(),this.notifyChange()}selectEverything(e,t){if(this.selected.clear(),this.selectedEdges.clear(),e)for(let n=0;n<e.length;n++)this.selected.add(e[n]);if(t)for(let n=0;n<t.length;n++)this.selectedEdges.add(t[n]);this.rebuildSelectionMesh(),this.rebuildEdgeSelectionLine(),this.notifyChange()}selectSameType(e,t){const n=this.selected.size>0,i=this.selectedEdges.size>0;if(n&&e)for(let s=0;s<e.length;s++)this.selected.add(e[s]);if(i&&t)for(let s=0;s<t.length;s++)this.selectedEdges.add(t[s]);if(!n&&!i){this.selectEverything(e,t);return}this.rebuildSelectionMesh(),this.rebuildEdgeSelectionLine(),this.notifyChange()}clearSelection(){this.clearXiaDots(),!(this.selected.size===0&&this.selectedEdges.size===0)&&(this.selected.clear(),this.selectedEdges.clear(),this.rebuildSelectionMesh(),this.rebuildEdgeSelectionLine(),this.notifyChange())}getSelectedFaces(){return Array.from(this.selected)}getSmoothGroup(e){return Array.from(this.findSmoothGroup(e))}get selectionCount(){return this.selected.size}isSelected(e){return this.selected.has(e)}groupSelected(){if(this.selected.size<2)return null;for(const n of this.selected){const i=this.faceToGroup.get(n);if(i!==void 0){const s=this.groups.get(i);s&&(s.delete(n),s.size===0&&this.groups.delete(i))}}const e=this.nextGroupId++,t=new Set(this.selected);this.groups.set(e,t);for(const n of t)this.faceToGroup.set(n,e);return e}ungroupSelected(){const e=new Set;for(const t of this.selected){const n=this.faceToGroup.get(t);n!==void 0&&e.add(n)}if(e.size===0)return!1;for(const t of e){const n=this.groups.get(t);if(n){for(const i of n)this.faceToGroup.delete(i);this.groups.delete(t)}}return!0}getGroupFaces(e){const t=this.faceToGroup.get(e);return t===void 0?null:this.groups.get(t)||null}hasGroup(e){return this.faceToGroup.has(e)}getGroupId(e){return this.faceToGroup.get(e)}getAllGroups(){return new Map(this.groups)}get groupCount(){return this.groups.size}enterGroupEdit(e){const t=this.groups.get(e);return!t||t.size===0?!1:(this.editingGroupId=e,this.clearSelection(),this.rebuildGroupBBox(t),console.log(`[SelectionManager] 그룹 편집 모드 진입: Group-${e}`),!0)}exitGroupEdit(){if(this.editingGroupId===null)return!1;const e=this.editingGroupId;return this.editingGroupId=null,this.clearGroupBBox(),console.log(`[SelectionManager] 그룹 편집 모드 종료: Group-${e}`),!0}isInGroupEditMode(){return this.editingGroupId!==null}getEditingGroupId(){return this.editingGroupId}handleGroupEditClick(e,t,n){if(this.editingGroupId===null)return!1;const i=this.groups.get(this.editingGroupId);return i?e>=0&&!i.has(e)?(this.exitGroupEdit(),!1):e<0?(this.selected.clear(),this.rebuildSelectionMesh(),this.notifyChange(),!0):(this.handleClick(e,t,n),!0):!1}selectGroup(e){const t=this.groups.get(e);if(t){this.clearXiaDots(),this.selected.clear(),this.selectedEdges.clear();for(const n of t)this.selected.add(n);this.edgeMap&&this.edgeLines&&this.addBorderEdgesForFaces(t),this.isXiaSelected=!0,this.rebuildSelectionMesh(),this.rebuildEdgeSelectionLine(),this.rebuildXiaDots(),this.notifyChange()}}syncGroupsFromWasm(e){this.groups.clear(),this.faceToGroup.clear();for(const n of e){const i=new Set(n.faceIds);this.groups.set(n.id,i);for(const s of n.faceIds)this.faceToGroup.set(s,n.id)}let t=0;for(const n of e)n.id>t&&(t=n.id);this.nextGroupId=t+1}rebuildGroupBBox(e){this.clearGroupBBox();let t=1/0,n=1/0,i=1/0,s=-1/0,o=-1/0,a=-1/0;for(let x=0;x<this.faceMap.length;x++){if(!e.has(this.faceMap[x]))continue;const y=x*3;if(!(y+2>=this.indices.length))for(let v=0;v<3;v++){const F=this.indices[y+v],A=this.positions[F*3],L=this.positions[F*3+1],O=this.positions[F*3+2];A<t&&(t=A),A>s&&(s=A),L<n&&(n=L),L>o&&(o=L),O<i&&(i=O),O>a&&(a=O)}}if(!isFinite(t))return;const c=2,l=t-c,h=n-c,d=i-c,u=s+c,m=o+c,g=a+c,_=new Float32Array([l,h,d,u,h,d,u,h,d,u,h,g,u,h,g,l,h,g,l,h,g,l,h,d,l,m,d,u,m,d,u,m,d,u,m,g,u,m,g,l,m,g,l,m,g,l,m,d,l,h,d,l,m,d,u,h,d,u,m,d,u,h,g,u,m,g,l,h,g,l,m,g]),f=new at;f.setAttribute("position",new yt(_,3));const p=new Oc({color:16750592,dashSize:6,gapSize:4,linewidth:1,depthTest:!1,depthWrite:!1});this.groupBBoxLines=new Vt(f,p),this.groupBBoxLines.name="group-edit-bbox",this.groupBBoxLines.computeLineDistances(),this.groupBBoxLines.renderOrder=998,this.highlightGroup.add(this.groupBBoxLines)}clearGroupBBox(){this.groupBBoxLines&&(this.highlightGroup.remove(this.groupBBoxLines),this.groupBBoxLines.geometry.dispose(),this.groupBBoxLines.material.dispose(),this.groupBBoxLines=null)}setHover(e){e!==this.hovered&&(this.hovered=e,this.rebuildHoverMesh())}clearHover(){this.hovered<0||(this.hovered=-1,this.rebuildHoverMesh())}rebuildSelectionMesh(){if(this.selectionMesh&&(this.highlightGroup.remove(this.selectionMesh),this.selectionMesh.geometry.dispose(),this.selectionMesh.material.dispose(),this.selectionMesh=null),this.selectionOutline&&(this.highlightGroup.remove(this.selectionOutline),this.selectionOutline.geometry.dispose(),this.selectionOutline.material.dispose(),this.selectionOutline=null),this.selected.size===0)return;const e=this.buildFaceGeometry(this.selected);if(!e)return;const t=new rn({color:fi.SELECT_COLOR,opacity:fi.SELECT_OPACITY,transparent:!0,side:sn,depthTest:!0,depthWrite:!1,polygonOffset:!0,polygonOffsetFactor:-1});this.selectionMesh=new rt(e,t),this.selectionMesh.name="selection-overlay",this.highlightGroup.add(this.selectionMesh);const n=this.buildBoundaryEdges(this.selected);if(n){const i=new zt({color:1402304,linewidth:2,depthTest:!0});this.selectionOutline=new Vt(n,i),this.selectionOutline.name="selection-outline",this.selectionOutline.renderOrder=2,this.highlightGroup.add(this.selectionOutline)}}rebuildHoverMesh(){if(this.hoverMesh&&(this.highlightGroup.remove(this.hoverMesh),this.hoverMesh.geometry.dispose(),this.hoverMesh.material.dispose(),this.hoverMesh=null),this.hoverOutline&&(this.highlightGroup.remove(this.hoverOutline),this.hoverOutline.geometry.dispose(),this.hoverOutline.material.dispose(),this.hoverOutline=null),this.hovered<0||this.selected.has(this.hovered))return;const e=new Set([this.hovered]),t=this.buildFaceGeometry(e);if(!t)return;const n=new rn({color:fi.HOVER_COLOR,opacity:fi.HOVER_OPACITY,transparent:!0,side:sn,depthTest:!0,depthWrite:!1,polygonOffset:!0,polygonOffsetFactor:-1});this.hoverMesh=new rt(t,n),this.hoverMesh.name="hover-overlay",this.highlightGroup.add(this.hoverMesh);const i=this.buildBoundaryEdges(e);if(i){const s=new zt({color:fi.HOVER_COLOR,linewidth:1,depthTest:!0});this.hoverOutline=new Vt(i,s),this.hoverOutline.name="hover-outline",this.hoverOutline.renderOrder=2,this.highlightGroup.add(this.hoverOutline)}}buildFaceGeometry(e){if(this.positions.length===0||this.indices.length===0)return null;const t=[];for(let i=0;i<this.faceMap.length;i++)if(e.has(this.faceMap[i])){const s=i*3;s+2<this.indices.length&&t.push(this.indices[s],this.indices[s+1],this.indices[s+2])}if(t.length===0)return null;const n=new at;return n.setAttribute("position",new yt(new Float32Array(this.positions),3)),n.setIndex(t),n}buildBoundaryEdges(e){if(this.positions.length===0||this.indices.length===0)return null;const t=new Map,n=new Map,i=(a,c)=>a<c?`${a}_${c}`:`${c}_${a}`;for(let a=0;a<this.faceMap.length;a++){if(!e.has(this.faceMap[a]))continue;const c=a*3;if(c+2>=this.indices.length)continue;const l=this.indices[c],h=this.indices[c+1],d=this.indices[c+2],u=[[l,h],[h,d],[d,l]];for(const[m,g]of u){const _=i(m,g);t.set(_,[m,g]),n.set(_,(n.get(_)||0)+1)}}const s=[];for(const[a,[c,l]]of t)(n.get(a)||0)===1&&s.push(this.positions[c*3],this.positions[c*3+1],this.positions[c*3+2],this.positions[l*3],this.positions[l*3+1],this.positions[l*3+2]);if(s.length===0)return null;const o=new at;return o.setAttribute("position",new ot(s,3)),o}findSmoothGroup(e){const n=Math.cos(30.1*Math.PI/180);if(this.faceMap.length===0||this.positions.length===0||this.indices.length===0)return new Set([e]);const i=new Map;for(let m=0;m<this.faceMap.length;m++){const g=this.faceMap[m];let _=i.get(g);_||(_=[],i.set(g,_)),_.push(m)}const s=new Map;for(const[m,g]of i){let _=0,f=0,p=0;for(const y of g){const v=this.indices[y*3],F=this.indices[y*3+1],A=this.indices[y*3+2],L=this.positions[v*3],O=this.positions[v*3+1],w=this.positions[v*3+2],S=this.positions[F*3],U=this.positions[F*3+1],Z=this.positions[F*3+2],K=this.positions[A*3],se=this.positions[A*3+1],fe=this.positions[A*3+2],z=S-L,de=U-O,$=Z-w,D=K-L,B=se-O,j=fe-w;_+=de*j-$*B,f+=$*D-z*j,p+=z*B-de*D}const x=Math.sqrt(_*_+f*f+p*p);s.set(m,x>1e-10?new P(_/x,f/x,p/x):new P(0,1,0))}const o=m=>{const g=Math.round(this.positions[m*3]*100),_=Math.round(this.positions[m*3+1]*100),f=Math.round(this.positions[m*3+2]*100);return`${g}_${_}_${f}`},a=new Map,c=(m,g)=>m<g?`${m}|${g}`:`${g}|${m}`;for(const[m,g]of i)for(const _ of g){const f=this.indices[_*3],p=this.indices[_*3+1],x=this.indices[_*3+2],y=o(f),v=o(p),F=o(x);for(const[A,L]of[[y,v],[v,F],[F,y]]){const O=c(A,L);let w=a.get(O);w||(w=new Set,a.set(O,w)),w.add(m)}}const l=new Map;for(const m of a.values()){if(m.size<2)continue;const g=[...m];for(let _=0;_<g.length;_++)for(let f=_+1;f<g.length;f++){let p=l.get(g[_]);p||(p=new Set,l.set(g[_],p)),p.add(g[f]),p=l.get(g[f]),p||(p=new Set,l.set(g[f],p)),p.add(g[_])}}console.log(`[SmoothGroup] seed=${e}, totalFaces=${i.size}, adjacency entries=${l.size}`);const h=l.get(e);console.log(`[SmoothGroup] seed neighbors=${h?h.size:0}`);const d=new Set([e]),u=[e];for(;u.length>0;){const m=u.shift(),g=s.get(m);if(!g)continue;const _=l.get(m);if(_)for(const f of _){if(d.has(f))continue;const p=s.get(f);if(!p)continue;g.dot(p)>=n&&(d.add(f),u.push(f))}}return console.log(`[SmoothGroup] result: ${d.size} faces selected`),d}findConnectedFaces(e){if(this.bridge){const t=this.bridge.getConnectedFaces(e);if(t.length>0)return console.log("[Selection] DCEL connected faces:",t.length,"from seed:",e),new Set(t)}return console.warn("[Selection] No DCEL bridge — returning seed face only"),new Set([e])}rebuildEdgeSelectionLine(){if(this.edgeSelectionLine&&(this.highlightGroup.remove(this.edgeSelectionLine),this.edgeSelectionLine.geometry.dispose(),this.edgeSelectionLine.material.dispose(),this.edgeSelectionLine=null),this.selectedEdges.size===0||!this.edgeLines||!this.edgeMap)return;const e=[];for(let i=0;i<this.edgeMap.length;i++)if(this.selectedEdges.has(this.edgeMap[i])){const s=i*6;s+5<this.edgeLines.length&&e.push(this.edgeLines[s],this.edgeLines[s+1],this.edgeLines[s+2],this.edgeLines[s+3],this.edgeLines[s+4],this.edgeLines[s+5])}if(e.length===0)return;const t=new at;t.setAttribute("position",new ot(e,3));const n=new zt({color:fi.SELECT_COLOR,linewidth:3,depthTest:!1});this.edgeSelectionLine=new Vt(t,n),this.edgeSelectionLine.renderOrder=999,this.highlightGroup.add(this.edgeSelectionLine)}rebuildEdgeHoverLine(){if(this.edgeHoverLine&&(this.highlightGroup.remove(this.edgeHoverLine),this.edgeHoverLine.geometry.dispose(),this.edgeHoverLine.material.dispose(),this.edgeHoverLine=null),this.hoveredEdgeSegIndex<0||!this.edgeLines)return;const e=this.hoveredEdgeSegIndex*6;if(e+5>=this.edgeLines.length||this.edgeMap&&this.selectedEdges.has(this.edgeMap[this.hoveredEdgeSegIndex]))return;const t=new at;t.setAttribute("position",new ot([this.edgeLines[e],this.edgeLines[e+1],this.edgeLines[e+2],this.edgeLines[e+3],this.edgeLines[e+4],this.edgeLines[e+5]],3));const n=new zt({color:fi.HOVER_COLOR,linewidth:2,depthTest:!1});this.edgeHoverLine=new An(t,n),this.edgeHoverLine.renderOrder=998,this.highlightGroup.add(this.edgeHoverLine)}rebuildXiaDots(){if(this.removeXiaVisuals(),!this.isXiaSelected||this.selected.size===0)return;const e=1,t=new Map;let n=1/0,i=1/0,s=1/0,o=-1/0,a=-1/0,c=-1/0;for(let A=0;A<this.faceMap.length;A++){if(!this.selected.has(this.faceMap[A]))continue;const L=A*3;if(!(L+2>=this.indices.length))for(let O=0;O<3;O++){const w=this.indices[L+O],S=this.positions[w*3],U=this.positions[w*3+1],Z=this.positions[w*3+2],K=`${S.toFixed(e)},${U.toFixed(e)},${Z.toFixed(e)}`;t.has(K)||(t.set(K,[S,U,Z]),S<n&&(n=S),S>o&&(o=S),U<i&&(i=U),U>a&&(a=U),Z<s&&(s=Z),Z>c&&(c=Z))}}if(t.size===0)return;const l=[];for(const[,[A,L,O]]of t)l.push(A,L,O);const h=new at;h.setAttribute("position",new ot(l,3));const d=new Ni({color:4359668,size:7,sizeAttenuation:!1,depthTest:!1,depthWrite:!1});this.xiaDotPoints=new Ns(h,d),this.xiaDotPoints.name="xia-dot-points",this.xiaDotPoints.renderOrder=999,this.highlightGroup.add(this.xiaDotPoints);const u=1,m=n-u,g=i-u,_=s-u,f=o+u,p=a+u,x=c+u,y=new Float32Array([m,g,_,f,g,_,f,g,_,f,g,x,f,g,x,m,g,x,m,g,x,m,g,_,m,p,_,f,p,_,f,p,_,f,p,x,f,p,x,m,p,x,m,p,x,m,p,_,m,g,_,m,p,_,f,g,_,f,p,_,f,g,x,f,p,x,m,g,x,m,p,x]),v=new at;v.setAttribute("position",new yt(y,3));const F=new Oc({color:4359668,dashSize:4,gapSize:3,linewidth:1,depthTest:!1,depthWrite:!1});this.xiaBBoxLines=new Vt(v,F),this.xiaBBoxLines.name="xia-bbox-dashed",this.xiaBBoxLines.computeLineDistances(),this.xiaBBoxLines.renderOrder=999,this.highlightGroup.add(this.xiaBBoxLines)}removeXiaVisuals(){this.xiaDotPoints&&(this.highlightGroup.remove(this.xiaDotPoints),this.xiaDotPoints.geometry.dispose(),this.xiaDotPoints.material.dispose(),this.xiaDotPoints=null),this.xiaBBoxLines&&(this.highlightGroup.remove(this.xiaBBoxLines),this.xiaBBoxLines.geometry.dispose(),this.xiaBBoxLines.material.dispose(),this.xiaBBoxLines=null)}clearXiaDots(){this.isXiaSelected=!1,this.removeXiaVisuals()}notifyChange(){const e=this.getSelectedFaces();for(const t of this.selectionChangeListeners)t(e)}dispose(){this.clearXiaDots(),this.highlightGroup.parent?.remove(this.highlightGroup)}}class w0{constructor(e){this._visible=!1,this._size=11,this.container=e,this.circle=document.createElement("div"),Object.assign(this.circle.style,{position:"absolute",pointerEvents:"none",border:"1.5px solid #3a3a4a",width:`${this._size}px`,height:`${this._size}px`,borderRadius:"50%",zIndex:"9999",display:"none",boxSizing:"border-box"}),e.appendChild(this.circle)}set visible(e){this._visible=e,this.circle.style.display=e?"block":"none"}get visible(){return this._visible}update(e,t){if(!this._visible)return;const n=this.container.getBoundingClientRect(),i=e-n.left,s=t-n.top,o=Math.floor(this._size/2);this.circle.style.left=`${i-o}px`,this.circle.style.top=`${s-o}px`}setSize(e){this._size=e|1,this.circle.style.width=`${this._size}px`,this.circle.style.height=`${this._size}px`}setColor(e){this.circle.style.borderColor=e}dispose(){this.circle.remove()}}function tu(){return!!(typeof window<"u"&&window.__AXIA_DEBUG)}function Ht(...r){tu()&&console.log(...r)}function E0(...r){tu()&&console.warn(...r)}class T0{constructor(e){this.name="select",this.dragSelectStart=null,this.dragSelectBox=null,this.isDragSelecting=!1,this.clickCount=0,this.clickTimer=null,this.lastClickFaceId=-1,this.MULTI_CLICK_DELAY=400,this.ctx=e}onActivate(){Ht("[SelectTool] Activated")}onDeactivate(){this.cleanup()}onMouseDown(e,t){const n=this.ctx.viewport.pick(e.clientX,e.clientY);if(n&&n.faceIndex!=null&&n.faceIndex!==void 0){const i=this.ctx.getFaceId(n.faceIndex);console.log("[HIT] faceId=",i,"triIndex=",n.faceIndex),i===this.lastClickFaceId?this.clickCount++:(this.clickCount=1,this.lastClickFaceId=i),this.clickTimer&&clearTimeout(this.clickTimer),this.clickTimer=setTimeout(()=>{this.clickCount=0,this.lastClickFaceId=-1},this.MULTI_CLICK_DELAY),this.clickCount>=3?(Ht("[SelectTool] Triple-click → selectAll from face",i),this.ctx.selection.selectAll(i),this.clickCount=0,this.lastClickFaceId=-1):this.clickCount===2?(Ht("[SelectTool] Double-click → face + adjacent edges",i),this.ctx.selection.handleClick(i,!1,!1),this.ctx.selection.selectAdjacentEdges(i)):this.ctx.selection.handleClick(i,e.shiftKey,e.ctrlKey)}else{const i=this.ctx.viewport.pickEdge(e.clientX,e.clientY);if(i&&i.index!=null&&this.ctx.edgeMap){const s=Math.floor(i.index/2),o=this.ctx.edgeMap[s];o!=null&&this.ctx.selection.handleEdgeClick(o,e.shiftKey,e.ctrlKey)}else this.clickCount=0,this.lastClickFaceId=-1,this.dragSelectStart={x:e.clientX,y:e.clientY},this.isDragSelecting=!1}}onMouseMove(e,t){if(this.dragSelectStart){const n=e.clientX-this.dragSelectStart.x,i=e.clientY-this.dragSelectStart.y;!this.isDragSelecting&&(Math.abs(n)>5||Math.abs(i)>5)&&(this.isDragSelecting=!0,this.ctx.selection.clearSelection(),this.createDragSelectBox()),this.isDragSelecting&&this.updateDragSelectBox(this.dragSelectStart.x,this.dragSelectStart.y,e.clientX,e.clientY)}}onMouseUp(e){this.dragSelectStart&&(this.isDragSelecting?(this.performBoxSelect(this.dragSelectStart.x,this.dragSelectStart.y,e.clientX,e.clientY),this.removeDragSelectBox()):this.ctx.selection.clearSelection(),this.dragSelectStart=null)}onKeyDown(e){e.key==="Escape"&&this.cleanup()}isBusy(){return this.isDragSelecting}cleanup(){this.removeDragSelectBox()}createDragSelectBox(){if(this.dragSelectBox)return;const e=document.createElement("div");e.style.position="absolute",e.style.pointerEvents="none",e.style.zIndex="1000",e.style.border="1px dashed #2196f3",e.style.background="rgba(33, 150, 243, 0.08)",this.ctx.viewport.container.appendChild(e),this.dragSelectBox=e}updateDragSelectBox(e,t,n,i){if(!this.dragSelectBox)return;const s=this.ctx.viewport.container.getBoundingClientRect(),o=e-s.left,a=t-s.top,c=n-s.left,l=i-s.top,h=Math.min(o,c),d=Math.min(a,l),u=Math.abs(c-o),m=Math.abs(l-a);c>=o?(this.dragSelectBox.style.border="1px solid #2196f3",this.dragSelectBox.style.background="rgba(33, 150, 243, 0.1)"):(this.dragSelectBox.style.border="1px dashed #4caf50",this.dragSelectBox.style.background="rgba(76, 175, 80, 0.1)"),this.dragSelectBox.style.left=h+"px",this.dragSelectBox.style.top=d+"px",this.dragSelectBox.style.width=u+"px",this.dragSelectBox.style.height=m+"px"}removeDragSelectBox(){this.dragSelectBox&&(this.dragSelectBox.remove(),this.dragSelectBox=null),this.isDragSelecting=!1,this.dragSelectStart=null}performBoxSelect(e,t,n,i){const s=this.ctx.viewport.activeCamera,a=this.ctx.viewport.renderer.domElement.getBoundingClientRect(),c=n>=e,l=Math.min(e,n),h=Math.max(e,n),d=Math.min(t,i),u=Math.max(t,i),m=y=>{const v=y.clone().project(s);return v.z<-1||v.z>1?null:{x:(v.x*.5+.5)*a.width+a.left,y:(-v.y*.5+.5)*a.height+a.top}},g=(y,v)=>y>=l&&y<=h&&v>=d&&v<=u,_=new Set,f=this.ctx.bridge.getMeshBuffers();if(f&&this.ctx.faceMap.length>0&&f.positions.length>0){const y=f.positions,v=f.indices,F=new Map;for(let A=0;A<this.ctx.faceMap.length;A++){const L=this.ctx.faceMap[A],O=A*3;if(O+2>=v.length)continue;F.has(L)||F.set(L,[]);const w=F.get(L);for(let S=0;S<3;S++){const U=v[O+S],Z=new P(y[U*3],y[U*3+1],y[U*3+2]),K=m(Z);K&&w.push(K)}}for(const[A,L]of F)L.length!==0&&(c?L.every(O=>g(O.x,O.y))&&_.add(A):L.some(O=>g(O.x,O.y))&&_.add(A))}const p=new Set,x=this.ctx.bridge.getEdgeLines();if(x&&this.ctx.edgeMap)for(let y=0;y<this.ctx.edgeMap.length;y++){const v=y*6;if(v+5>=x.length)continue;const F=m(new P(x[v],x[v+1],x[v+2])),A=m(new P(x[v+3],x[v+4],x[v+5]));!F||!A||(c?g(F.x,F.y)&&g(A.x,A.y)&&p.add(this.ctx.edgeMap[y]):(g(F.x,F.y)||g(A.x,A.y))&&p.add(this.ctx.edgeMap[y]))}this.ctx.selection.clearSelection();for(const y of _)this.ctx.selection.handleClick(y,!0,!1);for(const y of p)this.ctx.selection.handleEdgeClick(y,!0,!1)}}class A0{constructor(e){this.name="line",this.lineStart=null,this.linePreview=null,this.ctx=e}onActivate(){Ht("[DrawLineTool] Activated")}onDeactivate(){this.cleanup()}onMouseDown(e,t){if(t)if(!this.lineStart)this.lineStart=t.clone(),this.ctx.snap.setReferencePoint(t),this.ctx.axisLock=null,this.ctx.inferredAxis="free";else{const n=this.ctx.getGroundPoint(e),i=this.ctx.getSnappedPoint(e,n,!0);let s=null;if(i&&n&&i.distanceTo(n)>.01)s=i;else{const o=this.ctx.getAxisInferredPoint(e,this.lineStart);s=o?o.point:null}if(s){const o=this.lineStart.distanceTo(s);o>1&&(this.ctx.bridge.drawLine(this.lineStart.x,this.lineStart.y,this.lineStart.z,s.x,s.y,s.z),Ht("[Line] Created 3D:",o.toFixed(2),"mm"),this.ctx.syncMesh())}this.lineStart=s?s.clone():null,this.removeLinePreview(),this.ctx.clearAxisGuide(),this.ctx.dimLabel.clear(),this.ctx.axisLock=null,this.lineStart&&this.ctx.snap.setReferencePoint(this.lineStart)}}onMouseMove(e,t){if(!this.lineStart||!t){this.removeLinePreview();return}const n=this.ctx.getGroundPoint(e),i=this.ctx.getSnappedPoint(e,n);let s=null,o="free";if(i&&n&&i.distanceTo(n)>.01)s=i,o="free";else{const a=this.ctx.getAxisInferredPoint(e,this.lineStart);a&&(s=a.point,o=a.axis)}if(this.ctx.inferredAxis=o,s){const a={x:16724787,y:3377407,z:3394611,free:7651580},c={x:"#ff3333",y:"#3388ff",z:"#33cc33",free:"#74c0fc"},l={x:"X축",y:"Y축(높이)",z:"Z축",free:""};this.updateLinePreview(this.lineStart,s,a[o]),this.ctx.updateAxisGuide(this.lineStart,o,s);const h=this.lineStart.distanceTo(s);if(h>.1){const d=l[o]?`${l[o]} ${this.ctx.units.format(h)}`:this.ctx.units.format(h);this.ctx.dimLabel.update(this.ctx.viewport.activeCamera,[{from:this.lineStart.clone(),to:s.clone(),text:d,color:c[o]}])}}}onKeyDown(e){e.key==="Escape"&&this.cleanup()}applyVCBValue(e){if(!this.lineStart)return;const t=this.ctx.axisLock||this.ctx.inferredAxis;let n=new P(1,0,0);t==="y"?n.set(0,1,0):t==="z"&&n.set(0,0,1);const i=this.lineStart.clone().add(n.multiplyScalar(e));this.ctx.bridge.drawLine(this.lineStart.x,this.lineStart.y,this.lineStart.z,i.x,i.y,i.z),Ht(`[VCB/Line] Length=${e} axis=${t}`),this.lineStart=i.clone(),this.ctx.syncMesh()}isBusy(){return this.lineStart!==null}cleanup(){this.lineStart=null,this.removeLinePreview(),this.ctx.clearAxisGuide(),this.ctx.dimLabel.clear(),this.ctx.snap.setReferencePoint(null)}removeLinePreview(){this.linePreview&&(this.ctx.viewport.scene.remove(this.linePreview),this.linePreview.geometry.dispose(),this.linePreview.material.dispose(),this.linePreview=null)}updateLinePreview(e,t,n=7651580){this.removeLinePreview();const i=.5,s=[new P(e.x,e.y+i,e.z),new P(t.x,t.y+i,t.z)],o=new at().setFromPoints(s),a=new zt({color:n,linewidth:1});this.linePreview=new An(o,a),this.ctx.viewport.scene.add(this.linePreview)}}class C0{constructor(e){this.name="rect",this.rectStart=null,this.rectPreview=null,this.ctx=e}onActivate(){console.log("[DrawRectTool] Activated")}onDeactivate(){this.cleanup()}onMouseDown(e,t){if(t)if(!this.rectStart)this.rectStart=t.clone(),this.ctx.snap.setReferencePoint(t);else{if(t){const n=new P().addVectors(this.rectStart,t).multiplyScalar(.5),i=new P().subVectors(t,this.rectStart),s=Math.abs(i.x),o=Math.abs(i.z);s>1&&o>1&&(this.ctx.bridge.drawRect(n.x,n.y,n.z,0,1,0,0,0,1,s,o),console.log("[Rect] Created 3D:",`${s.toFixed(2)} x ${o.toFixed(2)}`),this.ctx.syncMesh())}this.cleanup()}}onMouseMove(e,t){if(!this.rectStart||!t){this.removeRectPreview();return}this.updateRectPreview(this.rectStart,t);const n=Math.abs(t.x-this.rectStart.x),i=Math.abs(t.z-this.rectStart.z);if(n>.001||i>.001){const s=this.rectStart,o=Math.min(s.x,t.x),a=Math.max(s.x,t.x),c=Math.min(s.z,t.z),l=Math.max(s.z,t.z),h=Math.max(n,i)*.08+100,d=this.rectStart.y,u=[{from:new P(o,d,l+h),to:new P(a,d,l+h),text:this.ctx.units.format(n),color:"#ff6b6b"},{from:new P(o-h,d,c),to:new P(o-h,d,l),text:this.ctx.units.format(i),color:"#51cf66"}];this.ctx.dimLabel.update(this.ctx.viewport.activeCamera,u)}}onKeyDown(e){e.key==="Escape"&&this.cleanup()}applyVCBValue(e,t){const n=e,i=t??e,s=this.rectStart||new P(0,0,0),o=s.x+n/2,a=s.z+i/2;this.ctx.bridge.drawRect(o,s.y,a,0,1,0,0,0,1,n,i),console.log(`[VCB/Rect] ${n}×${i}`),this.cleanup(),this.ctx.syncMesh()}isBusy(){return this.rectStart!==null}cleanup(){this.rectStart=null,this.removeRectPreview(),this.ctx.dimLabel.clear(),this.ctx.snap.setReferencePoint(null)}removeRectPreview(){this.rectPreview&&(this.ctx.viewport.scene.remove(this.rectPreview),this.rectPreview.geometry.dispose(),this.rectPreview.material instanceof Ft&&this.rectPreview.material.dispose(),this.rectPreview=null)}updateRectPreview(e,t){const n=new P().addVectors(e,t).multiplyScalar(.5),i=Math.abs(t.x-e.x),s=Math.abs(t.z-e.z);if(i<.001||s<.001)return;this.removeRectPreview();const o=new Pr(i,s),a=new rn({color:4491519,transparent:!0,opacity:.3,side:sn});this.rectPreview=new rt(o,a),this.rectPreview.rotation.x=-Math.PI/2,this.rectPreview.position.set(n.x,n.y+.5,n.z),this.ctx.viewport.scene.add(this.rectPreview)}}class R0{constructor(e){this.name="circle",this.circleCenter=null,this.circlePreview=null,this.ctx=e}onActivate(){console.log("[DrawCircleTool] Activated")}onDeactivate(){this.cleanup()}onMouseDown(e,t){if(t)if(!this.circleCenter)this.circleCenter=t.clone(),this.ctx.snap.setReferencePoint(t);else{const n=this.circleCenter.distanceTo(t);n>1&&(this.ctx.bridge.drawCircle(this.circleCenter.x,this.circleCenter.y,this.circleCenter.z,0,1,0,n,24),console.log("[Circle] Created 3D: R",n.toFixed(2),"mm"),this.ctx.syncMesh()),this.cleanup()}}onMouseMove(e,t){if(!this.circleCenter||!t){this.removeCirclePreview();return}const n=this.circleCenter.distanceTo(t);n>.1&&(this.updateCirclePreview(this.circleCenter,n),this.ctx.dimLabel.update(this.ctx.viewport.activeCamera,[{from:this.circleCenter.clone(),to:t.clone(),text:"R "+this.ctx.units.format(n),color:"#da77f2"}]))}onKeyDown(e){e.key==="Escape"&&this.cleanup()}applyVCBValue(e){this.circleCenter&&(this.ctx.bridge.drawCircle(this.circleCenter.x,this.circleCenter.y,this.circleCenter.z,0,1,0,e,24),console.log(`[VCB/Circle] R=${e}`),this.cleanup(),this.ctx.syncMesh())}isBusy(){return this.circleCenter!==null}cleanup(){this.circleCenter=null,this.removeCirclePreview(),this.ctx.dimLabel.clear(),this.ctx.snap.setReferencePoint(null)}removeCirclePreview(){this.circlePreview&&(this.ctx.viewport.scene.remove(this.circlePreview),this.circlePreview.geometry.dispose(),this.circlePreview.material.dispose(),this.circlePreview=null)}updateCirclePreview(e,t){this.removeCirclePreview();const n=48,i=[];for(let a=0;a<=n;a++){const c=a/n*Math.PI*2;i.push(new P(e.x+Math.cos(c)*t,e.y+.5,e.z+Math.sin(c)*t))}const s=new at().setFromPoints(i),o=new zt({color:14317554,linewidth:1});this.circlePreview=new An(s,o),this.ctx.viewport.scene.add(this.circlePreview)}}class Wn{constructor(e){this.name="pushpull",this.ppFaceId=-1,this.ppStartX=0,this.ppStartY=0,this.ppActive=!1,this.ppNormal=new P(0,1,0),this.ppScreenDir=new Ge(0,-1),this.ppGhost=null,this.ppHitPoint=new P,this.ppFaceVerts=[],this.lastPPDist=0,this.smoothGroupFaces=[],this.isSmoothGroup=!1,this.ctx=e}static{this._mouse=new Ge}static{this._ray=new Zo}static{this._camRight=new P}static{this._camUp=new P}static{this._planeNormal=new P}static{this._intersection=new P}static{this._plane=new jn}static{this._mouseNdc=new Ge}static{this._projTmp=new P}onActivate(){Ht("[PushPullTool] Activated")}onDeactivate(){this.cleanup()}onMouseDown(e,t){if(this.ppActive){const n=this.ppRayDist(e);if(Ht("[PP] Phase 2: confirm dist=",n.toFixed(2)),Math.abs(n)>.5)if(this.isSmoothGroup&&this.smoothGroupFaces.length>1){let i=0;for(const s of this.smoothGroupFaces)this.ctx.bridge.pushPull(s,n)&&i++;Ht("[PP] Smooth group pushPull:",i,"/",this.smoothGroupFaces.length,"faces, dist=",n.toFixed(2)),i>0&&(this.lastPPDist=n,this.ctx.syncMesh())}else{const i=this.ctx.bridge.pushPull(this.ppFaceId,n);Ht("[PP] pushPull result=",i,"dist=",n.toFixed(2)),i&&(this.lastPPDist=n,this.ctx.syncMesh())}this.cleanup()}else{const n=this.ctx.viewport.pick(e.clientX,e.clientY);let i=-1,s=null;if(n&&n.faceIndex!=null&&n.faceIndex>=0&&(i=this.ctx.getFaceId(n.faceIndex),s=n.point?n.point.clone():null),i<0){const o=this.ctx.getSelectedFaces();if(o.length===1){i=o[0];const a=this.ctx.bridge.facesCentroid(o);a&&(s=a)}}if(i>=0&&s){this.ppFaceId=i,this.ppStartX=e.clientX,this.ppStartY=e.clientY,this.ppActive=!0,this.smoothGroupFaces=this.ctx.selection.getSmoothGroup(i),this.isSmoothGroup=this.smoothGroupFaces.length>1;const o=this.ctx.bridge.getFaceNormal(i);!o||o[0]===0&&o[1]===0&&o[2]===0?(E0("[PP] Invalid face normal for faceId=",i),this.ppNormal=new P(0,1,0)):this.ppNormal=new P(o[0],o[1],o[2]);const a=s.clone().project(this.ctx.viewport.activeCamera),c=s.clone().add(this.ppNormal.clone().multiplyScalar(1e3)).project(this.ctx.viewport.activeCamera);this.ppScreenDir=new Ge(c.x-a.x,c.y-a.y),this.ppScreenDir.length()>1e-4?this.ppScreenDir.normalize():this.ppScreenDir.set(0,-1),this.ppHitPoint=s,this.createPPGhost(i,s),this.ctx.selection.handleClick(i,!1,!1),this.isSmoothGroup?Ht("[PP] Phase 1: SMOOTH GROUP selected,",this.smoothGroupFaces.length,"faces, seed=",i):Ht("[PP] Phase 1: face selected, faceId=",i,"normal=",this.ppNormal.toArray().map(l=>l.toFixed(3)))}}}onMouseMove(e,t){if(!this.ppActive||!this.ppGhost)return;const n=this.ppRayDist(e);if(this.updatePPGhost(n),this.ppFaceVerts.length>=2&&Math.abs(n)>.001){const i=Math.abs(n),o=(n>=0?"":"-")+this.ctx.units.format(i),a=this.ppNormal.clone().multiplyScalar(n),c=this.ctx.viewport.renderer.domElement.getBoundingClientRect(),l=Wn._mouseNdc;l.set((e.clientX-c.left)/c.width*2-1,-((e.clientY-c.top)/c.height)*2+1);let h=0,d=1/0;const u=Wn._projTmp;for(let _=0;_<this.ppFaceVerts.length;_++){u.copy(this.ppFaceVerts[_]).project(this.ctx.viewport.activeCamera);const f=u.x-l.x,p=u.y-l.y,x=Math.sqrt(f*f+p*p);x<d&&(d=x,h=_)}const m=this.ppFaceVerts[h].clone(),g=m.clone().add(a);this.ctx.dimLabel.update(this.ctx.viewport.activeCamera,[{from:m,to:g,text:o,color:"#ffd43b"}])}else this.ctx.dimLabel.clear()}onKeyDown(e){e.key==="Escape"&&this.cleanup()}applyVCBValue(e){if(this.isSmoothGroup&&this.smoothGroupFaces.length>1){let t=0;for(const n of this.smoothGroupFaces)this.ctx.bridge.pushPull(n,e)&&t++;t>0&&(this.lastPPDist=e,this.ctx.syncMesh())}else{const t=this.ppFaceId>=0?this.ppFaceId:this.ctx.getSelectedFaces()[0];t>=0&&this.ctx.bridge.pushPull(t,e)&&(this.lastPPDist=e,this.ctx.syncMesh())}this.cleanup()}isBusy(){return this.ppActive}cleanup(){this.ppActive=!1,this.ppFaceId=-1,this.smoothGroupFaces=[],this.isSmoothGroup=!1,this.removePPGhost(),this.ctx.selection.clearSelection(),this.ctx.dimLabel.clear()}createPPGhost(e,t){this.removePPGhost(),this.ppFaceVerts=this.ctx.extractFaceBoundary(e),!(this.ppFaceVerts.length<3)&&(this.ppGhost=new Bt,this.ppGhost.renderOrder=999,this.ctx.viewport.scene.add(this.ppGhost),this.rebuildPPGhost(0))}rebuildPPGhost(e){if(!this.ppGhost||this.ppFaceVerts.length<3)return;for(;this.ppGhost.children.length>0;){const u=this.ppGhost.children[0];this.ppGhost.remove(u),(u instanceof rt||u instanceof Vt)&&(u.geometry.dispose(),u.material instanceof Ft&&u.material.dispose())}if(Math.abs(e)<.001)return;const t=this.ppFaceVerts.length,n=this.ppNormal.clone().multiplyScalar(e),i=this.ppFaceVerts.map(u=>u.clone().add(n)),s=u=>{const m=[],g=[];for(const f of u)m.push(f.x,f.y,f.z);for(let f=1;f<u.length-1;f++)g.push(0,f,f+1);const _=new at;return _.setAttribute("position",new yt(new Float32Array(m),3)),_.setIndex(g),_.computeVertexNormals(),_},o=(u,m)=>{const g=[],_=[];let f=0;for(let x=0;x<u.length;x++){const y=(x+1)%u.length,v=u[x],F=u[y],A=m[y],L=m[x];g.push(v.x,v.y,v.z,F.x,F.y,F.z,A.x,A.y,A.z,L.x,L.y,L.z),_.push(f,f+1,f+2,f,f+2,f+3),f+=4}const p=new at;return p.setAttribute("position",new yt(new Float32Array(g),3)),p.setIndex(_),p.computeVertexNormals(),p},a=new rt(s(i),new rn({color:6003669,side:ln,transparent:!0,opacity:.3,depthWrite:!1}));a.renderOrder=999,this.ppGhost.add(a);const c=new rt(o(this.ppFaceVerts,i),new rn({color:6003669,side:ln,transparent:!0,opacity:.2,depthWrite:!1}));c.renderOrder=998,this.ppGhost.add(c);const l=[];for(let u=0;u<t;u++){const m=(u+1)%t;l.push(i[u].x,i[u].y,i[u].z),l.push(i[m].x,i[m].y,i[m].z)}for(let u=0;u<t;u++)l.push(this.ppFaceVerts[u].x,this.ppFaceVerts[u].y,this.ppFaceVerts[u].z),l.push(i[u].x,i[u].y,i[u].z);const h=new at;h.setAttribute("position",new yt(new Float32Array(l),3));const d=new Vt(h,new zt({color:2780344,depthTest:!1}));d.renderOrder=1e3,this.ppGhost.add(d)}updatePPGhost(e){this.rebuildPPGhost(e)}removePPGhost(){if(this.ppGhost){for(;this.ppGhost.children.length>0;){const e=this.ppGhost.children[0];this.ppGhost.remove(e),(e instanceof rt||e instanceof Vt)&&(e.geometry.dispose(),e.material instanceof Ft&&e.material.dispose())}this.ctx.viewport.scene.remove(this.ppGhost),this.ppGhost=null}this.ppFaceVerts=[]}ppRayDist(e){const n=this.ctx.viewport.renderer.domElement.getBoundingClientRect(),i=Wn._mouse;i.set((e.clientX-n.left)/n.width*2-1,-((e.clientY-n.top)/n.height)*2+1);const s=Wn._ray;s.setFromCamera(i,this.ctx.viewport.activeCamera);const o=Wn._camRight;o.setFromMatrixColumn(this.ctx.viewport.activeCamera.matrixWorld,0).normalize();const a=Wn._planeNormal;if(a.crossVectors(this.ppNormal,o).normalize(),a.length()<.001){const u=Wn._camUp;u.setFromMatrixColumn(this.ctx.viewport.activeCamera.matrixWorld,1).normalize(),a.crossVectors(this.ppNormal,u).normalize()}const c=Wn._plane;c.setFromNormalAndCoplanarPoint(a,this.ppHitPoint);const l=Wn._intersection;return s.ray.intersectPlane(c,l)?l.sub(this.ppHitPoint).dot(this.ppNormal):0}}class L0{constructor(e){this.name="move",this.transformActive=!1,this.transformStartPt=null,this.transformCentroid=null,this.transformLastDelta=new P,this.ctx=e}onActivate(){Ht("[MoveTool] Activated")}onDeactivate(){this.cleanup()}onMouseDown(e,t){if(this.transformActive)return;const n=this.ctx.getSelectedFaces();if(n.length>0){const i=this.ctx.bridge.facesCentroid(n);i&&t&&(this.transformCentroid=i,this.transformStartPt=t.clone(),this.transformActive=!0,this.transformLastDelta.set(0,0,0),Ht(`[Move] Start drag, ${n.length} faces, centroid=`,i.x.toFixed(1),i.y.toFixed(1),i.z.toFixed(1)))}}onMouseMove(e,t){if(!this.transformActive||!this.transformStartPt||!this.transformCentroid||!t)return;const n=this.ctx.getSelectedFaces(),i=new P().subVectors(t,this.transformStartPt),s=new P().subVectors(i,this.transformLastDelta);if(s.length()>.1){this.ctx.bridge.translateFaces(n,s.x,s.y,s.z),this.transformLastDelta.copy(i),this.ctx.syncMesh();const o=i.length();this.ctx.dimLabel.update(this.ctx.viewport.activeCamera,[{from:this.transformStartPt.clone(),to:t.clone(),text:this.ctx.units.format(o),color:"#ffd43b"}])}}onMouseUp(e){this.transformActive&&(Ht("[Move] End drag"),this.transformActive=!1,this.transformStartPt=null,this.transformCentroid=null,this.transformLastDelta.set(0,0,0),this.ctx.dimLabel.clear())}onKeyDown(e){e.key==="Escape"&&this.cleanup()}applyVCBValue(e){const t=this.ctx.getSelectedFaces();if(t.length>0){let n=0,i=0,s=0;const o=this.ctx.axisLock||this.ctx.inferredAxis;o==="x"?n=e:o==="y"?i=e:o==="z"?s=e:n=e,this.ctx.bridge.translateFaces(t,n,i,s),Ht(`[VCB/Move] Applied: (${n},${i},${s})`),this.ctx.syncMesh()}}isBusy(){return this.transformActive}cleanup(){this.transformActive=!1,this.transformStartPt=null,this.transformCentroid=null,this.transformLastDelta.set(0,0,0),this.ctx.dimLabel.clear()}}class I0{constructor(e){this.name="rotate",this.transformActive=!1,this.transformStartPt=null,this.transformCentroid=null,this.transformStartAngle=0,this.ctx=e}onActivate(){console.log("[RotateTool] Activated")}onDeactivate(){this.cleanup()}onMouseDown(e,t){if(this.transformActive)return;const n=this.ctx.getSelectedFaces();if(n.length>0){const i=this.ctx.bridge.facesCentroid(n);if(i&&t){this.transformCentroid=i,this.transformStartPt=t.clone(),this.transformActive=!0;const s=t.x-i.x,o=t.z-i.z;this.transformStartAngle=Math.atan2(o,s),console.log(`[Rotate] Start drag, ${n.length} faces, centroid=`,i.x.toFixed(1),i.y.toFixed(1),i.z.toFixed(1))}}}onMouseMove(e,t){if(!this.transformActive||!this.transformStartPt||!this.transformCentroid||!t)return;const n=this.ctx.getSelectedFaces(),i=this.transformCentroid,s=t.x-i.x,o=t.z-i.z,a=Math.atan2(o,s),c=(a-this.transformStartAngle)*(180/Math.PI);if(Math.abs(c)>.1){this.ctx.bridge.rotateFaces(n,i.x,i.y,i.z,0,1,0,c),this.transformStartAngle=a,this.ctx.syncMesh();const l=this.ctx.bridge.facesCentroid(n);l&&(this.transformCentroid=l),this.ctx.dimLabel.update(this.ctx.viewport.activeCamera,[{from:i.clone(),to:t.clone(),text:`${c.toFixed(1)}°`,color:"#da77f2"}])}}onMouseUp(e){this.transformActive&&(console.log("[Rotate] End drag"),this.transformActive=!1,this.transformStartPt=null,this.transformCentroid=null,this.ctx.dimLabel.clear())}onKeyDown(e){e.key==="Escape"&&this.cleanup()}applyVCBValue(e){const t=this.ctx.getSelectedFaces();if(t.length>0){const n=this.ctx.bridge.facesCentroid(t);n&&(this.ctx.bridge.rotateFaces(t,n.x,n.y,n.z,0,1,0,e),console.log(`[VCB/Rotate] Applied: ${e}° Y-axis`),this.ctx.syncMesh())}}isBusy(){return this.transformActive}cleanup(){this.transformActive=!1,this.transformStartPt=null,this.transformCentroid=null,this.ctx.dimLabel.clear()}}class P0{constructor(e){this.name="scale",this.transformActive=!1,this.transformStartPt=null,this.transformCentroid=null,this.ctx=e}onActivate(){Ht("[ScaleTool] Activated")}onDeactivate(){this.cleanup()}onMouseDown(e,t){if(this.transformActive)return;const n=this.ctx.getSelectedFaces();if(n.length>0){const i=this.ctx.bridge.facesCentroid(n);i&&t&&(this.transformCentroid=i,this.transformStartPt=t.clone(),this.transformActive=!0,Ht(`[Scale] Start drag, ${n.length} faces, centroid=`,i.x.toFixed(1),i.y.toFixed(1),i.z.toFixed(1)))}}onMouseMove(e,t){if(!this.transformActive||!this.transformStartPt||!this.transformCentroid||!t)return;const n=this.transformCentroid,i=this.transformStartPt.distanceTo(n),s=t.distanceTo(n);if(i>1){const o=s/i;this.ctx.dimLabel.update(this.ctx.viewport.activeCamera,[{from:n.clone(),to:t.clone(),text:`×${o.toFixed(2)}`,color:"#51cf66"}])}}onMouseUp(e){if(this.transformActive&&this.transformStartPt&&this.transformCentroid){const t=this.ctx.get3DPoint(e);if(t){const n=this.transformCentroid,i=this.transformStartPt.distanceTo(n),s=t.distanceTo(n);if(i>1){const o=s/i;if(Math.abs(o-1)>.01){const a=this.ctx.getSelectedFaces();this.ctx.bridge.scaleFaces(a,n.x,n.y,n.z,o,o,o),Ht(`[Scale] Applied ×${o.toFixed(3)}`),this.ctx.syncMesh()}}}console.log("[Scale] End drag"),this.transformActive=!1,this.transformStartPt=null,this.transformCentroid=null,this.ctx.dimLabel.clear()}}onKeyDown(e){e.key==="Escape"&&this.cleanup()}applyVCBValue(e){const t=this.ctx.getSelectedFaces();if(t.length>0){const n=this.ctx.bridge.facesCentroid(t);n&&(this.ctx.bridge.scaleFaces(t,n.x,n.y,n.z,e,e,e),console.log(`[VCB/Scale] Applied: ×${e}`),this.ctx.syncMesh())}}isBusy(){return this.transformActive}cleanup(){this.transformActive=!1,this.transformStartPt=null,this.transformCentroid=null,this.ctx.dimLabel.clear()}}class D0{constructor(e){this.name="offset",this.offsetPhase=0,this.offsetFaceId=-1,this.offsetEdgeId=-1,this.offsetNormal=new P(0,1,0),this.offsetHitPoint=new P,this.offsetGhost=null,this.offsetFaceVerts=[],this.lastOffsetDist=0,this.offsetEdgeDir=new P,this.offsetEdgeP0=new P,this.offsetEdgeP1=new P,this.offsetEdgeHighlight=null,this.offsetHoverHighlight=null,this.offsetCurrentSign=1,this.ctx=e}onActivate(){const e=this.ctx.viewport.renderer.domElement;e.style.cursor="none",console.log("[OffsetTool] Activated")}onDeactivate(){const e=this.ctx.viewport.renderer.domElement;e.style.cursor="",this.cleanup()}onMouseDown(e,t){if(this.offsetPhase===0){const n=this.pickOffsetTarget(e);n&&(this.offsetPhase=1,this.removeOffsetHover(),console.log("[Offset] Phase 1: object selected,",n.type==="edge"?"edgeId="+this.offsetEdgeId:"faceId="+this.offsetFaceId))}else if(this.offsetPhase===1){const n=this.ctx.getGroundPoint(e);if(!n)return;let i=0;if(this.offsetEdgeId>=0){const s=new P().addVectors(this.offsetEdgeP0,this.offsetEdgeP1).multiplyScalar(.5),o=new P().subVectors(n,s),a=o.dot(this.offsetEdgeDir)>=0?1:-1;if(this.lastOffsetDist>0?i=this.lastOffsetDist*a:i=o.dot(this.offsetEdgeDir),Math.abs(i)>.1){const c=[this.offsetNormal.x,this.offsetNormal.y,this.offsetNormal.z],l=this.ctx.bridge.offsetEdge(this.offsetEdgeId,i,c);l&&l.ok&&(this.lastOffsetDist=Math.abs(i),console.log("[Offset/Edge] Applied: dist=",i.toFixed(1),"newEdge=",l.newEdge))}}else if(this.offsetFaceId>=0){if(i=this.offsetRayDist(e),this.lastOffsetDist>0){const s=i>=0?1:-1;i=this.lastOffsetDist*s}if(Math.abs(i)>.1){const s=this.ctx.bridge.offsetFace(this.offsetFaceId,i);s&&s.ok&&(this.lastOffsetDist=Math.abs(i),console.log("[Offset/Face] Applied: dist=",i.toFixed(1),"innerFace=",s.innerFace))}}this.ctx.syncMesh(),this.resetOffsetState()}}onMouseMove(e,t){const n=this.ctx.pickBox;if(n&&(n.visible=!0,n.update(e.clientX,e.clientY)),this.offsetPhase===0){const i=this.ctx.viewport.pickEdge(e.clientX,e.clientY);if(i&&i.index!=null&&this.ctx.edgeMap){const s=Math.floor(i.index/2);this.showEdgeHover(s)}else this.removeOffsetHover()}else if(this.offsetPhase===1){if(this.offsetEdgeId>=0){const i=this.ctx.getGroundPoint(e);if(i){const s=new P().addVectors(this.offsetEdgeP0,this.offsetEdgeP1).multiplyScalar(.5),a=new P().subVectors(i,s).dot(this.offsetEdgeDir);Math.abs(a)>.1&&(this.offsetCurrentSign=a>=0?1:-1);let c=this.lastOffsetDist>0?this.lastOffsetDist*this.offsetCurrentSign:a;if(Math.abs(c)>.1){const l=this.offsetEdgeDir.clone().multiplyScalar(c),h=this.offsetEdgeP0.clone().add(l),d=this.offsetEdgeP1.clone().add(l);this.removeOffsetHover();const u=new at;u.setAttribute("position",new yt(new Float32Array([h.x,h.y,h.z,d.x,d.y,d.z]),3));const m=new zt({color:16752451,linewidth:2,depthTest:!1});this.offsetHoverHighlight=new An(u,m),this.offsetHoverHighlight.renderOrder=998,this.ctx.viewport.scene.add(this.offsetHoverHighlight);const g=this.ctx.units.format(Math.abs(c)),_=new P().addVectors(this.offsetEdgeP0,this.offsetEdgeP1).multiplyScalar(.5),f=_.clone().add(this.offsetEdgeDir.clone().multiplyScalar(c));this.ctx.dimLabel.update(this.ctx.viewport.activeCamera,[{from:_,to:f,text:g,color:"#ff9f43"}])}}}else if(this.offsetFaceId>=0){const i=this.offsetRayDist(e);Math.abs(i)>.1&&(this.offsetCurrentSign=i>=0?1:-1);let s=this.lastOffsetDist>0?this.lastOffsetDist*this.offsetCurrentSign:i;if(this.updateOffsetGhost(s),Math.abs(s)>.1){const o=this.ctx.units.format(Math.abs(s)),a=s>=0?"Inset":"Outset";if(this.offsetFaceVerts.length>=2){const c=new P().addVectors(this.offsetFaceVerts[0],this.offsetFaceVerts[1]).multiplyScalar(.5),l=new P().subVectors(this.offsetFaceVerts[1],this.offsetFaceVerts[0]),h=new P().crossVectors(l,this.offsetNormal).normalize(),d=c.clone().add(h.multiplyScalar(s));this.ctx.dimLabel.update(this.ctx.viewport.activeCamera,[{from:c,to:d,text:`${a}: ${o}`,color:"#ff9f43"}])}}else this.ctx.dimLabel.clear()}}}onKeyDown(e){e.key==="Escape"&&this.cleanup()}applyVCBValue(e){if(this.offsetPhase===0)this.lastOffsetDist=e,console.log("[VCB/Offset] Distance set:",e);else if(this.offsetPhase===1){const t=e*this.offsetCurrentSign;if(this.offsetEdgeId>=0){const n=[this.offsetNormal.x,this.offsetNormal.y,this.offsetNormal.z],i=this.ctx.bridge.offsetEdge(this.offsetEdgeId,t,n);i&&i.ok&&(this.lastOffsetDist=e,console.log("[VCB/Offset/Edge] Applied:",t,"newEdge=",i.newEdge))}else if(this.offsetFaceId>=0){const n=this.ctx.bridge.offsetFace(this.offsetFaceId,t);n&&n.ok&&(this.lastOffsetDist=e,console.log("[VCB/Offset/Face] Applied:",t,"innerFace=",n.innerFace))}this.ctx.syncMesh(),this.resetOffsetState()}this.ctx.dimLabel.clear()}isBusy(){return this.offsetPhase>0}cleanup(){this.resetOffsetState()}resetOffsetState(){this.offsetPhase=0,this.offsetFaceId=-1,this.offsetEdgeId=-1,this.offsetCurrentSign=1,this.removeOffsetGhost(),this.removeEdgeHighlight(),this.removeOffsetHover(),this.ctx.selection.clearSelection()}pickOffsetTarget(e){const t=this.ctx.viewport.pick(e.clientX,e.clientY);let n=-1,i=null;if(t&&t.faceIndex!=null&&t.faceIndex>=0&&(n=this.ctx.getFaceId(t.faceIndex),i=t.point?t.point.clone():null),n<0){const o=this.ctx.getSelectedFaces();if(o.length===1){n=o[0];const a=this.ctx.bridge.facesCentroid(o);a&&(i=a)}}if(n>=0&&i){this.offsetFaceId=n,this.offsetEdgeId=-1;const o=this.ctx.bridge.getFaceNormal(n);return this.offsetNormal=new P(o[0],o[1],o[2]),this.offsetHitPoint=i,this.createOffsetGhost(n),this.ctx.selection.handleClick(n,!1,!1),{type:"face"}}const s=this.ctx.viewport.pickEdge(e.clientX,e.clientY);if(s&&s.index!=null&&this.ctx.edgeMap){const o=Math.floor(s.index/2),a=this.ctx.edgeMap[o];if(a!=null){this.offsetEdgeId=a,this.offsetFaceId=-1,this.offsetNormal=new P(0,1,0);const c=this.ctx.bridge.getEdgeLines();if(c){const l=o*6;this.offsetEdgeP0=new P(c[l],c[l+1],c[l+2]),this.offsetEdgeP1=new P(c[l+3],c[l+4],c[l+5]);const h=new P().subVectors(this.offsetEdgeP1,this.offsetEdgeP0).normalize();this.offsetEdgeDir=new P().crossVectors(h,this.offsetNormal).normalize();const d=new P().addVectors(this.offsetEdgeP0,this.offsetEdgeP1).multiplyScalar(.5);this.offsetHitPoint=d,this.showEdgeSelected(this.offsetEdgeP0,this.offsetEdgeP1)}return{type:"edge"}}}return null}offsetRayDist(e){const n=this.ctx.viewport.renderer.domElement.getBoundingClientRect(),i=new Ge((e.clientX-n.left)/n.width*2-1,-((e.clientY-n.top)/n.height)*2+1),s=new Zo;s.setFromCamera(i,this.ctx.viewport.activeCamera);const o=new jn().setFromNormalAndCoplanarPoint(this.offsetNormal,this.offsetHitPoint),a=new P;if(!s.ray.intersectPlane(o,a))return 0;const l=new P().subVectors(a,this.offsetHitPoint),h=l.length();if(this.offsetEdgeId>=0&&this.offsetEdgeDir.lengthSq()>.001){const d=l.dot(this.offsetEdgeDir)>=0?1:-1;return h*d}if(this.offsetFaceVerts.length>=3){const d=new P;for(const g of this.offsetFaceVerts)d.add(g);d.divideScalar(this.offsetFaceVerts.length);const u=d.distanceTo(this.offsetHitPoint);return d.distanceTo(a)<u?h:-h}return h}createOffsetGhost(e){this.removeOffsetGhost(),this.removeEdgeHighlight(),this.offsetFaceVerts=this.ctx.extractFaceBoundary(e),!(this.offsetFaceVerts.length<3)&&(this.offsetGhost=new Bt,this.offsetGhost.renderOrder=999,this.ctx.viewport.scene.add(this.offsetGhost),this.rebuildOffsetGhost(0))}rebuildOffsetGhost(e){if(!this.offsetGhost||this.offsetFaceVerts.length<3)return;for(;this.offsetGhost.children.length>0;){const x=this.offsetGhost.children[0];this.offsetGhost.remove(x),(x instanceof rt||x instanceof Vt)&&(x.geometry.dispose(),x.material instanceof Ft&&x.material.dispose())}const t=this.offsetFaceVerts.length,n=Math.abs(e);if(n<.1)return;const i=this.offsetNormal.clone().normalize(),s=[];for(let x=0;x<t;x++){const y=(x+1)%t,v=new P().subVectors(this.offsetFaceVerts[y],this.offsetFaceVerts[x]),F=new P().crossVectors(v,i).normalize();s.push(F)}const o=e>=0?1:-1,a=[];for(let x=0;x<t;x++){const y=(x-1+t)%t,v=s[y],F=s[x],A=new P().addVectors(v,F).normalize(),L=A.dot(v),O=L>.1?n/L:n,w=Math.min(O,n*3);a.push(this.offsetFaceVerts[x].clone().add(A.multiplyScalar(w*o)))}const c=[],l=[];for(const x of a)c.push(x.x,x.y,x.z);for(let x=1;x<t-1;x++)l.push(0,x,x+1);const h=new at;h.setAttribute("position",new yt(new Float32Array(c),3)),h.setIndex(l),h.computeVertexNormals();const d=new rn({color:16752451,transparent:!0,opacity:.2,side:sn,depthWrite:!1});this.offsetGhost.add(new rt(h,d));const u=[];for(let x=0;x<t;x++){const y=(x+1)%t;u.push(a[x].x,a[x].y,a[x].z),u.push(a[y].x,a[y].y,a[y].z)}const m=new at;m.setAttribute("position",new yt(new Float32Array(u),3));const g=new zt({color:16752451,linewidth:2,depthTest:!1});this.offsetGhost.add(new Vt(m,g));const _=[];for(let x=0;x<t;x++)_.push(this.offsetFaceVerts[x].x,this.offsetFaceVerts[x].y,this.offsetFaceVerts[x].z),_.push(a[x].x,a[x].y,a[x].z);const f=new at;f.setAttribute("position",new yt(new Float32Array(_),3));const p=new zt({color:16752451,linewidth:1,depthTest:!1,transparent:!0,opacity:.5});this.offsetGhost.add(new Vt(f,p))}updateOffsetGhost(e){this.rebuildOffsetGhost(e)}removeOffsetGhost(){if(this.offsetGhost){for(;this.offsetGhost.children.length>0;){const e=this.offsetGhost.children[0];this.offsetGhost.remove(e),(e instanceof rt||e instanceof Vt)&&(e.geometry.dispose(),e.material instanceof Ft&&e.material.dispose())}this.ctx.viewport.scene.remove(this.offsetGhost),this.offsetGhost=null}this.offsetFaceVerts=[]}removeEdgeHighlight(){this.offsetEdgeHighlight&&(this.offsetEdgeHighlight.geometry.dispose(),this.offsetEdgeHighlight.material.dispose(),this.ctx.viewport.scene.remove(this.offsetEdgeHighlight),this.offsetEdgeHighlight=null)}removeOffsetHover(){this.offsetHoverHighlight&&(this.offsetHoverHighlight.geometry.dispose(),this.offsetHoverHighlight.material.dispose(),this.ctx.viewport.scene.remove(this.offsetHoverHighlight),this.offsetHoverHighlight=null)}showEdgeHover(e){this.removeOffsetHover();const t=this.ctx.bridge.getEdgeLines();if(!t)return;const n=e*6;if(n+5>=t.length)return;const i=t[n],s=t[n+1],o=t[n+2],a=t[n+3],c=t[n+4],l=t[n+5],h=new at;h.setAttribute("position",new yt(new Float32Array([i,s,o,a,c,l]),3));const d=new zt({color:65535,linewidth:2,depthTest:!1});this.offsetHoverHighlight=new An(h,d),this.offsetHoverHighlight.renderOrder=998,this.ctx.viewport.scene.add(this.offsetHoverHighlight)}showEdgeSelected(e,t){this.removeEdgeHighlight();const n=new at;n.setAttribute("position",new yt(new Float32Array([e.x,e.y,e.z,t.x,t.y,t.z]),3));const i=new zt({color:16776960,linewidth:3,depthTest:!1});this.offsetEdgeHighlight=new An(n,i),this.offsetEdgeHighlight.renderOrder=999,this.ctx.viewport.scene.add(this.offsetEdgeHighlight)}}class N0{constructor(e){this.name="erase",this.eraseHoverHighlight=null,this.ctx=e}onActivate(){Ht("[EraseTool] Activated")}onDeactivate(){this.cleanup()}onMouseDown(e,t){const n=this.ctx.viewport.pick(e.clientX,e.clientY);if(n&&n.faceIndex!=null&&n.faceIndex>=0){const s=this.ctx.getFaceId(n.faceIndex);if(s>=0){this.ctx.bridge.deleteFace(s),this.ctx.selection.clearSelection(),this.ctx.syncMesh(),Ht("[Erase] Deleted face:",s);return}}const i=this.ctx.viewport.pickEdge(e.clientX,e.clientY);if(i&&i.index!=null&&this.ctx.edgeMap){const s=Math.floor(i.index/2),o=this.ctx.edgeMap[s];if(o!=null){this.ctx.bridge.deleteEdge(o),this.ctx.syncMesh(),Ht("[Erase] Deleted edge:",o);return}}}onMouseMove(e,t){const n=this.ctx.viewport.pickEdge(e.clientX,e.clientY);if(n&&n.index!=null&&this.ctx.edgeMap){const s=Math.floor(n.index/2);this.showEraseHover(s)}else this.removeEraseHover();const i=this.ctx.viewport.pick(e.clientX,e.clientY);if(i&&i.faceIndex!=null&&i.faceIndex>=0){const s=this.ctx.getFaceId(i.faceIndex);s>=0&&this.ctx.selection.handleClick(s,!1,!1)}else n||this.ctx.selection.clearSelection()}onKeyDown(e){e.key==="Escape"&&this.cleanup()}isBusy(){return!1}cleanup(){this.removeEraseHover(),this.ctx.selection.clearSelection()}removeEraseHover(){this.eraseHoverHighlight&&(this.eraseHoverHighlight.geometry.dispose(),this.eraseHoverHighlight.material.dispose(),this.ctx.viewport.scene.remove(this.eraseHoverHighlight),this.eraseHoverHighlight=null)}showEraseHover(e){this.removeEraseHover();const t=this.ctx.bridge.getEdgeLines();if(!t)return;const n=e*6;if(n+5>=t.length)return;const i=new at;i.setAttribute("position",new yt(new Float32Array([t[n],t[n+1],t[n+2],t[n+3],t[n+4],t[n+5]]),3));const s=new zt({color:16729156,linewidth:2,depthTest:!1});this.eraseHoverHighlight=new An(i,s),this.eraseHoverHighlight.renderOrder=998,this.ctx.viewport.scene.add(this.eraseHoverHighlight)}}class dt{constructor(e){this.toastQueue=[],this.maxToasts=3,this.container=document.createElement("div"),this.container.id="axia-toast-container",this.container.style.cssText=`
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    `,e.appendChild(this.container)}static{this.instance=null}static{this.COLORS={success:"#27ae60",error:"#c0392b",warning:"#e67e22",info:"#2e75b6"}}static{this.LABELS={success:"Success",error:"Error",warning:"Warning",info:"Info"}}static init(e){return dt.instance||(dt.instance=new dt(e)),dt.instance}static getInstance(){return dt.instance}show(e,t="info",n=3e3){const i=document.createElement("div"),s=dt.COLORS[t];dt.LABELS[t],i.style.cssText=`
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background-color: ${s};
      color: white;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-size: 14px;
      font-weight: 500;
      max-width: 400px;
      word-break: break-word;
      pointer-events: auto;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      animation: slideUp 0.3s ease-out;
      opacity: 1;
    `;const o=document.createElement("div");switch(o.style.cssText=`
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
    `,t){case"success":o.textContent="✓";break;case"error":o.textContent="✕";break;case"warning":o.textContent="⚠";break;case"info":o.textContent="ℹ";break}const a=document.createElement("span");if(a.textContent=e,a.style.flex="1",i.appendChild(o),i.appendChild(a),i.addEventListener("click",()=>{this.removeToast(i)}),this.container.appendChild(i),this.toastQueue.push(i),this.toastQueue.length>this.maxToasts){const c=this.toastQueue.shift();c&&(c.style.animation="slideDown 0.3s ease-in forwards",setTimeout(()=>c.remove(),300))}setTimeout(()=>{i.parentElement&&this.removeToast(i)},n)}removeToast(e){const t=this.toastQueue.indexOf(e);t>-1&&this.toastQueue.splice(t,1),e.style.animation="slideDown 0.3s ease-in forwards",setTimeout(()=>{e.parentElement&&e.remove()},300)}static success(e,t){dt.getInstance()?.show(e,"success",t)}static error(e,t){dt.getInstance()?.show(e,"error",t)}static warning(e,t){dt.getInstance()?.show(e,"warning",t)}static info(e,t){dt.getInstance()?.show(e,"info",t)}}function F0(){if(document.getElementById("axia-toast-styles"))return;const r=document.createElement("style");r.id="axia-toast-styles",r.textContent=`
    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }

    @keyframes slideDown {
      from {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      to {
        opacity: 0;
        transform: translateX(-50%) translateY(20px);
      }
    }
  `,document.head.appendChild(r)}F0();class U0{constructor(e){this.name="group",this.busy=!1,this.ctx=e}onActivate(){const e=this.ctx.selection.getSelectedFaces();e.length>0?dt.info(`${e.length}개 면 선택됨 — Enter로 그룹 생성`):dt.info("그룹에 포함할 면들을 선택하세요")}onDeactivate(){this.busy=!1}onMouseDown(e,t){if(this.ctx.selection.isInGroupEditMode()){const i=this.ctx.viewport.pick(e.clientX,e.clientY);if(i&&i.faceIndex!=null){const s=this.getFaceId(i.faceIndex);this.ctx.selection.handleGroupEditClick(s,e.shiftKey,e.ctrlKey)||dt.info("그룹 편집 모드 종료")}else this.ctx.selection.handleGroupEditClick(-1,!1,!1);return}const n=this.ctx.viewport.pick(e.clientX,e.clientY);if(n&&n.faceIndex!=null){const i=this.getFaceId(n.faceIndex);if(i>=0){const s=this.ctx.selection.getGroupId(i);s!==void 0&&!e.shiftKey&&!e.ctrlKey?(this.ctx.selection.selectGroup(s),dt.info(`Group-${s} 선택됨 — 더블클릭으로 편집`)):this.ctx.selection.handleClick(i,e.shiftKey,e.ctrlKey)}}else this.ctx.selection.handleClick(-1,!1,!1)}onMouseMove(e,t){const n=this.ctx.viewport.pick(e.clientX,e.clientY);if(n&&n.faceIndex!=null){const i=this.getFaceId(n.faceIndex);this.ctx.selection.setHover(i)}else this.ctx.selection.clearHover()}onKeyDown(e){if(e.key==="Escape"){this.ctx.selection.isInGroupEditMode()?(this.ctx.selection.exitGroupEdit(),dt.info("그룹 편집 모드 종료")):this.ctx.selection.clearSelection(),e.preventDefault();return}if(e.key==="Enter"){this.createGroupFromSelection(),e.preventDefault();return}if(e.key==="Delete"||e.key==="Backspace"){this.ungroupSelection(),e.preventDefault();return}}isBusy(){return this.busy}createGroupFromSelection(){const e=this.ctx.selection.getSelectedFaces();if(e.length<2)return dt.warning("그룹을 만들려면 2개 이상의 면을 선택하세요"),null;const t=this.ctx.bridge.createGroup("Group",e);if(t>0)return this.ctx.selection.groupSelected(),dt.success(`Group-${t} 생성 (${e.length}개 면)`),Ht(`[GroupTool] Group-${t} created with faces:`,e),t;{const n=this.ctx.selection.groupSelected();return n!=null?(dt.success(`Group-${n} 생성 (${e.length}개 면)`),n):(dt.error("그룹 생성 실패"),null)}}ungroupSelection(){const e=this.ctx.selection.getSelectedFaces();if(e.length===0)return dt.warning("해제할 그룹을 선택하세요"),!1;const t=this.ctx.selection.getGroupId(e[0]);t!==void 0&&this.ctx.bridge.deleteGroup(t);const n=this.ctx.selection.ungroupSelected();return n&&dt.info("그룹 해제됨"),n}enterEditMode(e){const t=this.ctx.selection.getGroupId(e);if(t===void 0)return!1;const n=this.ctx.selection.enterGroupEdit(t);return n&&dt.info(`Group-${t} 편집 모드 — ESC로 종료`),n}getFaceId(e){return e>=0&&e<this.ctx.faceMap.length?this.ctx.faceMap[e]:-1}}class Wo{constructor(e,t,n){this._currentTool="select",this.faceMap=new Uint32Array(0),this.edgeMap=null,this.axisLock=null,this.inferredAxis="free",this.axisGuide=null,this.pickBox=null,this.tools=new Map,this.viewport=e,this.bridge=t,this.units=n||window.__axia_units||new dl,this.dimLabel=new y0(e.container),this.snap=new M0,this.snapVisual=new S0(e.container),this.selection=new fi(e.scene),this.selection.setBridge(t),this.pickBox=new w0(e.container);const i=this;this.toolContext={viewport:e,bridge:t,snap:this.snap,snapVisual:this.snapVisual,selection:this.selection,dimLabel:this.dimLabel,units:this.units,get faceMap(){return i.faceMap},get edgeMap(){return i.edgeMap},syncMesh:()=>this.syncMesh(),getSnappedPoint:(s,o,a)=>this.getSnappedPoint(s,o,a),getGroundPoint:s=>this.getGroundPoint(s),getSelectedFaces:()=>this.selection.getSelectedFaces(),get inferredAxis(){return i.inferredAxis},get axisLock(){return i.axisLock},getFaceId:s=>this.getFaceId(s),extractFaceBoundary:s=>this.extractFaceBoundary(s),get3DPoint:s=>this.get3DPoint(s),getAxisInferredPoint:(s,o)=>{const a=this.getAxisInferredPoint(s,o);return a?{point:a.point,axis:a.axis}:null},updateAxisGuide:(s,o,a)=>this.updateAxisGuide(s,o,a),clearAxisGuide:()=>this.clearAxisGuide(),pickBox:this.pickBox},this.tools.set("select",new T0(this.toolContext)),this.tools.set("line",new A0(this.toolContext)),this.tools.set("rect",new C0(this.toolContext)),this.tools.set("circle",new R0(this.toolContext)),this.tools.set("pushpull",new Wn(this.toolContext)),this.tools.set("move",new L0(this.toolContext)),this.tools.set("rotate",new I0(this.toolContext)),this.tools.set("scale",new P0(this.toolContext)),this.tools.set("offset",new D0(this.toolContext)),this.tools.set("erase",new N0(this.toolContext)),this.tools.set("group",new U0(this.toolContext)),this.setupMouseHandlers()}static{this.HOVER_TOOLS=new Set(["select","pushpull","offset","move","rotate","scale","group"])}static{this.EDGE_HOVER_TOOLS=new Set(["offset","erase"])}get currentTool(){return this._currentTool}isToolBusy(){const e=this.tools.get(this._currentTool);return e?e.isBusy():!1}setTool(e){const n=new Set(["pushpull","offset","move","rotate","scale"]).has(e)?this.selection.getSelectedFaces():[],i=this.tools.get(this._currentTool);i?.onDeactivate&&i.onDeactivate(),this._currentTool=e;const s=this.viewport.renderer.domElement;e==="offset"?(s.style.cursor="none",this.pickBox&&(this.pickBox.visible=!0)):(s.style.cursor="",this.pickBox&&(this.pickBox.visible=!1));const o=this.tools.get(e);if(o?.onActivate&&o.onActivate(),n.length>0)for(const a of n)this.selection.handleClick(a,!0,!1)}setAxisLock(e){this.axisLock=e,e||this.clearAxisGuide(),console.log("[AxisLock]",e?`${e.toUpperCase()}축 잠금`:"해제")}applyVCBValue(e,t){const n=this.tools.get(this._currentTool);n?.applyVCBValue&&n.applyVCBValue(e,t)}executeAction(e){if(e==="undo"){if(this.isToolBusy()){console.log("[Action] undo blocked — tool is active, cancelling tool instead"),this.cancelCurrentTool();return}const t=this.bridge.undo();console.log("[Action] undo =>",t),t&&(this.syncMesh(),Cr().syncFromRust())}else if(e==="redo"){const t=this.bridge.redo();console.log("[Action] redo =>",t),t&&(this.syncMesh(),Cr().syncFromRust())}else if(e==="delete"){const t=this.selection.getSelectedFaces(),n=this.selection.getSelectedEdges();if(t.length>0||n.length>0){if(!this.bridge.batchDelete(t,n)){for(const s of t)this.bridge.deleteFace(s);for(const s of n)this.bridge.deleteEdge(s)}this.selection.clearSelection(),this.syncMesh(),console.log("[Action] delete",t.length,"faces,",n.length,"edges")}}else if(e==="select-all")this.selection.selectEverything(this.faceMap,this.edgeMap),console.log("[Action] select-all");else if(e==="select-same")this.selection.selectSameType(this.faceMap,this.edgeMap),console.log("[Action] select-same");else if(e==="group"){const t=this.tools.get("group");if(t)t.createGroupFromSelection();else{const n=this.selection.groupSelected();n!=null&&console.log(`[Action] group created: Group-${n}, faces:`,this.selection.getSelectedFaces())}}else if(e==="ungroup"){const t=this.tools.get("group");if(t)t.ungroupSelection();else{const n=this.selection.ungroupSelected();console.log("[Action] ungroup =>",n)}}else if(e==="make-component"){const t=this.selection.getSelectedFaces();if(t.length>0){const n=this.selection.getGroupId(t[0]);if(n!==void 0){const i=this.bridge.makeComponent(n,`Component-${n}`);i>0&&console.log(`[Action] make-component: Group-${n} → Component def ${i}`)}else console.log("[Action] make-component — 먼저 그룹을 선택하세요")}}}syncMesh(){const e=this.bridge.getMeshBuffers(),t=this.bridge.getEdgeLines();this.edgeMap=this.bridge.getEdgeMap(),e?(this.viewport.updateMesh(e.positions,e.normals,e.indices,t??void 0,e.faceMap),this.faceMap=e.faceMap,this.selection.updateBuffers(e.positions,e.indices,e.faceMap),this.selection.updateEdgeBuffers(t,this.edgeMap),this.snap.updateFromMesh(e.positions,e.indices,e.faceMap,t)):(this.viewport.updateMesh(new Float32Array(0),new Float32Array(0),new Uint32Array(0),t??void 0,new Uint32Array(0)),this.faceMap=new Uint32Array(0),this.selection.updateBuffers(new Float32Array(0),new Uint32Array(0),new Uint32Array(0)),this.selection.updateEdgeBuffers(t,this.edgeMap),this.snap.updateFromMesh(new Float32Array(0),new Uint32Array(0),new Uint32Array(0),t));const n=this.bridge.getStats();this.viewport.setStats(n.verts,n.faces)}getSnappedPoint(e,t,n=!1){const i=this.viewport.renderer.domElement,s=window.__axia_snap_override;let o;return s==="none"?(o=null,n&&delete window.__axia_snap_override):s?(o=this.snap.findSnapOverride(s,e.clientX,e.clientY,this.viewport.activeCamera,i,t),n&&delete window.__axia_snap_override):o=this.snap.findSnap(e.clientX,e.clientY,this.viewport.activeCamera,i,t),this.snapVisual.update(o,this.viewport.activeCamera),o?o.position.clone():t}getGroundPoint(e){const t=this.getRay(e),n=new jn(new P(0,1,0),0),i=new P;return t.ray.intersectPlane(n,i)}get3DPoint(e){const t=this.viewport.pick(e.clientX,e.clientY);if(t&&t.point)return t.point.clone();const n=this.getRay(e),i=new jn(new P(0,1,0),0),s=new P;return n.ray.intersectPlane(i,s)}getRay(e){const n=this.viewport.renderer.domElement.getBoundingClientRect(),i=new Ge((e.clientX-n.left)/n.width*2-1,-((e.clientY-n.top)/n.height)*2+1),s=new Zo;return s.setFromCamera(i,this.viewport.activeCamera),s}extractFaceBoundary(e){const t=this.bridge.getMeshBuffers();if(!t)return[];const n=new Map,i=l=>new P(t.positions[l*3],t.positions[l*3+1],t.positions[l*3+2]),s=(l,h)=>{const d=`${l.x.toFixed(5)},${l.y.toFixed(5)},${l.z.toFixed(5)}`,u=`${h.x.toFixed(5)},${h.y.toFixed(5)},${h.z.toFixed(5)}`;return d<u?`${d}|${u}`:`${u}|${d}`};for(let l=0;l<t.faceMap.length;l++){if(t.faceMap[l]!==e)continue;const h=t.indices[l*3],d=t.indices[l*3+1],u=t.indices[l*3+2],m=i(h),g=i(d),_=i(u);for(const[f,p]of[[m,g],[g,_],[_,m]]){const x=s(f,p),y=n.get(x);y?y.count++:n.set(x,{a:f.clone(),b:p.clone(),count:1})}}const o=[];for(const[,l]of n)l.count===1&&o.push(l);if(o.length===0)return[];const a=[o[0].a.clone(),o[0].b.clone()],c=new Set([0]);for(let l=0;l<o.length;l++){const h=a[a.length-1];let d=!1;for(let u=0;u<o.length;u++){if(c.has(u))continue;const m=o[u];if(h.distanceTo(m.a)<.001){a.push(m.b.clone()),c.add(u),d=!0;break}else if(h.distanceTo(m.b)<.001){a.push(m.a.clone()),c.add(u),d=!0;break}}if(!d)break}return a.length>2&&a[0].distanceTo(a[a.length-1])<.001&&a.pop(),a}getAxisInferredPoint(e,t){const n=this.getRay(e),i=[{dir:new P(1,0,0),name:"x"},{dir:new P(0,1,0),name:"y"},{dir:new P(0,0,1),name:"z"}],s=this.axisLock;let o="x",a=t.clone(),c=1/0;const h=this.viewport.renderer.domElement.getBoundingClientRect();for(const u of i){if(s&&s!=="free"&&s!==u.name)continue;const m=this.closestPointOnAxisToRay(t,u.dir,n.ray.origin,n.ray.direction);if(!m)continue;const g=m.clone().project(this.viewport.activeCamera),_=(g.x*.5+.5)*h.width,f=(-g.y*.5+.5)*h.height,p=e.clientX-h.left,x=e.clientY-h.top,y=Math.sqrt((_-p)**2+(f-x)**2);y<c&&(c=y,o=u.name,a=m)}return!s&&c>30?{point:this.get3DPoint(e)||t.clone(),axis:"free"}:{point:a,axis:s&&s!=="free"?s:o}}closestPointOnAxisToRay(e,t,n,i){const s=new P().subVectors(e,n),o=t.dot(t),a=t.dot(i),c=i.dot(i),l=t.dot(s),h=i.dot(s),d=o*c-a*a;if(Math.abs(d)<1e-10)return null;const u=(a*h-c*l)/d;return e.clone().add(t.clone().multiplyScalar(u))}updateAxisGuide(e,t,n){if(this.axisGuide&&(this.viewport.scene.remove(this.axisGuide),this.axisGuide.geometry.dispose(),this.axisGuide.material.dispose(),this.axisGuide=null),t==="free")return;const i={x:16724787,y:3377407,z:3394611},o={x:new P(1,0,0),y:new P(0,1,0),z:new P(0,0,1)}[t],a=e.distanceTo(n)*1.5+500,c=e.clone().add(o.clone().multiplyScalar(-a)),l=e.clone().add(o.clone().multiplyScalar(a)),h=new at().setFromPoints([c,l]),d=new Oc({color:i[t],dashSize:20,gapSize:10,transparent:!0,opacity:.5});this.axisGuide=new An(h,d),this.axisGuide.computeLineDistances(),this.viewport.scene.add(this.axisGuide)}clearAxisGuide(){this.axisGuide&&(this.viewport.scene.remove(this.axisGuide),this.axisGuide.geometry.dispose(),this.axisGuide.material.dispose(),this.axisGuide=null)}getFaceId(e){return e>=0&&e<this.faceMap.length?this.faceMap[e]:-1}cancelCurrentTool(){const e=this.tools.get(this._currentTool);e?.onDeactivate&&e.onDeactivate(),this.clearAxisGuide(),this.dimLabel.clear(),this.snapVisual.clear(),this.snap.setReferencePoint(null),this.snap.clearTrackPoints(),this.axisLock=null,this.inferredAxis="free"}setupMouseHandlers(){const e=this.viewport.renderer.domElement;e.addEventListener("dblclick",t=>{if(t.button!==0||t.altKey||this._currentTool!=="select"&&this._currentTool!=="group")return;const n=this.viewport.pick(t.clientX,t.clientY);if(n&&n.faceIndex!=null){const i=this.getFaceId(n.faceIndex);if(i>=0){if(this.selection.getGroupId(i)!==void 0){const o=this.tools.get("group");if(o){o.enterEditMode(i);return}}this.selection.selectFaceWithEdges(i)}}}),e.addEventListener("mousedown",t=>{if(t.button!==0||t.altKey)return;const n=this.get3DPoint(t),i=this.getSnappedPoint(t,n,!0),s=this.tools.get(this._currentTool);s?.onMouseDown&&s.onMouseDown(t,i)}),e.addEventListener("mousemove",t=>{const n=this.get3DPoint(t),i=this.getSnappedPoint(t,n),s=this.tools.get(this._currentTool);s?.onMouseMove&&s.onMouseMove(t,i);const o=this.isToolBusy();if(!o&&Wo.HOVER_TOOLS.has(this._currentTool)){const a=this.viewport.pick(t.clientX,t.clientY);if(a&&a.faceIndex!=null){const c=this.getFaceId(a.faceIndex);this.selection.setHover(c),this.selection.clearEdgeHover()}else if(this.selection.clearHover(),Wo.EDGE_HOVER_TOOLS.has(this._currentTool)){const c=this.viewport.pickEdge(t.clientX,t.clientY);if(c&&c.index!=null){const l=Math.floor(c.index/2);this.selection.setEdgeHover(l)}else this.selection.clearEdgeHover()}else this.selection.clearEdgeHover()}else o?(this.selection.clearHover(),this.selection.clearEdgeHover()):(this.selection.clearHover(),this.selection.clearEdgeHover());this._currentTool==="select"&&(this.dimLabel.clear(),this.snapVisual.clear())}),e.addEventListener("mouseleave",()=>{this.selection.clearHover(),this.selection.clearEdgeHover()}),e.addEventListener("mouseup",t=>{if(t.button!==0)return;const n=this.tools.get(this._currentTool);n?.onMouseUp&&n.onMouseUp(t)}),document.addEventListener("keydown",t=>{t.key==="ArrowRight"?(this.setAxisLock("x"),t.preventDefault()):t.key==="ArrowUp"?(this.setAxisLock("y"),t.preventDefault()):t.key==="ArrowLeft"?(this.setAxisLock("z"),t.preventDefault()):t.key==="ArrowDown"&&(this.setAxisLock(null),t.preventDefault());const n=this.tools.get(this._currentTool);n?.onKeyDown&&n.onKeyDown(t)})}}class Gc{__destroy_into_raw(){const e=this.__wbg_ptr;return this.__wbg_ptr=0,Jh.unregister(this),e}free(){const e=this.__destroy_into_raw();te.__wbg_axiaengine_free(e,0)}add_faces_to_group(e,t){const n=vn(t,te.__wbindgen_export2),i=kt;return te.axiaengine_add_faces_to_group(this.__wbg_ptr,e,n,i)!==0}assign_material(e,t){const n=vn(e,te.__wbindgen_export2),i=kt;return te.axiaengine_assign_material(this.__wbg_ptr,n,i,t)!==0}batch_delete(e,t){const n=vn(e,te.__wbindgen_export2),i=kt,s=vn(t,te.__wbindgen_export2),o=kt;return te.axiaengine_batch_delete(this.__wbg_ptr,n,i,s,o)!==0}boolean_op(e,t,n){let i,s;try{const c=te.__wbindgen_add_to_stack_pointer(-16),l=vn(e,te.__wbindgen_export2),h=kt,d=vn(t,te.__wbindgen_export2),u=kt,m=Co(n,te.__wbindgen_export2,te.__wbindgen_export3),g=kt;te.axiaengine_boolean_op(c,this.__wbg_ptr,l,h,d,u,m,g);var o=pt().getInt32(c+0,!0),a=pt().getInt32(c+4,!0);return i=o,s=a,Xn(o,a)}finally{te.__wbindgen_add_to_stack_pointer(16),te.__wbindgen_export4(i,s,1)}}can_redo(){return te.axiaengine_can_redo(this.__wbg_ptr)!==0}can_undo(){return te.axiaengine_can_undo(this.__wbg_ptr)!==0}create_group(e,t){const n=Co(e,te.__wbindgen_export2,te.__wbindgen_export3),i=kt,s=vn(t,te.__wbindgen_export2),o=kt;return te.axiaengine_create_group(this.__wbg_ptr,n,i,s,o)}delete_edge(e){return te.axiaengine_delete_edge(this.__wbg_ptr,e)!==0}delete_face(e){return te.axiaengine_delete_face(this.__wbg_ptr,e)!==0}delete_group(e){return te.axiaengine_delete_group(this.__wbg_ptr,e)!==0}draw_circle(e,t,n,i,s,o,a,c){return te.axiaengine_draw_circle(this.__wbg_ptr,e,t,n,i,s,o,a,c)}draw_line(e,t,n,i,s,o,a,c,l){return te.axiaengine_draw_line(this.__wbg_ptr,e,t,n,i,s,o,a,c,l)}draw_rect(e,t,n,i,s,o,a,c,l,h,d){return te.axiaengine_draw_rect(this.__wbg_ptr,e,t,n,i,s,o,a,c,l,h,d)}export_snapshot(){try{const i=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_export_snapshot(i,this.__wbg_ptr);var e=pt().getInt32(i+0,!0),t=pt().getInt32(i+4,!0),n=nu(e,t).slice();return te.__wbindgen_export4(e,t*1,1),n}finally{te.__wbindgen_add_to_stack_pointer(16)}}face_count(){return te.axiaengine_face_count(this.__wbg_ptr)>>>0}faces_centroid(e){try{const s=te.__wbindgen_add_to_stack_pointer(-16),o=vn(e,te.__wbindgen_export2),a=kt;te.axiaengine_faces_centroid(s,this.__wbg_ptr,o,a);var t=pt().getInt32(s+0,!0),n=pt().getInt32(s+4,!0),i=Qh(t,n).slice();return te.__wbindgen_export4(t,n*8,8),i}finally{te.__wbindgen_add_to_stack_pointer(16)}}get_all_groups(){let e,t;try{const s=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_get_all_groups(s,this.__wbg_ptr);var n=pt().getInt32(s+0,!0),i=pt().getInt32(s+4,!0);return e=n,t=i,Xn(n,i)}finally{te.__wbindgen_add_to_stack_pointer(16),te.__wbindgen_export4(e,t,1)}}get_all_materials(){let e,t;try{const s=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_get_all_materials(s,this.__wbg_ptr);var n=pt().getInt32(s+0,!0),i=pt().getInt32(s+4,!0);return e=n,t=i,Xn(n,i)}finally{te.__wbindgen_add_to_stack_pointer(16),te.__wbindgen_export4(e,t,1)}}get_connected_faces(e){try{const s=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_get_connected_faces(s,this.__wbg_ptr,e);var t=pt().getInt32(s+0,!0),n=pt().getInt32(s+4,!0),i=hr(t,n).slice();return te.__wbindgen_export4(t,n*4,4),i}finally{te.__wbindgen_add_to_stack_pointer(16)}}get_edge_lines(){try{const i=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_get_edge_lines(i,this.__wbg_ptr);var e=pt().getInt32(i+0,!0),t=pt().getInt32(i+4,!0),n=Ha(e,t).slice();return te.__wbindgen_export4(e,t*4,4),n}finally{te.__wbindgen_add_to_stack_pointer(16)}}get_edge_map(){try{const i=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_get_edge_map(i,this.__wbg_ptr);var e=pt().getInt32(i+0,!0),t=pt().getInt32(i+4,!0),n=hr(e,t).slice();return te.__wbindgen_export4(e,t*4,4),n}finally{te.__wbindgen_add_to_stack_pointer(16)}}get_face_map(){try{const i=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_get_face_map(i,this.__wbg_ptr);var e=pt().getInt32(i+0,!0),t=pt().getInt32(i+4,!0),n=hr(e,t).slice();return te.__wbindgen_export4(e,t*4,4),n}finally{te.__wbindgen_add_to_stack_pointer(16)}}get_face_material(e){return te.axiaengine_get_face_material(this.__wbg_ptr,e)>>>0}get_face_normal(e){try{const s=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_get_face_normal(s,this.__wbg_ptr,e);var t=pt().getInt32(s+0,!0),n=pt().getInt32(s+4,!0),i=Qh(t,n).slice();return te.__wbindgen_export4(t,n*8,8),i}finally{te.__wbindgen_add_to_stack_pointer(16)}}get_group_faces(e){try{const s=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_get_group_faces(s,this.__wbg_ptr,e);var t=pt().getInt32(s+0,!0),n=pt().getInt32(s+4,!0),i=hr(t,n).slice();return te.__wbindgen_export4(t,n*4,4),i}finally{te.__wbindgen_add_to_stack_pointer(16)}}get_group_for_face(e){return te.axiaengine_get_group_for_face(this.__wbg_ptr,e)}get_group_info(e){let t,n;try{const o=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_get_group_info(o,this.__wbg_ptr,e);var i=pt().getInt32(o+0,!0),s=pt().getInt32(o+4,!0);return t=i,n=s,Xn(i,s)}finally{te.__wbindgen_add_to_stack_pointer(16),te.__wbindgen_export4(t,n,1)}}get_indices(){try{const i=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_get_indices(i,this.__wbg_ptr);var e=pt().getInt32(i+0,!0),t=pt().getInt32(i+4,!0),n=hr(e,t).slice();return te.__wbindgen_export4(e,t*4,4),n}finally{te.__wbindgen_add_to_stack_pointer(16)}}get_normals(){try{const i=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_get_normals(i,this.__wbg_ptr);var e=pt().getInt32(i+0,!0),t=pt().getInt32(i+4,!0),n=Ha(e,t).slice();return te.__wbindgen_export4(e,t*4,4),n}finally{te.__wbindgen_add_to_stack_pointer(16)}}get_positions(){try{const i=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_get_positions(i,this.__wbg_ptr);var e=pt().getInt32(i+0,!0),t=pt().getInt32(i+4,!0),n=Ha(e,t).slice();return te.__wbindgen_export4(e,t*4,4),n}finally{te.__wbindgen_add_to_stack_pointer(16)}}get_stats(){let e,t;try{const s=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_get_stats(s,this.__wbg_ptr);var n=pt().getInt32(s+0,!0),i=pt().getInt32(s+4,!0);return e=n,t=i,Xn(n,i)}finally{te.__wbindgen_add_to_stack_pointer(16),te.__wbindgen_export4(e,t,1)}}get_xia_face(e){return te.axiaengine_get_xia_face(this.__wbg_ptr,e)>>>0}get_xia_info(e){let t,n;try{const o=te.__wbindgen_add_to_stack_pointer(-16),a=vn(e,te.__wbindgen_export2),c=kt;te.axiaengine_get_xia_info(o,this.__wbg_ptr,a,c);var i=pt().getInt32(o+0,!0),s=pt().getInt32(o+4,!0);return t=i,n=s,Xn(i,s)}finally{te.__wbindgen_add_to_stack_pointer(16),te.__wbindgen_export4(t,n,1)}}group_count(){return te.axiaengine_group_count(this.__wbg_ptr)>>>0}import_dxf(e){let t,n;try{const o=te.__wbindgen_add_to_stack_pointer(-16),a=ed(e,te.__wbindgen_export2),c=kt;te.axiaengine_import_dxf(o,this.__wbg_ptr,a,c);var i=pt().getInt32(o+0,!0),s=pt().getInt32(o+4,!0);return t=i,n=s,Xn(i,s)}finally{te.__wbindgen_add_to_stack_pointer(16),te.__wbindgen_export4(t,n,1)}}import_snapshot(e){const t=ed(e,te.__wbindgen_export2),n=kt;return te.axiaengine_import_snapshot(this.__wbg_ptr,t,n)!==0}make_component(e,t){const n=Co(t,te.__wbindgen_export2,te.__wbindgen_export3),i=kt;return te.axiaengine_make_component(this.__wbg_ptr,e,n,i)}constructor(){const e=te.axiaengine_new();return this.__wbg_ptr=e>>>0,Jh.register(this,this.__wbg_ptr,this),this}offset_edge(e,t,n,i,s){let o,a;try{const h=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_offset_edge(h,this.__wbg_ptr,e,t,n,i,s);var c=pt().getInt32(h+0,!0),l=pt().getInt32(h+4,!0);return o=c,a=l,Xn(c,l)}finally{te.__wbindgen_add_to_stack_pointer(16),te.__wbindgen_export4(o,a,1)}}offset_face(e,t){let n,i;try{const a=te.__wbindgen_add_to_stack_pointer(-16);te.axiaengine_offset_face(a,this.__wbg_ptr,e,t);var s=pt().getInt32(a+0,!0),o=pt().getInt32(a+4,!0);return n=s,i=o,Xn(s,o)}finally{te.__wbindgen_add_to_stack_pointer(16),te.__wbindgen_export4(n,i,1)}}orient_faces(){return te.axiaengine_orient_faces(this.__wbg_ptr)>>>0}push_pull(e,t){return te.axiaengine_push_pull(this.__wbg_ptr,e,t)!==0}redo(){return te.axiaengine_redo(this.__wbg_ptr)!==0}remove_faces_from_group(e,t){const n=vn(t,te.__wbindgen_export2),i=kt;return te.axiaengine_remove_faces_from_group(this.__wbg_ptr,e,n,i)!==0}remove_material(e){const t=vn(e,te.__wbindgen_export2),n=kt;return te.axiaengine_remove_material(this.__wbg_ptr,t,n)!==0}rename_group(e,t){const n=Co(t,te.__wbindgen_export2,te.__wbindgen_export3),i=kt;return te.axiaengine_rename_group(this.__wbg_ptr,e,n,i)!==0}rotate_faces(e,t,n,i,s,o,a,c){const l=vn(e,te.__wbindgen_export2),h=kt;return te.axiaengine_rotate_faces(this.__wbg_ptr,l,h,t,n,i,s,o,a,c)!==0}scale_faces(e,t,n,i,s,o,a){const c=vn(e,te.__wbindgen_export2),l=kt;return te.axiaengine_scale_faces(this.__wbg_ptr,c,l,t,n,i,s,o,a)!==0}set_group_parent(e,t){return te.axiaengine_set_group_parent(this.__wbg_ptr,e,t)!==0}toggle_group_lock(e){return te.axiaengine_toggle_group_lock(this.__wbg_ptr,e)!==0}toggle_group_visibility(e){return te.axiaengine_toggle_group_visibility(this.__wbg_ptr,e)!==0}translate_faces(e,t,n,i){const s=vn(e,te.__wbindgen_export2),o=kt;return te.axiaengine_translate_faces(this.__wbg_ptr,s,o,t,n,i)!==0}undo(){return te.axiaengine_undo(this.__wbg_ptr)!==0}vert_count(){return te.axiaengine_vert_count(this.__wbg_ptr)>>>0}}Symbol.dispose&&(Gc.prototype[Symbol.dispose]=Gc.prototype.free);function O0(){return{__proto__:null,"./axia_wasm_bg.js":{__proto__:null,__wbg___wbindgen_throw_6b64449b9b9ed33c:function(e,t){throw new Error(Xn(e,t))},__wbg_getRandomValues_d49329ff89a07af1:function(){return G0(function(e,t){globalThis.crypto.getRandomValues(nu(e,t))},arguments)},__wbg_getTime_da7c55f52b71e8c6:function(e){return vr(e).getTime()},__wbg_getTimezoneOffset_31f57a5389d0d57c:function(e){return vr(e).getTimezoneOffset()},__wbg_log_7e1aa9064a1dbdbd:function(e){console.log(vr(e))},__wbg_new_0_4d657201ced14de3:function(){return Cs(new Date)},__wbg_new_7913666fe5070684:function(e){const t=new Date(vr(e));return Cs(t)},__wbg_new_with_year_month_day_hr_min_sec_d352dc3247220342:function(e,t,n,i,s,o){const a=new Date(e>>>0,t,n,i,s,o);return Cs(a)},__wbindgen_cast_0000000000000001:function(e){return Cs(e)},__wbindgen_cast_0000000000000002:function(e,t){const n=Xn(e,t);return Cs(n)},__wbindgen_object_drop_ref:function(e){H0(e)}}}}const Jh=typeof FinalizationRegistry>"u"?{register:()=>{},unregister:()=>{}}:new FinalizationRegistry(r=>te.__wbg_axiaengine_free(r>>>0,1));function Cs(r){br===mi.length&&mi.push(mi.length+1);const e=br;return br=mi[e],mi[e]=r,e}function k0(r){r<1028||(mi[r]=br,br=r)}function Ha(r,e){return r=r>>>0,B0().subarray(r/4,r/4+e)}function Qh(r,e){return r=r>>>0,z0().subarray(r/8,r/8+e)}function hr(r,e){return r=r>>>0,iu().subarray(r/4,r/4+e)}function nu(r,e){return r=r>>>0,Fs().subarray(r/1,r/1+e)}let $i=null;function pt(){return($i===null||$i.buffer.detached===!0||$i.buffer.detached===void 0&&$i.buffer!==te.memory.buffer)&&($i=new DataView(te.memory.buffer)),$i}let mr=null;function B0(){return(mr===null||mr.byteLength===0)&&(mr=new Float32Array(te.memory.buffer)),mr}let gr=null;function z0(){return(gr===null||gr.byteLength===0)&&(gr=new Float64Array(te.memory.buffer)),gr}function Xn(r,e){return r=r>>>0,W0(r,e)}let _r=null;function iu(){return(_r===null||_r.byteLength===0)&&(_r=new Uint32Array(te.memory.buffer)),_r}let xr=null;function Fs(){return(xr===null||xr.byteLength===0)&&(xr=new Uint8Array(te.memory.buffer)),xr}function vr(r){return mi[r]}function G0(r,e){try{return r.apply(this,e)}catch(t){te.__wbindgen_export(Cs(t))}}let mi=new Array(1024).fill(void 0);mi.push(void 0,null,!0,!1);let br=mi.length;function vn(r,e){const t=e(r.length*4,4)>>>0;return iu().set(r,t/4),kt=r.length,t}function ed(r,e){const t=e(r.length*1,1)>>>0;return Fs().set(r,t/1),kt=r.length,t}function Co(r,e,t){if(t===void 0){const a=Mr.encode(r),c=e(a.length,1)>>>0;return Fs().subarray(c,c+a.length).set(a),kt=a.length,c}let n=r.length,i=e(n,1)>>>0;const s=Fs();let o=0;for(;o<n;o++){const a=r.charCodeAt(o);if(a>127)break;s[i+o]=a}if(o!==n){o!==0&&(r=r.slice(o)),i=t(i,n,n=o+r.length*3,1)>>>0;const a=Fs().subarray(i+o,i+n),c=Mr.encodeInto(r,a);o+=c.written,i=t(i,n,o,1)>>>0}return kt=o,i}function H0(r){const e=vr(r);return k0(r),e}let Oo=new TextDecoder("utf-8",{ignoreBOM:!0,fatal:!0});Oo.decode();const V0=2146435072;let Va=0;function W0(r,e){return Va+=e,Va>=V0&&(Oo=new TextDecoder("utf-8",{ignoreBOM:!0,fatal:!0}),Oo.decode(),Va=e),Oo.decode(Fs().subarray(r,r+e))}const Mr=new TextEncoder;"encodeInto"in Mr||(Mr.encodeInto=function(r,e){const t=Mr.encode(r);return e.set(t),{read:r.length,written:t.length}});let kt=0,te;function X0(r,e){return te=r.exports,$i=null,mr=null,gr=null,_r=null,xr=null,te}async function j0(r,e){if(typeof Response=="function"&&r instanceof Response){if(typeof WebAssembly.instantiateStreaming=="function")try{return await WebAssembly.instantiateStreaming(r,e)}catch(i){if(r.ok&&t(r.type)&&r.headers.get("Content-Type")!=="application/wasm")console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n",i);else throw i}const n=await r.arrayBuffer();return await WebAssembly.instantiate(n,e)}else{const n=await WebAssembly.instantiate(r,e);return n instanceof WebAssembly.Instance?{instance:n,module:r}:n}function t(n){switch(n){case"basic":case"cors":case"default":return!0}return!1}}async function q0(r){if(te!==void 0)return te;r!==void 0&&(Object.getPrototypeOf(r)===Object.prototype?{module_or_path:r}=r:console.warn("using deprecated parameters for the initialization function; pass a single object instead")),r===void 0&&(r=new URL("/assets/axia_wasm_bg-_kt2sami.wasm",import.meta.url));const e=O0();(typeof r=="string"||typeof Request=="function"&&r instanceof Request||typeof URL=="function"&&r instanceof URL)&&(r=fetch(r));const{instance:t,module:n}=await j0(await r,e);return X0(t)}class Y0{constructor(){this.engine=null,this.bufferCache={positions:null,normals:null,indices:null,faceMap:null,edgeLines:null,edgeMap:null,dirty:!0}}async init(){try{await q0(),this.engine=new Gc,console.log("[WasmBridge] Engine initialized.")}catch(e){console.error("[WasmBridge] Failed to initialize WASM:",e),dt.error("WASM 엔진 초기화 실패")}}isReady(){return this.engine!==null}markDirty(){this.bufferCache.dirty=!0}drawLine(e,t,n,i,s,o,a=0,c=0,l=0){return this.engine?(this.markDirty(),this.engine.draw_line(e,t,n,i,s,o,a,c,l)):-1}drawRect(e,t,n,i,s,o,a,c,l,h,d){return this.engine?(this.markDirty(),this.engine.draw_rect(e,t,n,i,s,o,a,c,l,h,d)):-1}drawCircle(e,t,n,i,s,o,a,c){return this.engine?(this.markDirty(),this.engine.draw_circle(e,t,n,i,s,o,a,c)):-1}getXiaFace(e){if(!this.engine)return-1;if(this.engine.get_xia_face){const t=this.engine.get_xia_face(e);return t===4294967295?-1:t}return e}pushPull(e,t){return this.engine?(this.markDirty(),this.engine.push_pull(e,t)):!1}undo(){return this.engine?(this.markDirty(),this.engine.undo()):!1}redo(){return this.engine?(this.markDirty(),this.engine.redo()):!1}getMeshBuffers(){if(!this.engine)return null;if(!this.bufferCache.dirty&&this.bufferCache.positions)return{positions:this.bufferCache.positions,normals:this.bufferCache.normals,indices:this.bufferCache.indices,faceMap:this.bufferCache.faceMap};const e=this.engine.get_positions(),t=this.engine.get_normals(),n=this.engine.get_indices(),i=this.engine.get_face_map();return e.length===0?null:(this.bufferCache={positions:e,normals:t,indices:n,faceMap:i,edgeLines:null,edgeMap:null,dirty:!1},{positions:e,normals:t,indices:n,faceMap:i})}getEdgeLines(){if(!this.engine)return null;if(!this.bufferCache.dirty&&this.bufferCache.edgeLines)return this.bufferCache.edgeLines;try{const e=this.engine.get_edge_lines?.();return e&&e.length>0?(this.bufferCache.edgeLines=e,e):null}catch{return null}}getFaceNormal(e){if(!this.engine)return[0,0,0];const t=this.engine.get_face_normal(e);return[t[0],t[1],t[2]]}deleteFace(e){return this.engine?(this.markDirty(),this.engine.delete_face(e)):!1}deleteEdge(e){if(!this.engine)return!1;this.markDirty();try{return this.engine.delete_edge?.(e)??!1}catch(t){return console.error("[WasmBridge] deleteEdge failed:",t),!1}}batchDelete(e,t){if(!this.engine?.batch_delete)return!1;this.markDirty();try{const n=new Uint32Array(e),i=new Uint32Array(t);return this.engine.batch_delete(n,i)}catch(n){return console.error("[WasmBridge] batchDelete failed:",n),!1}}getConnectedFaces(e){if(!this.engine?.get_connected_faces)return[];try{const t=this.engine.get_connected_faces(e);return Array.from(t)}catch(t){return console.error("[WasmBridge] getConnectedFaces failed:",t),[]}}faceCount(){return this.engine?this.engine.face_count():0}exportSnapshot(){if(!this.engine)return null;try{const e=this.engine.export_snapshot?.();return e&&dt.success("프로젝트 내보내기 성공"),e??null}catch(e){return console.error("[WasmBridge] exportSnapshot failed:",e),dt.error("프로젝트 내보내기 실패"),null}}importSnapshot(e){if(!this.engine)return!1;this.markDirty();try{const t=this.engine.import_snapshot?.(e)??!1;return t&&dt.success("프로젝트 불러오기 성공"),t}catch(t){return console.error("[WasmBridge] importSnapshot failed:",t),dt.error("프로젝트 불러오기 실패"),!1}}getStats(){if(!this.engine)return{verts:0,edges:0,faces:0,groups:0,components:0,canUndo:!1,canRedo:!1};try{return JSON.parse(this.engine.get_stats())}catch{return{verts:0,edges:0,faces:0,groups:0,components:0,canUndo:!1,canRedo:!1}}}importDxf(e){if(!this.engine)return null;this.markDirty();try{const t=this.engine.import_dxf?.(e);if(!t)return null;const n=JSON.parse(t);return n.ok?dt.success(`DXF 불러오기 성공: ${n.totalFaces??0}개 면`):dt.error(`DXF 불러오기 실패: ${n.error??"알 수 없는 오류"}`),n}catch(t){return console.error("[WasmBridge] importDxf failed:",t),dt.error("DXF 파일 파싱 실패"),null}}translateFaces(e,t,n,i){if(!this.engine)return!1;this.markDirty();try{const s=new Uint32Array(e);return this.engine.translate_faces?.(s,t,n,i)??!1}catch(s){return console.error("[WasmBridge] translateFaces failed:",s),dt.warning("이동 실행 실패"),!1}}rotateFaces(e,t,n,i,s,o,a,c){if(!this.engine)return!1;this.markDirty();try{const l=new Uint32Array(e);return this.engine.rotate_faces?.(l,t,n,i,s,o,a,c)??!1}catch(l){return console.error("[WasmBridge] rotateFaces failed:",l),dt.warning("회전 실행 실패"),!1}}scaleFaces(e,t,n,i,s,o,a){if(!this.engine)return!1;this.markDirty();try{const c=new Uint32Array(e);return this.engine.scale_faces?.(c,t,n,i,s,o,a)??!1}catch(c){return console.error("[WasmBridge] scaleFaces failed:",c),dt.warning("스케일 실행 실패"),!1}}facesCentroid(e){if(!this.engine)return null;try{const t=new Uint32Array(e),n=this.engine.faces_centroid?.(t);return!n||n.length<3?null:new P(n[0],n[1],n[2])}catch(t){return console.error("[WasmBridge] facesCentroid failed:",t),null}}offsetFace(e,t){if(!this.engine)return null;this.markDirty();try{const n=this.engine.offset_face?.(e,t);if(!n)return null;const i=JSON.parse(n);return i.ok||dt.warning(`Offset 실패: ${i.error??"알 수 없는 오류"}`),i}catch(n){return console.error("[WasmBridge] offsetFace failed:",n),dt.warning("Offset 실행 실패"),null}}offsetEdge(e,t,n){if(!this.engine)return null;this.markDirty();try{const i=this.engine.offset_edge?.(e,t,n[0],n[1],n[2]);if(!i)return null;const s=JSON.parse(i);return s.ok||dt.warning(`Edge Offset 실패: ${s.error??"알 수 없는 오류"}`),s}catch(i){return console.error("[WasmBridge] offsetEdge failed:",i),dt.warning("Edge Offset 실행 실패"),null}}getEdgeMap(){if(!this.engine)return null;if(!this.bufferCache.dirty&&this.bufferCache.edgeMap)return this.bufferCache.edgeMap;try{const e=this.engine.get_edge_map?.();return e&&e.length>0?(this.bufferCache.edgeMap=e,e):null}catch{return null}}getXiaInfo(e){if(!this.engine)return null;try{const t=new Uint32Array(e),n=this.engine.get_xia_info?.(t);return n?JSON.parse(n):null}catch(t){return console.error("[WasmBridge] getXiaInfo failed:",t),null}}createGroup(e,t){if(!this.engine)return 0;try{const n=new Uint32Array(t);return this.engine.create_group?.(e,n)??0}catch(n){return console.error("[WasmBridge] createGroup failed:",n),0}}deleteGroup(e){if(!this.engine)return!1;try{return this.engine.delete_group?.(e)??!1}catch(t){return console.error("[WasmBridge] deleteGroup failed:",t),!1}}renameGroup(e,t){if(!this.engine)return!1;try{return this.engine.rename_group?.(e,t)??!1}catch(n){return console.error("[WasmBridge] renameGroup failed:",n),!1}}toggleGroupVisibility(e){if(!this.engine)return!1;try{return this.engine.toggle_group_visibility?.(e)??!1}catch(t){return console.error("[WasmBridge] toggleGroupVisibility failed:",t),!1}}toggleGroupLock(e){if(!this.engine)return!1;try{return this.engine.toggle_group_lock?.(e)??!1}catch(t){return console.error("[WasmBridge] toggleGroupLock failed:",t),!1}}getGroupForFace(e){if(!this.engine)return 0;try{return this.engine.get_group_for_face?.(e)??0}catch{return 0}}getGroupFaces(e){if(!this.engine)return[];try{const t=this.engine.get_group_faces?.(e);return t?Array.from(t):[]}catch{return[]}}addFacesToGroup(e,t){if(!this.engine)return!1;try{const n=new Uint32Array(t);return this.engine.add_faces_to_group?.(e,n)??!1}catch{return!1}}removeFacesFromGroup(e,t){if(!this.engine)return!1;try{const n=new Uint32Array(t);return this.engine.remove_faces_from_group?.(e,n)??!1}catch{return!1}}setGroupParent(e,t){if(!this.engine)return!1;try{return this.engine.set_group_parent?.(e,t)??!1}catch{return!1}}makeComponent(e,t){if(!this.engine)return 0;try{return this.engine.make_component?.(e,t)??0}catch(n){return console.error("[WasmBridge] makeComponent failed:",n),0}}getGroupInfo(e){if(!this.engine)return null;try{const t=this.engine.get_group_info?.(e);return t?JSON.parse(t):null}catch{return null}}getAllGroups(){if(!this.engine)return[];try{const e=this.engine.get_all_groups?.();return e?JSON.parse(e):[]}catch{return[]}}groupCount(){if(!this.engine)return 0;try{return this.engine.group_count?.()??0}catch{return 0}}assignMaterial(e,t){if(!this.engine?.assign_material)return!1;this.markDirty();try{return this.engine.assign_material(e,t)}catch(n){return console.error("[WasmBridge] assignMaterial failed:",n),!1}}removeMaterial(e){if(!this.engine?.remove_material)return!1;this.markDirty();try{return this.engine.remove_material(e)}catch(t){return console.error("[WasmBridge] removeMaterial failed:",t),!1}}getFaceMaterial(e){if(!this.engine?.get_face_material)return 0;try{return this.engine.get_face_material(e)}catch{return 0}}getAllMaterials(){if(!this.engine?.get_all_materials)return null;try{return this.engine.get_all_materials()}catch{return null}}booleanOp(e,t,n){if(!this.engine)return null;this.markDirty();try{const i=new Uint32Array(e),s=new Uint32Array(t),o=this.engine.boolean_op?.(i,s,n);if(!o)return null;const a=JSON.parse(o);return a.ok?dt.success(`Boolean ${n} 성공`):dt.error(`Boolean ${n} 실패: ${a.error??"알 수 없는 오류"}`),a}catch(i){return console.error("[WasmBridge] booleanOp failed:",i),dt.error(`Boolean 연산 실패: ${String(i)}`),null}}}class $0{constructor(e){this.units=e,this.isOpen=!1,this.panel=this.createPanel(),document.body.appendChild(this.panel),document.addEventListener("mousedown",t=>{this.isOpen&&!this.panel.contains(t.target)&&!t.target.closest("#settings-btn")&&this.close()}),e.onChange(()=>this.updateDisplay())}toggle(){this.isOpen?this.close():this.open()}open(){this.updateDisplay(),this.panel.style.display="block",this.isOpen=!0}close(){this.panel.style.display="none",this.isOpen=!1}createPanel(){const e=document.createElement("div");e.id="settings-panel",e.innerHTML=`
      <div class="sp-header">단위 설정</div>

      <div class="sp-section">
        <label class="sp-label">단위</label>
        <div class="sp-unit-btns" id="sp-unit-btns"></div>
      </div>

      <div class="sp-section">
        <label class="sp-label">소수점 자릿수</label>
        <div class="sp-row">
          <input type="range" id="sp-precision" min="0" max="8" step="1" />
          <span id="sp-precision-val" class="sp-value"></span>
        </div>
      </div>

      <div class="sp-divider"></div>

      <div class="sp-section">
        <label class="sp-label">
          <input type="checkbox" id="sp-snap" />
          그리드 스냅
        </label>
      </div>

      <div class="sp-section">
        <label class="sp-label">스냅 간격</label>
        <div class="sp-row">
          <input type="number" id="sp-snap-interval" step="0.1" min="0.0001" />
          <span id="sp-snap-unit" class="sp-value"></span>
        </div>
      </div>

      <div class="sp-divider"></div>
      <div class="sp-info" id="sp-info"></div>
    `;const t=e.querySelector("#sp-unit-btns");for(const o of dl.allUnits){const a=document.createElement("button");a.className="sp-ubtn",a.dataset.unit=o.type,a.textContent=o.label,a.title=o.labelLong,a.addEventListener("click",()=>{this.units.unit=o.type}),t.appendChild(a)}const n=e.querySelector("#sp-precision");n.addEventListener("input",()=>{this.units.precision=parseInt(n.value)});const i=e.querySelector("#sp-snap");i.addEventListener("change",()=>{this.units.gridSnap=i.checked});const s=e.querySelector("#sp-snap-interval");return s.addEventListener("change",()=>{const o=parseFloat(s.value);!isNaN(o)&&o>0&&(this.units.snapInterval=this.units.toInternal(o))}),e}updateDisplay(){this.panel.querySelectorAll(".sp-ubtn").forEach(a=>{a.classList.toggle("active",a.dataset.unit===this.units.unit)});const e=this.panel.querySelector("#sp-precision"),t=this.panel.querySelector("#sp-precision-val");e.value=String(this.units.precision),t.textContent=String(this.units.precision);const n=this.panel.querySelector("#sp-snap");n.checked=this.units.gridSnap;const i=this.panel.querySelector("#sp-snap-interval"),s=this.panel.querySelector("#sp-snap-unit");i.value=this.units.fromInternal(this.units.snapInterval).toFixed(this.units.precision),s.textContent=this.units.config.label;const o=this.panel.querySelector("#sp-info");o.textContent=`1 ${this.units.config.label} = ${this.units.config.toMM} mm`}}const K0=/^[og]\s*(.+)?/,Z0=/^mtllib /,J0=/^usemtl /,Q0=/^usemap /,td=/\s+/,nd=new P,Wa=new P,id=new P,sd=new P,In=new P,Ro=new qe;function ev(){const r={objects:[],object:{},vertices:[],normals:[],colors:[],uvs:[],materials:{},materialLibraries:[],startObject:function(e,t){if(this.object&&this.object.fromDeclaration===!1){this.object.name=e,this.object.fromDeclaration=t!==!1;return}const n=this.object&&typeof this.object.currentMaterial=="function"?this.object.currentMaterial():void 0;if(this.object&&typeof this.object._finalize=="function"&&this.object._finalize(!0),this.object={name:e||"",fromDeclaration:t!==!1,geometry:{vertices:[],normals:[],colors:[],uvs:[],hasUVIndices:!1},materials:[],smooth:!0,startMaterial:function(i,s){const o=this._finalize(!1);o&&(o.inherited||o.groupCount<=0)&&this.materials.splice(o.index,1);const a={index:this.materials.length,name:i||"",mtllib:Array.isArray(s)&&s.length>0?s[s.length-1]:"",smooth:o!==void 0?o.smooth:this.smooth,groupStart:o!==void 0?o.groupEnd:0,groupEnd:-1,groupCount:-1,inherited:!1,clone:function(c){const l={index:typeof c=="number"?c:this.index,name:this.name,mtllib:this.mtllib,smooth:this.smooth,groupStart:0,groupEnd:-1,groupCount:-1,inherited:!1};return l.clone=this.clone.bind(l),l}};return this.materials.push(a),a},currentMaterial:function(){if(this.materials.length>0)return this.materials[this.materials.length-1]},_finalize:function(i){const s=this.currentMaterial();if(s&&s.groupEnd===-1&&(s.groupEnd=this.geometry.vertices.length/3,s.groupCount=s.groupEnd-s.groupStart,s.inherited=!1),i&&this.materials.length>1)for(let o=this.materials.length-1;o>=0;o--)this.materials[o].groupCount<=0&&this.materials.splice(o,1);return i&&this.materials.length===0&&this.materials.push({name:"",smooth:this.smooth}),s}},n&&n.name&&typeof n.clone=="function"){const i=n.clone(0);i.inherited=!0,this.object.materials.push(i)}this.objects.push(this.object)},finalize:function(){this.object&&typeof this.object._finalize=="function"&&this.object._finalize(!0)},parseVertexIndex:function(e,t){const n=parseInt(e,10);return(n>=0?n-1:n+t/3)*3},parseNormalIndex:function(e,t){const n=parseInt(e,10);return(n>=0?n-1:n+t/3)*3},parseUVIndex:function(e,t){const n=parseInt(e,10);return(n>=0?n-1:n+t/2)*2},addVertex:function(e,t,n){const i=this.vertices,s=this.object.geometry.vertices;s.push(i[e+0],i[e+1],i[e+2]),s.push(i[t+0],i[t+1],i[t+2]),s.push(i[n+0],i[n+1],i[n+2])},addVertexPoint:function(e){const t=this.vertices;this.object.geometry.vertices.push(t[e+0],t[e+1],t[e+2])},addVertexLine:function(e){const t=this.vertices;this.object.geometry.vertices.push(t[e+0],t[e+1],t[e+2])},addNormal:function(e,t,n){const i=this.normals,s=this.object.geometry.normals;s.push(i[e+0],i[e+1],i[e+2]),s.push(i[t+0],i[t+1],i[t+2]),s.push(i[n+0],i[n+1],i[n+2])},addFaceNormal:function(e,t,n){const i=this.vertices,s=this.object.geometry.normals;nd.fromArray(i,e),Wa.fromArray(i,t),id.fromArray(i,n),In.subVectors(id,Wa),sd.subVectors(nd,Wa),In.cross(sd),In.normalize(),s.push(In.x,In.y,In.z),s.push(In.x,In.y,In.z),s.push(In.x,In.y,In.z)},addColor:function(e,t,n){const i=this.colors,s=this.object.geometry.colors;i[e]!==void 0&&s.push(i[e+0],i[e+1],i[e+2]),i[t]!==void 0&&s.push(i[t+0],i[t+1],i[t+2]),i[n]!==void 0&&s.push(i[n+0],i[n+1],i[n+2])},addUV:function(e,t,n){const i=this.uvs,s=this.object.geometry.uvs;s.push(i[e+0],i[e+1]),s.push(i[t+0],i[t+1]),s.push(i[n+0],i[n+1])},addDefaultUV:function(){const e=this.object.geometry.uvs;e.push(0,0),e.push(0,0),e.push(0,0)},addUVLine:function(e){const t=this.uvs;this.object.geometry.uvs.push(t[e+0],t[e+1])},addFace:function(e,t,n,i,s,o,a,c,l){const h=this.vertices.length;let d=this.parseVertexIndex(e,h),u=this.parseVertexIndex(t,h),m=this.parseVertexIndex(n,h);if(this.addVertex(d,u,m),this.addColor(d,u,m),a!==void 0&&a!==""){const g=this.normals.length;d=this.parseNormalIndex(a,g),u=this.parseNormalIndex(c,g),m=this.parseNormalIndex(l,g),this.addNormal(d,u,m)}else this.addFaceNormal(d,u,m);if(i!==void 0&&i!==""){const g=this.uvs.length;d=this.parseUVIndex(i,g),u=this.parseUVIndex(s,g),m=this.parseUVIndex(o,g),this.addUV(d,u,m),this.object.geometry.hasUVIndices=!0}else this.addDefaultUV()},addPointGeometry:function(e){this.object.geometry.type="Points";const t=this.vertices.length;for(let n=0,i=e.length;n<i;n++){const s=this.parseVertexIndex(e[n],t);this.addVertexPoint(s),this.addColor(s)}},addLineGeometry:function(e,t){this.object.geometry.type="Line";const n=this.vertices.length,i=this.uvs.length;for(let s=0,o=e.length;s<o;s++)this.addVertexLine(this.parseVertexIndex(e[s],n));for(let s=0,o=t.length;s<o;s++)this.addUVLine(this.parseUVIndex(t[s],i))}};return r.startObject("",!1),r}class tv extends Cn{constructor(e){super(e),this.materials=null}load(e,t,n,i){const s=this,o=new ki(this.manager);o.setPath(this.path),o.setRequestHeader(this.requestHeader),o.setWithCredentials(this.withCredentials),o.load(e,function(a){try{t(s.parse(a))}catch(c){i?i(c):console.error(c),s.manager.itemError(e)}},n,i)}setMaterials(e){return this.materials=e,this}parse(e){const t=new ev;e.indexOf(`\r
`)!==-1&&(e=e.replace(/\r\n/g,`
`)),e.indexOf(`\\
`)!==-1&&(e=e.replace(/\\\n/g,""));const n=e.split(`
`);let i=[];for(let a=0,c=n.length;a<c;a++){const l=n[a].trimStart();if(l.length===0)continue;const h=l.charAt(0);if(h!=="#")if(h==="v"){const d=l.split(td);switch(d[0]){case"v":t.vertices.push(parseFloat(d[1]),parseFloat(d[2]),parseFloat(d[3])),d.length>=7?(Ro.setRGB(parseFloat(d[4]),parseFloat(d[5]),parseFloat(d[6]),It),t.colors.push(Ro.r,Ro.g,Ro.b)):t.colors.push(void 0,void 0,void 0);break;case"vn":t.normals.push(parseFloat(d[1]),parseFloat(d[2]),parseFloat(d[3]));break;case"vt":t.uvs.push(parseFloat(d[1]),parseFloat(d[2]));break}}else if(h==="f"){const u=l.slice(1).trim().split(td),m=[];for(let _=0,f=u.length;_<f;_++){const p=u[_];if(p.length>0){const x=p.split("/");m.push(x)}}const g=m[0];for(let _=1,f=m.length-1;_<f;_++){const p=m[_],x=m[_+1];t.addFace(g[0],p[0],x[0],g[1],p[1],x[1],g[2],p[2],x[2])}}else if(h==="l"){const d=l.substring(1).trim().split(" ");let u=[];const m=[];if(l.indexOf("/")===-1)u=d;else for(let g=0,_=d.length;g<_;g++){const f=d[g].split("/");f[0]!==""&&u.push(f[0]),f[1]!==""&&m.push(f[1])}t.addLineGeometry(u,m)}else if(h==="p"){const u=l.slice(1).trim().split(" ");t.addPointGeometry(u)}else if((i=K0.exec(l))!==null){const d=(" "+i[0].slice(1).trim()).slice(1);t.startObject(d)}else if(J0.test(l))t.object.startMaterial(l.substring(7).trim(),t.materialLibraries);else if(Z0.test(l))t.materialLibraries.push(l.substring(7).trim());else if(Q0.test(l))console.warn('THREE.OBJLoader: Rendering identifier "usemap" not supported. Textures must be defined in MTL files.');else if(h==="s"){if(i=l.split(" "),i.length>1){const u=i[1].trim().toLowerCase();t.object.smooth=u!=="0"&&u!=="off"}else t.object.smooth=!0;const d=t.object.currentMaterial();d&&(d.smooth=t.object.smooth)}else{if(l==="\0")continue;console.warn('THREE.OBJLoader: Unexpected line: "'+l+'"')}}t.finalize();const s=new Bt;if(s.materialLibraries=[].concat(t.materialLibraries),!(t.objects.length===1&&t.objects[0].geometry.vertices.length===0)===!0)for(let a=0,c=t.objects.length;a<c;a++){const l=t.objects[a],h=l.geometry,d=l.materials,u=h.type==="Line",m=h.type==="Points";let g=!1;if(h.vertices.length===0)continue;const _=new at;_.setAttribute("position",new ot(h.vertices,3)),h.normals.length>0&&_.setAttribute("normal",new ot(h.normals,3)),h.colors.length>0&&(g=!0,_.setAttribute("color",new ot(h.colors,3))),h.hasUVIndices===!0&&_.setAttribute("uv",new ot(h.uvs,2));const f=[];for(let x=0,y=d.length;x<y;x++){const v=d[x],F=v.name+"_"+v.smooth+"_"+g;let A=t.materials[F];if(this.materials!==null){if(A=this.materials.create(v.name),u&&A&&!(A instanceof zt)){const L=new zt;Ft.prototype.copy.call(L,A),L.color.copy(A.color),A=L}else if(m&&A&&!(A instanceof Ni)){const L=new Ni({size:10,sizeAttenuation:!1});Ft.prototype.copy.call(L,A),L.color.copy(A.color),L.map=A.map,A=L}}A===void 0&&(u?A=new zt:m?A=new Ni({size:1,sizeAttenuation:!1}):A=new Ar,A.name=v.name,A.flatShading=!v.smooth,A.vertexColors=g,t.materials[F]=A),f.push(A)}let p;if(f.length>1){for(let x=0,y=d.length;x<y;x++){const v=d[x];_.addGroup(v.groupStart,v.groupCount,x)}u?p=new Vt(_,f):m?p=new Ns(_,f):p=new rt(_,f)}else u?p=new Vt(_,f[0]):m?p=new Ns(_,f[0]):p=new rt(_,f[0]);p.name=l.name,s.add(p)}else if(t.vertices.length>0){const a=new Ni({size:1,sizeAttenuation:!1}),c=new at;c.setAttribute("position",new ot(t.vertices,3)),t.colors.length>0&&t.colors[0]!==void 0&&(c.setAttribute("color",new ot(t.colors,3)),a.vertexColors=!0);const l=new Ns(c,a);s.add(l)}return s}}class nv extends Cn{constructor(e){super(e)}load(e,t,n,i){const s=this,o=new ki(this.manager);o.setPath(this.path),o.setResponseType("arraybuffer"),o.setRequestHeader(this.requestHeader),o.setWithCredentials(this.withCredentials),o.load(e,function(a){try{t(s.parse(a))}catch(c){i?i(c):console.error(c),s.manager.itemError(e)}},n,i)}parse(e){function t(l){const h=new DataView(l),d=32/8*3+32/8*3*3+16/8,u=h.getUint32(80,!0);if(80+32/8+u*d===h.byteLength)return!0;const g=[115,111,108,105,100];for(let _=0;_<5;_++)if(n(g,h,_))return!1;return!0}function n(l,h,d){for(let u=0,m=l.length;u<m;u++)if(l[u]!==h.getUint8(d+u))return!1;return!0}function i(l){const h=new DataView(l),d=h.getUint32(80,!0);let u,m,g,_=!1,f,p,x,y,v;for(let U=0;U<70;U++)h.getUint32(U,!1)==1129270351&&h.getUint8(U+4)==82&&h.getUint8(U+5)==61&&(_=!0,f=new Float32Array(d*3*3),p=h.getUint8(U+6)/255,x=h.getUint8(U+7)/255,y=h.getUint8(U+8)/255,v=h.getUint8(U+9)/255);const F=84,A=50,L=new at,O=new Float32Array(d*3*3),w=new Float32Array(d*3*3),S=new qe;for(let U=0;U<d;U++){const Z=F+U*A,K=h.getFloat32(Z,!0),se=h.getFloat32(Z+4,!0),fe=h.getFloat32(Z+8,!0);if(_){const z=h.getUint16(Z+48,!0);(z&32768)===0?(u=(z&31)/31,m=(z>>5&31)/31,g=(z>>10&31)/31):(u=p,m=x,g=y)}for(let z=1;z<=3;z++){const de=Z+z*12,$=U*3*3+(z-1)*3;O[$]=h.getFloat32(de,!0),O[$+1]=h.getFloat32(de+4,!0),O[$+2]=h.getFloat32(de+8,!0),w[$]=K,w[$+1]=se,w[$+2]=fe,_&&(S.setRGB(u,m,g,It),f[$]=S.r,f[$+1]=S.g,f[$+2]=S.b)}}return L.setAttribute("position",new yt(O,3)),L.setAttribute("normal",new yt(w,3)),_&&(L.setAttribute("color",new yt(f,3)),L.hasColors=!0,L.alpha=v),L}function s(l){const h=new at,d=/solid([\s\S]*?)endsolid/g,u=/facet([\s\S]*?)endfacet/g,m=/solid\s(.+)/;let g=0;const _=/[\s]+([+-]?(?:\d*)(?:\.\d*)?(?:[eE][+-]?\d+)?)/.source,f=new RegExp("vertex"+_+_+_,"g"),p=new RegExp("normal"+_+_+_,"g"),x=[],y=[],v=[],F=new P;let A,L=0,O=0,w=0;for(;(A=d.exec(l))!==null;){O=w;const S=A[0],U=(A=m.exec(S))!==null?A[1]:"";for(v.push(U);(A=u.exec(S))!==null;){let se=0,fe=0;const z=A[0];for(;(A=p.exec(z))!==null;)F.x=parseFloat(A[1]),F.y=parseFloat(A[2]),F.z=parseFloat(A[3]),fe++;for(;(A=f.exec(z))!==null;)x.push(parseFloat(A[1]),parseFloat(A[2]),parseFloat(A[3])),y.push(F.x,F.y,F.z),se++,w++;fe!==1&&console.error("THREE.STLLoader: Something isn't right with the normal of face number "+g),se!==3&&console.error("THREE.STLLoader: Something isn't right with the vertices of face number "+g),g++}const Z=O,K=w-O;h.userData.groupNames=v,h.addGroup(Z,K,L),L++}return h.setAttribute("position",new ot(x,3)),h.setAttribute("normal",new ot(y,3)),h}function o(l){return typeof l!="string"?new TextDecoder().decode(l):l}function a(l){if(typeof l=="string"){const h=new Uint8Array(l.length);for(let d=0;d<l.length;d++)h[d]=l.charCodeAt(d)&255;return h.buffer||h}else return l}const c=a(e);return t(c)?i(c):s(o(e))}}function rd(r,e){if(e===Hu)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),r;if(e===Pc||e===Ed){let t=r.getIndex();if(t===null){const o=[],a=r.getAttribute("position");if(a!==void 0){for(let c=0;c<a.count;c++)o.push(c);r.setIndex(o),t=r.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),r}const n=t.count-2,i=[];if(e===Pc)for(let o=1;o<=n;o++)i.push(t.getX(0)),i.push(t.getX(o)),i.push(t.getX(o+1));else for(let o=0;o<n;o++)o%2===0?(i.push(t.getX(o)),i.push(t.getX(o+1)),i.push(t.getX(o+2))):(i.push(t.getX(o+2)),i.push(t.getX(o+1)),i.push(t.getX(o)));i.length/3!==n&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.");const s=r.clone();return s.setIndex(i),s.clearGroups(),s}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",e),r}class iv extends Cn{constructor(e){super(e),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(t){return new cv(t)}),this.register(function(t){return new lv(t)}),this.register(function(t){return new xv(t)}),this.register(function(t){return new vv(t)}),this.register(function(t){return new yv(t)}),this.register(function(t){return new dv(t)}),this.register(function(t){return new uv(t)}),this.register(function(t){return new fv(t)}),this.register(function(t){return new pv(t)}),this.register(function(t){return new av(t)}),this.register(function(t){return new mv(t)}),this.register(function(t){return new hv(t)}),this.register(function(t){return new _v(t)}),this.register(function(t){return new gv(t)}),this.register(function(t){return new rv(t)}),this.register(function(t){return new bv(t)}),this.register(function(t){return new Mv(t)})}load(e,t,n,i){const s=this;let o;if(this.resourcePath!=="")o=this.resourcePath;else if(this.path!==""){const l=es.extractUrlBase(e);o=es.resolveURL(l,this.path)}else o=es.extractUrlBase(e);this.manager.itemStart(e);const a=function(l){i?i(l):console.error(l),s.manager.itemError(e),s.manager.itemEnd(e)},c=new ki(this.manager);c.setPath(this.path),c.setResponseType("arraybuffer"),c.setRequestHeader(this.requestHeader),c.setWithCredentials(this.withCredentials),c.load(e,function(l){try{s.parse(l,o,function(h){t(h),s.manager.itemEnd(e)},a)}catch(h){a(h)}},n,a)}setDRACOLoader(e){return this.dracoLoader=e,this}setKTX2Loader(e){return this.ktx2Loader=e,this}setMeshoptDecoder(e){return this.meshoptDecoder=e,this}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}parse(e,t,n,i){let s;const o={},a={},c=new TextDecoder;if(typeof e=="string")s=JSON.parse(e);else if(e instanceof ArrayBuffer)if(c.decode(new Uint8Array(e,0,4))===su){try{o[xt.KHR_BINARY_GLTF]=new Sv(e)}catch(d){i&&i(d);return}s=JSON.parse(o[xt.KHR_BINARY_GLTF].content)}else s=JSON.parse(c.decode(e));else s=e;if(s.asset===void 0||s.asset.version[0]<2){i&&i(new Error("THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported."));return}const l=new Uv(s,{path:t||this.resourcePath||"",crossOrigin:this.crossOrigin,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});l.fileLoader.setRequestHeader(this.requestHeader);for(let h=0;h<this.pluginCallbacks.length;h++){const d=this.pluginCallbacks[h](l);d.name||console.error("THREE.GLTFLoader: Invalid plugin found: missing name"),a[d.name]=d,o[d.name]=!0}if(s.extensionsUsed)for(let h=0;h<s.extensionsUsed.length;++h){const d=s.extensionsUsed[h],u=s.extensionsRequired||[];switch(d){case xt.KHR_MATERIALS_UNLIT:o[d]=new ov;break;case xt.KHR_DRACO_MESH_COMPRESSION:o[d]=new wv(s,this.dracoLoader);break;case xt.KHR_TEXTURE_TRANSFORM:o[d]=new Ev;break;case xt.KHR_MESH_QUANTIZATION:o[d]=new Tv;break;default:u.indexOf(d)>=0&&a[d]===void 0&&console.warn('THREE.GLTFLoader: Unknown extension "'+d+'".')}}l.setExtensions(o),l.setPlugins(a),l.parse(n,i)}parseAsync(e,t){const n=this;return new Promise(function(i,s){n.parse(e,t,i,s)})}}function sv(){let r={};return{get:function(e){return r[e]},add:function(e,t){r[e]=t},remove:function(e){delete r[e]},removeAll:function(){r={}}}}const xt={KHR_BINARY_GLTF:"KHR_binary_glTF",KHR_DRACO_MESH_COMPRESSION:"KHR_draco_mesh_compression",KHR_LIGHTS_PUNCTUAL:"KHR_lights_punctual",KHR_MATERIALS_CLEARCOAT:"KHR_materials_clearcoat",KHR_MATERIALS_DISPERSION:"KHR_materials_dispersion",KHR_MATERIALS_IOR:"KHR_materials_ior",KHR_MATERIALS_SHEEN:"KHR_materials_sheen",KHR_MATERIALS_SPECULAR:"KHR_materials_specular",KHR_MATERIALS_TRANSMISSION:"KHR_materials_transmission",KHR_MATERIALS_IRIDESCENCE:"KHR_materials_iridescence",KHR_MATERIALS_ANISOTROPY:"KHR_materials_anisotropy",KHR_MATERIALS_UNLIT:"KHR_materials_unlit",KHR_MATERIALS_VOLUME:"KHR_materials_volume",KHR_TEXTURE_BASISU:"KHR_texture_basisu",KHR_TEXTURE_TRANSFORM:"KHR_texture_transform",KHR_MESH_QUANTIZATION:"KHR_mesh_quantization",KHR_MATERIALS_EMISSIVE_STRENGTH:"KHR_materials_emissive_strength",EXT_MATERIALS_BUMP:"EXT_materials_bump",EXT_TEXTURE_WEBP:"EXT_texture_webp",EXT_TEXTURE_AVIF:"EXT_texture_avif",EXT_MESHOPT_COMPRESSION:"EXT_meshopt_compression",EXT_MESH_GPU_INSTANCING:"EXT_mesh_gpu_instancing"};class rv{constructor(e){this.parser=e,this.name=xt.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){const e=this.parser,t=this.parser.json.nodes||[];for(let n=0,i=t.length;n<i;n++){const s=t[n];s.extensions&&s.extensions[this.name]&&s.extensions[this.name].light!==void 0&&e._addNodeRef(this.cache,s.extensions[this.name].light)}}_loadLight(e){const t=this.parser,n="light:"+e;let i=t.cache.get(n);if(i)return i;const s=t.json,c=((s.extensions&&s.extensions[this.name]||{}).lights||[])[e];let l;const h=new qe(16777215);c.color!==void 0&&h.setRGB(c.color[0],c.color[1],c.color[2],mn);const d=c.range!==void 0?c.range:0;switch(c.type){case"directional":l=new Vo(h),l.target.position.set(0,0,-1),l.add(l.target);break;case"point":l=new Kd(h),l.distance=d;break;case"spot":l=new $d(h),l.distance=d,c.spot=c.spot||{},c.spot.innerConeAngle=c.spot.innerConeAngle!==void 0?c.spot.innerConeAngle:0,c.spot.outerConeAngle=c.spot.outerConeAngle!==void 0?c.spot.outerConeAngle:Math.PI/4,l.angle=c.spot.outerConeAngle,l.penumbra=1-c.spot.innerConeAngle/c.spot.outerConeAngle,l.target.position.set(0,0,-1),l.add(l.target);break;default:throw new Error("THREE.GLTFLoader: Unexpected light type: "+c.type)}return l.position.set(0,0,0),l.decay=2,pi(l,c),c.intensity!==void 0&&(l.intensity=c.intensity),l.name=t.createUniqueName(c.name||"light_"+e),i=Promise.resolve(l),t.cache.add(n,i),i}getDependency(e,t){if(e==="light")return this._loadLight(t)}createNodeAttachment(e){const t=this,n=this.parser,s=n.json.nodes[e],a=(s.extensions&&s.extensions[this.name]||{}).light;return a===void 0?null:this._loadLight(a).then(function(c){return n._getNodeRef(t.cache,a,c)})}}class ov{constructor(){this.name=xt.KHR_MATERIALS_UNLIT}getMaterialType(){return rn}extendParams(e,t,n){const i=[];e.color=new qe(1,1,1),e.opacity=1;const s=t.pbrMetallicRoughness;if(s){if(Array.isArray(s.baseColorFactor)){const o=s.baseColorFactor;e.color.setRGB(o[0],o[1],o[2],mn),e.opacity=o[3]}s.baseColorTexture!==void 0&&i.push(n.assignTexture(e,"map",s.baseColorTexture,It))}return Promise.all(i)}}class av{constructor(e){this.parser=e,this.name=xt.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(e,t){const i=this.parser.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=i.extensions[this.name].emissiveStrength;return s!==void 0&&(t.emissiveIntensity=s),Promise.resolve()}}class cv{constructor(e){this.parser=e,this.name=xt.KHR_MATERIALS_CLEARCOAT}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:ni}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],o=i.extensions[this.name];if(o.clearcoatFactor!==void 0&&(t.clearcoat=o.clearcoatFactor),o.clearcoatTexture!==void 0&&s.push(n.assignTexture(t,"clearcoatMap",o.clearcoatTexture)),o.clearcoatRoughnessFactor!==void 0&&(t.clearcoatRoughness=o.clearcoatRoughnessFactor),o.clearcoatRoughnessTexture!==void 0&&s.push(n.assignTexture(t,"clearcoatRoughnessMap",o.clearcoatRoughnessTexture)),o.clearcoatNormalTexture!==void 0&&(s.push(n.assignTexture(t,"clearcoatNormalMap",o.clearcoatNormalTexture)),o.clearcoatNormalTexture.scale!==void 0)){const a=o.clearcoatNormalTexture.scale;t.clearcoatNormalScale=new Ge(a,a)}return Promise.all(s)}}class lv{constructor(e){this.parser=e,this.name=xt.KHR_MATERIALS_DISPERSION}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:ni}extendMaterialParams(e,t){const i=this.parser.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=i.extensions[this.name];return t.dispersion=s.dispersion!==void 0?s.dispersion:0,Promise.resolve()}}class hv{constructor(e){this.parser=e,this.name=xt.KHR_MATERIALS_IRIDESCENCE}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:ni}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],o=i.extensions[this.name];return o.iridescenceFactor!==void 0&&(t.iridescence=o.iridescenceFactor),o.iridescenceTexture!==void 0&&s.push(n.assignTexture(t,"iridescenceMap",o.iridescenceTexture)),o.iridescenceIor!==void 0&&(t.iridescenceIOR=o.iridescenceIor),t.iridescenceThicknessRange===void 0&&(t.iridescenceThicknessRange=[100,400]),o.iridescenceThicknessMinimum!==void 0&&(t.iridescenceThicknessRange[0]=o.iridescenceThicknessMinimum),o.iridescenceThicknessMaximum!==void 0&&(t.iridescenceThicknessRange[1]=o.iridescenceThicknessMaximum),o.iridescenceThicknessTexture!==void 0&&s.push(n.assignTexture(t,"iridescenceThicknessMap",o.iridescenceThicknessTexture)),Promise.all(s)}}class dv{constructor(e){this.parser=e,this.name=xt.KHR_MATERIALS_SHEEN}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:ni}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[];t.sheenColor=new qe(0,0,0),t.sheenRoughness=0,t.sheen=1;const o=i.extensions[this.name];if(o.sheenColorFactor!==void 0){const a=o.sheenColorFactor;t.sheenColor.setRGB(a[0],a[1],a[2],mn)}return o.sheenRoughnessFactor!==void 0&&(t.sheenRoughness=o.sheenRoughnessFactor),o.sheenColorTexture!==void 0&&s.push(n.assignTexture(t,"sheenColorMap",o.sheenColorTexture,It)),o.sheenRoughnessTexture!==void 0&&s.push(n.assignTexture(t,"sheenRoughnessMap",o.sheenRoughnessTexture)),Promise.all(s)}}class uv{constructor(e){this.parser=e,this.name=xt.KHR_MATERIALS_TRANSMISSION}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:ni}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],o=i.extensions[this.name];return o.transmissionFactor!==void 0&&(t.transmission=o.transmissionFactor),o.transmissionTexture!==void 0&&s.push(n.assignTexture(t,"transmissionMap",o.transmissionTexture)),Promise.all(s)}}class fv{constructor(e){this.parser=e,this.name=xt.KHR_MATERIALS_VOLUME}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:ni}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],o=i.extensions[this.name];t.thickness=o.thicknessFactor!==void 0?o.thicknessFactor:0,o.thicknessTexture!==void 0&&s.push(n.assignTexture(t,"thicknessMap",o.thicknessTexture)),t.attenuationDistance=o.attenuationDistance||1/0;const a=o.attenuationColor||[1,1,1];return t.attenuationColor=new qe().setRGB(a[0],a[1],a[2],mn),Promise.all(s)}}class pv{constructor(e){this.parser=e,this.name=xt.KHR_MATERIALS_IOR}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:ni}extendMaterialParams(e,t){const i=this.parser.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=i.extensions[this.name];return t.ior=s.ior!==void 0?s.ior:1.5,Promise.resolve()}}class mv{constructor(e){this.parser=e,this.name=xt.KHR_MATERIALS_SPECULAR}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:ni}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],o=i.extensions[this.name];t.specularIntensity=o.specularFactor!==void 0?o.specularFactor:1,o.specularTexture!==void 0&&s.push(n.assignTexture(t,"specularIntensityMap",o.specularTexture));const a=o.specularColorFactor||[1,1,1];return t.specularColor=new qe().setRGB(a[0],a[1],a[2],mn),o.specularColorTexture!==void 0&&s.push(n.assignTexture(t,"specularColorMap",o.specularColorTexture,It)),Promise.all(s)}}class gv{constructor(e){this.parser=e,this.name=xt.EXT_MATERIALS_BUMP}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:ni}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],o=i.extensions[this.name];return t.bumpScale=o.bumpFactor!==void 0?o.bumpFactor:1,o.bumpTexture!==void 0&&s.push(n.assignTexture(t,"bumpMap",o.bumpTexture)),Promise.all(s)}}class _v{constructor(e){this.parser=e,this.name=xt.KHR_MATERIALS_ANISOTROPY}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:ni}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],o=i.extensions[this.name];return o.anisotropyStrength!==void 0&&(t.anisotropy=o.anisotropyStrength),o.anisotropyRotation!==void 0&&(t.anisotropyRotation=o.anisotropyRotation),o.anisotropyTexture!==void 0&&s.push(n.assignTexture(t,"anisotropyMap",o.anisotropyTexture)),Promise.all(s)}}class xv{constructor(e){this.parser=e,this.name=xt.KHR_TEXTURE_BASISU}loadTexture(e){const t=this.parser,n=t.json,i=n.textures[e];if(!i.extensions||!i.extensions[this.name])return null;const s=i.extensions[this.name],o=t.options.ktx2Loader;if(!o){if(n.extensionsRequired&&n.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures");return null}return t.loadTextureImage(e,s.source,o)}}class vv{constructor(e){this.parser=e,this.name=xt.EXT_TEXTURE_WEBP,this.isSupported=null}loadTexture(e){const t=this.name,n=this.parser,i=n.json,s=i.textures[e];if(!s.extensions||!s.extensions[t])return null;const o=s.extensions[t],a=i.images[o.source];let c=n.textureLoader;if(a.uri){const l=n.options.manager.getHandler(a.uri);l!==null&&(c=l)}return this.detectSupport().then(function(l){if(l)return n.loadTextureImage(e,o.source,c);if(i.extensionsRequired&&i.extensionsRequired.indexOf(t)>=0)throw new Error("THREE.GLTFLoader: WebP required by asset but unsupported.");return n.loadTexture(e)})}detectSupport(){return this.isSupported||(this.isSupported=new Promise(function(e){const t=new Image;t.src="data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",t.onload=t.onerror=function(){e(t.height===1)}})),this.isSupported}}class yv{constructor(e){this.parser=e,this.name=xt.EXT_TEXTURE_AVIF,this.isSupported=null}loadTexture(e){const t=this.name,n=this.parser,i=n.json,s=i.textures[e];if(!s.extensions||!s.extensions[t])return null;const o=s.extensions[t],a=i.images[o.source];let c=n.textureLoader;if(a.uri){const l=n.options.manager.getHandler(a.uri);l!==null&&(c=l)}return this.detectSupport().then(function(l){if(l)return n.loadTextureImage(e,o.source,c);if(i.extensionsRequired&&i.extensionsRequired.indexOf(t)>=0)throw new Error("THREE.GLTFLoader: AVIF required by asset but unsupported.");return n.loadTexture(e)})}detectSupport(){return this.isSupported||(this.isSupported=new Promise(function(e){const t=new Image;t.src="data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAABcAAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAMAAAAABNjb2xybmNseAACAAIABoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAAB9tZGF0EgAKCBgABogQEDQgMgkQAAAAB8dSLfI=",t.onload=t.onerror=function(){e(t.height===1)}})),this.isSupported}}class bv{constructor(e){this.name=xt.EXT_MESHOPT_COMPRESSION,this.parser=e}loadBufferView(e){const t=this.parser.json,n=t.bufferViews[e];if(n.extensions&&n.extensions[this.name]){const i=n.extensions[this.name],s=this.parser.getDependency("buffer",i.buffer),o=this.parser.options.meshoptDecoder;if(!o||!o.supported){if(t.extensionsRequired&&t.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files");return null}return s.then(function(a){const c=i.byteOffset||0,l=i.byteLength||0,h=i.count,d=i.byteStride,u=new Uint8Array(a,c,l);return o.decodeGltfBufferAsync?o.decodeGltfBufferAsync(h,d,u,i.mode,i.filter).then(function(m){return m.buffer}):o.ready.then(function(){const m=new ArrayBuffer(h*d);return o.decodeGltfBuffer(new Uint8Array(m),h,d,u,i.mode,i.filter),m})})}else return null}}class Mv{constructor(e){this.name=xt.EXT_MESH_GPU_INSTANCING,this.parser=e}createNodeMesh(e){const t=this.parser.json,n=t.nodes[e];if(!n.extensions||!n.extensions[this.name]||n.mesh===void 0)return null;const i=t.meshes[n.mesh];for(const l of i.primitives)if(l.mode!==Pn.TRIANGLES&&l.mode!==Pn.TRIANGLE_STRIP&&l.mode!==Pn.TRIANGLE_FAN&&l.mode!==void 0)return null;const o=n.extensions[this.name].attributes,a=[],c={};for(const l in o)a.push(this.parser.getDependency("accessor",o[l]).then(h=>(c[l]=h,c[l])));return a.length<1?null:(a.push(this.parser.createNodeMesh(e)),Promise.all(a).then(l=>{const h=l.pop(),d=h.isGroup?h.children:[h],u=l[0].count,m=[];for(const g of d){const _=new Ze,f=new P,p=new bi,x=new P(1,1,1),y=new Px(g.geometry,g.material,u);for(let v=0;v<u;v++)c.TRANSLATION&&f.fromBufferAttribute(c.TRANSLATION,v),c.ROTATION&&p.fromBufferAttribute(c.ROTATION,v),c.SCALE&&x.fromBufferAttribute(c.SCALE,v),y.setMatrixAt(v,_.compose(f,p,x));for(const v in c)if(v==="_COLOR_0"){const F=c[v];y.instanceColor=new Fc(F.array,F.itemSize,F.normalized)}else v!=="TRANSLATION"&&v!=="ROTATION"&&v!=="SCALE"&&g.geometry.setAttribute(v,c[v]);Ut.prototype.copy.call(y,g),this.parser.assignFinalMaterial(y),m.push(y)}return h.isGroup?(h.clear(),h.add(...m),h):m[0]}))}}const su="glTF",dr=12,od={JSON:1313821514,BIN:5130562};class Sv{constructor(e){this.name=xt.KHR_BINARY_GLTF,this.content=null,this.body=null;const t=new DataView(e,0,dr),n=new TextDecoder;if(this.header={magic:n.decode(new Uint8Array(e.slice(0,4))),version:t.getUint32(4,!0),length:t.getUint32(8,!0)},this.header.magic!==su)throw new Error("THREE.GLTFLoader: Unsupported glTF-Binary header.");if(this.header.version<2)throw new Error("THREE.GLTFLoader: Legacy binary file detected.");const i=this.header.length-dr,s=new DataView(e,dr);let o=0;for(;o<i;){const a=s.getUint32(o,!0);o+=4;const c=s.getUint32(o,!0);if(o+=4,c===od.JSON){const l=new Uint8Array(e,dr+o,a);this.content=n.decode(l)}else if(c===od.BIN){const l=dr+o;this.body=e.slice(l,l+a)}o+=a}if(this.content===null)throw new Error("THREE.GLTFLoader: JSON content not found.")}}class wv{constructor(e,t){if(!t)throw new Error("THREE.GLTFLoader: No DRACOLoader instance provided.");this.name=xt.KHR_DRACO_MESH_COMPRESSION,this.json=e,this.dracoLoader=t,this.dracoLoader.preload()}decodePrimitive(e,t){const n=this.json,i=this.dracoLoader,s=e.extensions[this.name].bufferView,o=e.extensions[this.name].attributes,a={},c={},l={};for(const h in o){const d=Hc[h]||h.toLowerCase();a[d]=o[h]}for(const h in e.attributes){const d=Hc[h]||h.toLowerCase();if(o[h]!==void 0){const u=n.accessors[e.attributes[h]],m=Us[u.componentType];l[d]=m.name,c[d]=u.normalized===!0}}return t.getDependency("bufferView",s).then(function(h){return new Promise(function(d,u){i.decodeDracoFile(h,function(m){for(const g in m.attributes){const _=m.attributes[g],f=c[g];f!==void 0&&(_.normalized=f)}d(m)},a,l,mn,u)})})}}class Ev{constructor(){this.name=xt.KHR_TEXTURE_TRANSFORM}extendTexture(e,t){return(t.texCoord===void 0||t.texCoord===e.channel)&&t.offset===void 0&&t.rotation===void 0&&t.scale===void 0||(e=e.clone(),t.texCoord!==void 0&&(e.channel=t.texCoord),t.offset!==void 0&&e.offset.fromArray(t.offset),t.rotation!==void 0&&(e.rotation=t.rotation),t.scale!==void 0&&e.repeat.fromArray(t.scale),e.needsUpdate=!0),e}}class Tv{constructor(){this.name=xt.KHR_MESH_QUANTIZATION}}class ru extends Nr{constructor(e,t,n,i){super(e,t,n,i)}copySampleValue_(e){const t=this.resultBuffer,n=this.sampleValues,i=this.valueSize,s=e*i*3+i;for(let o=0;o!==i;o++)t[o]=n[s+o];return t}interpolate_(e,t,n,i){const s=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=a*2,l=a*3,h=i-t,d=(n-t)/h,u=d*d,m=u*d,g=e*l,_=g-l,f=-2*m+3*u,p=m-u,x=1-f,y=p-u+d;for(let v=0;v!==a;v++){const F=o[_+v+a],A=o[_+v+c]*h,L=o[g+v+a],O=o[g+v]*h;s[v]=x*F+y*A+f*L+p*O}return s}}const Av=new bi;class Cv extends ru{interpolate_(e,t,n,i){const s=super.interpolate_(e,t,n,i);return Av.fromArray(s).normalize().toArray(s),s}}const Pn={POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6},Us={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},ad={9728:pn,9729:cn,9984:md,9985:Lo,9986:ur,9987:Yn},cd={33071:Dn,33648:Bo,10497:ti},Xa={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},Hc={POSITION:"position",NORMAL:"normal",TANGENT:"tangent",TEXCOORD_0:"uv",TEXCOORD_1:"uv1",TEXCOORD_2:"uv2",TEXCOORD_3:"uv3",COLOR_0:"color",WEIGHTS_0:"skinWeight",JOINTS_0:"skinIndex"},Ii={scale:"scale",translation:"position",rotation:"quaternion",weights:"morphTargetInfluences"},Rv={CUBICSPLINE:void 0,LINEAR:Er,STEP:wr},ja={OPAQUE:"OPAQUE",MASK:"MASK",BLEND:"BLEND"};function Lv(r){return r.DefaultMaterial===void 0&&(r.DefaultMaterial=new Qi({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:ln})),r.DefaultMaterial}function qi(r,e,t){for(const n in t.extensions)r[n]===void 0&&(e.userData.gltfExtensions=e.userData.gltfExtensions||{},e.userData.gltfExtensions[n]=t.extensions[n])}function pi(r,e){e.extras!==void 0&&(typeof e.extras=="object"?Object.assign(r.userData,e.extras):console.warn("THREE.GLTFLoader: Ignoring primitive type .extras, "+e.extras))}function Iv(r,e,t){let n=!1,i=!1,s=!1;for(let l=0,h=e.length;l<h;l++){const d=e[l];if(d.POSITION!==void 0&&(n=!0),d.NORMAL!==void 0&&(i=!0),d.COLOR_0!==void 0&&(s=!0),n&&i&&s)break}if(!n&&!i&&!s)return Promise.resolve(r);const o=[],a=[],c=[];for(let l=0,h=e.length;l<h;l++){const d=e[l];if(n){const u=d.POSITION!==void 0?t.getDependency("accessor",d.POSITION):r.attributes.position;o.push(u)}if(i){const u=d.NORMAL!==void 0?t.getDependency("accessor",d.NORMAL):r.attributes.normal;a.push(u)}if(s){const u=d.COLOR_0!==void 0?t.getDependency("accessor",d.COLOR_0):r.attributes.color;c.push(u)}}return Promise.all([Promise.all(o),Promise.all(a),Promise.all(c)]).then(function(l){const h=l[0],d=l[1],u=l[2];return n&&(r.morphAttributes.position=h),i&&(r.morphAttributes.normal=d),s&&(r.morphAttributes.color=u),r.morphTargetsRelative=!0,r})}function Pv(r,e){if(r.updateMorphTargets(),e.weights!==void 0)for(let t=0,n=e.weights.length;t<n;t++)r.morphTargetInfluences[t]=e.weights[t];if(e.extras&&Array.isArray(e.extras.targetNames)){const t=e.extras.targetNames;if(r.morphTargetInfluences.length===t.length){r.morphTargetDictionary={};for(let n=0,i=t.length;n<i;n++)r.morphTargetDictionary[t[n]]=n}else console.warn("THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.")}}function Dv(r){let e;const t=r.extensions&&r.extensions[xt.KHR_DRACO_MESH_COMPRESSION];if(t?e="draco:"+t.bufferView+":"+t.indices+":"+qa(t.attributes):e=r.indices+":"+qa(r.attributes)+":"+r.mode,r.targets!==void 0)for(let n=0,i=r.targets.length;n<i;n++)e+=":"+qa(r.targets[n]);return e}function qa(r){let e="";const t=Object.keys(r).sort();for(let n=0,i=t.length;n<i;n++)e+=t[n]+":"+r[t[n]]+";";return e}function Vc(r){switch(r){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw new Error("THREE.GLTFLoader: Unsupported normalized accessor component type.")}}function Nv(r){return r.search(/\.jpe?g($|\?)/i)>0||r.search(/^data\:image\/jpeg/)===0?"image/jpeg":r.search(/\.webp($|\?)/i)>0||r.search(/^data\:image\/webp/)===0?"image/webp":r.search(/\.ktx2($|\?)/i)>0||r.search(/^data\:image\/ktx2/)===0?"image/ktx2":"image/png"}const Fv=new Ze;class Uv{constructor(e={},t={}){this.json=e,this.extensions={},this.plugins={},this.options=t,this.cache=new sv,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let n=!1,i=-1,s=!1,o=-1;if(typeof navigator<"u"){const a=navigator.userAgent;n=/^((?!chrome|android).)*safari/i.test(a)===!0;const c=a.match(/Version\/(\d+)/);i=n&&c?parseInt(c[1],10):-1,s=a.indexOf("Firefox")>-1,o=s?a.match(/Firefox\/([0-9]+)\./)[1]:-1}typeof createImageBitmap>"u"||n&&i<17||s&&o<98?this.textureLoader=new al(this.options.manager):this.textureLoader=new e0(this.options.manager),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new ki(this.options.manager),this.fileLoader.setResponseType("arraybuffer"),this.options.crossOrigin==="use-credentials"&&this.fileLoader.setWithCredentials(!0)}setExtensions(e){this.extensions=e}setPlugins(e){this.plugins=e}parse(e,t){const n=this,i=this.json,s=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(o){return o._markDefs&&o._markDefs()}),Promise.all(this._invokeAll(function(o){return o.beforeRoot&&o.beforeRoot()})).then(function(){return Promise.all([n.getDependencies("scene"),n.getDependencies("animation"),n.getDependencies("camera")])}).then(function(o){const a={scene:o[0][i.scene||0],scenes:o[0],animations:o[1],cameras:o[2],asset:i.asset,parser:n,userData:{}};return qi(s,a,i),pi(a,i),Promise.all(n._invokeAll(function(c){return c.afterRoot&&c.afterRoot(a)})).then(function(){for(const c of a.scenes)c.updateMatrixWorld();e(a)})}).catch(t)}_markDefs(){const e=this.json.nodes||[],t=this.json.skins||[],n=this.json.meshes||[];for(let i=0,s=t.length;i<s;i++){const o=t[i].joints;for(let a=0,c=o.length;a<c;a++)e[o[a]].isBone=!0}for(let i=0,s=e.length;i<s;i++){const o=e[i];o.mesh!==void 0&&(this._addNodeRef(this.meshCache,o.mesh),o.skin!==void 0&&(n[o.mesh].isSkinnedMesh=!0)),o.camera!==void 0&&this._addNodeRef(this.cameraCache,o.camera)}}_addNodeRef(e,t){t!==void 0&&(e.refs[t]===void 0&&(e.refs[t]=e.uses[t]=0),e.refs[t]++)}_getNodeRef(e,t,n){if(e.refs[t]<=1)return n;const i=n.clone(),s=(o,a)=>{const c=this.associations.get(o);c!=null&&this.associations.set(a,c);for(const[l,h]of o.children.entries())s(h,a.children[l])};return s(n,i),i.name+="_instance_"+e.uses[t]++,i}_invokeOne(e){const t=Object.values(this.plugins);t.push(this);for(let n=0;n<t.length;n++){const i=e(t[n]);if(i)return i}return null}_invokeAll(e){const t=Object.values(this.plugins);t.unshift(this);const n=[];for(let i=0;i<t.length;i++){const s=e(t[i]);s&&n.push(s)}return n}getDependency(e,t){const n=e+":"+t;let i=this.cache.get(n);if(!i){switch(e){case"scene":i=this.loadScene(t);break;case"node":i=this._invokeOne(function(s){return s.loadNode&&s.loadNode(t)});break;case"mesh":i=this._invokeOne(function(s){return s.loadMesh&&s.loadMesh(t)});break;case"accessor":i=this.loadAccessor(t);break;case"bufferView":i=this._invokeOne(function(s){return s.loadBufferView&&s.loadBufferView(t)});break;case"buffer":i=this.loadBuffer(t);break;case"material":i=this._invokeOne(function(s){return s.loadMaterial&&s.loadMaterial(t)});break;case"texture":i=this._invokeOne(function(s){return s.loadTexture&&s.loadTexture(t)});break;case"skin":i=this.loadSkin(t);break;case"animation":i=this._invokeOne(function(s){return s.loadAnimation&&s.loadAnimation(t)});break;case"camera":i=this.loadCamera(t);break;default:if(i=this._invokeOne(function(s){return s!=this&&s.getDependency&&s.getDependency(e,t)}),!i)throw new Error("Unknown type: "+e);break}this.cache.add(n,i)}return i}getDependencies(e){let t=this.cache.get(e);if(!t){const n=this,i=this.json[e+(e==="mesh"?"es":"s")]||[];t=Promise.all(i.map(function(s,o){return n.getDependency(e,o)})),this.cache.add(e,t)}return t}loadBuffer(e){const t=this.json.buffers[e],n=this.fileLoader;if(t.type&&t.type!=="arraybuffer")throw new Error("THREE.GLTFLoader: "+t.type+" buffer type is not supported.");if(t.uri===void 0&&e===0)return Promise.resolve(this.extensions[xt.KHR_BINARY_GLTF].body);const i=this.options;return new Promise(function(s,o){n.load(es.resolveURL(t.uri,i.path),s,void 0,function(){o(new Error('THREE.GLTFLoader: Failed to load buffer "'+t.uri+'".'))})})}loadBufferView(e){const t=this.json.bufferViews[e];return this.getDependency("buffer",t.buffer).then(function(n){const i=t.byteLength||0,s=t.byteOffset||0;return n.slice(s,s+i)})}loadAccessor(e){const t=this,n=this.json,i=this.json.accessors[e];if(i.bufferView===void 0&&i.sparse===void 0){const o=Xa[i.type],a=Us[i.componentType],c=i.normalized===!0,l=new a(i.count*o);return Promise.resolve(new yt(l,o,c))}const s=[];return i.bufferView!==void 0?s.push(this.getDependency("bufferView",i.bufferView)):s.push(null),i.sparse!==void 0&&(s.push(this.getDependency("bufferView",i.sparse.indices.bufferView)),s.push(this.getDependency("bufferView",i.sparse.values.bufferView))),Promise.all(s).then(function(o){const a=o[0],c=Xa[i.type],l=Us[i.componentType],h=l.BYTES_PER_ELEMENT,d=h*c,u=i.byteOffset||0,m=i.bufferView!==void 0?n.bufferViews[i.bufferView].byteStride:void 0,g=i.normalized===!0;let _,f;if(m&&m!==d){const p=Math.floor(u/m),x="InterleavedBuffer:"+i.bufferView+":"+i.componentType+":"+p+":"+i.count;let y=t.cache.get(x);y||(_=new l(a,p*m,i.count*m/h),y=new il(_,m/h),t.cache.add(x,y)),f=new Kn(y,c,u%m/h,g)}else a===null?_=new l(i.count*c):_=new l(a,u,i.count*c),f=new yt(_,c,g);if(i.sparse!==void 0){const p=Xa.SCALAR,x=Us[i.sparse.indices.componentType],y=i.sparse.indices.byteOffset||0,v=i.sparse.values.byteOffset||0,F=new x(o[1],y,i.sparse.count*p),A=new l(o[2],v,i.sparse.count*c);a!==null&&(f=new yt(f.array.slice(),f.itemSize,f.normalized)),f.normalized=!1;for(let L=0,O=F.length;L<O;L++){const w=F[L];if(f.setX(w,A[L*c]),c>=2&&f.setY(w,A[L*c+1]),c>=3&&f.setZ(w,A[L*c+2]),c>=4&&f.setW(w,A[L*c+3]),c>=5)throw new Error("THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.")}f.normalized=g}return f})}loadTexture(e){const t=this.json,n=this.options,s=t.textures[e].source,o=t.images[s];let a=this.textureLoader;if(o.uri){const c=n.manager.getHandler(o.uri);c!==null&&(a=c)}return this.loadTextureImage(e,s,a)}loadTextureImage(e,t,n){const i=this,s=this.json,o=s.textures[e],a=s.images[t],c=(a.uri||a.bufferView)+":"+o.sampler;if(this.textureCache[c])return this.textureCache[c];const l=this.loadImageSource(t,n).then(function(h){h.flipY=!1,h.name=o.name||a.name||"",h.name===""&&typeof a.uri=="string"&&a.uri.startsWith("data:image/")===!1&&(h.name=a.uri);const u=(s.samplers||{})[o.sampler]||{};return h.magFilter=ad[u.magFilter]||cn,h.minFilter=ad[u.minFilter]||Yn,h.wrapS=cd[u.wrapS]||ti,h.wrapT=cd[u.wrapT]||ti,h.generateMipmaps=!h.isCompressedTexture&&h.minFilter!==pn&&h.minFilter!==cn,i.associations.set(h,{textures:e}),h}).catch(function(){return null});return this.textureCache[c]=l,l}loadImageSource(e,t){const n=this,i=this.json,s=this.options;if(this.sourceCache[e]!==void 0)return this.sourceCache[e].then(d=>d.clone());const o=i.images[e],a=self.URL||self.webkitURL;let c=o.uri||"",l=!1;if(o.bufferView!==void 0)c=n.getDependency("bufferView",o.bufferView).then(function(d){l=!0;const u=new Blob([d],{type:o.mimeType});return c=a.createObjectURL(u),c});else if(o.uri===void 0)throw new Error("THREE.GLTFLoader: Image "+e+" is missing URI and bufferView");const h=Promise.resolve(c).then(function(d){return new Promise(function(u,m){let g=u;t.isImageBitmapLoader===!0&&(g=function(_){const f=new jt(_);f.needsUpdate=!0,u(f)}),t.load(es.resolveURL(d,s.path),g,void 0,m)})}).then(function(d){return l===!0&&a.revokeObjectURL(c),pi(d,o),d.userData.mimeType=o.mimeType||Nv(o.uri),d}).catch(function(d){throw console.error("THREE.GLTFLoader: Couldn't load texture",c),d});return this.sourceCache[e]=h,h}assignTexture(e,t,n,i){const s=this;return this.getDependency("texture",n.index).then(function(o){if(!o)return null;if(n.texCoord!==void 0&&n.texCoord>0&&(o=o.clone(),o.channel=n.texCoord),s.extensions[xt.KHR_TEXTURE_TRANSFORM]){const a=n.extensions!==void 0?n.extensions[xt.KHR_TEXTURE_TRANSFORM]:void 0;if(a){const c=s.associations.get(o);o=s.extensions[xt.KHR_TEXTURE_TRANSFORM].extendTexture(o,a),s.associations.set(o,c)}}return i!==void 0&&(o.colorSpace=i),e[t]=o,o})}assignFinalMaterial(e){const t=e.geometry;let n=e.material;const i=t.attributes.tangent===void 0,s=t.attributes.color!==void 0,o=t.attributes.normal===void 0;if(e.isPoints){const a="PointsMaterial:"+n.uuid;let c=this.cache.get(a);c||(c=new Ni,Ft.prototype.copy.call(c,n),c.color.copy(n.color),c.map=n.map,c.sizeAttenuation=!1,this.cache.add(a,c)),n=c}else if(e.isLine){const a="LineBasicMaterial:"+n.uuid;let c=this.cache.get(a);c||(c=new zt,Ft.prototype.copy.call(c,n),c.color.copy(n.color),c.map=n.map,this.cache.add(a,c)),n=c}if(i||s||o){let a="ClonedMaterial:"+n.uuid+":";i&&(a+="derivative-tangents:"),s&&(a+="vertex-colors:"),o&&(a+="flat-shading:");let c=this.cache.get(a);c||(c=n.clone(),s&&(c.vertexColors=!0),o&&(c.flatShading=!0),i&&(c.normalScale&&(c.normalScale.y*=-1),c.clearcoatNormalScale&&(c.clearcoatNormalScale.y*=-1)),this.cache.add(a,c),this.associations.set(c,this.associations.get(n))),n=c}e.material=n}getMaterialType(){return Qi}loadMaterial(e){const t=this,n=this.json,i=this.extensions,s=n.materials[e];let o;const a={},c=s.extensions||{},l=[];if(c[xt.KHR_MATERIALS_UNLIT]){const d=i[xt.KHR_MATERIALS_UNLIT];o=d.getMaterialType(),l.push(d.extendParams(a,s,t))}else{const d=s.pbrMetallicRoughness||{};if(a.color=new qe(1,1,1),a.opacity=1,Array.isArray(d.baseColorFactor)){const u=d.baseColorFactor;a.color.setRGB(u[0],u[1],u[2],mn),a.opacity=u[3]}d.baseColorTexture!==void 0&&l.push(t.assignTexture(a,"map",d.baseColorTexture,It)),a.metalness=d.metallicFactor!==void 0?d.metallicFactor:1,a.roughness=d.roughnessFactor!==void 0?d.roughnessFactor:1,d.metallicRoughnessTexture!==void 0&&(l.push(t.assignTexture(a,"metalnessMap",d.metallicRoughnessTexture)),l.push(t.assignTexture(a,"roughnessMap",d.metallicRoughnessTexture))),o=this._invokeOne(function(u){return u.getMaterialType&&u.getMaterialType(e)}),l.push(Promise.all(this._invokeAll(function(u){return u.extendMaterialParams&&u.extendMaterialParams(e,a)})))}s.doubleSided===!0&&(a.side=sn);const h=s.alphaMode||ja.OPAQUE;if(h===ja.BLEND?(a.transparent=!0,a.depthWrite=!1):(a.transparent=!1,h===ja.MASK&&(a.alphaTest=s.alphaCutoff!==void 0?s.alphaCutoff:.5)),s.normalTexture!==void 0&&o!==rn&&(l.push(t.assignTexture(a,"normalMap",s.normalTexture)),a.normalScale=new Ge(1,1),s.normalTexture.scale!==void 0)){const d=s.normalTexture.scale;a.normalScale.set(d,d)}if(s.occlusionTexture!==void 0&&o!==rn&&(l.push(t.assignTexture(a,"aoMap",s.occlusionTexture)),s.occlusionTexture.strength!==void 0&&(a.aoMapIntensity=s.occlusionTexture.strength)),s.emissiveFactor!==void 0&&o!==rn){const d=s.emissiveFactor;a.emissive=new qe().setRGB(d[0],d[1],d[2],mn)}return s.emissiveTexture!==void 0&&o!==rn&&l.push(t.assignTexture(a,"emissiveMap",s.emissiveTexture,It)),Promise.all(l).then(function(){const d=new o(a);return s.name&&(d.name=s.name),pi(d,s),t.associations.set(d,{materials:e}),s.extensions&&qi(i,d,s),d})}createUniqueName(e){const t=Lt.sanitizeNodeName(e||"");return t in this.nodeNamesUsed?t+"_"+ ++this.nodeNamesUsed[t]:(this.nodeNamesUsed[t]=0,t)}loadGeometries(e){const t=this,n=this.extensions,i=this.primitiveCache;function s(a){return n[xt.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(a,t).then(function(c){return ld(c,a,t)})}const o=[];for(let a=0,c=e.length;a<c;a++){const l=e[a],h=Dv(l),d=i[h];if(d)o.push(d.promise);else{let u;l.extensions&&l.extensions[xt.KHR_DRACO_MESH_COMPRESSION]?u=s(l):u=ld(new at,l,t),i[h]={primitive:l,promise:u},o.push(u)}}return Promise.all(o)}loadMesh(e){const t=this,n=this.json,i=this.extensions,s=n.meshes[e],o=s.primitives,a=[];for(let c=0,l=o.length;c<l;c++){const h=o[c].material===void 0?Lv(this.cache):this.getDependency("material",o[c].material);a.push(h)}return a.push(t.loadGeometries(o)),Promise.all(a).then(function(c){const l=c.slice(0,c.length-1),h=c[c.length-1],d=[];for(let m=0,g=h.length;m<g;m++){const _=h[m],f=o[m];let p;const x=l[m];if(f.mode===Pn.TRIANGLES||f.mode===Pn.TRIANGLE_STRIP||f.mode===Pn.TRIANGLE_FAN||f.mode===void 0)p=s.isSkinnedMesh===!0?new Xd(_,x):new rt(_,x),p.isSkinnedMesh===!0&&p.normalizeSkinWeights(),f.mode===Pn.TRIANGLE_STRIP?p.geometry=rd(p.geometry,Ed):f.mode===Pn.TRIANGLE_FAN&&(p.geometry=rd(p.geometry,Pc));else if(f.mode===Pn.LINES)p=new Vt(_,x);else if(f.mode===Pn.LINE_STRIP)p=new An(_,x);else if(f.mode===Pn.LINE_LOOP)p=new Dx(_,x);else if(f.mode===Pn.POINTS)p=new Ns(_,x);else throw new Error("THREE.GLTFLoader: Primitive mode unsupported: "+f.mode);Object.keys(p.geometry.morphAttributes).length>0&&Pv(p,s),p.name=t.createUniqueName(s.name||"mesh_"+e),pi(p,s),f.extensions&&qi(i,p,f),t.assignFinalMaterial(p),d.push(p)}for(let m=0,g=d.length;m<g;m++)t.associations.set(d[m],{meshes:e,primitives:m});if(d.length===1)return s.extensions&&qi(i,d[0],s),d[0];const u=new Bt;s.extensions&&qi(i,u,s),t.associations.set(u,{meshes:e});for(let m=0,g=d.length;m<g;m++)u.add(d[m]);return u})}loadCamera(e){let t;const n=this.json.cameras[e],i=n[n.type];if(!i){console.warn("THREE.GLTFLoader: Missing camera parameters.");return}return n.type==="perspective"?t=new nn(Zi.radToDeg(i.yfov),i.aspectRatio||1,i.znear||1,i.zfar||2e6):n.type==="orthographic"&&(t=new Dr(-i.xmag,i.xmag,i.ymag,-i.ymag,i.znear,i.zfar)),n.name&&(t.name=this.createUniqueName(n.name)),pi(t,n),Promise.resolve(t)}loadSkin(e){const t=this.json.skins[e],n=[];for(let i=0,s=t.joints.length;i<s;i++)n.push(this._loadNodeShallow(t.joints[i]));return t.inverseBindMatrices!==void 0?n.push(this.getDependency("accessor",t.inverseBindMatrices)):n.push(null),Promise.all(n).then(function(i){const s=i.pop(),o=i,a=[],c=[];for(let l=0,h=o.length;l<h;l++){const d=o[l];if(d){a.push(d);const u=new Ze;s!==null&&u.fromArray(s.array,l*16),c.push(u)}else console.warn('THREE.GLTFLoader: Joint "%s" could not be found.',t.joints[l])}return new Ko(a,c)})}loadAnimation(e){const t=this.json,n=this,i=t.animations[e],s=i.name?i.name:"animation_"+e,o=[],a=[],c=[],l=[],h=[];for(let d=0,u=i.channels.length;d<u;d++){const m=i.channels[d],g=i.samplers[m.sampler],_=m.target,f=_.node,p=i.parameters!==void 0?i.parameters[g.input]:g.input,x=i.parameters!==void 0?i.parameters[g.output]:g.output;_.node!==void 0&&(o.push(this.getDependency("node",f)),a.push(this.getDependency("accessor",p)),c.push(this.getDependency("accessor",x)),l.push(g),h.push(_))}return Promise.all([Promise.all(o),Promise.all(a),Promise.all(c),Promise.all(l),Promise.all(h)]).then(function(d){const u=d[0],m=d[1],g=d[2],_=d[3],f=d[4],p=[];for(let x=0,y=u.length;x<y;x++){const v=u[x],F=m[x],A=g[x],L=_[x],O=f[x];if(v===void 0)continue;v.updateMatrix&&v.updateMatrix();const w=n._createAnimationTracks(v,F,A,L,O);if(w)for(let S=0;S<w.length;S++)p.push(w[S])}return new kc(s,void 0,p)})}createNodeMesh(e){const t=this.json,n=this,i=t.nodes[e];return i.mesh===void 0?null:n.getDependency("mesh",i.mesh).then(function(s){const o=n._getNodeRef(n.meshCache,i.mesh,s);return i.weights!==void 0&&o.traverse(function(a){if(a.isMesh)for(let c=0,l=i.weights.length;c<l;c++)a.morphTargetInfluences[c]=i.weights[c]}),o})}loadNode(e){const t=this.json,n=this,i=t.nodes[e],s=n._loadNodeShallow(e),o=[],a=i.children||[];for(let l=0,h=a.length;l<h;l++)o.push(n.getDependency("node",a[l]));const c=i.skin===void 0?Promise.resolve(null):n.getDependency("skin",i.skin);return Promise.all([s,Promise.all(o),c]).then(function(l){const h=l[0],d=l[1],u=l[2];u!==null&&h.traverse(function(m){m.isSkinnedMesh&&m.bind(u,Fv)});for(let m=0,g=d.length;m<g;m++)h.add(d[m]);return h})}_loadNodeShallow(e){const t=this.json,n=this.extensions,i=this;if(this.nodeCache[e]!==void 0)return this.nodeCache[e];const s=t.nodes[e],o=s.name?i.createUniqueName(s.name):"",a=[],c=i._invokeOne(function(l){return l.createNodeMesh&&l.createNodeMesh(e)});return c&&a.push(c),s.camera!==void 0&&a.push(i.getDependency("camera",s.camera).then(function(l){return i._getNodeRef(i.cameraCache,s.camera,l)})),i._invokeAll(function(l){return l.createNodeAttachment&&l.createNodeAttachment(e)}).forEach(function(l){a.push(l)}),this.nodeCache[e]=Promise.all(a).then(function(l){let h;if(s.isBone===!0?h=new sl:l.length>1?h=new Bt:l.length===1?h=l[0]:h=new Ut,h!==l[0])for(let d=0,u=l.length;d<u;d++)h.add(l[d]);if(s.name&&(h.userData.name=s.name,h.name=o),pi(h,s),s.extensions&&qi(n,h,s),s.matrix!==void 0){const d=new Ze;d.fromArray(s.matrix),h.applyMatrix4(d)}else s.translation!==void 0&&h.position.fromArray(s.translation),s.rotation!==void 0&&h.quaternion.fromArray(s.rotation),s.scale!==void 0&&h.scale.fromArray(s.scale);return i.associations.has(h)||i.associations.set(h,{}),i.associations.get(h).nodes=e,h}),this.nodeCache[e]}loadScene(e){const t=this.extensions,n=this.json.scenes[e],i=this,s=new Bt;n.name&&(s.name=i.createUniqueName(n.name)),pi(s,n),n.extensions&&qi(t,s,n);const o=n.nodes||[],a=[];for(let c=0,l=o.length;c<l;c++)a.push(i.getDependency("node",o[c]));return Promise.all(a).then(function(c){for(let h=0,d=c.length;h<d;h++)s.add(c[h]);const l=h=>{const d=new Map;for(const[u,m]of i.associations)(u instanceof Ft||u instanceof jt)&&d.set(u,m);return h.traverse(u=>{const m=i.associations.get(u);m!=null&&d.set(u,m)}),d};return i.associations=l(s),s})}_createAnimationTracks(e,t,n,i,s){const o=[],a=e.name?e.name:e.uuid,c=[];Ii[s.path]===Ii.weights?e.traverse(function(u){u.morphTargetInfluences&&c.push(u.name?u.name:u.uuid)}):c.push(a);let l;switch(Ii[s.path]){case Ii.weights:l=Ws;break;case Ii.rotation:l=ss;break;case Ii.position:case Ii.scale:l=Oi;break;default:switch(n.itemSize){case 1:l=Ws;break;case 2:case 3:default:l=Oi;break}break}const h=i.interpolation!==void 0?Rv[i.interpolation]:Er,d=this._getArrayFromAccessor(n);for(let u=0,m=c.length;u<m;u++){const g=new l(c[u]+"."+Ii[s.path],t.array,d,h);i.interpolation==="CUBICSPLINE"&&this._createCubicSplineTrackInterpolant(g),o.push(g)}return o}_getArrayFromAccessor(e){let t=e.array;if(e.normalized){const n=Vc(t.constructor),i=new Float32Array(t.length);for(let s=0,o=t.length;s<o;s++)i[s]=t[s]*n;t=i}return t}_createCubicSplineTrackInterpolant(e){e.createInterpolant=function(n){const i=this instanceof ss?Cv:ru;return new i(this.times,this.values,this.getValueSize()/3,n)},e.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}}function Ov(r,e,t){const n=e.attributes,i=new Un;if(n.POSITION!==void 0){const a=t.json.accessors[n.POSITION],c=a.min,l=a.max;if(c!==void 0&&l!==void 0){if(i.set(new P(c[0],c[1],c[2]),new P(l[0],l[1],l[2])),a.normalized){const h=Vc(Us[a.componentType]);i.min.multiplyScalar(h),i.max.multiplyScalar(h)}}else{console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.");return}}else return;const s=e.targets;if(s!==void 0){const a=new P,c=new P;for(let l=0,h=s.length;l<h;l++){const d=s[l];if(d.POSITION!==void 0){const u=t.json.accessors[d.POSITION],m=u.min,g=u.max;if(m!==void 0&&g!==void 0){if(c.setX(Math.max(Math.abs(m[0]),Math.abs(g[0]))),c.setY(Math.max(Math.abs(m[1]),Math.abs(g[1]))),c.setZ(Math.max(Math.abs(m[2]),Math.abs(g[2]))),u.normalized){const _=Vc(Us[u.componentType]);c.multiplyScalar(_)}a.max(c)}else console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.")}}i.expandByVector(a)}r.boundingBox=i;const o=new On;i.getCenter(o.center),o.radius=i.min.distanceTo(i.max)/2,r.boundingSphere=o}function ld(r,e,t){const n=e.attributes,i=[];function s(o,a){return t.getDependency("accessor",o).then(function(c){r.setAttribute(a,c)})}for(const o in n){const a=Hc[o]||o.toLowerCase();a in r.attributes||i.push(s(n[o],a))}if(e.indices!==void 0&&!r.index){const o=t.getDependency("accessor",e.indices).then(function(a){r.setIndex(a)});i.push(o)}return gt.workingColorSpace!==mn&&"COLOR_0"in n&&console.warn(`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "${gt.workingColorSpace}" not supported.`),pi(r,e),Ov(r,e,t),Promise.all(i).then(function(){return e.targets!==void 0?Iv(r,e.targets,t):r})}class hd extends Yx{constructor(e){super(e)}parse(e){function t(z){switch(z.image_type){case u:case _:if(z.colormap_length>256||z.colormap_size!==24||z.colormap_type!==1)throw new Error("THREE.TGALoader: Invalid type colormap data for indexed type.");break;case m:case g:case f:case p:if(z.colormap_type)throw new Error("THREE.TGALoader: Invalid type colormap data for colormap type.");break;case d:throw new Error("THREE.TGALoader: No data.");default:throw new Error("THREE.TGALoader: Invalid type "+z.image_type)}if(z.width<=0||z.height<=0)throw new Error("THREE.TGALoader: Invalid image size.");if(z.pixel_size!==8&&z.pixel_size!==16&&z.pixel_size!==24&&z.pixel_size!==32)throw new Error("THREE.TGALoader: Invalid pixel size "+z.pixel_size)}function n(z,de,$,D,B){let j,X;const Y=$.pixel_size>>3,k=$.width*$.height*Y;if(de&&(X=B.subarray(D,D+=$.colormap_length*($.colormap_size>>3))),z){j=new Uint8Array(k);let G,Q,ee,oe=0;const ce=new Uint8Array(Y);for(;oe<k;)if(G=B[D++],Q=(G&127)+1,G&128){for(ee=0;ee<Y;++ee)ce[ee]=B[D++];for(ee=0;ee<Q;++ee)j.set(ce,oe+ee*Y);oe+=Y*Q}else{for(Q*=Y,ee=0;ee<Q;++ee)j[oe+ee]=B[D++];oe+=Q}}else j=B.subarray(D,D+=de?$.width*$.height:k);return{pixel_data:j,palettes:X}}function i(z,de,$,D,B,j,X,Y,k){const G=k;let Q,ee=0,oe,ce;const Me=S.width;for(ce=de;ce!==D;ce+=$)for(oe=B;oe!==X;oe+=j,ee++)Q=Y[ee],z[(oe+Me*ce)*4+3]=255,z[(oe+Me*ce)*4+2]=G[Q*3+0],z[(oe+Me*ce)*4+1]=G[Q*3+1],z[(oe+Me*ce)*4+0]=G[Q*3+2];return z}function s(z,de,$,D,B,j,X,Y){let k,G=0,Q,ee;const oe=S.width;for(ee=de;ee!==D;ee+=$)for(Q=B;Q!==X;Q+=j,G+=2)k=Y[G+0]+(Y[G+1]<<8),z[(Q+oe*ee)*4+0]=(k&31744)>>7,z[(Q+oe*ee)*4+1]=(k&992)>>2,z[(Q+oe*ee)*4+2]=(k&31)<<3,z[(Q+oe*ee)*4+3]=k&32768?0:255;return z}function o(z,de,$,D,B,j,X,Y){let k=0,G,Q;const ee=S.width;for(Q=de;Q!==D;Q+=$)for(G=B;G!==X;G+=j,k+=3)z[(G+ee*Q)*4+3]=255,z[(G+ee*Q)*4+2]=Y[k+0],z[(G+ee*Q)*4+1]=Y[k+1],z[(G+ee*Q)*4+0]=Y[k+2];return z}function a(z,de,$,D,B,j,X,Y){let k=0,G,Q;const ee=S.width;for(Q=de;Q!==D;Q+=$)for(G=B;G!==X;G+=j,k+=4)z[(G+ee*Q)*4+2]=Y[k+0],z[(G+ee*Q)*4+1]=Y[k+1],z[(G+ee*Q)*4+0]=Y[k+2],z[(G+ee*Q)*4+3]=Y[k+3];return z}function c(z,de,$,D,B,j,X,Y){let k,G=0,Q,ee;const oe=S.width;for(ee=de;ee!==D;ee+=$)for(Q=B;Q!==X;Q+=j,G++)k=Y[G],z[(Q+oe*ee)*4+0]=k,z[(Q+oe*ee)*4+1]=k,z[(Q+oe*ee)*4+2]=k,z[(Q+oe*ee)*4+3]=255;return z}function l(z,de,$,D,B,j,X,Y){let k=0,G,Q;const ee=S.width;for(Q=de;Q!==D;Q+=$)for(G=B;G!==X;G+=j,k+=2)z[(G+ee*Q)*4+0]=Y[k+0],z[(G+ee*Q)*4+1]=Y[k+0],z[(G+ee*Q)*4+2]=Y[k+0],z[(G+ee*Q)*4+3]=Y[k+1];return z}function h(z,de,$,D,B){let j,X,Y,k,G,Q;switch((S.flags&x)>>y){default:case A:j=0,Y=1,G=de,X=0,k=1,Q=$;break;case v:j=0,Y=1,G=de,X=$-1,k=-1,Q=-1;break;case L:j=de-1,Y=-1,G=-1,X=0,k=1,Q=$;break;case F:j=de-1,Y=-1,G=-1,X=$-1,k=-1,Q=-1;break}if(K)switch(S.pixel_size){case 8:c(z,X,k,Q,j,Y,G,D);break;case 16:l(z,X,k,Q,j,Y,G,D);break;default:throw new Error("THREE.TGALoader: Format not supported.")}else switch(S.pixel_size){case 8:i(z,X,k,Q,j,Y,G,D,B);break;case 16:s(z,X,k,Q,j,Y,G,D);break;case 24:o(z,X,k,Q,j,Y,G,D);break;case 32:a(z,X,k,Q,j,Y,G,D);break;default:throw new Error("THREE.TGALoader: Format not supported.")}return z}const d=0,u=1,m=2,g=3,_=9,f=10,p=11,x=48,y=4,v=0,F=1,A=2,L=3;if(e.length<19)throw new Error("THREE.TGALoader: Not enough data to contain header.");let O=0;const w=new Uint8Array(e),S={id_length:w[O++],colormap_type:w[O++],image_type:w[O++],colormap_index:w[O++]|w[O++]<<8,colormap_length:w[O++]|w[O++]<<8,colormap_size:w[O++],origin:[w[O++]|w[O++]<<8,w[O++]|w[O++]<<8],width:w[O++]|w[O++]<<8,height:w[O++]|w[O++]<<8,pixel_size:w[O++],flags:w[O++]};if(t(S),S.id_length+O>e.length)throw new Error("THREE.TGALoader: No data.");O+=S.id_length;let U=!1,Z=!1,K=!1;switch(S.image_type){case _:U=!0,Z=!0;break;case u:Z=!0;break;case f:U=!0;break;case m:break;case p:U=!0,K=!0;break;case g:K=!0;break}const se=new Uint8Array(S.width*S.height*4),fe=n(U,Z,S,O,w);return h(se,S.width,S.height,fe.pixel_data,fe.palettes),{data:se,width:S.width,height:S.height,flipY:!0,generateMipmaps:!0,minFilter:Yn}}}class kv extends Cn{load(e,t,n,i){const s=this,o=s.path===""?es.extractUrlBase(e):s.path,a=new ki(s.manager);a.setPath(s.path),a.setRequestHeader(s.requestHeader),a.setWithCredentials(s.withCredentials),a.load(e,function(c){try{t(s.parse(c,o))}catch(l){i?i(l):console.error(l),s.manager.itemError(e)}},n,i)}parse(e,t){function n(M,b){const C=[],T=M.childNodes;for(let I=0,re=T.length;I<re;I++){const le=T[I];le.nodeName===b&&C.push(le)}return C}function i(M){if(M.length===0)return[];const b=M.trim().split(/\s+/),C=new Array(b.length);for(let T=0,I=b.length;T<I;T++)C[T]=b[T];return C}function s(M){if(M.length===0)return[];const b=M.trim().split(/\s+/),C=new Array(b.length);for(let T=0,I=b.length;T<I;T++)C[T]=parseFloat(b[T]);return C}function o(M){if(M.length===0)return[];const b=M.trim().split(/\s+/),C=new Array(b.length);for(let T=0,I=b.length;T<I;T++)C[T]=parseInt(b[T]);return C}function a(M){return M.substring(1)}function c(){return"three_default_"+ou++}function l(M){return Object.keys(M).length===0}function h(M){return{unit:d(n(M,"unit")[0]),upAxis:u(n(M,"up_axis")[0])}}function d(M){return M!==void 0&&M.hasAttribute("meter")===!0?parseFloat(M.getAttribute("meter")):1}function u(M){return M!==void 0?M.textContent:"Y_UP"}function m(M,b,C,T){const I=n(M,b)[0];if(I!==void 0){const re=n(I,C);for(let le=0;le<re.length;le++)T(re[le])}}function g(M,b){for(const C in M){const T=M[C];T.build=b(M[C])}}function _(M,b){return M.build!==void 0||(M.build=b(M)),M.build}function f(M){const b={sources:{},samplers:{},channels:{}};let C=!1;for(let T=0,I=M.childNodes.length;T<I;T++){const re=M.childNodes[T];if(re.nodeType!==1)continue;let le;switch(re.nodeName){case"source":le=re.getAttribute("id"),b.sources[le]=ae(re);break;case"sampler":le=re.getAttribute("id"),b.samplers[le]=p(re);break;case"channel":le=re.getAttribute("target"),b.channels[le]=x(re);break;case"animation":f(re),C=!0;break;default:console.log(re)}}C===!1&&(tt.animations[M.getAttribute("id")||Zi.generateUUID()]=b)}function p(M){const b={inputs:{}};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"input":const re=a(I.getAttribute("source")),le=I.getAttribute("semantic");b.inputs[le]=re;break}}return b}function x(M){const b={};let T=M.getAttribute("target").split("/");const I=T.shift();let re=T.shift();const le=re.indexOf("(")!==-1,Fe=re.indexOf(".")!==-1;if(Fe)T=re.split("."),re=T.shift(),b.member=T.shift();else if(le){const Se=re.split("(");re=Se.shift();for(let Ie=0;Ie<Se.length;Ie++)Se[Ie]=parseInt(Se[Ie].replace(/\)/,""));b.indices=Se}return b.id=I,b.sid=re,b.arraySyntax=le,b.memberSyntax=Fe,b.sampler=a(M.getAttribute("source")),b}function y(M){const b=[],C=M.channels,T=M.samplers,I=M.sources;for(const re in C)if(C.hasOwnProperty(re)){const le=C[re],Fe=T[le.sampler],Se=Fe.inputs.INPUT,Ie=Fe.inputs.OUTPUT,je=I[Se],ge=I[Ie],Xe=F(le,je,ge);S(Xe,b)}return b}function v(M){return _(tt.animations[M],y)}function F(M,b,C){const T=tt.nodes[M.id],I=Wt(T.id),re=T.transforms[M.sid],le=T.matrix.clone().transpose();let Fe,Se,Ie,je,ge,Xe;const Be={};switch(re){case"matrix":for(Ie=0,je=b.array.length;Ie<je;Ie++)if(Fe=b.array[Ie],Se=Ie*C.stride,Be[Fe]===void 0&&(Be[Fe]={}),M.arraySyntax===!0){const Gt=C.array[Se],Ct=M.indices[0]+4*M.indices[1];Be[Fe][Ct]=Gt}else for(ge=0,Xe=C.stride;ge<Xe;ge++)Be[Fe][ge]=C.array[Se+ge];break;case"translate":console.warn('THREE.ColladaLoader: Animation transform type "%s" not yet implemented.',re);break;case"rotate":console.warn('THREE.ColladaLoader: Animation transform type "%s" not yet implemented.',re);break;case"scale":console.warn('THREE.ColladaLoader: Animation transform type "%s" not yet implemented.',re);break}const et=A(Be,le);return{name:I.uuid,keyframes:et}}function A(M,b){const C=[];for(const I in M)C.push({time:parseFloat(I),value:M[I]});C.sort(T);for(let I=0;I<16;I++)U(C,I,b.elements[I]);return C;function T(I,re){return I.time-re.time}}const L=new P,O=new P,w=new bi;function S(M,b){const C=M.keyframes,T=M.name,I=[],re=[],le=[],Fe=[];for(let Se=0,Ie=C.length;Se<Ie;Se++){const je=C[Se],ge=je.time,Xe=je.value;H.fromArray(Xe).transpose(),H.decompose(L,w,O),I.push(ge),re.push(L.x,L.y,L.z),le.push(w.x,w.y,w.z,w.w),Fe.push(O.x,O.y,O.z)}return re.length>0&&b.push(new Oi(T+".position",I,re)),le.length>0&&b.push(new ss(T+".quaternion",I,le)),Fe.length>0&&b.push(new Oi(T+".scale",I,Fe)),b}function U(M,b,C){let T,I=!0,re,le;for(re=0,le=M.length;re<le;re++)T=M[re],T.value[b]===void 0?T.value[b]=null:I=!1;if(I===!0)for(re=0,le=M.length;re<le;re++)T=M[re],T.value[b]=C;else Z(M,b)}function Z(M,b){let C,T;for(let I=0,re=M.length;I<re;I++){const le=M[I];if(le.value[b]===null){if(C=K(M,I,b),T=se(M,I,b),C===null){le.value[b]=T.value[b];continue}if(T===null){le.value[b]=C.value[b];continue}fe(le,C,T,b)}}}function K(M,b,C){for(;b>=0;){const T=M[b];if(T.value[C]!==null)return T;b--}return null}function se(M,b,C){for(;b<M.length;){const T=M[b];if(T.value[C]!==null)return T;b++}return null}function fe(M,b,C,T){if(C.time-b.time===0){M.value[T]=b.value[T];return}M.value[T]=(M.time-b.time)*(C.value[T]-b.value[T])/(C.time-b.time)+b.value[T]}function z(M){const b={name:M.getAttribute("id")||"default",start:parseFloat(M.getAttribute("start")||0),end:parseFloat(M.getAttribute("end")||0),animations:[]};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"instance_animation":b.animations.push(a(I.getAttribute("url")));break}}tt.clips[M.getAttribute("id")]=b}function de(M){const b=[],C=M.name,T=M.end-M.start||-1,I=M.animations;for(let re=0,le=I.length;re<le;re++){const Fe=v(I[re]);for(let Se=0,Ie=Fe.length;Se<Ie;Se++)b.push(Fe[Se])}return new kc(C,T,b)}function $(M){return _(tt.clips[M],de)}function D(M){const b={};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"skin":b.id=a(I.getAttribute("source")),b.skin=B(I);break;case"morph":b.id=a(I.getAttribute("source")),console.warn("THREE.ColladaLoader: Morph target animation not supported yet.");break}}tt.controllers[M.getAttribute("id")]=b}function B(M){const b={sources:{}};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"bind_shape_matrix":b.bindShapeMatrix=s(I.textContent);break;case"source":const re=I.getAttribute("id");b.sources[re]=ae(I);break;case"joints":b.joints=j(I);break;case"vertex_weights":b.vertexWeights=X(I);break}}return b}function j(M){const b={inputs:{}};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"input":const re=I.getAttribute("semantic"),le=a(I.getAttribute("source"));b.inputs[re]=le;break}}return b}function X(M){const b={inputs:{}};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"input":const re=I.getAttribute("semantic"),le=a(I.getAttribute("source")),Fe=parseInt(I.getAttribute("offset"));b.inputs[re]={id:le,offset:Fe};break;case"vcount":b.vcount=o(I.textContent);break;case"v":b.v=o(I.textContent);break}}return b}function Y(M){const b={id:M.id},C=tt.geometries[b.id];return M.skin!==void 0&&(b.skin=k(M.skin),C.sources.skinIndices=b.skin.indices,C.sources.skinWeights=b.skin.weights),b}function k(M){const C={joints:[],indices:{array:[],stride:4},weights:{array:[],stride:4}},T=M.sources,I=M.vertexWeights,re=I.vcount,le=I.v,Fe=I.inputs.JOINT.offset,Se=I.inputs.WEIGHT.offset,Ie=M.sources[M.joints.inputs.JOINT],je=M.sources[M.joints.inputs.INV_BIND_MATRIX],ge=T[I.inputs.WEIGHT.id].array;let Xe=0,Be,et,Ke;for(Be=0,Ke=re.length;Be<Ke;Be++){const Ct=re[Be],Et=[];for(et=0;et<Ct;et++){const Tt=le[Xe+Fe],ri=le[Xe+Se],xn=ge[ri];Et.push({index:Tt,weight:xn}),Xe+=2}for(Et.sort(Gt),et=0;et<4;et++){const Tt=Et[et];Tt!==void 0?(C.indices.array.push(Tt.index),C.weights.array.push(Tt.weight)):(C.indices.array.push(0),C.weights.array.push(0))}}for(M.bindShapeMatrix?C.bindMatrix=new Ze().fromArray(M.bindShapeMatrix).transpose():C.bindMatrix=new Ze().identity(),Be=0,Ke=Ie.array.length;Be<Ke;Be++){const Ct=Ie.array[Be],Et=new Ze().fromArray(je.array,Be*je.stride).transpose();C.joints.push({name:Ct,boneInverse:Et})}return C;function Gt(Ct,Et){return Et.weight-Ct.weight}}function G(M){return _(tt.controllers[M],Y)}function Q(M){const b={init_from:n(M,"init_from")[0].textContent};tt.images[M.getAttribute("id")]=b}function ee(M){return M.build!==void 0?M.build:M.init_from}function oe(M){const b=tt.images[M];return b!==void 0?_(b,ee):(console.warn("THREE.ColladaLoader: Couldn't find image with ID:",M),null)}function ce(M){const b={};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"profile_COMMON":b.profile=Me(I);break}}tt.effects[M.getAttribute("id")]=b}function Me(M){const b={surfaces:{},samplers:{}};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"newparam":$e(I,b);break;case"technique":b.technique=V(I);break;case"extra":b.extra=Ue(I);break}}return b}function $e(M,b){const C=M.getAttribute("sid");for(let T=0,I=M.childNodes.length;T<I;T++){const re=M.childNodes[T];if(re.nodeType===1)switch(re.nodeName){case"surface":b.surfaces[C]=Je(re);break;case"sampler2D":b.samplers[C]=_e(re);break}}}function Je(M){const b={};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"init_from":b.init_from=I.textContent;break}}return b}function _e(M){const b={};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"source":b.source=I.textContent;break}}return b}function V(M){const b={};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"constant":case"lambert":case"blinn":case"phong":b.type=I.nodeName,b.parameters=Pt(I);break;case"extra":b.extra=Ue(I);break}}return b}function Pt(M){const b={};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"emission":case"diffuse":case"specular":case"bump":case"ambient":case"shininess":case"transparency":b[I.nodeName]=be(I);break;case"transparent":b[I.nodeName]={opaque:I.hasAttribute("opaque")?I.getAttribute("opaque"):"A_ONE",data:be(I)};break}}return b}function be(M){const b={};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"color":b[I.nodeName]=s(I.textContent);break;case"float":b[I.nodeName]=parseFloat(I.textContent);break;case"texture":b[I.nodeName]={id:I.getAttribute("texture"),extra:Te(I)};break}}return b}function Te(M){const b={technique:{}};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"extra":xe(I,b);break}}return b}function xe(M,b){for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"technique":ke(I,b);break}}}function ke(M,b){for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"repeatU":case"repeatV":case"offsetU":case"offsetV":b.technique[I.nodeName]=parseFloat(I.textContent);break;case"wrapU":case"wrapV":I.textContent.toUpperCase()==="TRUE"?b.technique[I.nodeName]=1:I.textContent.toUpperCase()==="FALSE"?b.technique[I.nodeName]=0:b.technique[I.nodeName]=parseInt(I.textContent);break;case"bump":b[I.nodeName]=E(I);break}}}function Ue(M){const b={};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"technique":b.technique=N(I);break}}return b}function N(M){const b={};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"double_sided":b[I.nodeName]=parseInt(I.textContent);break;case"bump":b[I.nodeName]=E(I);break}}return b}function E(M){const b={};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"texture":b[I.nodeName]={id:I.getAttribute("texture"),texcoord:I.getAttribute("texcoord"),extra:Te(I)};break}}return b}function J(M){return M}function ue(M){return _(tt.effects[M],J)}function me(M){const b={name:M.getAttribute("name")};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"instance_effect":b.url=a(I.getAttribute("url"));break}}tt.materials[M.getAttribute("id")]=b}function he(M){let b,C=M.slice((M.lastIndexOf(".")-1>>>0)+2);switch(C=C.toLowerCase(),C){case"tga":b=Rn;break;default:b=zn}return b}function Oe(M){const b=ue(M.url),C=b.profile.technique;let T;switch(C.type){case"phong":case"blinn":T=new Ar;break;case"lambert":T=new Fx;break;default:T=new rn;break}T.name=M.name||"";function I(Se,Ie=null){const je=b.profile.samplers[Se.id];let ge=null;if(je!==void 0){const Xe=b.profile.surfaces[je.source];ge=oe(Xe.init_from)}else console.warn("THREE.ColladaLoader: Undefined sampler. Access image directly (see #12530)."),ge=oe(Se.id);if(ge!==null){const Xe=he(ge);if(Xe!==void 0){const Be=Xe.load(ge),et=Se.extra;if(et!==void 0&&et.technique!==void 0&&l(et.technique)===!1){const Ke=et.technique;Be.wrapS=Ke.wrapU?ti:Dn,Be.wrapT=Ke.wrapV?ti:Dn,Be.offset.set(Ke.offsetU||0,Ke.offsetV||0),Be.repeat.set(Ke.repeatU||1,Ke.repeatV||1)}else Be.wrapS=ti,Be.wrapT=ti;return Ie!==null&&(Be.colorSpace=Ie),Be}else return console.warn("THREE.ColladaLoader: Loader for texture %s not found.",ge),null}else return console.warn("THREE.ColladaLoader: Couldn't create texture with ID:",Se.id),null}const re=C.parameters;for(const Se in re){const Ie=re[Se];switch(Se){case"diffuse":Ie.color&&T.color.fromArray(Ie.color),Ie.texture&&(T.map=I(Ie.texture,It));break;case"specular":Ie.color&&T.specular&&T.specular.fromArray(Ie.color),Ie.texture&&(T.specularMap=I(Ie.texture));break;case"bump":Ie.texture&&(T.normalMap=I(Ie.texture));break;case"ambient":Ie.texture&&(T.lightMap=I(Ie.texture,It));break;case"shininess":Ie.float&&T.shininess&&(T.shininess=Ie.float);break;case"emission":Ie.color&&T.emissive&&T.emissive.fromArray(Ie.color),Ie.texture&&(T.emissiveMap=I(Ie.texture,It));break}}gt.toWorkingColorSpace(T.color,It),T.specular&&gt.toWorkingColorSpace(T.specular,It),T.emissive&&gt.toWorkingColorSpace(T.emissive,It);let le=re.transparent,Fe=re.transparency;if(Fe===void 0&&le&&(Fe={float:1}),le===void 0&&Fe&&(le={opaque:"A_ONE",data:{color:[1,1,1,1]}}),le&&Fe)if(le.data.texture)T.transparent=!0;else{const Se=le.data.color;switch(le.opaque){case"A_ONE":T.opacity=Se[3]*Fe.float;break;case"RGB_ZERO":T.opacity=1-Se[0]*Fe.float;break;case"A_ZERO":T.opacity=1-Se[3]*Fe.float;break;case"RGB_ONE":T.opacity=Se[0]*Fe.float;break;default:console.warn('THREE.ColladaLoader: Invalid opaque type "%s" of transparent tag.',le.opaque)}T.opacity<1&&(T.transparent=!0)}if(C.extra!==void 0&&C.extra.technique!==void 0){const Se=C.extra.technique;for(const Ie in Se){const je=Se[Ie];switch(Ie){case"double_sided":T.side=je===1?sn:ln;break;case"bump":T.normalMap=I(je.texture),T.normalScale=new Ge(1,1);break}}}return T}function Ee(M){return _(tt.materials[M],Oe)}function De(M){const b={name:M.getAttribute("name")};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"optics":b.optics=_t(I);break}}tt.cameras[M.getAttribute("id")]=b}function _t(M){for(let b=0;b<M.childNodes.length;b++){const C=M.childNodes[b];switch(C.nodeName){case"technique_common":return ye(C)}}return{}}function ye(M){const b={};for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];switch(T.nodeName){case"perspective":case"orthographic":b.technique=T.nodeName,b.parameters=Ne(T);break}}return b}function Ne(M){const b={};for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];switch(T.nodeName){case"xfov":case"yfov":case"xmag":case"ymag":case"znear":case"zfar":case"aspect_ratio":b[T.nodeName]=parseFloat(T.textContent);break}}return b}function Ye(M){let b;switch(M.optics.technique){case"perspective":b=new nn(M.optics.parameters.yfov,M.optics.parameters.aspect_ratio,M.optics.parameters.znear,M.optics.parameters.zfar);break;case"orthographic":let C=M.optics.parameters.ymag,T=M.optics.parameters.xmag;const I=M.optics.parameters.aspect_ratio;T=T===void 0?C*I:T,C=C===void 0?T/I:C,T*=.5,C*=.5,b=new Dr(-T,T,C,-C,M.optics.parameters.znear,M.optics.parameters.zfar);break;default:b=new nn;break}return b.name=M.name||"",b}function Qe(M){const b=tt.cameras[M];return b!==void 0?_(b,Ye):(console.warn("THREE.ColladaLoader: Couldn't find camera with ID:",M),null)}function Re(M){let b={};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"technique_common":b=ct(I);break}}tt.lights[M.getAttribute("id")]=b}function ct(M){const b={};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"directional":case"point":case"spot":case"ambient":b.technique=I.nodeName,b.parameters=it(I)}}return b}function it(M){const b={};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"color":const re=s(I.textContent);b.color=new qe().fromArray(re),gt.toWorkingColorSpace(b.color,It);break;case"falloff_angle":b.falloffAngle=parseFloat(I.textContent);break;case"quadratic_attenuation":const le=parseFloat(I.textContent);b.distance=le?Math.sqrt(1/le):0;break}}return b}function St(M){let b;switch(M.technique){case"directional":b=new Vo;break;case"point":b=new Kd;break;case"spot":b=new $d;break;case"ambient":b=new Zd;break}return M.parameters.color&&b.color.copy(M.parameters.color),M.parameters.distance&&(b.distance=M.parameters.distance),b}function W(M){const b=tt.lights[M];return b!==void 0?_(b,St):(console.warn("THREE.ColladaLoader: Couldn't find light with ID:",M),null)}function Ae(M){const b={name:M.getAttribute("name"),sources:{},vertices:{},primitives:[]},C=n(M,"mesh")[0];if(C!==void 0){for(let T=0;T<C.childNodes.length;T++){const I=C.childNodes[T];if(I.nodeType!==1)continue;const re=I.getAttribute("id");switch(I.nodeName){case"source":b.sources[re]=ae(I);break;case"vertices":b.vertices=pe(I);break;case"polygons":console.warn("THREE.ColladaLoader: Unsupported primitive type: ",I.nodeName);break;case"lines":case"linestrips":case"polylist":case"triangles":b.primitives.push(Pe(I));break;default:console.log(I)}}tt.geometries[M.getAttribute("id")]=b}}function ae(M){const b={array:[],stride:3};for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];if(T.nodeType===1)switch(T.nodeName){case"float_array":b.array=s(T.textContent);break;case"Name_array":b.array=i(T.textContent);break;case"technique_common":const I=n(T,"accessor")[0];I!==void 0&&(b.stride=parseInt(I.getAttribute("stride")));break}}return b}function pe(M){const b={};for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];T.nodeType===1&&(b[T.getAttribute("semantic")]=a(T.getAttribute("source")))}return b}function Pe(M){const b={type:M.nodeName,material:M.getAttribute("material"),count:parseInt(M.getAttribute("count")),inputs:{},stride:0,hasUV:!1};for(let C=0,T=M.childNodes.length;C<T;C++){const I=M.childNodes[C];if(I.nodeType===1)switch(I.nodeName){case"input":const re=a(I.getAttribute("source")),le=I.getAttribute("semantic"),Fe=parseInt(I.getAttribute("offset")),Se=parseInt(I.getAttribute("set")),Ie=Se>0?le+Se:le;b.inputs[Ie]={id:re,offset:Fe},b.stride=Math.max(b.stride,Fe+1),le==="TEXCOORD"&&(b.hasUV=!0);break;case"vcount":b.vcount=o(I.textContent);break;case"p":b.p=o(I.textContent);break}}return b}function Le(M){const b={};for(let C=0;C<M.length;C++){const T=M[C];b[T.type]===void 0&&(b[T.type]=[]),b[T.type].push(T)}return b}function lt(M){let b=0;for(let C=0,T=M.length;C<T;C++)M[C].hasUV===!0&&b++;b>0&&b<M.length&&(M.uvsNeedsFix=!0)}function Ot(M){const b={},C=M.sources,T=M.vertices,I=M.primitives;if(I.length===0)return{};const re=Le(I);for(const le in re){const Fe=re[le];lt(Fe),b[le]=$t(Fe,C,T)}return b}function $t(M,b,C){const T={},I={array:[],stride:0},re={array:[],stride:0},le={array:[],stride:0},Fe={array:[],stride:0},Se={array:[],stride:0},Ie={array:[],stride:4},je={array:[],stride:4},ge=new at,Xe=[];let Be=0;for(let et=0;et<M.length;et++){const Ke=M[et],Gt=Ke.inputs;let Ct=0;switch(Ke.type){case"lines":case"linestrips":Ct=Ke.count*2;break;case"triangles":Ct=Ke.count*3;break;case"polylist":for(let Et=0;Et<Ke.count;Et++){const Tt=Ke.vcount[Et];switch(Tt){case 3:Ct+=3;break;case 4:Ct+=6;break;default:Ct+=(Tt-2)*3;break}}break;default:console.warn("THREE.ColladaLoader: Unknow primitive type:",Ke.type)}ge.addGroup(Be,Ct,et),Be+=Ct,Ke.material&&Xe.push(Ke.material);for(const Et in Gt){const Tt=Gt[Et];switch(Et){case"VERTEX":for(const ri in C){const xn=C[ri];switch(ri){case"POSITION":const as=I.array.length;if(ut(Ke,b[xn],Tt.offset,I.array),I.stride=b[xn].stride,b.skinWeights&&b.skinIndices&&(ut(Ke,b.skinIndices,Tt.offset,Ie.array),ut(Ke,b.skinWeights,Tt.offset,je.array)),Ke.hasUV===!1&&M.uvsNeedsFix===!0){const au=(I.array.length-as)/I.stride;for(let pl=0;pl<au;pl++)le.array.push(0,0)}break;case"NORMAL":ut(Ke,b[xn],Tt.offset,re.array),re.stride=b[xn].stride;break;case"COLOR":ut(Ke,b[xn],Tt.offset,Se.array),Se.stride=b[xn].stride;break;case"TEXCOORD":ut(Ke,b[xn],Tt.offset,le.array),le.stride=b[xn].stride;break;case"TEXCOORD1":ut(Ke,b[xn],Tt.offset,Fe.array),le.stride=b[xn].stride;break;default:console.warn('THREE.ColladaLoader: Semantic "%s" not handled in geometry build process.',ri)}}break;case"NORMAL":ut(Ke,b[Tt.id],Tt.offset,re.array),re.stride=b[Tt.id].stride;break;case"COLOR":ut(Ke,b[Tt.id],Tt.offset,Se.array,!0),Se.stride=b[Tt.id].stride;break;case"TEXCOORD":ut(Ke,b[Tt.id],Tt.offset,le.array),le.stride=b[Tt.id].stride;break;case"TEXCOORD1":ut(Ke,b[Tt.id],Tt.offset,Fe.array),Fe.stride=b[Tt.id].stride;break}}}return I.array.length>0&&ge.setAttribute("position",new ot(I.array,I.stride)),re.array.length>0&&ge.setAttribute("normal",new ot(re.array,re.stride)),Se.array.length>0&&ge.setAttribute("color",new ot(Se.array,Se.stride)),le.array.length>0&&ge.setAttribute("uv",new ot(le.array,le.stride)),Fe.array.length>0&&ge.setAttribute("uv1",new ot(Fe.array,Fe.stride)),Ie.array.length>0&&ge.setAttribute("skinIndex",new ot(Ie.array,Ie.stride)),je.array.length>0&&ge.setAttribute("skinWeight",new ot(je.array,je.stride)),T.data=ge,T.type=M[0].type,T.materialKeys=Xe,T}function ut(M,b,C,T,I=!1){const re=M.p,le=M.stride,Fe=M.vcount;function Se(ge){let Xe=re[ge+C]*je;const Be=Xe+je;for(;Xe<Be;Xe++)T.push(Ie[Xe]);if(I){const et=T.length-je-1;zi.setRGB(T[et+0],T[et+1],T[et+2],It),T[et+0]=zi.r,T[et+1]=zi.g,T[et+2]=zi.b}}const Ie=b.array,je=b.stride;if(M.vcount!==void 0){let ge=0;for(let Xe=0,Be=Fe.length;Xe<Be;Xe++){const et=Fe[Xe];if(et===4){const Ke=ge+le*0,Gt=ge+le*1,Ct=ge+le*2,Et=ge+le*3;Se(Ke),Se(Gt),Se(Et),Se(Gt),Se(Ct),Se(Et)}else if(et===3){const Ke=ge+le*0,Gt=ge+le*1,Ct=ge+le*2;Se(Ke),Se(Gt),Se(Ct)}else if(et>4)for(let Ke=1,Gt=et-2;Ke<=Gt;Ke++){const Ct=ge+le*0,Et=ge+le*Ke,Tt=ge+le*(Ke+1);Se(Ct),Se(Et),Se(Tt)}ge+=le*et}}else for(let ge=0,Xe=re.length;ge<Xe;ge+=le)Se(ge)}function gn(M){return _(tt.geometries[M],Ot)}function kn(M){const b={name:M.getAttribute("name")||"",joints:{},links:[]};for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];if(T.nodeType===1)switch(T.nodeName){case"technique_common":si(T,b);break}}tt.kinematicsModels[M.getAttribute("id")]=b}function Ur(M){return M.build!==void 0?M.build:M}function Or(M){return _(tt.kinematicsModels[M],Ur)}function si(M,b){for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];if(T.nodeType===1)switch(T.nodeName){case"joint":b.joints[T.getAttribute("sid")]=$s(T);break;case"link":b.links.push(Ks(T));break}}}function $s(M){let b;for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];if(T.nodeType===1)switch(T.nodeName){case"prismatic":case"revolute":b=kr(T);break}}return b}function kr(M){const b={sid:M.getAttribute("sid"),name:M.getAttribute("name")||"",axis:new P,limits:{min:0,max:0},type:M.nodeName,static:!1,zeroPosition:0,middlePosition:0};for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];if(T.nodeType===1)switch(T.nodeName){case"axis":const I=s(T.textContent);b.axis.fromArray(I);break;case"limits":const re=T.getElementsByTagName("max")[0],le=T.getElementsByTagName("min")[0];b.limits.max=parseFloat(re.textContent),b.limits.min=parseFloat(le.textContent);break}}return b.limits.min>=b.limits.max&&(b.static=!0),b.middlePosition=(b.limits.min+b.limits.max)/2,b}function Ks(M){const b={sid:M.getAttribute("sid"),name:M.getAttribute("name")||"",attachments:[],transforms:[]};for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];if(T.nodeType===1)switch(T.nodeName){case"attachment_full":b.attachments.push(rs(T));break;case"matrix":case"translate":case"rotate":b.transforms.push(Zs(T));break}}return b}function rs(M){const b={joint:M.getAttribute("joint").split("/").pop(),transforms:[],links:[]};for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];if(T.nodeType===1)switch(T.nodeName){case"link":b.links.push(Ks(T));break;case"matrix":case"translate":case"rotate":b.transforms.push(Zs(T));break}}return b}function Zs(M){const b={type:M.nodeName},C=s(M.textContent);switch(b.type){case"matrix":b.obj=new Ze,b.obj.fromArray(C).transpose();break;case"translate":b.obj=new P,b.obj.fromArray(C);break;case"rotate":b.obj=new P,b.obj.fromArray(C),b.angle=Zi.degToRad(C[3]);break}return b}function os(M){const b={name:M.getAttribute("name")||"",rigidBodies:{}};for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];if(T.nodeType===1)switch(T.nodeName){case"rigid_body":b.rigidBodies[T.getAttribute("name")]={},Br(T,b.rigidBodies[T.getAttribute("name")]);break}}tt.physicsModels[M.getAttribute("id")]=b}function Br(M,b){for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];if(T.nodeType===1)switch(T.nodeName){case"technique_common":zr(T,b);break}}}function zr(M,b){for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];if(T.nodeType===1)switch(T.nodeName){case"inertia":b.inertia=s(T.textContent);break;case"mass":b.mass=s(T.textContent)[0];break}}}function Jo(M){const b={bindJointAxis:[]};for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];if(T.nodeType===1)switch(T.nodeName){case"bind_joint_axis":b.bindJointAxis.push(Qo(T));break}}tt.kinematicsScenes[a(M.getAttribute("url"))]=b}function Qo(M){const b={target:M.getAttribute("target").split("/").pop()};for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];if(T.nodeType===1)switch(T.nodeName){case"axis":const I=T.getElementsByTagName("param")[0];b.axis=I.textContent;const re=b.axis.split("inst_").pop().split("axis")[0];b.jointIndex=re.substring(0,re.length-1);break}}return b}function ea(M){return M.build!==void 0?M.build:M}function R(M){return _(tt.kinematicsScenes[M],ea)}function q(){const M=Object.keys(tt.kinematicsModels)[0],b=Object.keys(tt.kinematicsScenes)[0],C=Object.keys(tt.visualScenes)[0];if(M===void 0||b===void 0)return;const T=Or(M),I=R(b),re=Mt(C),le=I.bindJointAxis,Fe={};for(let je=0,ge=le.length;je<ge;je++){const Xe=le[je],Be=st.querySelector('[sid="'+Xe.target+'"]');if(Be){const et=Be.parentElement;Se(Xe.jointIndex,et)}}function Se(je,ge){const Xe=ge.getAttribute("name"),Be=T.joints[je];re.traverse(function(et){et.name===Xe&&(Fe[je]={object:et,transforms:ne(ge),joint:Be,position:Be.zeroPosition})})}const Ie=new Ze;fl={joints:T&&T.joints,getJointValue:function(je){const ge=Fe[je];if(ge)return ge.position;console.warn("THREE.ColladaLoader: Joint "+je+" doesn't exist.")},setJointValue:function(je,ge){const Xe=Fe[je];if(Xe){const Be=Xe.joint;if(ge>Be.limits.max||ge<Be.limits.min)console.warn("THREE.ColladaLoader: Joint "+je+" value "+ge+" outside of limits (min: "+Be.limits.min+", max: "+Be.limits.max+").");else if(Be.static)console.warn("THREE.ColladaLoader: Joint "+je+" is static.");else{const et=Xe.object,Ke=Be.axis,Gt=Xe.transforms;H.identity();for(let Ct=0;Ct<Gt.length;Ct++){const Et=Gt[Ct];if(Et.sid&&Et.sid.indexOf(je)!==-1)switch(Be.type){case"revolute":H.multiply(Ie.makeRotationAxis(Ke,Zi.degToRad(ge)));break;case"prismatic":H.multiply(Ie.makeTranslation(Ke.x*ge,Ke.y*ge,Ke.z*ge));break;default:console.warn("THREE.ColladaLoader: Unknown joint type: "+Be.type);break}else switch(Et.type){case"matrix":H.multiply(Et.obj);break;case"translate":H.multiply(Ie.makeTranslation(Et.obj.x,Et.obj.y,Et.obj.z));break;case"scale":H.scale(Et.obj);break;case"rotate":H.multiply(Ie.makeRotationAxis(Et.obj,Et.angle));break}}et.matrix.copy(H),et.matrix.decompose(et.position,et.quaternion,et.scale),Fe[je].position=ge}}else console.log("THREE.ColladaLoader: "+je+" does not exist.")}}}function ne(M){const b=[],C=st.querySelector('[id="'+M.id+'"]');for(let T=0;T<C.childNodes.length;T++){const I=C.childNodes[T];if(I.nodeType!==1)continue;let re,le;switch(I.nodeName){case"matrix":re=s(I.textContent);const Fe=new Ze().fromArray(re).transpose();b.push({sid:I.getAttribute("sid"),type:I.nodeName,obj:Fe});break;case"translate":case"scale":re=s(I.textContent),le=new P().fromArray(re),b.push({sid:I.getAttribute("sid"),type:I.nodeName,obj:le});break;case"rotate":re=s(I.textContent),le=new P().fromArray(re);const Se=Zi.degToRad(re[3]);b.push({sid:I.getAttribute("sid"),type:I.nodeName,obj:le,angle:Se});break}}return b}function ie(M){const b=M.getElementsByTagName("node");for(let C=0;C<b.length;C++){const T=b[C];T.hasAttribute("id")===!1&&T.setAttribute("id",c())}}const H=new Ze,ve=new P;function Ce(M){const b={name:M.getAttribute("name")||"",type:M.getAttribute("type"),id:M.getAttribute("id"),sid:M.getAttribute("sid"),matrix:new Ze,nodes:[],instanceCameras:[],instanceControllers:[],instanceLights:[],instanceGeometries:[],instanceNodes:[],transforms:{}};for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];if(T.nodeType!==1)continue;let I;switch(T.nodeName){case"node":b.nodes.push(T.getAttribute("id")),Ce(T);break;case"instance_camera":b.instanceCameras.push(a(T.getAttribute("url")));break;case"instance_controller":b.instanceControllers.push(ze(T));break;case"instance_light":b.instanceLights.push(a(T.getAttribute("url")));break;case"instance_geometry":b.instanceGeometries.push(ze(T));break;case"instance_node":b.instanceNodes.push(a(T.getAttribute("url")));break;case"matrix":I=s(T.textContent),b.matrix.multiply(H.fromArray(I).transpose()),b.transforms[T.getAttribute("sid")]=T.nodeName;break;case"translate":I=s(T.textContent),ve.fromArray(I),b.matrix.multiply(H.makeTranslation(ve.x,ve.y,ve.z)),b.transforms[T.getAttribute("sid")]=T.nodeName;break;case"rotate":I=s(T.textContent);const re=Zi.degToRad(I[3]);b.matrix.multiply(H.makeRotationAxis(ve.fromArray(I),re)),b.transforms[T.getAttribute("sid")]=T.nodeName;break;case"scale":I=s(T.textContent),b.matrix.scale(ve.fromArray(I)),b.transforms[T.getAttribute("sid")]=T.nodeName;break;case"extra":break;default:console.log(T)}}return Dt(b.id)?console.warn("THREE.ColladaLoader: There is already a node with ID %s. Exclude current node from further processing.",b.id):tt.nodes[b.id]=b,b}function ze(M){const b={id:a(M.getAttribute("url")),materials:{},skeletons:[]};for(let C=0;C<M.childNodes.length;C++){const T=M.childNodes[C];switch(T.nodeName){case"bind_material":const I=T.getElementsByTagName("instance_material");for(let re=0;re<I.length;re++){const le=I[re],Fe=le.getAttribute("symbol"),Se=le.getAttribute("target");b.materials[Fe]=a(Se)}break;case"skeleton":b.skeletons.push(a(T.textContent));break}}return b}function He(M,b){const C=[],T=[];let I,re,le;for(I=0;I<M.length;I++){const Ie=M[I];let je;if(Dt(Ie))je=Wt(Ie),nt(je,b,C);else if(Bn(Ie)){const Xe=tt.visualScenes[Ie].children;for(let Be=0;Be<Xe.length;Be++){const et=Xe[Be];if(et.type==="JOINT"){const Ke=Wt(et.id);nt(Ke,b,C)}}}else console.error("THREE.ColladaLoader: Unable to find root bone of skeleton with ID:",Ie)}for(I=0;I<b.length;I++)for(re=0;re<C.length;re++)if(le=C[re],le.bone.name===b[I].name){T[I]=le,le.processed=!0;break}for(I=0;I<C.length;I++)le=C[I],le.processed===!1&&(T.push(le),le.processed=!0);const Fe=[],Se=[];for(I=0;I<T.length;I++)le=T[I],Fe.push(le.bone),Se.push(le.boneInverse);return new Ko(Fe,Se)}function nt(M,b,C){M.traverse(function(T){if(T.isBone===!0){let I;for(let re=0;re<b.length;re++){const le=b[re];if(le.name===T.name){I=le.boneInverse;break}}I===void 0&&(I=new Ze),C.push({bone:T,boneInverse:I,processed:!1})}})}function ht(M){const b=[],C=M.matrix,T=M.nodes,I=M.type,re=M.instanceCameras,le=M.instanceControllers,Fe=M.instanceLights,Se=M.instanceGeometries,Ie=M.instanceNodes;for(let ge=0,Xe=T.length;ge<Xe;ge++)b.push(Wt(T[ge]));for(let ge=0,Xe=re.length;ge<Xe;ge++){const Be=Qe(re[ge]);Be!==null&&b.push(Be.clone())}for(let ge=0,Xe=le.length;ge<Xe;ge++){const Be=le[ge],et=G(Be.id),Ke=gn(et.id),Gt=At(Ke,Be.materials),Ct=Be.skeletons,Et=et.skin.joints,Tt=He(Ct,Et);for(let ri=0,xn=Gt.length;ri<xn;ri++){const as=Gt[ri];as.isSkinnedMesh&&(as.bind(Tt,et.skin.bindMatrix),as.normalizeSkinWeights()),b.push(as)}}for(let ge=0,Xe=Fe.length;ge<Xe;ge++){const Be=W(Fe[ge]);Be!==null&&b.push(Be.clone())}for(let ge=0,Xe=Se.length;ge<Xe;ge++){const Be=Se[ge],et=gn(Be.id),Ke=At(et,Be.materials);for(let Gt=0,Ct=Ke.length;Gt<Ct;Gt++)b.push(Ke[Gt])}for(let ge=0,Xe=Ie.length;ge<Xe;ge++)b.push(Wt(Ie[ge]).clone());let je;if(T.length===0&&b.length===1)je=b[0];else{je=I==="JOINT"?new sl:new Bt;for(let ge=0;ge<b.length;ge++)je.add(b[ge])}return je.name=I==="JOINT"?M.sid:M.name,je.matrix.copy(C),je.matrix.decompose(je.position,je.quaternion,je.scale),je}const Ve=new rn({name:Cn.DEFAULT_MATERIAL_NAME,color:16711935});function bt(M,b){const C=[];for(let T=0,I=M.length;T<I;T++){const re=b[M[T]];re===void 0?(console.warn("THREE.ColladaLoader: Material with key %s not found. Apply fallback material.",M[T]),C.push(Ve)):C.push(Ee(re))}return C}function At(M,b){const C=[];for(const T in M){const I=M[T],re=bt(I.materialKeys,b);if(re.length===0&&(T==="lines"||T==="linestrips"?re.push(new zt):re.push(new Ar)),T==="lines"||T==="linestrips")for(let Ie=0,je=re.length;Ie<je;Ie++){const ge=re[Ie];if(ge.isMeshPhongMaterial===!0||ge.isMeshLambertMaterial===!0){const Xe=new zt;Xe.color.copy(ge.color),Xe.opacity=ge.opacity,Xe.transparent=ge.transparent,re[Ie]=Xe}}const le=I.data.attributes.skinIndex!==void 0,Fe=re.length===1?re[0]:re;let Se;switch(T){case"lines":Se=new Vt(I.data,Fe);break;case"linestrips":Se=new An(I.data,Fe);break;case"triangles":case"polylist":le?Se=new Xd(I.data,Fe):Se=new rt(I.data,Fe);break}C.push(Se)}return C}function Dt(M){return tt.nodes[M]!==void 0}function Wt(M){return _(tt.nodes[M],ht)}function wt(M){const b={name:M.getAttribute("name"),children:[]};ie(M);const C=n(M,"node");for(let T=0;T<C.length;T++)b.children.push(Ce(C[T]));tt.visualScenes[M.getAttribute("id")]=b}function We(M){const b=new Bt;b.name=M.name;const C=M.children;for(let T=0;T<C.length;T++){const I=C[T];b.add(Wt(I.id))}return b}function Bn(M){return tt.visualScenes[M]!==void 0}function Mt(M){return _(tt.visualScenes[M],We)}function Mn(M){const b=n(M,"instance_visual_scene")[0];return Mt(a(b.getAttribute("url")))}function Mi(){const M=tt.clips;if(l(M)===!0){if(l(tt.animations)===!1){const b=[];for(const C in tt.animations){const T=v(C);for(let I=0,re=T.length;I<re;I++)b.push(T[I])}Gr.push(new kc("default",-1,b))}}else for(const b in M)Gr.push($(b))}function hn(M){let b="";const C=[M];for(;C.length;){const T=C.shift();T.nodeType===Node.TEXT_NODE?b+=T.textContent:(b+=`
`,C.push.apply(C,T.childNodes))}return b.trim()}if(e.length===0)return{scene:new Hd};const Si=new DOMParser().parseFromString(e,"application/xml"),st=n(Si,"COLLADA")[0],_n=Si.getElementsByTagName("parsererror")[0];if(_n!==void 0){const M=n(_n,"div")[0];let b;return M?b=M.textContent:b=hn(_n),console.error(`THREE.ColladaLoader: Failed to parse collada file.
`,b),null}const Bi=st.getAttribute("version");console.debug("THREE.ColladaLoader: File version",Bi);const dn=h(n(st,"asset")[0]),zn=new al(this.manager);zn.setPath(this.resourcePath||t).setCrossOrigin(this.crossOrigin);let Rn;hd&&(Rn=new hd(this.manager),Rn.setPath(this.resourcePath||t));const zi=new qe,Gr=[];let fl={},ou=0;const tt={animations:{},clips:{},controllers:{},images:{},effects:{},materials:{},cameras:{},lights:{},geometries:{},nodes:{},visualScenes:{},kinematicsModels:{},physicsModels:{},kinematicsScenes:{}};m(st,"library_animations","animation",f),m(st,"library_animation_clips","animation_clip",z),m(st,"library_controllers","controller",D),m(st,"library_images","image",Q),m(st,"library_effects","effect",ce),m(st,"library_materials","material",me),m(st,"library_cameras","camera",De),m(st,"library_lights","light",Re),m(st,"library_geometries","geometry",Ae),m(st,"library_nodes","node",Ce),m(st,"library_visual_scenes","visual_scene",wt),m(st,"library_kinematics_models","kinematics_model",kn),m(st,"library_physics_models","physics_model",os),m(st,"scene","instance_kinematics_scene",Jo),g(tt.animations,y),g(tt.clips,de),g(tt.controllers,Y),g(tt.images,ee),g(tt.effects,J),g(tt.materials,Oe),g(tt.cameras,Ye),g(tt.lights,St),g(tt.geometries,Ot),g(tt.visualScenes,We),Mi(),q();const Hr=Mn(n(st,"scene")[0]);return Hr.animations=Gr,dn.upAxis==="Z_UP"&&(console.warn("THREE.ColladaLoader: You are loading an asset with a Z-UP coordinate system. The loader just rotates the asset to transform it into Y-UP. The vertex data are not converted, see #24289."),Hr.rotation.set(-Math.PI/2,0,0)),Hr.scale.multiplyScalar(dn.unit),{get animations(){return console.warn("THREE.ColladaLoader: Please access animations over scene.animations now."),Gr},kinematics:fl,library:tt,scene:Hr}}}const yn=new qe;class Bv extends Cn{constructor(e){super(e),this.propertyNameMapping={},this.customPropertyMapping={}}load(e,t,n,i){const s=this,o=new ki(this.manager);o.setPath(this.path),o.setResponseType("arraybuffer"),o.setRequestHeader(this.requestHeader),o.setWithCredentials(this.withCredentials),o.load(e,function(a){try{t(s.parse(a))}catch(c){i?i(c):console.error(c),s.manager.itemError(e)}},n,i)}setPropertyNameMapping(e){this.propertyNameMapping=e}setCustomPropertyNameMapping(e){this.customPropertyMapping=e}parse(e){function t(f,p=0){const x=/^ply([\s\S]*)end_header(\r\n|\r|\n)/;let y="";const v=x.exec(f);v!==null&&(y=v[1]);const F={comments:[],elements:[],headerLength:p,objInfo:""},A=y.split(/\r\n|\r|\n/);let L;function O(w,S){const U={type:w[0]};return U.type==="list"?(U.name=w[3],U.countType=w[1],U.itemType=w[2]):U.name=w[1],U.name in S&&(U.name=S[U.name]),U}for(let w=0;w<A.length;w++){let S=A[w];if(S=S.trim(),S==="")continue;const U=S.split(/\s+/),Z=U.shift();switch(S=U.join(" "),Z){case"format":F.format=U[0],F.version=U[1];break;case"comment":F.comments.push(S);break;case"element":L!==void 0&&F.elements.push(L),L={},L.name=U[0],L.count=parseInt(U[1]),L.properties=[];break;case"property":L.properties.push(O(U,_.propertyNameMapping));break;case"obj_info":F.objInfo=S;break;default:console.log("unhandled",Z,U)}}return L!==void 0&&F.elements.push(L),F}function n(f,p){switch(p){case"char":case"uchar":case"short":case"ushort":case"int":case"uint":case"int8":case"uint8":case"int16":case"uint16":case"int32":case"uint32":return parseInt(f);case"float":case"double":case"float32":case"float64":return parseFloat(f)}}function i(f,p){const x={};for(let y=0;y<f.length;y++){if(p.empty())return null;if(f[y].type==="list"){const v=[],F=n(p.next(),f[y].countType);for(let A=0;A<F;A++){if(p.empty())return null;v.push(n(p.next(),f[y].itemType))}x[f[y].name]=v}else x[f[y].name]=n(p.next(),f[y].type)}return x}function s(){const f={indices:[],vertices:[],normals:[],uvs:[],faceVertexUvs:[],colors:[],faceVertexColors:[]};for(const p of Object.keys(_.customPropertyMapping))f[p]=[];return f}function o(f){const p=f.map(y=>y.name);function x(y){for(let v=0,F=y.length;v<F;v++){const A=y[v];if(p.includes(A))return A}return null}return{attrX:x(["x","px","posx"])||"x",attrY:x(["y","py","posy"])||"y",attrZ:x(["z","pz","posz"])||"z",attrNX:x(["nx","normalx"]),attrNY:x(["ny","normaly"]),attrNZ:x(["nz","normalz"]),attrS:x(["s","u","texture_u","tx"]),attrT:x(["t","v","texture_v","ty"]),attrR:x(["red","diffuse_red","r","diffuse_r"]),attrG:x(["green","diffuse_green","g","diffuse_g"]),attrB:x(["blue","diffuse_blue","b","diffuse_b"])}}function a(f,p){const x=s(),y=/end_header\s+(\S[\s\S]*\S|\S)\s*$/;let v,F;(F=y.exec(f))!==null?v=F[1].split(/\s+/):v=[];const A=new zv(v);e:for(let L=0;L<p.elements.length;L++){const O=p.elements[L],w=o(O.properties);for(let S=0;S<O.count;S++){const U=i(O.properties,A);if(!U)break e;l(x,O.name,U,w)}}return c(x)}function c(f){let p=new at;f.indices.length>0&&p.setIndex(f.indices),p.setAttribute("position",new ot(f.vertices,3)),f.normals.length>0&&p.setAttribute("normal",new ot(f.normals,3)),f.uvs.length>0&&p.setAttribute("uv",new ot(f.uvs,2)),f.colors.length>0&&p.setAttribute("color",new ot(f.colors,3)),(f.faceVertexUvs.length>0||f.faceVertexColors.length>0)&&(p=p.toNonIndexed(),f.faceVertexUvs.length>0&&p.setAttribute("uv",new ot(f.faceVertexUvs,2)),f.faceVertexColors.length>0&&p.setAttribute("color",new ot(f.faceVertexColors,3)));for(const x of Object.keys(_.customPropertyMapping))f[x].length>0&&p.setAttribute(x,new ot(f[x],_.customPropertyMapping[x].length));return p.computeBoundingSphere(),p}function l(f,p,x,y){if(p==="vertex"){f.vertices.push(x[y.attrX],x[y.attrY],x[y.attrZ]),y.attrNX!==null&&y.attrNY!==null&&y.attrNZ!==null&&f.normals.push(x[y.attrNX],x[y.attrNY],x[y.attrNZ]),y.attrS!==null&&y.attrT!==null&&f.uvs.push(x[y.attrS],x[y.attrT]),y.attrR!==null&&y.attrG!==null&&y.attrB!==null&&(yn.setRGB(x[y.attrR]/255,x[y.attrG]/255,x[y.attrB]/255,It),f.colors.push(yn.r,yn.g,yn.b));for(const v of Object.keys(_.customPropertyMapping))for(const F of _.customPropertyMapping[v])f[v].push(x[F])}else if(p==="face"){const v=x.vertex_indices||x.vertex_index,F=x.texcoord;v.length===3?(f.indices.push(v[0],v[1],v[2]),F&&F.length===6&&(f.faceVertexUvs.push(F[0],F[1]),f.faceVertexUvs.push(F[2],F[3]),f.faceVertexUvs.push(F[4],F[5]))):v.length===4&&(f.indices.push(v[0],v[1],v[3]),f.indices.push(v[1],v[2],v[3])),y.attrR!==null&&y.attrG!==null&&y.attrB!==null&&(yn.setRGB(x[y.attrR]/255,x[y.attrG]/255,x[y.attrB]/255,It),f.faceVertexColors.push(yn.r,yn.g,yn.b),f.faceVertexColors.push(yn.r,yn.g,yn.b),f.faceVertexColors.push(yn.r,yn.g,yn.b))}}function h(f,p){const x={};let y=0;for(let v=0;v<p.length;v++){const F=p[v],A=F.valueReader;if(F.type==="list"){const L=[],O=F.countReader.read(f+y);y+=F.countReader.size;for(let w=0;w<O;w++)L.push(A.read(f+y)),y+=A.size;x[F.name]=L}else x[F.name]=A.read(f+y),y+=A.size}return[x,y]}function d(f,p,x){function y(v,F,A){switch(F){case"int8":case"char":return{read:L=>v.getInt8(L),size:1};case"uint8":case"uchar":return{read:L=>v.getUint8(L),size:1};case"int16":case"short":return{read:L=>v.getInt16(L,A),size:2};case"uint16":case"ushort":return{read:L=>v.getUint16(L,A),size:2};case"int32":case"int":return{read:L=>v.getInt32(L,A),size:4};case"uint32":case"uint":return{read:L=>v.getUint32(L,A),size:4};case"float32":case"float":return{read:L=>v.getFloat32(L,A),size:4};case"float64":case"double":return{read:L=>v.getFloat64(L,A),size:8}}}for(let v=0,F=f.length;v<F;v++){const A=f[v];A.type==="list"?(A.countReader=y(p,A.countType,x),A.valueReader=y(p,A.itemType,x)):A.valueReader=y(p,A.type,x)}}function u(f,p){const x=s(),y=p.format==="binary_little_endian",v=new DataView(f,p.headerLength);let F,A=0;for(let L=0;L<p.elements.length;L++){const O=p.elements[L],w=O.properties,S=o(w);d(w,v,y);for(let U=0;U<O.count;U++){F=h(A,w),A+=F[1];const Z=F[0];l(x,O.name,Z,S)}}return c(x)}function m(f){let p=0,x=!0,y="";const v=[],F=new TextDecoder().decode(f.subarray(0,5)),A=/^ply\r\n/.test(F);do{const L=String.fromCharCode(f[p++]);L!==`
`&&L!=="\r"?y+=L:(y==="end_header"&&(x=!1),y!==""&&(v.push(y),y=""))}while(x&&p<f.length);return A===!0&&p++,{headerText:v.join("\r")+"\r",headerLength:p}}let g;const _=this;if(e instanceof ArrayBuffer){const f=new Uint8Array(e),{headerText:p,headerLength:x}=m(f),y=t(p,x);if(y.format==="ascii"){const v=new TextDecoder().decode(f);g=a(v,y)}else g=u(e,y)}else g=a(e,t(e));return g}}class zv{constructor(e){this.arr=e,this.i=0}empty(){return this.i>=this.arr.length}next(){return this.arr[this.i++]}}class Gv extends Cn{constructor(e){super(e),this.debug=!1,this.group=null,this.materials=[],this.meshes=[]}load(e,t,n,i){const s=this,o=this.path===""?es.extractUrlBase(e):this.path,a=new ki(this.manager);a.setPath(this.path),a.setResponseType("arraybuffer"),a.setRequestHeader(this.requestHeader),a.setWithCredentials(this.withCredentials),a.load(e,function(c){try{t(s.parse(c,o))}catch(l){i?i(l):console.error(l),s.manager.itemError(e)}},n,i)}parse(e,t){this.group=new Bt,this.materials=[],this.meshes=[],this.readFile(e,t);for(let n=0;n<this.meshes.length;n++)this.group.add(this.meshes[n]);return this.group}readFile(e,t){const n=new DataView(e),i=new ul(n,0,this.debugMessage);if(i.id===Vv||i.id===Wv||i.id===Hv){let s=i.readChunk();for(;s;){if(s.id===Xv){const o=s.readDWord();this.debugMessage("3DS file version: "+o)}else s.id===Jv?this.readMeshData(s,t):this.debugMessage("Unknown main chunk: "+s.hexId);s=i.readChunk()}}this.debugMessage("Parsed "+this.meshes.length+" meshes")}readMeshData(e,t){let n=e.readChunk();for(;n;){if(n.id===Qv){const i=+n.readDWord();this.debugMessage("Mesh Version: "+i)}else if(n.id===ey){const i=n.readFloat();this.debugMessage("Master scale: "+i),this.group.scale.set(i,i,i)}else n.id===by?(this.debugMessage("Named Object"),this.readNamedObject(n)):n.id===ty?(this.debugMessage("Material"),this.readMaterialEntry(n,t)):this.debugMessage("Unknown MDATA chunk: "+n.hexId);n=e.readChunk()}}readNamedObject(e){const t=e.readString();let n=e.readChunk();for(;n;){if(n.id===My){const i=this.readMesh(n);i.name=t,this.meshes.push(i)}else this.debugMessage("Unknown named object chunk: "+n.hexId);n=e.readChunk()}}readMaterialEntry(e,t){let n=e.readChunk();const i=new Ar;for(;n;){if(n.id===ny)i.name=n.readString(),this.debugMessage("   Name: "+i.name);else if(n.id===hy)this.debugMessage("   Wireframe"),i.wireframe=!0;else if(n.id===dy){const s=n.readByte();i.wireframeLinewidth=s,this.debugMessage("   Wireframe Thickness: "+s)}else if(n.id===cy)i.side=sn,this.debugMessage("   DoubleSided");else if(n.id===ly)this.debugMessage("   Additive Blending"),i.blending=Ya;else if(n.id===sy)this.debugMessage("   Diffuse Color"),i.color=this.readColor(n);else if(n.id===ry)this.debugMessage("   Specular Color"),i.specular=this.readColor(n);else if(n.id===iy)this.debugMessage("   Ambient color"),i.color=this.readColor(n);else if(n.id===oy){const s=this.readPercentage(n);i.shininess=s*100,this.debugMessage("   Shininess : "+s)}else if(n.id===ay){const s=this.readPercentage(n);i.opacity=1-s,this.debugMessage("  Transparency : "+s),i.transparent=i.opacity<1}else n.id===uy?(this.debugMessage("   ColorMap"),i.map=this.readMap(n,t)):n.id===py?(this.debugMessage("   BumpMap"),i.bumpMap=this.readMap(n,t)):n.id===fy?(this.debugMessage("   OpacityMap"),i.alphaMap=this.readMap(n,t)):n.id===my?(this.debugMessage("   SpecularMap"),i.specularMap=this.readMap(n,t)):this.debugMessage("   Unknown material chunk: "+n.hexId);n=e.readChunk()}this.materials[i.name]=i}readMesh(e){let t=e.readChunk();const n=new at,i=new Ar,s=new rt(n,i);for(s.name="mesh";t;){if(t.id===Sy){const o=t.readWord();this.debugMessage("   Vertex: "+o);const a=[];for(let c=0;c<o;c++)a.push(t.readFloat()),a.push(t.readFloat()),a.push(t.readFloat());n.setAttribute("position",new ot(a,3))}else if(t.id===wy)this.readFaceArray(t,s);else if(t.id===Ty){const o=t.readWord();this.debugMessage("   UV: "+o);const a=[];for(let c=0;c<o;c++)a.push(t.readFloat()),a.push(t.readFloat());n.setAttribute("uv",new ot(a,2))}else if(t.id===Ay){this.debugMessage("   Tranformation Matrix (TODO)");const o=[];for(let l=0;l<12;l++)o[l]=t.readFloat();const a=new Ze;a.elements[0]=o[0],a.elements[1]=o[6],a.elements[2]=o[3],a.elements[3]=o[9],a.elements[4]=o[2],a.elements[5]=o[8],a.elements[6]=o[5],a.elements[7]=o[11],a.elements[8]=o[1],a.elements[9]=o[7],a.elements[10]=o[4],a.elements[11]=o[10],a.elements[12]=0,a.elements[13]=0,a.elements[14]=0,a.elements[15]=1,a.transpose();const c=new Ze;c.copy(a).invert(),n.applyMatrix4(c),a.decompose(s.position,s.quaternion,s.scale)}else this.debugMessage("   Unknown mesh chunk: "+t.hexId);t=e.readChunk()}return n.computeVertexNormals(),s}readFaceArray(e,t){const n=e.readWord();this.debugMessage("   Faces: "+n);const i=[];for(let a=0;a<n;++a)i.push(e.readWord(),e.readWord(),e.readWord()),e.readWord();t.geometry.setIndex(i);let s=0,o=0;for(;!e.endOfChunk;){const a=e.readChunk();if(a.id===Ey){this.debugMessage("      Material Group");const c=this.readMaterialGroup(a),l=c.index.length*3;t.geometry.addGroup(o,l,s),o+=l,s++;const h=this.materials[c.name];Array.isArray(t.material)===!1&&(t.material=[]),h!==void 0&&t.material.push(h)}else this.debugMessage("      Unknown face array chunk: "+a.hexId)}t.material.length===1&&(t.material=t.material[0])}readMap(e,t){let n=e.readChunk(),i={};const s=new al(this.manager);for(s.setPath(this.resourcePath||t).setCrossOrigin(this.crossOrigin);n;){if(n.id===gy){const o=n.readString();i=s.load(o),this.debugMessage("      File: "+t+o)}else n.id===vy?(i.offset.x=n.readFloat(),this.debugMessage("      OffsetX: "+i.offset.x)):n.id===yy?(i.offset.y=n.readFloat(),this.debugMessage("      OffsetY: "+i.offset.y)):n.id===_y?(i.repeat.x=n.readFloat(),this.debugMessage("      RepeatX: "+i.repeat.x)):n.id===xy?(i.repeat.y=n.readFloat(),this.debugMessage("      RepeatY: "+i.repeat.y)):this.debugMessage("      Unknown map chunk: "+n.hexId);n=e.readChunk()}return i}readMaterialGroup(e){const t=e.readString(),n=e.readWord();this.debugMessage("         Name: "+t),this.debugMessage("         Faces: "+n);const i=[];for(let s=0;s<n;++s)i.push(e.readWord());return{name:t,index:i}}readColor(e){const t=e.readChunk(),n=new qe;if(t.id===qv||t.id===Yv){const i=t.readByte(),s=t.readByte(),o=t.readByte();n.setRGB(i/255,s/255,o/255),this.debugMessage("      Color: "+n.r+", "+n.g+", "+n.b)}else if(t.id===jv||t.id===$v){const i=t.readFloat(),s=t.readFloat(),o=t.readFloat();n.setRGB(i,s,o),this.debugMessage("      Color: "+n.r+", "+n.g+", "+n.b)}else this.debugMessage("      Unknown color chunk: "+t.hexId);return n}readPercentage(e){const t=e.readChunk();switch(t.id){case Kv:return t.readShort()/100;case Zv:return t.readFloat();default:return this.debugMessage("      Unknown percentage chunk: "+t.hexId),0}}debugMessage(e){this.debug&&console.log(e)}}class ul{constructor(e,t,n){this.data=e,this.offset=t,this.position=t,this.debugMessage=n,this.debugMessage instanceof Function&&(this.debugMessage=function(){}),this.id=this.readWord(),this.size=this.readDWord(),this.end=this.offset+this.size,this.end>e.byteLength&&this.debugMessage("Bad chunk size for chunk at "+t)}readChunk(){if(this.endOfChunk)return null;try{const e=new ul(this.data,this.position,this.debugMessage);return this.position+=e.size,e}catch{return this.debugMessage("Unable to read chunk at "+this.position),null}}get hexId(){return this.id.toString(16)}get endOfChunk(){return this.position>=this.end}readByte(){const e=this.data.getUint8(this.position,!0);return this.position+=1,e}readFloat(){try{const e=this.data.getFloat32(this.position,!0);return this.position+=4,e}catch(e){return this.debugMessage(e+" "+this.position+" "+this.data.byteLength),0}}readInt(){const e=this.data.getInt32(this.position,!0);return this.position+=4,e}readShort(){const e=this.data.getInt16(this.position,!0);return this.position+=2,e}readDWord(){const e=this.data.getUint32(this.position,!0);return this.position+=4,e}readWord(){const e=this.data.getUint16(this.position,!0);return this.position+=2,e}readString(){let e="",t=this.readByte();for(;t;)e+=String.fromCharCode(t),t=this.readByte();return e}}const Hv=19789,Vv=15786,Wv=49725,Xv=2,jv=16,qv=17,Yv=18,$v=19,Kv=48,Zv=49,Jv=15677,Qv=15678,ey=256,ty=45055,ny=40960,iy=40976,sy=40992,ry=41008,oy=41024,ay=41040,cy=41089,ly=41091,hy=41093,dy=41095,uy=41472,fy=41488,py=41520,my=41476,gy=41728,_y=41812,xy=41814,vy=41816,yy=41818,by=16384,My=16640,Sy=16656,wy=16672,Ey=16688,Ty=16704,Ay=16736,ko={obj:".obj",stl:".stl",gltf:".gltf,.glb",dae:".dae",ply:".ply","3ds":".3ds"},dd={obj:"Wavefront OBJ",stl:"STereoLithography",gltf:"glTF / GLB",dae:"COLLADA",ply:"Stanford PLY","3ds":"3D Studio"},Cy=Object.values(ko).join(",");class Ry{constructor(e){this._importedItems=[],this.defaultFrontMat=new Qi({color:13421772,side:ln,roughness:.6,metalness:.1}),this.defaultBackMat=new Qi({color:8952251,side:Jt,roughness:.7,metalness:.05}),this.defaultEdgeMat=new zt({color:3355494}),this.scene=e,this.importedGroup=new Bt,this.importedGroup.name="imported-group",this.scene.add(this.importedGroup)}async openFileDialog(e){const t=e?ko[e]:Cy;return new Promise(n=>{const i=document.createElement("input");i.type="file",i.accept=t,i.style.display="none",document.body.appendChild(i),i.onchange=async()=>{const s=i.files?.[0];if(document.body.removeChild(i),!s){n(null);return}try{const o=await this.importFile(s,e);n(o)}catch(o){console.error("[FileImporter] 가져오기 실패:",o),alert(`파일 가져오기 실패: ${o.message}`),n(null)}},i.oncancel=()=>{document.body.removeChild(i),n(null)},i.click()})}async importFile(e,t){const n=e.name.split(".").pop()?.toLowerCase()||"",i=t||this.detectFormat(n);if(!i)throw new Error(`지원하지 않는 파일 형식입니다: .${n}`);console.log(`[FileImporter] ${dd[i]} 가져오기: ${e.name}`);const s=await e.arrayBuffer();let o;switch(i){case"obj":o=await this.loadOBJ(e);break;case"stl":o=this.loadSTL(s,e.name);break;case"gltf":o=await this.loadGLTF(s,e.name);break;case"dae":o=await this.loadDAE(e);break;case"ply":o=this.loadPLY(s,e.name);break;case"3ds":o=this.load3DS(s,e.name);break;default:throw new Error(`지원하지 않는 포맷: ${i}`)}let a=0,c=0,l=0;o.traverse(d=>{if(d instanceof rt){a++;const u=d.geometry;c+=u.attributes.position?.count||0,l+=u.index?u.index.count/3:(u.attributes.position?.count||0)/3}}),this.applyDefaultStyle(o),this.importedGroup.add(o);const h={format:i,fileName:e.name,group:o,meshCount:a,vertexCount:c,faceCount:Math.floor(l)};return this._importedItems.push(h),console.log(`[FileImporter] 완료: ${e.name} — ${a} 메시, ${c} 정점, ${Math.floor(l)} 면`),h}detectFormat(e){switch(e){case"obj":return"obj";case"stl":return"stl";case"gltf":case"glb":return"gltf";case"dae":return"dae";case"ply":return"ply";case"3ds":return"3ds";default:return null}}async loadOBJ(e){const t=await e.text(),i=new tv().parse(t),s=new Bt;for(s.name=`import-obj-${e.name}`;i.children.length>0;){const o=i.children[0];i.remove(o),s.add(o)}return s}loadSTL(e,t){const i=new nv().parse(e);i.computeVertexNormals();const s=new rt(i);s.name=t;const o=new Bt;return o.name=`import-stl-${t}`,o.add(s),o}async loadGLTF(e,t){const n=new iv;return new Promise((i,s)=>{n.parse(e,"",o=>{const a=new Bt;for(a.name=`import-gltf-${t}`;o.scene.children.length>0;){const c=o.scene.children[0];o.scene.remove(c),a.add(c)}i(a)},o=>s(o))})}async loadDAE(e){const t=await e.text(),i=new kv().parse(t,""),s=new Bt;for(s.name=`import-dae-${e.name}`;i.scene.children.length>0;){const o=i.scene.children[0];i.scene.remove(o),s.add(o)}return s}loadPLY(e,t){const i=new Bv().parse(e);i.computeVertexNormals();const s=new Bt;if(s.name=`import-ply-${t}`,i.index||i.attributes.position.count>0)if(i.index){const o=new rt(i);o.name=t,s.add(o)}else{const o=new Ni({size:2,sizeAttenuation:!0,vertexColors:i.hasAttribute("color")});i.hasAttribute("color")||o.color.set(4491519);const a=new Ns(i,o);a.name=t,s.add(a)}return s}load3DS(e,t){const i=new Gv().parse(e,""),s=new Bt;for(s.name=`import-3ds-${t}`;i.children.length>0;){const o=i.children[0];i.remove(o),s.add(o)}return s}applyDefaultStyle(e){e.traverse(t=>{if(t instanceof rt){const n=t.geometry;n.attributes.normal||n.computeVertexNormals();const i=t.material,s=i?.color?.getHex?.()??13421772;if(i?.map!=null)i.side=sn;else{const l=new Qi({color:s!==16777215?s:13421772,side:ln,roughness:.6,metalness:.1});t.material=l;const h=new rt(n,this.defaultBackMat);h.name=t.name+"_back",t.parent?.add(h),h.position.copy(t.position),h.rotation.copy(t.rotation),h.scale.copy(t.scale)}const a=new jd(n,15),c=new Vt(a,this.defaultEdgeMat);c.name=t.name+"_edges",t.add(c)}})}get importedItems(){return this._importedItems}removeImport(e){this.importedGroup.remove(e.group),e.group.traverse(n=>{n instanceof rt&&(n.geometry.dispose(),n.material instanceof Ft&&n.material.dispose()),n instanceof Vt&&(n.geometry.dispose(),n.material instanceof Ft&&n.material.dispose())});const t=this._importedItems.indexOf(e);t!==-1&&this._importedItems.splice(t,1)}clearAll(){for(const e of[...this._importedItems])this.removeImport(e)}static getSupportedFormats(){return Object.keys(ko).map(e=>({format:e,label:dd[e],accept:ko[e]}))}}class Ly{constructor(e,t,n,i={}){this.groups=[],this.selectedGroupId=null,this.visible=!1,this.container=e,this.bridge=t,this.selection=n,this.callbacks=i,this.panelEl=document.createElement("div"),this.panelEl.id="component-panel",this.panelEl.className="component-panel",this.panelEl.innerHTML=`
      <div class="cp-header">
        <span class="cp-title">그룹 / 컴포넌트</span>
        <div class="cp-actions">
          <button class="cp-btn cp-btn-add" title="선택한 면으로 그룹 생성">+</button>
          <button class="cp-btn cp-btn-refresh" title="새로고침">⟳</button>
        </div>
      </div>
      <div class="cp-tree"></div>
      <div class="cp-empty">그룹이 없습니다</div>
    `,this.panelEl.style.display="none",e.appendChild(this.panelEl),this.treeEl=this.panelEl.querySelector(".cp-tree"),this.panelEl.querySelector(".cp-btn-add")?.addEventListener("click",()=>{this.callbacks.onRefresh?.()}),this.panelEl.querySelector(".cp-btn-refresh")?.addEventListener("click",()=>{this.refresh()}),this.injectStyles()}toggle(){this.visible=!this.visible,this.panelEl.style.display=this.visible?"flex":"none",this.visible&&this.refresh()}show(){this.visible=!0,this.panelEl.style.display="flex",this.refresh()}hide(){this.visible=!1,this.panelEl.style.display="none"}refresh(){const e=this.bridge.getAllGroups();if(e.length>0)this.groups=e;else{this.groups=[];const t=this.selection.getAllGroups();for(const[n,i]of t)this.groups.push({id:n,name:`Group-${n}`,faceCount:i.size,faceIds:Array.from(i),parent:null,children:[],visible:!0,locked:!1,isComponent:!1})}this.render()}render(){const e=this.panelEl.querySelector(".cp-empty");if(this.groups.length===0){this.treeEl.innerHTML="",e.style.display="block";return}e.style.display="none";const t=this.groups.filter(i=>i.parent===null||i.parent===0),n=new Map;for(const i of this.groups)if(i.parent&&i.parent>0){const s=n.get(i.parent)||[];s.push(i),n.set(i.parent,s)}this.treeEl.innerHTML="";for(const i of t)this.treeEl.appendChild(this.createTreeNode(i,n,0))}createTreeNode(e,t,n){const i=document.createElement("div");i.className="cp-node",i.dataset.groupId=String(e.id),this.selectedGroupId===e.id&&i.classList.add("cp-selected");const s=n*16,o=e.isComponent?"◆":"▣",a=e.locked?"🔒":"",c=e.visible?"👁":"👁‍🗨";i.innerHTML=`
      <div class="cp-row" style="padding-left: ${s+4}px">
        <span class="cp-icon">${o}</span>
        <span class="cp-name" title="${e.name}">${e.name}</span>
        <span class="cp-face-count">(${e.faceCount})</span>
        <span class="cp-lock cp-toggle" data-action="lock">${a}</span>
        <span class="cp-vis cp-toggle" data-action="vis">${c}</span>
        <button class="cp-btn-delete cp-toggle" data-action="delete" title="그룹 해제">✕</button>
      </div>
    `;const l=i.querySelector(".cp-row");l.addEventListener("click",d=>{const u=d.target.closest(".cp-toggle")?.getAttribute("data-action");if(u){d.stopPropagation(),this.handleAction(e.id,u);return}this.selectGroupInPanel(e.id)}),l.addEventListener("dblclick",()=>{this.callbacks.onGroupDoubleClick?.(e.id)});const h=t.get(e.id);if(h)for(const d of h)i.appendChild(this.createTreeNode(d,t,n+1));return i}selectGroupInPanel(e){this.selectedGroupId=e,this.callbacks.onGroupSelect?.(e),this.selection.selectGroup(e),this.treeEl.querySelectorAll(".cp-node").forEach(t=>{t.classList.toggle("cp-selected",t.getAttribute("data-group-id")===String(e))})}handleAction(e,t){switch(t){case"vis":this.bridge.toggleGroupVisibility(e),this.refresh();break;case"lock":this.bridge.toggleGroupLock(e),this.refresh();break;case"delete":this.callbacks.onGroupDelete?.(e),this.bridge.deleteGroup(e),this.selection.ungroupSelected(),dt.info(`Group-${e} 해제됨`),this.refresh();break}}injectStyles(){if(document.getElementById("cp-styles"))return;const e=document.createElement("style");e.id="cp-styles",e.textContent=`
      .component-panel {
        position: absolute;
        right: 8px;
        bottom: 60px;
        width: 260px;
        max-height: 300px;
        background: rgba(30, 30, 40, 0.95);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        font-size: 12px;
        color: #ccc;
        z-index: 100;
        overflow: hidden;
        backdrop-filter: blur(8px);
      }
      .cp-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 10px;
        background: rgba(255,255,255,0.05);
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .cp-title {
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .cp-actions {
        display: flex;
        gap: 4px;
      }
      .cp-btn {
        background: none;
        border: 1px solid rgba(255,255,255,0.15);
        color: #aaa;
        cursor: pointer;
        border-radius: 3px;
        padding: 1px 6px;
        font-size: 12px;
      }
      .cp-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
      .cp-tree {
        overflow-y: auto;
        flex: 1;
        padding: 4px 0;
      }
      .cp-empty {
        text-align: center;
        padding: 16px;
        color: #666;
        font-style: italic;
      }
      .cp-node {
        user-select: none;
      }
      .cp-row {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        cursor: pointer;
        border-radius: 3px;
        margin: 0 4px;
      }
      .cp-row:hover { background: rgba(255,255,255,0.06); }
      .cp-selected > .cp-row { background: rgba(33, 150, 243, 0.2); }
      .cp-icon { font-size: 10px; width: 14px; text-align: center; }
      .cp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cp-face-count { color: #888; font-size: 10px; }
      .cp-toggle { cursor: pointer; font-size: 10px; opacity: 0.5; padding: 0 2px; }
      .cp-toggle:hover { opacity: 1; }
      .cp-btn-delete {
        background: none;
        border: none;
        color: #f44336;
        cursor: pointer;
        font-size: 11px;
        opacity: 0;
        transition: opacity 0.15s;
      }
      .cp-row:hover .cp-btn-delete { opacity: 0.6; }
      .cp-btn-delete:hover { opacity: 1 !important; }
    `,document.head.appendChild(e)}dispose(){this.panelEl.remove()}}async function Iy(){console.log("AXiA 3D starting...");const r=new Y0;if(await r.init(),!r.isReady()){console.error("WASM engine failed to initialize");return}const e=document.getElementById("viewport"),t=new v0(e),n=new dl,i=new $0(n),s=document.getElementById("settings-btn");s&&s.addEventListener("click",D=>{D.stopPropagation(),i.toggle()});const o=new Ry(t.scene);window.__axia_units=n,window.__axia_bridge=r,window.__axia_viewport=t,window.__axia_importer=o;const a=()=>{const D={mm:[1e3,5e3],cm:[1e3,5e3],m:[1e3,5e3],in:[304.79999999999995,1524],ft:[304.8,1524]},[B,j]=D[n.unit]||[1,5];t.updateGridSpacing(B,j)};n.onChange(a),a();const c=new Wo(t,r,n);window.__axia_toolManager=c;{const D=[{cx:-15e3,cz:-1e4,w:2e4,d:12e3,h:8e3},{cx:15e3,cz:-8e3,w:14e3,d:1e4,h:12e3},{cx:-8e3,cz:12e3,w:1e4,d:8e3,h:5e3},{cx:12e3,cz:1e4,w:18e3,d:6e3,h:7e3}];for(const B of D){const j=r.faceCount(),X=r.drawRect(B.cx,0,B.cz,0,1,0,0,0,1,B.w,B.d);X>=0&&(console.log(`[Init] Box xia=${X} → faceId=${j}`),r.pushPull(j,B.h))}c.syncMesh(),console.log("[Init] 4 default boxes created")}c.selection.onChange(D=>{const B=document.getElementById("stat-sel-wrap"),j=document.getElementById("stat-selected");B&&j&&(D.length>0?(B.style.display="",j.textContent=String(D.length)):B.style.display="none")});{const D=document.getElementById("menubar");let B=null;const j=()=>{D?.querySelectorAll(".menu-item").forEach(k=>k.classList.remove("open")),B=null};D?.querySelectorAll(":scope > .menu-item").forEach(k=>{k.addEventListener("click",G=>{G.stopPropagation();const Q=k;Q.classList.contains("open")?j():(j(),Q.classList.add("open"),B=Q)}),k.addEventListener("mouseenter",()=>{B&&B!==k&&(j(),k.classList.add("open"),B=k)})}),document.addEventListener("click",()=>j());const X=k=>{c.setTool(k),document.getElementById("toolbar").querySelectorAll(".tool-btn").forEach(ee=>{ee.classList.toggle("active",ee.dataset.tool===k)});const Q=document.getElementById("tool-label");if(Q){const ee={select:"Select",line:"Line",rect:"Rectangle",circle:"Circle",pushpull:"Push/Pull",move:"Move"};Q.textContent=ee[k]||k}},Y=k=>{t.setViewMode(k),document.getElementById("view-mode-bar")?.querySelectorAll(".view-btn").forEach(Q=>Q.classList.toggle("active",Q.dataset.view===k))};D?.addEventListener("click",k=>{const G=k.target.closest(".menu-action");if(!G)return;const Q=G.dataset.action;if(Q)switch(j(),Q){case"file-new":confirm("현재 작업을 초기화하시겠습니까?")&&location.reload();break;case"file-open":window.__axia_open?.();break;case"file-save":case"file-saveas":window.__axia_save?.();break;case"import-all":o.openFileDialog();break;case"import-obj":o.openFileDialog("obj");break;case"import-stl":o.openFileDialog("stl");break;case"import-gltf":o.openFileDialog("gltf");break;case"import-dae":o.openFileDialog("dae");break;case"import-ply":o.openFileDialog("ply");break;case"import-3ds":o.openFileDialog("3ds");break;case"import-dxf":de();break;case"undo":c.executeAction("undo");break;case"redo":c.executeAction("redo");break;case"delete":c.executeAction("delete");break;case"select-all":c.executeAction("select-all");break;case"select-same":c.executeAction("select-same");break;case"deselect":c.selection.clearSelection();break;case"view-3d":Y("3d");break;case"view-top":Y("top");break;case"view-front":Y("front");break;case"view-back":Y("back");break;case"view-right":Y("right");break;case"view-left":Y("left");break;case"view-bottom":Y("bottom");break;case"view-home":t.resetCamera();break;case"view-grid":{const ee=t.getStyleSettings();t.setGridVisible(!ee.gridVisible);break}case"view-axis":{const ee=t.getStyleSettings();t.setAxisVisible(!ee.axisVisible);break}case"tool-line":X("line");break;case"tool-polyline":X("polyline");break;case"tool-rect":X("rect");break;case"tool-polygon":X("polygon");break;case"tool-circle":X("circle");break;case"tool-arc":X("arc");break;case"tool-freehand":X("freehand");break;case"tool-point":X("point");break;case"tool-text3d":X("text3d");break;case"tool-pushpull":X("pushpull");break;case"tool-move":X("move");break;case"tool-rotate":X("rotate");break;case"tool-scale":X("scale");break;case"tool-offset":X("offset");break;case"tool-mirror":X("mirror");break;case"tool-array":X("array");break;case"tool-trim":X("trim");break;case"tool-extend":X("extend");break;case"tool-fillet":X("fillet");break;case"tool-chamfer":X("chamfer");break;case"tool-explode":X("explode");break;case"tool-group":c.executeAction("group");break;case"tool-ungroup":c.executeAction("ungroup");break;case"tool-make-component":c.executeAction("make-component");break;case"bool-union":$("union");break;case"bool-subtract":$("subtract");break;case"bool-intersect":$("intersect");break;case"format-units":document.getElementById("settings-btn")?.click();break;case"format-style":document.getElementById("style-btn")?.click();break;case"format-osnap":window.__axia_openOsnapPanel?.();break;case"help-shortcuts":alert(`AXiA 3D 단축키

[ 그리기 ]
V — 선택
L — 선 (Line)
Shift+L — 폴리선 (Polyline)
R — 사각형 (Rect)
G — 다각형 (Polygon)
C — 원 (Circle)
A — 호 (Arc)
Shift+F — 자유선 (Freehand)

[ 수정 ]
P — 밀기/당기기 (Push/Pull)
M — 이동 (Move)
Q — 회전 (Rotate)
S — 크기 조정 (Scale)
O — 오프셋 (Offset)

[ 편집 ]
Ctrl+G — 그룹
Ctrl+Shift+G — 그룹 해제
Ctrl+S — 저장
Ctrl+O — 열기
Ctrl+Z — 실행취소
Ctrl+Y — 다시실행

[ 탐색 ]
H — 원점 복귀
F3 — 스냅 토글
→ X축 잠금 / ↑ Y축 잠금 / ← Z축 잠금 / ↓ 해제

Alt+드래그 — 궤도 회전
중버튼 드래그 — 이동
스크롤 — 줌`);break;case"help-about":alert(`AXiA 3D v0.1.0

경량 3D 모델링 프로그램
XIA Geometry Engine (Rust/WASM)`);break}})}const l=document.getElementById("toolbar");l.addEventListener("click",D=>{const B=D.target.closest(".tool-btn");if(!B)return;const j=B.dataset.tool;if(!j)return;if(j==="undo"||j==="redo"){c.executeAction(j),B.classList.add("flash"),B.addEventListener("animationend",()=>B.classList.remove("flash"),{once:!0});return}l.querySelectorAll(".tool-btn").forEach(Y=>Y.classList.remove("active")),B.classList.add("active"),c.setTool(j);const X=document.getElementById("tool-label");if(X){const Y={select:"Select",line:"Line",rect:"Rectangle",circle:"Circle",pushpull:"Push/Pull",move:"Move",rotate:"Rotate",scale:"Scale",offset:"Offset"};X.textContent=Y[j]||j}});const h=document.getElementById("osnap-toggle"),d=document.getElementById("stat-osnap"),u=()=>{const D=c.snap.enabled;d&&(d.textContent=D?"ON":"OFF",d.style.color=D?"#44ff88":"#ff4444")};h&&h.addEventListener("click",()=>{c.snap.toggle(),u()}),window.addEventListener("keydown",D=>{if(!(D.target instanceof HTMLInputElement)){if(D.key===" "&&c.isToolBusy()){D.preventDefault(),c.cancelCurrentTool();return}if(D.key==="Delete"){c.executeAction("delete");return}if(D.key==="F3"){D.preventDefault(),c.snap.toggle(),u();return}if(D.key==="ArrowRight"){D.preventDefault(),c.setAxisLock("x");return}if(D.key==="ArrowUp"){D.preventDefault(),c.setAxisLock("y");return}if(D.key==="ArrowLeft"){D.preventDefault(),c.setAxisLock("z");return}if(D.key==="ArrowDown"){D.preventDefault(),c.setAxisLock(null);return}if(D.ctrlKey&&(D.key==="s"||D.key==="S")){D.preventDefault(),se();return}if(D.ctrlKey&&(D.key==="o"||D.key==="O")){D.preventDefault(),z();return}if(D.ctrlKey&&D.shiftKey&&(D.key==="g"||D.key==="G")){D.preventDefault(),c.executeAction("ungroup");return}if(D.ctrlKey&&(D.key==="g"||D.key==="G")){D.preventDefault(),c.executeAction("group");return}if(D.ctrlKey&&(D.key==="a"||D.key==="A")){D.preventDefault(),c.executeAction("select-all");return}if(D.ctrlKey&&D.key==="z"){if(D.preventDefault(),D.repeat)return;if(!D.isTrusted){console.warn("[Undo] blocked non-trusted event");return}c.executeAction("undo");const B=l.querySelector('[data-tool="undo"]');B&&(B.classList.add("flash"),B.addEventListener("animationend",()=>B.classList.remove("flash"),{once:!0}))}else if(D.ctrlKey&&D.key==="y"){if(D.preventDefault(),D.repeat)return;if(!D.isTrusted){console.warn("[Redo] blocked non-trusted event");return}c.executeAction("redo");const B=l.querySelector('[data-tool="redo"]');B&&(B.classList.add("flash"),B.addEventListener("animationend",()=>B.classList.remove("flash"),{once:!0}))}else if(D.key==="Escape"){if(c.selection.isInGroupEditMode()){c.selection.exitGroupEdit();return}if(t.viewMode!=="3d"){t.setViewMode("3d"),document.getElementById("view-mode-bar")?.querySelectorAll(".view-btn").forEach(X=>X.classList.toggle("active",X.dataset.view==="3d"));const j=document.getElementById("tool-label");j&&(j.textContent="3D Perspective")}else c.setTool("select"),l.querySelectorAll(".tool-btn").forEach(B=>{B.classList.toggle("active",B.dataset.tool==="select")})}else if(D.shiftKey&&!D.ctrlKey&&!D.altKey){const j={L:"polyline",F:"freehand"}[D.key];if(j){c.setTool(j),l.querySelectorAll(".tool-btn").forEach(Y=>Y.classList.remove("active"));const X=document.getElementById("tool-label");X&&(X.textContent=j)}}else if(!D.ctrlKey&&!D.altKey){if(D.key==="h"||D.key==="H"){t.resetCamera();return}if(new Set(["t","b","f","k"]).has(D.key.toLowerCase())||c.isToolBusy())return;const X={v:"select",V:"select",l:"line",L:"line",r:"rect",R:"rect",g:"polygon",G:"polygon",c:"circle",C:"circle",a:"arc",A:"arc",p:"pushpull",P:"pushpull",m:"move",M:"move",q:"rotate",Q:"rotate",s:"scale",S:"scale",o:"offset",O:"offset",e:"erase",E:"erase"}[D.key];if(X){c.setTool(X),l.querySelectorAll(".tool-btn").forEach(k=>{k.classList.toggle("active",k.dataset.tool===X)});const Y=document.getElementById("tool-label");if(Y){const k={select:"Select",line:"Line",rect:"Rectangle",circle:"Circle",pushpull:"Push/Pull",move:"Move",rotate:"Rotate",scale:"Scale",offset:"Offset",erase:"Erase"};Y.textContent=k[X]||X}}}}});const m=document.getElementById("home-btn");m&&m.addEventListener("click",()=>{t.resetCamera()});const g=document.getElementById("view-mode-bar");if(g){g.addEventListener("click",B=>{const j=B.target.closest(".view-btn");if(!j)return;const X=j.dataset.view;if(!X)return;g.querySelectorAll(".view-btn").forEach(k=>k.classList.remove("active")),j.classList.add("active"),t.setViewMode(X);const Y=document.getElementById("tool-label");if(Y){const k={"3d":"3D Perspective",top:"Top (XY)",bottom:"Bottom (XY)",front:"Front (XZ)",back:"Back (XZ)",right:"Right (YZ)",left:"Left (YZ)"};Y.textContent=k[X]||X}});const D=B=>{t.setViewMode(B),g.querySelectorAll(".view-btn").forEach(X=>{const Y=X.dataset.view;X.classList.toggle("active",Y===B)});const j=document.getElementById("tool-label");if(j){const X={"3d":"3D Perspective",top:"Top (XY)",bottom:"Bottom (XY)",front:"Front (XZ)",back:"Back (XZ)",right:"Right (YZ)",left:"Left (YZ)"};j.textContent=X[B]||B}};window.addEventListener("keydown",B=>{if(B.target instanceof HTMLInputElement)return;const j=c.currentTool,X=L.has(j),Y=B.code.startsWith("Numpad");if(X&&Y&&!B.ctrlKey)return;let k=null;if(B.code==="Numpad7"?k=B.ctrlKey?"bottom":"top":B.code==="Numpad1"?k=B.ctrlKey?"back":"front":B.code==="Numpad3"?k=B.ctrlKey?"left":"right":(B.code==="Numpad0"||B.code==="Numpad5")&&(k="3d"),!B.ctrlKey&&!B.altKey){const G=B.key.toLowerCase();G==="t"?k="top":G==="b"?k="bottom":G==="f"?k="front":G==="k"&&(k="back")}k&&(B.preventDefault(),D(k))})}t.start();const _=document.getElementById("stat-unit"),f=document.getElementById("stat-prec");n.onChange(()=>{_.textContent=n.config.label,f.textContent=String(n.precision)}),_.textContent=n.config.label,f.textContent=String(n.precision);const p=l.querySelector('[data-tool="undo"]'),x=l.querySelector('[data-tool="redo"]');setInterval(()=>{const D=r.getStats();document.getElementById("stat-verts").textContent=String(D.verts),document.getElementById("stat-faces").textContent=String(D.faces),document.getElementById("stat-tool").textContent=c.currentTool,p&&p.classList.toggle("disabled",D.canUndo===!1),x&&x.classList.toggle("disabled",D.canRedo===!1)},200);const y=document.getElementById("cmd-input"),v=document.getElementById("cmd-label"),F=document.getElementById("commandbar"),A={offset:"오프셋 거리:",pushpull:"밀기/당기기 거리:",line:"길이:",rect:"가로, 세로:",circle:"반지름:",move:"이동 거리:",rotate:"각도(°):",scale:"배율:",select:"치수:"},L=new Set(["offset","pushpull","line","rect","circle","move","rotate","scale"]),O=D=>{if(!y)return;F?.classList.add("vcb-active"),y.focus(),D&&(y.value=D);const B=c.currentTool;v&&(v.textContent=A[B]||"치수:")},w=()=>{y&&(F?.classList.remove("vcb-active"),y.blur(),y.value="")};if(y){y.addEventListener("keydown",B=>{if(B.key==="Enter"||B.key===" "&&c.currentTool!=="rect"){B.preventDefault();const X=y.value.trim();if(!X){w();return}const Y=c.currentTool;if(Y==="rect"&&(X.includes(",")||X.includes(" "))){const G=X.split(/[,\s]+/).map(Q=>n.parseInput(Q.trim()));if(G.length===2&&G[0]!==null&&G[1]!==null){console.log(`[VCB] rect: ${G[0]}×${G[1]} mm`),c.applyVCBValue(G[0],G[1]),w();return}}const k=n.parseInput(X);k!==null?(console.log(`[VCB] ${Y}: "${X}" → ${k.toFixed(2)} mm`),c.applyVCBValue(k),y.placeholder=n.format(k),w()):(console.warn(`[VCB] Invalid: "${X}"`),y.value="")}B.key==="Escape"&&(B.preventDefault(),B.stopPropagation(),w())});const D=()=>{if(!y)return;c.currentTool==="rect"?y.placeholder=`가로, 세로 (${n.config.label})`:y.placeholder=`숫자 입력 후 Enter (${n.config.label})`};n.onChange(D),D()}window.addEventListener("keydown",D=>{if(D.target instanceof HTMLInputElement||D.ctrlKey||D.altKey||D.metaKey||!/^[0-9.\-]$/.test(D.key))return;const j=c.currentTool;L.has(j)&&(D.preventDefault(),D.stopPropagation(),O(D.key))},!0);const S=document.getElementById("context-menu");if(S){t.onContextMenu((j,X)=>{c.currentTool==="line"&&c.isToolBusy()&&c.cancelCurrentTool();const Y=c.selection.getSelectedFaces(),k=Y.length>0,G=Y.length>=2;let Q;k&&(Q=c.selection.getGroupId(Y[0]));const ee=Q!==void 0,oe=c.selection.isInGroupEditMode(),ce=S.querySelectorAll(".ctx-group-item"),Me=S.querySelector(".ctx-group-sep");ce.forEach(be=>{const Te=be,xe=Te.dataset.action;let ke=!1;switch(xe){case"group":ke=G&&!ee;break;case"ungroup":ke=ee;break;case"group-edit":ke=ee&&!oe;break;case"make-component":ke=ee;break;case"group-lock":ke=ee;break;case"group-hide":ke=ee;break}Te.style.display=ke?"":"none"});const $e=Array.from(ce).some(be=>be.style.display!=="none");Me&&(Me.style.display=$e?"":"none");const Je=200,_e=400,V=Math.min(j,window.innerWidth-Je);let Pt;X+_e>window.innerHeight?Pt=X-_e:Pt=X,Pt=Math.max(4,Pt),S.style.left=V+"px",S.style.top=Pt+"px",S.classList.add("visible")}),S.addEventListener("click",j=>{const X=j.target.closest(".ctx-item");if(!X)return;const Y=X.dataset.action;switch(S.classList.remove("visible"),Y){case"snap-override":return;case"undo":c.executeAction("undo");break;case"redo":c.executeAction("redo");break;case"delete":c.executeAction("delete");break;case"select-all":c.executeAction("select-all");break;case"select-same":c.executeAction("select-same");break;case"deselect":c.selection.clearSelection();break;case"group":c.executeAction("group");break;case"ungroup":c.executeAction("ungroup");break;case"group-edit":{const k=c.selection.getSelectedFaces();if(k.length>0){const G=c.selection.getGroupId(k[0]);G!==void 0&&c.selection.enterGroupEdit(G)}break}case"make-component":c.executeAction("make-component");break;case"group-lock":{const k=c.selection.getSelectedFaces();if(k.length>0){const G=c.selection.getGroupId(k[0]);G!==void 0&&r.toggleGroupLock(G)}break}case"group-hide":{const k=c.selection.getSelectedFaces();if(k.length>0){const G=c.selection.getGroupId(k[0]);G!==void 0&&(r.toggleGroupVisibility(G),c.syncMesh())}break}case"view-top":t.setViewMode("top");break;case"view-front":t.setViewMode("front");break;case"view-right":t.setViewMode("right");break;case"view-3d":t.setViewMode("3d");break}if(Y?.startsWith("view-")){const k=Y.replace("view-","");g?.querySelectorAll(".view-btn").forEach(Q=>Q.classList.toggle("active",Q.dataset.view===k));const G=document.getElementById("tool-label");if(G){const Q={"3d":"3D Perspective",top:"Top (XY)",front:"Front (XZ)",right:"Right (YZ)"};G.textContent=Q[k]||k}}});const D=document.getElementById("snap-submenu"),B=S.querySelector(".ctx-submenu-trigger");if(B&&D){B.addEventListener("mouseenter",()=>{const k=B.getBoundingClientRect();let G=k.right+2;const Q=210,ee=480;G+Q>window.innerWidth&&(G=k.left-Q-2);let oe;k.bottom+ee>window.innerHeight?oe=k.bottom-ee:oe=k.top,oe=Math.max(4,oe),D.style.left=G+"px",D.style.top=oe+"px",D.classList.add("visible")}),S.querySelectorAll(".ctx-item").forEach(k=>{k!==B&&k.addEventListener("mouseenter",()=>{D.classList.remove("visible")})});let j=null;const X=()=>{j=setTimeout(()=>D.classList.remove("visible"),150)},Y=()=>{j&&(clearTimeout(j),j=null)};D.addEventListener("mouseenter",Y),D.addEventListener("mouseleave",X),B.addEventListener("mouseleave",X),B.addEventListener("mouseenter",Y)}window.addEventListener("mousedown",j=>{!S.contains(j.target)&&!(D&&D.contains(j.target))&&(S.classList.remove("visible"),D?.classList.remove("visible"))}),D&&D.addEventListener("click",j=>{const X=j.target.closest(".snap-ov");if(!X)return;const Y=X.dataset.snap;if(D.classList.remove("visible"),S.classList.remove("visible"),Y==="none")window.__axia_snap_override="none";else if(Y==="settings"){const k=window.__axia_openOsnapPanel;k&&k()}else Y&&(console.log("[OSNAP] Override snap:",Y),window.__axia_snap_override=Y)})}const U=document.getElementById("osnap-panel");if(U){const D=document.getElementById("osnap-master"),B=U.querySelectorAll("input[data-mode]");B.forEach(ce=>{const Me=ce.dataset.mode;Me&&c.snap.setMode(Me,ce.checked)});const j=()=>{D&&(D.checked=c.snap.enabled),B.forEach(ce=>{const Me=ce.dataset.mode;Me&&(ce.checked=c.snap.isActive(Me))}),U.classList.add("visible")},X=()=>U.classList.remove("visible"),Y=()=>{c.snap.enabled=D?.checked??!0,B.forEach(Me=>{const $e=Me.dataset.mode;$e&&c.snap.setMode($e,Me.checked)});const ce=document.getElementById("osnap-size-slider");ce&&c.snapVisual.setMarkerSize(parseInt(ce.value)),u()};D&&D.addEventListener("change",Y),B.forEach(ce=>{ce.addEventListener("change",Y)}),document.getElementById("osnap-ok")?.addEventListener("click",()=>{Y(),X()}),document.getElementById("osnap-cancel")?.addEventListener("click",X),document.getElementById("osnap-panel-close")?.addEventListener("click",X),document.getElementById("osnap-select-all")?.addEventListener("click",()=>{B.forEach(ce=>ce.checked=!0),Y()}),document.getElementById("osnap-clear-all")?.addEventListener("click",()=>{B.forEach(ce=>ce.checked=!1),Y()});const k=document.getElementById("osnap-size-slider"),G=document.getElementById("osnap-size-preview"),Q=ce=>{if(!G)return;const Me=G.getContext("2d"),$e=G.width,Je=G.height;Me.clearRect(0,0,$e,Je),Me.fillStyle="#000",Me.fillRect(0,0,$e,Je);const _e=$e/2,V=Je/2;Me.strokeStyle="#FF3333",Me.lineWidth=1.2,Me.strokeRect(_e-ce,V-ce,ce*2,ce*2)};k&&(Q(parseInt(k.value)),k.addEventListener("input",()=>{const ce=parseInt(k.value);Q(ce)}));const ee=j,oe=()=>{ee(),k&&(k.value=String(c.snapVisual?.getMarkerSize()??8),Q(parseInt(k.value)))};U.addEventListener("keydown",ce=>{ce.key==="Escape"&&X()}),window.__axia_openOsnapPanel=oe,h?.addEventListener("dblclick",oe)}const Z=D=>{let B="";for(let j=0;j<D.length;j++)B+=String.fromCharCode(D[j]);return btoa(B)},K=D=>{const B=atob(D),j=new Uint8Array(B.length);for(let X=0;X<B.length;X++)j[X]=B.charCodeAt(X);return j},se=()=>{const D=r.exportSnapshot();if(!D){console.warn("[Save] WASM export_snapshot not available (WASM rebuild needed)"),fe();return}const B={format:"xia",version:"1.0.0",engine:"AXiA 3D",created:new Date().toISOString(),units:{unit:n.unit,precision:n.precision},camera:t.getCameraState(),style:t.getStyleSettings(),mesh:Z(D)},j=JSON.stringify(B,null,2),X=new Blob([j],{type:"application/json"}),Y=URL.createObjectURL(X),k=document.createElement("a");k.href=Y,k.download=`AXiA_Project_${new Date().toISOString().slice(0,10)}.xia`,k.click(),URL.revokeObjectURL(Y),console.log("[Save] Project saved:",j.length,"bytes")},fe=()=>{const D=r.getMeshBuffers(),B=r.getEdgeLines(),j={format:"xia",version:"1.0.0-fallback",engine:"AXiA 3D",created:new Date().toISOString(),units:{unit:n.unit,precision:n.precision},camera:t.getCameraState(),style:t.getStyleSettings(),buffers:D?{positions:Array.from(D.positions),normals:Array.from(D.normals),indices:Array.from(D.indices),faceMap:Array.from(D.faceMap)}:null,edgeLines:B?Array.from(B):null},X=JSON.stringify(j),Y=new Blob([X],{type:"application/json"}),k=URL.createObjectURL(Y),G=document.createElement("a");G.href=k,G.download=`AXiA_Project_${new Date().toISOString().slice(0,10)}.xia`,G.click(),URL.revokeObjectURL(k),console.log("[Save] Fallback project saved:",X.length,"bytes")},z=()=>{const D=document.createElement("input");D.type="file",D.accept=".xia",D.addEventListener("change",async()=>{const B=D.files?.[0];if(B)try{const j=await B.text(),X=JSON.parse(j);if(X.format!=="xia"){alert("올바른 .xia 파일이 아닙니다.");return}if(X.mesh){const Y=K(X.mesh);r.importSnapshot(Y)?(c.syncMesh(),console.log("[Open] Mesh restored from snapshot")):console.error("[Open] importSnapshot failed")}if(X.units&&(n.unit=X.units.unit,X.units.precision!==void 0&&(n.precision=X.units.precision)),X.camera&&t.setCameraState(X.camera),X.style){const Y=X.style;t.updateBackground(Y.bgMode,Y.bgSkyColor,Y.bgGroundColor,Y.bgMidColor),Y.frontColor!==void 0&&t.setFaceColors(Y.frontColor,Y.backColor),Y.edgeColor!==void 0&&t.setEdgeStyle({color:Y.edgeColor,visible:Y.edgeVisible}),Y.gridVisible!==void 0&&t.setGridVisible(Y.gridVisible),Y.axisVisible!==void 0&&t.setAxisVisible(Y.axisVisible)}console.log("[Open] Project loaded:",B.name)}catch(j){console.error("[Open] Failed to load project:",j),alert("파일을 불러오는데 실패했습니다.")}}),D.click()},de=()=>{const D=document.createElement("input");D.type="file",D.accept=".dxf",D.style.display="none",document.body.appendChild(D),D.onchange=async()=>{const B=D.files?.[0];if(document.body.removeChild(D),!!B){console.log(`[DXF Import] 파일: ${B.name} (${(B.size/1024).toFixed(1)} KB)`);try{const j=await B.arrayBuffer(),X=new Uint8Array(j),Y=r.importDxf(X);if(!Y){alert(`DXF 가져오기 실패: WASM 엔진이 준비되지 않았습니다.
로컬에서 wasm-pack 빌드 후 다시 시도해 주세요.`);return}if(!Y.ok){alert(`DXF 파싱 실패: ${Y.error||"알 수 없는 오류"}`);return}c.syncMesh();const k=[Y.lines&&`선 ${Y.lines}`,Y.polylines&&`폴리선 ${Y.polylines}`,Y.circles&&`원 ${Y.circles}`,Y.arcs&&`호 ${Y.arcs}`,Y.faces3d&&`3D면 ${Y.faces3d}`,Y.solids&&`솔리드 ${Y.solids}`,Y.ellipses&&`타원 ${Y.ellipses}`,Y.splines&&`스플라인 ${Y.splines}`].filter(Boolean).join(", ");console.log(`[DXF Import] 완료: ${k}`),console.log(`[DXF Import] 총 정점: ${Y.totalVerts}, 총 면: ${Y.totalFaces}, 스킵: ${Y.skipped}`)}catch(j){console.error("[DXF Import] 오류:",j),alert(`DXF 가져오기 중 오류: ${j.message}`)}}},D.click()},$=D=>{const B=c.selection.getSelectedFaces();if(B.length<2){alert(`Boolean ${D}: 두 개의 솔리드를 선택해주세요.
현재 선택된 면: ${B.length}개

사용법:
1. 첫 번째 솔리드의 면을 클릭 (Shift+클릭으로 여러 면)
2. 두 번째 솔리드의 면을 클릭
3. 수정 메뉴에서 Boolean 연산 선택`);return}const j=Math.ceil(B.length/2),X=B.slice(0,j),Y=B.slice(j);console.log(`[Boolean] ${D}: A=${X.length} faces, B=${Y.length} faces`);const k=r.booleanOp(X,Y,D);if(!k){alert("Boolean 연산 실패: WASM 엔진이 준비되지 않았습니다.");return}if(!k.ok){alert(`Boolean ${D} 실패: ${k.error||"알 수 없는 오류"}`);return}c.syncMesh(),console.log(`[Boolean] ${D} 완료: 결과 면 ${k.resultFaces?.length??0}개, 총 정점 ${k.totalVerts}, 총 면 ${k.totalFaces}`)};window.__axia_save=se,window.__axia_open=z;{const D=document.getElementById("style-panel"),B=document.getElementById("style-btn"),j=document.getElementById("style-panel-close"),X=()=>{D&&(D.classList.toggle("open"),D.classList.contains("open")&&(G(),Q()))};B?.addEventListener("click",oe=>{oe.stopPropagation(),X()}),j?.addEventListener("click",()=>D?.classList.remove("open")),window.addEventListener("keydown",oe=>{oe.target instanceof HTMLInputElement||oe.target instanceof HTMLSelectElement||oe.key==="Escape"&&D?.classList.contains("open")&&(D.classList.remove("open"),oe.stopPropagation())});const Y=[{name:"건축 설계",bgMode:"gradient2",bgSkyColor:"#8eaac4",bgGroundColor:"#d8dce2",frontColor:15263976,backColor:8952251,edgeColor:3355494},{name:"밝은 하늘",bgMode:"gradient2",bgSkyColor:"#87ceeb",bgGroundColor:"#d4e6c3",frontColor:16119285,backColor:11189196,edgeColor:4473958},{name:"클래식 흰색",bgMode:"solid",bgSkyColor:"#ffffff",bgGroundColor:"#ffffff",frontColor:15790320,backColor:12634328,edgeColor:3355443},{name:"다크 모드",bgMode:"gradient2",bgSkyColor:"#0d0d1a",bgGroundColor:"#000000",frontColor:13421772,backColor:6715272,edgeColor:2236996},{name:"블루프린트",bgMode:"solid",bgSkyColor:"#1a2744",bgGroundColor:"#1a2744",frontColor:6719675,backColor:4478327,edgeColor:11193599},{name:"석양",bgMode:"gradient3",bgSkyColor:"#1a0533",bgMidColor:"#cc4422",bgGroundColor:"#ffaa44",frontColor:15786192,backColor:10057574,edgeColor:5583650},{name:"모노크롬",bgMode:"gradient2",bgSkyColor:"#666666",bgGroundColor:"#222222",frontColor:14540253,backColor:8947848,edgeColor:4473924},{name:"따뜻한 톤",bgMode:"gradient2",bgSkyColor:"#5c4033",bgGroundColor:"#2a1810",frontColor:15785160,backColor:11178112,edgeColor:4469538},{name:"네온",bgMode:"solid",bgSkyColor:"#0a0a14",bgGroundColor:"#0a0a14",frontColor:1118498,backColor:657942,edgeColor:65484}];let k=0;const G=()=>{const oe=document.getElementById("style-presets");oe&&(oe.innerHTML="",Y.forEach((ce,Me)=>{const $e=document.createElement("div");$e.className="sty-preset"+(Me===k?" active":"");const Je=document.createElement("canvas");Je.width=80,Je.height=64;const _e=Je.getContext("2d");if(ce.bgMode==="solid")_e.fillStyle=ce.bgSkyColor,_e.fillRect(0,0,80,64);else{const xe=_e.createLinearGradient(0,0,0,64);xe.addColorStop(0,ce.bgSkyColor),ce.bgMode==="gradient3"&&ce.bgMidColor&&xe.addColorStop(.5,ce.bgMidColor),xe.addColorStop(1,ce.bgGroundColor),_e.fillStyle=xe,_e.fillRect(0,0,80,64)}const V="#"+ce.frontColor.toString(16).padStart(6,"0"),Pt="#"+ce.edgeColor.toString(16).padStart(6,"0");_e.fillStyle=V,_e.beginPath(),_e.moveTo(22,44),_e.lineTo(22,20),_e.lineTo(46,12),_e.lineTo(46,36),_e.closePath(),_e.fill(),_e.fillStyle=V,_e.globalAlpha=.7,_e.beginPath(),_e.moveTo(22,20),_e.lineTo(40,14),_e.lineTo(58,22),_e.lineTo(46,12),_e.moveTo(22,20),_e.lineTo(46,12),_e.lineTo(62,18),_e.lineTo(38,26),_e.closePath(),_e.fill(),_e.globalAlpha=1;const be="#"+ce.backColor.toString(16).padStart(6,"0");_e.fillStyle=be,_e.beginPath(),_e.moveTo(46,12),_e.lineTo(62,18),_e.lineTo(62,42),_e.lineTo(46,36),_e.closePath(),_e.fill(),_e.strokeStyle=Pt,_e.lineWidth=1,_e.beginPath(),_e.moveTo(22,44),_e.lineTo(22,20),_e.lineTo(46,12),_e.lineTo(46,36),_e.lineTo(22,44),_e.moveTo(22,20),_e.lineTo(38,26),_e.lineTo(62,18),_e.lineTo(46,12),_e.moveTo(46,36),_e.lineTo(62,42),_e.lineTo(62,18),_e.moveTo(22,44),_e.lineTo(38,50),_e.lineTo(62,42),_e.stroke(),_e.strokeStyle="rgba(255,255,255,0.15)",_e.lineWidth=.5;for(let xe=10;xe<75;xe+=12)_e.beginPath(),_e.moveTo(xe,58),_e.lineTo(xe+6,52),_e.stroke();$e.appendChild(Je);const Te=document.createElement("div");Te.className="sty-preset-name",Te.textContent=ce.name,$e.appendChild(Te),$e.addEventListener("click",()=>{k=Me,t.applyStylePreset(ce),G(),Q()}),oe.appendChild($e)}))},Q=()=>{const oe=t.getStyleSettings(),ce=document.getElementById("sty-bg-mode");ce&&(ce.value=oe.bgMode);const Me=(Pt,be)=>{const Te=document.getElementById(Pt);Te&&(Te.value=be)};Me("sty-bg-sky",oe.bgSkyColor),Me("sty-bg-mid",oe.bgMidColor),Me("sty-bg-ground",oe.bgGroundColor),Me("sty-face-front","#"+oe.frontColor.toString(16).padStart(6,"0")),Me("sty-face-back","#"+oe.backColor.toString(16).padStart(6,"0")),Me("sty-edge-color","#"+oe.edgeColor.toString(16).padStart(6,"0"));const $e=document.getElementById("sty-face-opacity");$e&&($e.value=String(Math.round(oe.faceOpacity*100)));const Je=document.getElementById("sty-face-opacity-val");Je&&(Je.textContent=Math.round(oe.faceOpacity*100)+"%"),document.getElementById("sty-edge-visible").checked=oe.edgeVisible,document.getElementById("sty-edge-profile").checked=oe.profileEdge,document.getElementById("sty-grid-visible").checked=oe.gridVisible,document.getElementById("sty-axis-visible").checked=oe.axisVisible;const _e=document.getElementById("sty-bg-mid-row"),V=document.getElementById("sty-bg-ground-row");_e&&(_e.style.display=oe.bgMode==="gradient3"?"flex":"none"),V&&(V.style.display=oe.bgMode==="solid"?"none":"flex")};document.getElementById("sty-bg-mode")?.addEventListener("change",oe=>{const ce=oe.target.value;t.updateBackground(ce),Q()});const ee=(oe,ce)=>{document.getElementById(oe)?.addEventListener("input",Me=>{const $e=Me.target.value;ce==="sky"?t.updateBackground(void 0,$e):ce==="ground"?t.updateBackground(void 0,void 0,$e):t.updateBackground(void 0,void 0,void 0,$e)})};ee("sty-bg-sky","sky"),ee("sty-bg-ground","ground"),ee("sty-bg-mid","mid"),document.getElementById("sty-face-front")?.addEventListener("input",oe=>{const ce=parseInt(oe.target.value.replace("#",""),16);t.setFaceColors(ce,void 0)}),document.getElementById("sty-face-back")?.addEventListener("input",oe=>{const ce=parseInt(oe.target.value.replace("#",""),16);t.setFaceColors(void 0,ce)}),document.getElementById("sty-face-opacity")?.addEventListener("input",oe=>{const ce=parseInt(oe.target.value);t.setFaceOpacity(ce/100);const Me=document.getElementById("sty-face-opacity-val");Me&&(Me.textContent=ce+"%")}),document.getElementById("sty-edge-color")?.addEventListener("input",oe=>{const ce=parseInt(oe.target.value.replace("#",""),16);t.setEdgeStyle({color:ce})}),document.getElementById("sty-edge-width")?.addEventListener("input",oe=>{const ce=oe.target.value,Me=document.getElementById("sty-edge-width-val");Me&&(Me.textContent=ce)}),document.getElementById("sty-edge-visible")?.addEventListener("change",oe=>{t.setEdgeStyle({visible:oe.target.checked})}),document.getElementById("sty-edge-profile")?.addEventListener("change",oe=>{t.setEdgeStyle({profileEdge:oe.target.checked})}),document.getElementById("sty-grid-visible")?.addEventListener("change",oe=>{t.setGridVisible(oe.target.checked)}),document.getElementById("sty-axis-visible")?.addEventListener("change",oe=>{t.setAxisVisible(oe.target.checked)}),document.getElementById("sty-grid-color")?.addEventListener("input",oe=>{const ce=parseInt(oe.target.value.replace("#",""),16);t.setGridColor(ce)})}{const D=document.getElementById("xia-inspector"),B=document.getElementById("inspector-btn"),j=document.getElementById("xi-close"),{getMaterialLibrary:X,GeometryState:Y,GEOMETRY_STATES:k}=await hu(async()=>{const{getMaterialLibrary:be,GeometryState:Te,GEOMETRY_STATES:xe}=await Promise.resolve().then(()=>x0);return{getMaterialLibrary:be,GeometryState:Te,GEOMETRY_STATES:xe}},void 0),G=X();G.setBridge(r);let Q=1,ee=[],oe=0;const ce=document.getElementById("xi-material");if(ce){const be=G.getAll();for(const Te of be){const xe=document.createElement("option");xe.value=Te.id,xe.textContent=`${Te.name} (${Te.nameEn})`,ce.appendChild(xe)}}const Me=()=>{D&&D.classList.toggle("open")};B?.addEventListener("click",be=>{be.stopPropagation(),Me()}),j?.addEventListener("click",()=>D?.classList.remove("open")),D?.querySelectorAll(".xi-tab").forEach(be=>{be.addEventListener("click",()=>{D.querySelectorAll(".xi-tab").forEach(xe=>xe.classList.remove("active")),D.querySelectorAll(".xi-tab-content").forEach(xe=>xe.classList.remove("active")),be.classList.add("active");const Te=be.dataset.tab;document.getElementById(`xi-tab-${Te}`)?.classList.add("active")})});const $e=(be,Te=0)=>Te===0?Math.round(be).toLocaleString():be.toFixed(Te).replace(/\B(?=(\d{3})+\.)/g,","),Je=be=>{const Te=document.getElementById("xi-state-steps");if(!Te)return;const xe=["point","line","face","volume","xia"],ke=xe.indexOf(be);Te.querySelectorAll(".xi-step").forEach(Ue=>{const N=Ue.dataset.state||"",E=xe.indexOf(N);Ue.classList.remove("active","passed"),E===ke?Ue.classList.add("active"):E<ke&&Ue.classList.add("passed")}),Te.querySelectorAll(".xi-step-line").forEach((Ue,N)=>{Ue.classList.toggle("passed",N<ke)})};Je("point");const _e=be=>{const Te=document.getElementById("xi-material-hint"),xe=document.getElementById("xi-material-props"),ke=document.getElementById("xi-phys-badge"),Ue=document.getElementById("xi-assign-btn");if(!be||be===""){Te&&(Te.style.display=""),xe&&(xe.style.display="none"),ke&&(ke.textContent="Appearance",ke.style.background="rgba(156, 39, 176, 0.15)",ke.style.color="#ce93d8"),Ue?.classList.remove("assigned");return}const N=G.get(be);if(!N)return;Te&&(Te.style.display="none"),xe&&(xe.style.display=""),ke&&(ke.textContent="XIA (물체)",ke.style.background="rgba(76, 175, 80, 0.15)",ke.style.color="#81c784"),Ue?.classList.add("assigned");const E=document.getElementById("xi-density"),J=document.getElementById("xi-thermal");E&&(E.value=N.physical.density.toLocaleString()),J&&(J.value=String(N.physical.thermalConductivity)),D?.querySelectorAll(".xi-fire-btn").forEach(Oe=>{Oe.classList.toggle("active",Oe.dataset.fire===N.physical.fireRating)});const ue=G.computePhysics(oe,be),me=document.getElementById("xi-mass"),he=document.getElementById("xi-weight-n");ue&&(me&&(me.textContent=$e(ue.mass,1)),he&&(he.textContent=$e(ue.weight,1)))},V=()=>{t.refreshMaterialColors()};G.onChange(V),ce?.addEventListener("change",()=>{const be=ce.value,Te=c.selection.getSelectedFaces(),xe=Te.length>0?Te:ee;console.log("[Material] assign to faces:",xe,"material:",be),xe.length>0&&be?G.assignToFaces(xe,be):xe.length>0&&!be&&G.unassignFromFaces(xe),ee=xe,_e(be||null),Pt(ee)}),document.getElementById("xi-assign-btn")?.addEventListener("click",()=>{!ce||ee.length===0||(G.hasMaterial(ee)?(G.unassignFromFaces(ee),ce.value="",_e(null)):ce.value&&(G.assignToFaces(ee,ce.value),_e(ce.value)),Pt(ee))});const Pt=be=>{ee=be;const Te=document.getElementById("xi-empty"),xe=document.getElementById("xi-content");if(be.length===0){Te&&(Te.style.display=""),xe&&(xe.style.display="none"),Je("point");return}Te&&(Te.style.display="none"),xe&&(xe.style.display=""),D&&!D.classList.contains("open")&&D.classList.add("open");const ke=r.getXiaInfo(be),Ue=document.getElementById("xi-id"),N=document.getElementById("xi-name");if(Ue&&(Ue.textContent=`XIA-${String(Q).padStart(4,"0")}`),ke&&!ke.empty){const E=G.determineState({faceCount:ke.faceCount||0,isSolid:ke.isSolid||!1,height:ke.height||0},be),J=k[E];Je(E);const ue=document.getElementById("xi-solid-dot"),me=document.getElementById("xi-solid-label"),he=document.getElementById("xi-solid-sub"),Oe=document.getElementById("xi-shape-type");ue&&(ue.className="xi-solid-dot "+E),me&&(me.textContent=`${J.icon} ${J.labelEn}`),he&&(he.textContent=J.description),Oe&&(Oe.textContent=`□ ${ke.shapeType||""}`);const Ee=document.getElementById("xi-length"),De=document.getElementById("xi-width"),_t=document.getElementById("xi-height");Ee&&(Ee.textContent=$e(ke.length||0)),De&&(De.textContent=$e(ke.width||0)),_t&&(_t.textContent=$e(ke.height||0));const ye=document.getElementById("xi-area"),Ne=(ke.surfaceArea||0)/1e6;ye&&(ye.textContent=$e(Ne,1));const Ye=document.getElementById("xi-volume")?.closest(".xi-computed-box"),Qe=document.getElementById("xi-weight")?.closest(".xi-computed-box");if(E===Y.Volume||E===Y.Xia){Ye&&(Ye.style.display=""),Qe&&(Qe.style.display="");const St=document.getElementById("xi-volume"),W=(ke.volume||0)/1e9;St&&(St.textContent=$e(W,1)),oe=ke.volume||0}else Ye&&(Ye.style.display="none"),Qe&&(Qe.style.display="none"),oe=0;const Re=document.getElementById("xi-physical-section");Re&&(E===Y.Volume||E===Y.Xia?(Re.style.display="",Re.style.opacity="1",Re.style.pointerEvents=""):(Re.style.display="",Re.style.opacity="0.35",Re.style.pointerEvents="none"));const ct=G.getCommonMaterial(be);ce&&(ce.value=ct?ct.id:""),_e(ct?ct.id:null);const it=document.getElementById("xi-snap-count");it&&(it.textContent=String(ke.snapPoints||0)),N&&!N.dataset.edited&&(E===Y.Xia&&ct?N.value=`${ct.name} ${ke.shapeType||"객체"}`:N.value=`${J.label} ${ke.shapeType||""}`.trim())}else{const E=document.getElementById("xi-length"),J=document.getElementById("xi-width"),ue=document.getElementById("xi-height");E&&(E.textContent="-"),J&&(J.textContent="-"),ue&&(ue.textContent="-"),Je("face")}};document.getElementById("xi-name")?.addEventListener("input",be=>{be.target.dataset.edited="true"}),c.selection.onChange(be=>{Pt(be),be.length>0&&Q++}),window.addEventListener("keydown",be=>{be.target instanceof HTMLInputElement||be.target instanceof HTMLSelectElement||((be.key==="i"||be.key==="I")&&Me(),be.key==="Escape"&&D?.classList.contains("open")&&D.classList.remove("open"))})}{const D=new Ly(e,r,c.selection,{onGroupSelect:B=>{c.selection.selectGroup(B),console.log(`[ComponentPanel] Group-${B} selected`)},onGroupDoubleClick:B=>{c.selection.enterGroupEdit(B),console.log(`[ComponentPanel] Group-${B} edit mode`)},onGroupDelete:B=>{console.log(`[ComponentPanel] Group-${B} deleted`)},onRefresh:()=>{c.executeAction("group"),D.refresh()}});window.__axia_componentPanel=D,window.addEventListener("keydown",B=>{B.target.tagName!=="INPUT"&&(B.key==="o"||B.key==="O")&&!B.ctrlKey&&!B.altKey&&!B.shiftKey&&D.toggle()}),c.selection.onChange(()=>{D.refresh()})}console.log("AXiA 3D ready. OSNAP: F3=Toggle, R=Rect, P=Push/Pull, I=Inspector, O=Outliner")}Iy().catch(console.error);
