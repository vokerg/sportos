// Deterministic 3x Android tab templates; iOS uses native SF Symbols.
import {deflateSync} from 'node:zlib';
import {writeFileSync,mkdirSync} from 'node:fs';
const paths={
 Home:[[[3,10],[12,3],[21,10]],[[5,9],[5,21],[19,21],[19,9]],[[9,21],[9,14],[15,14],[15,21]]],
 Daily:[[[3,5],[21,5],[21,21],[3,21],[3,5]],[[7,3],[7,7]],[[17,3],[17,7]],[[3,11],[21,11]],[[8,15],[10,15]],[[14,15],[16,15]]],
 Activities:[[[2,13],[6,13],[9,5],[14,20],[17,11],[22,11]]],
 RunLab:[[[4,4],[4,20],[20,20]],[[8,15],[12,10],[15,12],[20,5]],[[16,5],[20,5],[20,9]]],
 More:[[[5,12],[5.01,12]],[[12,12],[12.01,12]],[[19,12],[19.01,12]]],
};
const distance=(x,y,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1];const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);};
const crc=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
const chunk=(type,data)=>{const name=Buffer.from(type),len=Buffer.alloc(4),check=Buffer.alloc(4);len.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([len,name,data,check]);};
mkdirSync('apps/mobile/assets/tabs',{recursive:true});
for(const [name,lines] of Object.entries(paths)){
 const size=72,raw=Buffer.alloc(size*(1+size*4));
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  let hits=0;for(let sy=0;sy<2;sy++)for(let sx=0;sx<2;sx++){
   if(lines.some(line=>line.some((p,i)=>i&&distance((x+(sx+.5)/2)/3,(y+(sy+.5)/2)/3,line[i-1],p)<(name==='More'?1.6:.9))))hits++;
  }
  raw[y*(1+size*4)+1+x*4+3]=Math.round(hits*255/4);
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
 writeFileSync(`apps/mobile/assets/tabs/${name}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
