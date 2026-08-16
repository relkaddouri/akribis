"use server";

/**
 * Uploads catalogue photos to Supabase Storage.
 *
 * Same shape as lib/server/product-photo.ts and lib/server/pharmacy.ts:
 * the picker calls this directly rather than at form submission, and the
 * service-role client does the write. Two differences, both deliberate:
 *
 *  - `requireAdmin()`, not `requireUser()`. A catalogue photo is national
 *    — one upload changes what every pharmacy sees.
 *  - the bucket is created with its own limits rather than bare
 *    `{ public: true }`, so the ceiling holds even if some future caller
 *    forgets to check.
 *
 * Access rules: the bucket is public for reads, which is what lets an
 * <img> on a pharmacy screen load without a signed URL. Writes have no
 * RLS policy at all, so the anon and authenticated keys cannot insert —
 * only the service-role key can, and it only ever runs behind
 * `requireAdmin()` here. See tests/admin/catalogue-photos.test.ts.
 */

import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CATALOGUE_PHOTO_BUCKET,
  CATALOGUE_PHOTO_MIME_TYPES,
  MAX_CATALOGUE_PHOTO_SIZE_BYTES,
  extensionForMime,
  rejectionReason,
} from "@/lib/catalogue/photo-rules";

export type UploadedPhoto = { url: string };
export type UploadResult =
  | { ok: true; photos: UploadedPhoto[]; rejets: string[] }
  | { ok: false; error: string };

async function ensureBucket(admin: ReturnType<typeof createAdminClient>) {
  await admin.storage.createBucket(CATALOGUE_PHOTO_BUCKET, {
    public: true,
    fileSizeLimit: MAX_CATALOGUE_PHOTO_SIZE_BYTES,
    allowedMimeTypes: [...CATALOGUE_PHOTO_MIME_TYPES],
  });
  // A "already exists" error is the expected outcome on every call but the
  // first, and is not worth surfacing.
}

/**
 * Uploads a batch and reports per-file rejections rather than failing the
 * lot: dropping six files in and being told only "invalid" would leave
 * the admin guessing which one.
 *
 * Photos are stored under a random path with no product id in it — the
 * fiche does not exist yet when creating one, and re-keying the object
 * later would be a move for no gain.
 */
export async function uploadCataloguePhotos(formData: FormData): Promise<UploadResult> {
  await requireAdmin();

  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) return { ok: false, error: "Aucun fichier reçu." };

  const admin = createAdminClient();
  const photos: UploadedPhoto[] = [];
  const rejets: string[] = [];
  let bucketChecked = false;

  for (const file of files) {
    const reason = rejectionReason(file);
    if (reason) {
      rejets.push(reason);
      continue;
    }

    const path = `${crypto.randomUUID()}.${extensionForMime(file.type)}`;

    let { error } = await admin.storage
      .from(CATALOGUE_PHOTO_BUCKET)
      .upload(path, file, { contentType: file.type });

    if (error && !bucketChecked && /bucket not found/i.test(error.message)) {
      await ensureBucket(admin);
      bucketChecked = true;
      ({ error } = await admin.storage
        .from(CATALOGUE_PHOTO_BUCKET)
        .upload(path, file, { contentType: file.type }));
    }

    if (error) {
      rejets.push(`${file.name} : échec du téléversement.`);
      continue;
    }

    const {
      data: { publicUrl },
    } = admin.storage.from(CATALOGUE_PHOTO_BUCKET).getPublicUrl(path);
    photos.push({ url: publicUrl });
  }

  return { ok: true, photos, rejets };
}
