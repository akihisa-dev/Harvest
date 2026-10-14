import type {YoutubeFormat} from "../../core/youtube.js";

/** Bounded transient evidence from an extension-owned page, never collection metadata. */
export interface YoutubePageEvidence {
  readonly videoId: string;
  readonly title: string;
  readonly previewUrl: string;
  readonly formats: YoutubeFormat[];
  readonly capture?: {readonly url: string;readonly body: number[]};
  readonly error?: string;
}
export function isYoutubePageEvidence(value: unknown): value is YoutubePageEvidence {
  if(!value||typeof value!=="object")return false;
  const v=value as Record<string,unknown>;
  if(typeof v["videoId"]!=="string"||typeof v["title"]!=="string"||typeof v["previewUrl"]!=="string"||!Array.isArray(v["formats"])||v["formats"].length>128)return false;
  if(v["error"]!==undefined&&typeof v["error"]!=="string")return false;
  if(!v["formats"].every(f=>f&&typeof f==="object"&&Number.isSafeInteger(f.itag)&&f.itag>0
    &&typeof f.lastModified==="string"&&/^\d{1,20}$/.test(f.lastModified)&&typeof f.xtags==="string"&&f.xtags.length<1024
    &&typeof f.mimeType==="string"&&f.mimeType.length<256&&typeof f.language==="string"&&typeof f.defaultAudio==="boolean"
    &&[f.contentLength,f.durationMs,f.height,f.fps,f.bitrate].every(n=>Number.isSafeInteger(n)&&n>=0)&&f.durationMs>0))return false;
  const c=v["capture"];
  if(c===undefined)return true;
  if(!c||typeof c!=="object")return false;
  const capture=c as Record<string,unknown>;
  return typeof capture["url"]==="string"&&capture["url"].length<16384&&Array.isArray(capture["body"])
    &&capture["body"].length>0&&capture["body"].length<=65536&&capture["body"].every(b=>Number.isInteger(b)&&b>=0&&b<=255);
}
