/**
 * SLF GoldDesk — evidence storage.
 * Photos are compressed in the browser before they ever reach us (see PhotoInput);
 * this module only writes the bytes and records the file_object row.
 */
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { one } from "./db.js";

const BUCKET = process.env.S3_BUCKET || "slf-golddesk-media-4471";
const REGION = process.env.AWS_REGION || "ap-south-1";
let client;
const s3 = () => (client ??= new S3Client({ region: REGION }));

/** Store one image (plus its thumbnail) and return the file_object id. */
export async function storeImage({ kind, buffer, thumbBuffer, mime, width, height, employeeId }) {
  const stamp = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 10);
  const key = `media/${kind}/${stamp}/${rand}.jpg`;
  const thumbKey = thumbBuffer ? `media/${kind}/${stamp}/${rand}_thumb.jpg` : null;

  await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer,
    ContentType: mime || "image/jpeg", ServerSideEncryption: "AES256" }));
  if (thumbBuffer)
    await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: thumbKey, Body: thumbBuffer,
      ContentType: "image/jpeg", ServerSideEncryption: "AES256" }));

  const row = await one(
    `INSERT INTO file_object (kind, s3_key, mime, bytes, width_px, height_px, thumb_s3_key, captured_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [kind, key, mime || "image/jpeg", buffer.length, width ?? null, height ?? null, thumbKey, employeeId ?? null]);
  return { fileId: Number(row.id), key, thumbKey };
}

/** Short-lived link so a photo can be shown in the browser without making the bucket public. */
export async function viewUrl(s3Key, seconds = 300) {
  if (!s3Key) return null;
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }), { expiresIn: seconds });
}
