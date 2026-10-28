// Reproducible code-native SportOS pulse icon. No fonts, external images or AI asset dependency.
import {deflateSync} from 'node:zlib';import {writeFileSync,mkdirSync} from 'node:fs';
const size=1024,scale=2,n=size*scale;
const colors={bg:[16,43,49],tile:[17,105,116],line:[129,211,210],end:[242,248,250]};
const path=[[292,627],[405,627],[482,390],[555,659],[623,478],[736,478]];
const segmentDistance=(x,y,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1];const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);};
const raw=Buffer.alloc(size*(1+size*3));
for(let y=0;y<size;y++){for(let x=0;x<size;x++){
 const sum=[0,0,0];for(let sy=0;sy<scale;sy++)for(let sx=0;sx<scale;sx++){
  const xx=x+(sx+.5)/scale,yy=y+(sy+.5)/scale;
  let c=colors.bg;const dx=Math.max(340-xx,0,xx-684),dy=Math.max(340-yy,0,yy-684);
  if(dx*dx+dy*dy<=175*175)c=colors.tile;
  if(path.some((a,i)=>i&&segmentDistance(xx,yy,path[i-1],a)<=24))c=colors.line;
  if([path[0],path.at(-1)].some(p=>Math.hypot(xx-p[0],yy-p[1])<=24))c=colors.end;
  c.forEach((v,i)=>sum[i]+=v);
 }
 const offset=y*(1+size*3)+1+x*3;sum.forEach((v,i)=>raw[offset+i]=Math.round(v/(scale*scale)));
}}
const crc=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
const chunk=(type,data)=>{const name=Buffer.from(type),len=Buffer.alloc(4),check=Buffer.alloc(4);len.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([len,name,data,check]);};
const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
mkdirSync('apps/mobile/assets',{recursive:true});
writeFileSync('apps/mobile/assets/icon.png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
console.log('Generated opaque 1024px SportOS icon.');
