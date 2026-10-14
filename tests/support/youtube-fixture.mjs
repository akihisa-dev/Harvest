import {encodeBytes as b,encodeNumber as n,encodeText as t,joinBytes as join} from '../../dist/extension/core/youtube-wire.js';
export {b,n,t,join};
export const videoId='abcdefghijk',url='https://r1-test.googlevideo.com/videoplayback?sabr=1&n=fixture';
export const video={itag:137,lastModified:'12345',xtags:'',mimeType:'video/mp4; codecs="avc1.640028"',contentLength:8,durationMs:2000,height:1080,fps:30,bitrate:1000,language:'',defaultAudio:false};
export const audio={...video,itag:140,mimeType:'audio/mp4; codecs="mp4a.40.2"',height:0,fps:0,language:'en.0',defaultAudio:true};
export const identity=f=>join([n(1,f.itag),n(2,BigInt(f.lastModified)),t(3,f.xtags)]);
export const template=join([b(1,join([n(28,800),n(40,0)])),b(5,new Uint8Array([1,2,3])),b(19,join([b(1,n(16,1)),b(2,new Uint8Array(32).fill(7))]))]);
function umpInt(value){
  if(value<128)return new Uint8Array([value]);
  const length=value<16384?2:value<2097152?3:value<268435456?4:5;
  const bits=length===5?0:8-length,first=length===5?240:((256-(1<<(9-length)))|(value&((1<<bits)-1)));
  value=Math.floor(value/(2**bits));const result=[first];
  for(let i=1;i<length;i++){result.push(value&255);value=Math.floor(value/256);}
  return new Uint8Array(result);
}
export const part=(type,data)=>join([umpInt(type),umpInt(data.length),data]);
export const initialization=(f,last=2)=>part(42,join([t(1,videoId),b(2,identity(f)),n(3,f.durationMs),n(4,last),t(5,f.mimeType),n(9,f.durationMs),n(10,1000)]));
export const header=(f,id,sequence,bytes,overrides=[])=>part(20,join([n(1,id),t(2,videoId),n(3,f.itag),n(4,12345),n(8,sequence===0?1:0),n(9,sequence),n(11,sequence?1000*(sequence-1):0),n(12,sequence?1000:0),b(13,identity(f)),n(14,bytes.length),...overrides]));
export const segment=(f,id,sequence,data=new Uint8Array([sequence,2]))=>join([header(f,id,sequence,data),part(21,new Uint8Array([id,...data])),part(22,new Uint8Array([id]))]);
export const completeResponse=()=>join([initialization(video),initialization(audio),...[video,audio].flatMap((f,i)=>[0,1,2].map(s=>segment(f,i,s)))]);
