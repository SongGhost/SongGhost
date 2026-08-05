import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getPhase5Env } from "@/lib/env";

let r2Client: S3Client | undefined;

function getR2Client(): S3Client {
  if (!r2Client) {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = getPhase5Env();
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
 */
export async function uploadLoreAudioBuffer(
  key: string,
  buffer: Buffer,
  mimeType = "audio/mpeg",
): Promise<string> {
  const { R2_BUCKET_NAME, NEXT_PUBLIC_R2_CDN_URL } = getPhase5Env();

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    }),
  );

  return `${NEXT_PUBLIC_R2_CDN_URL}/${key}`;
}
