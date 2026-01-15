import path from "node:path";

export type MediaInfoType =
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "ptt"
  | "pdf"
  | "file"
  | "document"
  | "doc"
  | "docx"
  | "xls"
  | "xlsx"
  | "ppt"
  | "pptx"
  | "csv"
  | "txt"
  | "json";

const EXTENSION_TO_INFO: Record<string, MediaInfoType> = {
  ".jpg": "image",
  ".jpeg": "image",
  ".png": "image",
  ".gif": "image",
  ".webp": "image",
  ".mp4": "video",
  ".mov": "video",
  ".avi": "video",
  ".mkv": "video",
  ".webm": "video",
  ".mp3": "audio",
  ".wav": "audio",
  ".ogg": "audio",
  ".m4a": "audio",
  ".aac": "audio",
  ".pdf": "pdf",
  ".doc": "doc",
  ".docx": "docx",
  ".xls": "xls",
  ".xlsx": "xlsx",
  ".ppt": "ppt",
  ".pptx": "pptx",
  ".csv": "csv",
  ".txt": "txt",
  ".json": "json",
  ".zip": "file",
  ".rar": "file",
  ".7z": "file"
};

const EXTENSION_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".json": "application/json",
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed"
};

export function normalizeMediaType(input?: string): MediaInfoType | undefined {
  if (!input) return undefined;
  const value = input.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "voice") return "voice";
  if (value === "ptt") return "ptt";
  if (value === "document") return "document";
  if (value === "file") return "file";
  const allowed: MediaInfoType[] = [
    "image",
    "video",
    "audio",
    "voice",
    "ptt",
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "csv",
    "txt",
    "json"
  ];
  return allowed.includes(value as MediaInfoType) ? (value as MediaInfoType) : undefined;
}

export function inferMediaType(filePath: string): MediaInfoType {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_INFO[ext] ?? "file";
}

export function resolveMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? "application/octet-stream";
}

export function resolveMediaTypes(infoType: MediaInfoType): {
  outerType: string;
  innerType: string;
} {
  if (infoType === "image") {
    return { outerType: "externalShareImage", innerType: "image" };
  }
  if (infoType === "video") {
    return { outerType: "externalShareVideo", innerType: "video" };
  }
  if (infoType === "audio" || infoType === "voice" || infoType === "ptt") {
    return { outerType: "audioVoiceNotes", innerType: "audio" };
  }
  if (infoType === "file" || infoType === "document") {
    return { outerType: "documentSharing", innerType: "document" };
  }
  if (
    infoType === "pdf" ||
    infoType === "doc" ||
    infoType === "docx" ||
    infoType === "xls" ||
    infoType === "xlsx" ||
    infoType === "ppt" ||
    infoType === "pptx" ||
    infoType === "csv" ||
    infoType === "txt" ||
    infoType === "json"
  ) {
    return { outerType: "documentSharing", innerType: infoType };
  }
  return { outerType: "documentSharing", innerType: infoType };
}

export function isAudioType(infoType: MediaInfoType): boolean {
  return infoType === "audio" || infoType === "voice" || infoType === "ptt";
}

export function isVideoType(infoType: MediaInfoType): boolean {
  return infoType === "video";
}

export function isImageType(infoType: MediaInfoType): boolean {
  return infoType === "image";
}
