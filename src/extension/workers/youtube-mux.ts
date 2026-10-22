import {BufferSource,BufferTarget,EncodedAudioPacketSource,EncodedPacketSink,EncodedVideoPacketSource,Input,MP4,Mp4OutputFormat,Output} from "harvest-vendor-mediabunny";
import {hasCompleteMp4Boxes} from "../../core/original-media-structure.js";
import {indexMediaRanges} from "../../core/iso-media-ranges.js";
import type {YoutubeTrackDurations} from "../../core/youtube.js";

/** Copy encoded AVC/AAC packets into one MP4, preserving timestamps and avoiding recompression. */
export async function muxYoutube(video:Blob,audio:Blob,durations:YoutubeTrackDurations,maxBytes:number):Promise<Blob>{
  if(video.size+audio.size>maxBytes)throw new Error("YouTube動画が保存容量の上限を超えています。");
  const buffers:Uint8Array[]=[];
  for(const blob of [video,audio]){
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(!hasCompleteMp4Boxes(bytes))throw new Error("YouTube動画の分割データが不完全または未対応です。");
    buffers.push(bytes);
  }
  // Reuse the bytes inspected above instead of reading both Blobs a second time.
  const inputs=buffers.map(bytes=>new Input({formats:[MP4],source:new BufferSource(bytes)}));
  const target=new BufferTarget(),output=new Output({format:new Mp4OutputFormat(),target});
  const videoSource=new EncodedVideoPacketSource("avc"),audioSource=new EncodedAudioPacketSource("aac");
  const unsubscribe=target.on("write",({end})=>{if(end>maxBytes)throw new Error("YouTube動画が保存容量の上限を超えています。");});
  try{
    const v=await inputs[0]!.getPrimaryVideoTrack(),a=await inputs[1]!.getPrimaryAudioTrack();
    if(!v||!a||await v.getCodec()!=="avc"||await a.getCodec()!=="aac"||(await inputs[0]!.getTracks()).length!==1||(await inputs[1]!.getTracks()).length!==1)throw new Error("YouTube動画の映像または音声を確認できませんでした。");
    const vc=await v.getDecoderConfig(),ac=await a.getDecoderConfig();
    if(!vc||!ac||!vc.codec.startsWith("avc1")||!ac.codec.startsWith("mp4a"))throw new Error("YouTube動画の映像または音声を確認できませんでした。");
    output.addVideoTrack(videoSource);output.addAudioTrack(audioSource);await output.start();
    const tracks=[v,a];
    for(let index=0;index<tracks.length;index++){
      const track=tracks[index]!,sink=new EncodedPacketSink(track);
      const bytes=buffers[index]!,containsMedia=indexMediaRanges(bytes);
      const durationMs=index===0?durations.videoMs:durations.audioMs;
      let previous:object|undefined,count=0,end=0,start=Infinity;
      // Keep only the current declared sample; no playback prefetch queue.
      for(let metadata=await sink.getFirstPacket({metadataOnly:true});metadata;
        metadata=await sink.getNextPacket(metadata,{metadataOnly:true})){
        const packet=previous?await sink.getNextPacket(previous):await sink.getFirstPacket();
        if(!packet||packet.byteLength!==metadata.byteLength||packet.data.length!==metadata.byteLength||!Number.isFinite(packet.timestamp)||!Number.isFinite(packet.duration)||packet.duration<=0)throw new Error("YouTube動画の分割データが不完全または未対応です。");
        // Check the original input before remuxing can hide an invalid sample offset.
        if(packet.data.buffer!==bytes.buffer||!containsMedia(packet.data.byteOffset-bytes.byteOffset,packet.data.byteLength))throw new Error("YouTube動画の分割データが不完全または未対応です。");
        if(index===0)await videoSource.add(packet,{decoderConfig:vc as VideoDecoderConfig});
        else await audioSource.add(packet,{decoderConfig:ac as AudioDecoderConfig});
        previous=metadata;count++;start=Math.min(start,packet.timestamp);end=Math.max(end,packet.timestamp+packet.duration);
      }
      if(!count||Math.abs(start)>0.1||Math.abs(end*1000-durationMs)>100||Math.abs(await track.computeDuration()*1000-durationMs)>100)throw new Error("YouTube動画の末尾まで取得できませんでした。");
    }
    videoSource.close();audioSource.close();await output.finalize();
    if(!target.buffer?.byteLength||target.buffer.byteLength>maxBytes)throw new Error("YouTube動画が保存容量の上限を超えています。");
    return new Blob([target.buffer],{type:"video/mp4"});
  }finally{unsubscribe();videoSource.close();audioSource.close();if(output.state!=="finalized")await output.cancel().catch(()=>{});for(const input of inputs)input.dispose();}
}
