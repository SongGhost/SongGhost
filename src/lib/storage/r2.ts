import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getPhase5Env } from "@/lib/env";

let r2Client: S3Client | undefined;

/**
 * True when all Cloudflare R2 credentials needed for upload are present.
 * `R2_ENDPOINT` may substitute for `R2_ACCOUNT_ID` (account id still preferred
 * for the S3 client endpoint builder in this module).
 */
export function isR2Configured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const hasEndpoint =
    Boolean(env.R2_ACCOUNT_ID?.trim()) || Boolean(env.R2_ENDPOINT?.trim());
  return (
    hasEndpoint &&
    Boolean(env.R2_ACCESS_KEY_ID?.trim()) &&
    Boolean(env.R2_SECRET_ACCESS_KEY?.trim()) &&
    Boolean(env.R2_BUCKET_NAME?.trim()) &&
    Boolean(env.NEXT_PUBLIC_R2_CDN_URL?.trim())
  );
}

function getR2Client(): S3Client {
  if (!r2Client) {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } =
      getPhase5Env();

    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      throw new Error(
        "Cloudflare R2 is not configured (missing account/credentials)",
      );
    }

    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return r2Client;
}

/**
 * Upload a lore TTS buffer to Cloudflare R2 and return its public CDN URL.
 * Callers should check `isR2Configured()` first and fall back when unset.
 */
export async function uploadLoreAudioBuffer(
  key: string,
  buffer: Buffer,
  mimeType = "audio/mpeg",
): Promise<string> {
  const { R2_BUCKET_NAME, NEXT_PUBLIC_R2_CDN_URL } = getPhase5Env();

  if (!R2_BUCKET_NAME || !NEXT_PUBLIC_R2_CDN_URL) {
    throw new Error(
      "Cloudflare R2 is not configured (missing bucket/CDN URL)",
    );
  }

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    }),
  );

  return `${NEXT_PUBLIC_R2_CDN_URL.replace(/\/$/, "")}/${key}`;
}

/** Inline data-URL fallback when R2 is unavailable (local/dev). */
export function audioBufferToDataUrl(
  buffer: Buffer,
  mimeType = "audio/mpeg",
): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}
