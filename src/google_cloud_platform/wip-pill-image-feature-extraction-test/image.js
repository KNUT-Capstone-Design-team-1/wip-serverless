const { createHash } = require("node:crypto");
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function normalizeImage(value) {
  if (typeof value !== "string") throw new Error("Invalid image");
  const base64 = value.replace(/^data:image\/[\w.+-]+;base64,/, "").replace(/\s/g, "");
  if (!base64 || base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error("Invalid image");
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64").replace(/=+$/, "") !== base64.replace(/=+$/, "")) {
    throw new Error("Invalid image");
  }
  let mimeType;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mimeType = "image/jpeg";
  else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mimeType = "image/png";
  else if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") mimeType = "image/webp";
  else if (bytes.toString("ascii", 4, 8) === "ftyp" && /^(heic|heix|heim|heis)$/.test(bytes.toString("ascii", 8, 12))) mimeType = "image/heic";
  else if (bytes.toString("ascii", 4, 8) === "ftyp" && /^(mif1|msf1)$/.test(bytes.toString("ascii", 8, 12))) mimeType = "image/heif";
  else throw new Error("Unsupported image format");
  return { bytes, inlineData: { data: bytes.toString("base64"), mimeType } };
}

function prepareImages(body, model) {
  if (!body || (!body.front && !body.back)) throw new Error("Image not received");
  // Bump this version whenever the prompt/schema changes. Front/back order matters.
  const hash = createHash("sha256").update(JSON.stringify(["pill-features-v2", model || ""]));
  const images = {};
  for (const side of ["front", "back"]) {
    const image = body[side] ? normalizeImage(body[side]) : null;
    hash.update(`${side}:${image?.bytes.length || 0}:`);
    if (image) {
      hash.update(image.bytes);
      images[side] = image.inlineData;
    }
  }
  return { images, key: hash.digest("hex") };
}

module.exports = { prepareImages };
