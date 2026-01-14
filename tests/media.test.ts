import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inferMediaType,
  normalizeMediaType,
  resolveMediaTypes,
  resolveMimeType
} from "../src/media.js";

test("normalizeMediaType maps aliases and rejects unknowns", () => {
  assert.equal(normalizeMediaType("Voice"), "audio");
  assert.equal(normalizeMediaType("Document"), "document");
  assert.equal(normalizeMediaType("docx"), "docx");
  assert.equal(normalizeMediaType(""), undefined);
  assert.equal(normalizeMediaType("unknown"), undefined);
});

test("inferMediaType uses file extensions", () => {
  assert.equal(inferMediaType("photo.jpg"), "image");
  assert.equal(inferMediaType("clip.mp4"), "video");
  assert.equal(inferMediaType("voice.m4a"), "audio");
  assert.equal(inferMediaType("report.pdf"), "pdf");
  assert.equal(inferMediaType("doc.docx"), "docx");
  assert.equal(inferMediaType("sheet.xlsx"), "xlsx");
  assert.equal(inferMediaType("archive.zip"), "file");
});

test("resolveMimeType maps common extensions", () => {
  assert.equal(resolveMimeType("photo.webp"), "image/webp");
  assert.equal(resolveMimeType("voice.m4a"), "audio/mp4");
  assert.equal(resolveMimeType("report.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(resolveMimeType("unknown.bin"), "application/octet-stream");
});

test("resolveMediaTypes maps to correct outer/inner types", () => {
  assert.deepEqual(resolveMediaTypes("image"), {
    outerType: "externalShareImage",
    innerType: "image"
  });
  assert.deepEqual(resolveMediaTypes("audio"), {
    outerType: "audioVoiceNotes",
    innerType: "audio"
  });
  assert.deepEqual(resolveMediaTypes("docx"), {
    outerType: "documentSharing",
    innerType: "docx"
  });
  assert.deepEqual(resolveMediaTypes("file"), {
    outerType: "documentSharing",
    innerType: "document"
  });
});
