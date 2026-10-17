import sharp from 'sharp';
import heicConvert from 'heic-convert';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// WhatsApp image messages accept JPEG/PNG up to 5 MB. We normalise every image to a compressed JPEG
// (max 1200x1500, EXIF-rotated, usually 150-400 KB) so it loads fast on customers' phones.
const MAX_W = 1200;
const MAX_H = 1500;
const TARGET_BYTES = 900 * 1024;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export const LOCAL_UPLOAD_DIR = path.resolve('uploads');

export class ImageError extends Error {
  status = 400;
}

function isHeic(buf: Buffer) {
  // ISO-BMFF "ftyp" box with a HEIF brand
  if (buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  const brand = buf.toString('ascii', 8, 12);
  return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand);
}

/** Any common image (JPG, PNG, WEBP, AVIF, GIF, TIFF, HEIC/iPhone) -> optimised JPEG buffer. */
export async function toWhatsAppJpeg(input: Buffer, maxW = MAX_W, maxH = MAX_H): Promise<Buffer> {
  if (input.length > MAX_INPUT_BYTES) throw new ImageError('Image is larger than 25 MB');
  let buf = input;
  if (isHeic(buf)) {
    try {
      buf = Buffer.from(await heicConvert({ buffer: buf as any, format: 'JPEG', quality: 0.92 }));
    } catch {
      throw new ImageError('Could not read this HEIC/iPhone photo. Export it as JPG and try again.');
    }
  }
  let meta;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    throw new ImageError('This file is not a supported image');
  }
  if (!meta.width || !meta.height) throw new ImageError('This file is not a supported image');
  const base = () =>
    sharp(buf, { failOn: 'none' })
      .rotate() // respect phone orientation
      .resize({ width: maxW, height: maxH, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }); // transparent PNG -> white
  for (const quality of [82, 72, 62, 52]) {
    const out = await base().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (out.length <= TARGET_BYTES || quality === 52) return out;
  }
  throw new ImageError('Could not compress image');
}

// ---------------- Storage: local folder (default) or any S3-compatible bucket (Cloudflare R2, AWS S3, Wasabi...) ----------------

let s3: S3Client | null = null;
export function storageMode(): 'S3' | 'LOCAL' {
  return process.env.S3_BUCKET ? 'S3' : 'LOCAL';
}
function s3Client() {
  s3 ??= new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined, // e.g. https://<account>.r2.cloudflarestorage.com
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID || '', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '' },
  });
  return s3;
}

/** Stores a JPEG and returns the URL to save in the DB (relative /uploads/... for local, absolute for S3). */
export async function storeJpeg(jpeg: Buffer, folder = 'products'): Promise<string> {
  const name = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomBytes(8).toString('hex')}.jpg`;
  if (storageMode() === 'S3') {
    await s3Client().send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET, Key: name, Body: jpeg, ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    const base = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
    if (!base) throw new Error('S3_PUBLIC_URL is required when S3_BUCKET is set (public URL of the bucket)');
    return `${base}/${name}`;
  }
  const file = path.join(LOCAL_UPLOAD_DIR, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, jpeg);
  return `/uploads/${name}`;
}

export async function processAndStore(input: Buffer, folder = 'products') {
  return storeJpeg(await toWhatsAppJpeg(input), folder);
}

/** Download an image from a link (Google Drive "view" links are converted to direct download). */
export async function fetchImage(url: string, headers: Record<string, string> = {}): Promise<Buffer> {
  let u = url.trim();
  const drive = u.match(/drive\.google\.com\/file\/d\/([^/]+)/) ?? u.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (drive) u = `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  if (u.includes('dropbox.com')) u = /[?&]dl=0/.test(u) ? u.replace(/dl=0/, 'dl=1') : `${u}${u.includes('?') ? '&' : '?'}dl=1`;
  if (!/^https?:\/\//i.test(u)) throw new ImageError(`Not a web link: ${url}`);
  const res = await fetch(u, { headers, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!res.ok) throw new ImageError(`Download failed (${res.status}) for ${url}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_INPUT_BYTES) throw new ImageError('Image is larger than 25 MB');
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/html')) throw new ImageError(`Link is a web page, not an image (make it public / direct link): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function importFromUrl(url: string, folder = 'products') {
  return processAndStore(await fetchImage(url), folder);
}

/** Read an image we stored ourselves (local or S3 URL) or any http(s) URL. */
export async function loadStoredImage(url: string): Promise<Buffer> {
  if (url.startsWith('/uploads/')) {
    const file = path.join(LOCAL_UPLOAD_DIR, url.slice('/uploads/'.length));
    if (!file.startsWith(LOCAL_UPLOAD_DIR + path.sep)) throw new ImageError('Bad path');
    return fs.readFile(file);
  }
  return fetchImage(url);
}
