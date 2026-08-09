"use server";

/**
 * Uploads a product photo to Supabase Storage and returns its public
 * URL — called directly from the wizard's photo picker (not tied to
 * form submission), matching the pattern in lib/server/pharmacy.ts for
 * the pharmacy logo. Storage is inherently network-dependent, so this
 * only ever runs while online; the rest of the product form stays
 * fully usable offline since photoUrl is just an optional string field.
 */

import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

const PRODUCT_PHOTO_BUCKET = "product-photos";
export const MAX_PRODUCT_PHOTO_SIZE_BYTES = 2 * 1024 * 1024;

export async function uploadProductPhoto(file: File): Promise<{ url: string }> {
  const user = await requireUser();

  if (!file.type.startsWith("image/")) {
    throw new Error("Le fichier doit être une image");
  }
  if (file.size > MAX_PRODUCT_PHOTO_SIZE_BYTES) {
    throw new Error("L'image ne doit pas dépasser 2 Mo");
  }

  const admin = createAdminClient();
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.pharmacyId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await admin.storage.from(PRODUCT_PHOTO_BUCKET).upload(path, file, {
    contentType: file.type,
  });

  if (uploadError && /bucket not found/i.test(uploadError.message)) {
    await admin.storage.createBucket(PRODUCT_PHOTO_BUCKET, { public: true });
    const retry = await admin.storage.from(PRODUCT_PHOTO_BUCKET).upload(path, file, {
      contentType: file.type,
    });
    if (retry.error) throw new Error("Impossible de téléverser la photo");
  } else if (uploadError) {
    throw new Error("Impossible de téléverser la photo");
  }

  const {
    data: { publicUrl },
  } = admin.storage.from(PRODUCT_PHOTO_BUCKET).getPublicUrl(path);

  return { url: publicUrl };
}
