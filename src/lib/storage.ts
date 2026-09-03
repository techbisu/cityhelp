/**
 * CityHelp — Storage abstraction layer
 *
 * Default: Cloudinary (free 25GB tier, image/audio/video optimized)
 * Alternative: Cloudflare R2 (zero egress, S3-compatible) — switch via STORAGE_PROVIDER env
 *
 * Interface:
 *   uploadMedia(buffer, key, contentType) → { url, publicId }
 *   deleteMedia(publicId) → void
 *   getMediaUrl(publicId) → string
 *
 * Usage:
 *   const { uploadMedia } = await getStorageProvider();
 *   const result = await uploadMedia(buffer, `tenants/${tenantId}/voice/${mediaId}.m4a`, "audio/mp4");
 */
import { v2 as cloudinary } from "cloudinary";

// ── Cloudinary configuration ──
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";

// ── R2 configuration (future scope) ──
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "cityhelp-media";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

export type StorageProvider = "cloudinary" | "r2";

export interface UploadResult {
  url: string;
  publicId: string;
  provider: StorageProvider;
}

export interface StorageAdapter {
  uploadMedia(buffer: Buffer, key: string, contentType: string): Promise<UploadResult>;
  deleteMedia(publicId: string): Promise<void>;
  getMediaUrl(publicId: string): string;
  isConfigured(): boolean;
}

/**
 * Get the active storage provider based on env config.
 * Falls back gracefully — if neither is configured, returns null.
 */
export function getStorageProvider(): StorageAdapter | null {
  const provider = (process.env.STORAGE_PROVIDER || "cloudinary") as StorageProvider;

  if (provider === "r2" && R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
    return new R2StorageAdapter();
  }

  if (provider === "cloudinary" && CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    // Configure Cloudinary
    cloudinary.config({
      cloud_name: CLOUDINARY_CLOUD_NAME,
      api_key: CLOUDINARY_API_KEY,
      api_secret: CLOUDINARY_API_SECRET,
    });
    return new CloudinaryStorageAdapter();
  }

  return null;
}

export function isStorageConfigured(): boolean {
  const provider = getStorageProvider();
  return provider?.isConfigured() ?? false;
}

// ── Cloudinary Adapter (default) ─────────────────────────

class CloudinaryStorageAdapter implements StorageAdapter {
  isConfigured(): boolean {
    return !!(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
  }

  async uploadMedia(buffer: Buffer, key: string, contentType: string): Promise<UploadResult> {
    // Cloudinary uses "resource_type" to categorize uploads
    const resourceType = contentType.startsWith("image/")
      ? "image"
      : contentType.startsWith("audio/")
      ? "video" // Cloudinary treats audio as "video" resource type
      : contentType.startsWith("video/")
      ? "video"
      : "raw";

    // Sanitize key for Cloudinary public_id (no leading slash, no extension)
    const publicId = key.replace(/^\//, "").replace(/\.[^/.]+$/, "");

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: resourceType,
          folder: "cityhelp",
        },
        (error, result) => {
          if (error) {
            reject(new Error(`Cloudinary upload failed: ${error.message}`));
          } else if (result) {
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
              provider: "cloudinary",
            });
          } else {
            reject(new Error("Cloudinary upload returned no result"));
          }
        }
      );
      uploadStream.end(buffer);
    });
  }

  async deleteMedia(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId);
  }

  getMediaUrl(publicId: string): string {
    return cloudinary.url(publicId, { secure: true });
  }
}

// ── Cloudflare R2 Adapter (future scope — S3-compatible) ──

class R2StorageAdapter implements StorageAdapter {
  isConfigured(): boolean {
    return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
  }

  /**
   * R2 uses the S3-compatible API. In production, this would use @aws-sdk/client-s3
   * with the R2 endpoint URL. For now, this is a stub that documents the interface.
   *
   * To enable R2:
   * 1. bun add @aws-sdk/client-s3
   * 2. Set env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
   * 3. Set STORAGE_PROVIDER=r2
   * 4. Uncomment the implementation below
   */
  async uploadMedia(buffer: Buffer, key: string, contentType: string): Promise<UploadResult> {
    // R2 S3-compatible endpoint
    const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

    // In production, use @aws-sdk/client-s3:
    //
    // import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
    // const s3 = new S3Client({
    //   region: "auto",
    //   endpoint,
    //   credentials: {
    //     accessKeyId: R2_ACCESS_KEY_ID,
    //     secretAccessKey: R2_SECRET_ACCESS_KEY,
    //   },
    // });
    // await s3.send(new PutObjectCommand({
    //   Bucket: R2_BUCKET_NAME,
    //   Key: key,
    //   Body: buffer,
    //   ContentType: contentType,
    // }));
    // const url = R2_PUBLIC_URL
    //   ? `${R2_PUBLIC_URL}/${key}`
    //   : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
    // return { url, publicId: key, provider: "r2" };

    // Stub for now — throws to indicate R2 needs SDK installation
    throw new Error(
      "R2 storage requires @aws-sdk/client-s3. Run: bun add @aws-sdk/client-s3, then uncomment the R2 implementation in src/lib/storage.ts"
    );
  }

  async deleteMedia(publicId: string): Promise<void> {
    // R2 delete via S3 DeleteObjectCommand
    throw new Error("R2 storage requires @aws-sdk/client-s3 (not yet installed)");
  }

  getMediaUrl(publicId: string): string {
    if (R2_PUBLIC_URL) {
      return `${R2_PUBLIC_URL}/${publicId}`;
    }
    return `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${publicId}`;
  }
}

/**
 * Download media from WhatsApp and store it.
 * Called by the webhook when a voice note or photo arrives.
 */
export async function downloadAndStoreMedia(
  tenantId: string,
  mediaBuffer: Buffer,
  mediaId: string,
  mimeType: string
): Promise<UploadResult | null> {
  const storage = getStorageProvider();
  if (!storage) {
    console.log("[Storage:skip] No storage provider configured — media not saved");
    return null;
  }

  // Determine file extension from mime type
  const ext = mimeType.startsWith("image/") ? ".jpg"
    : mimeType.startsWith("audio/") ? ".m4a"
    : mimeType.startsWith("video/") ? ".mp4"
    : "";

  const key = `tenants/${tenantId}/media/${mediaId}${ext}`;

  try {
    const result = await storage.uploadMedia(mediaBuffer, key, mimeType);
    console.log(`[Storage] Uploaded ${mediaId} to ${result.provider}: ${result.url}`);
    return result;
  } catch (e) {
    console.error(`[Storage] Upload failed for ${mediaId}:`, e);
    return null;
  }
}
