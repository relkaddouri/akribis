"use server";

/**
 * Read/write facade for the pharmacy's own profile: identity fields shown
 * on the settings page, plus receipt customization. Every write is scoped
 * to the caller's own pharmacy via requireOwner() — never trust an id from
 * form input for a single-tenant-scoped write like this.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { requireOwner, requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  pharmacyInfoSchema,
  receiptSettingsSchema,
  parseReceiptSettings,
  MAX_LOGO_SIZE_BYTES,
  type ReceiptSettings,
} from "@/lib/validations/pharmacy";

export type ActionState = { error?: string; success?: boolean };

export type PharmacySettings = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  ice: string | null;
  orderNumber: string | null;
  logoUrl: string | null;
  receiptSettings: ReceiptSettings;
  /** Dirhams per loyalty point; 0 means the programme is off. */
  loyaltyRate: number;
};

const LOGO_BUCKET = "pharmacy-logos";

/** Everything the printed receipt shows about the pharmacy itself. */
export type ReceiptBranding = {
  pharmacyName: string;
  address: string | null;
  phone: string | null;
  ice: string | null;
  logoUrl: string | null;
  showLogo: boolean;
  legalNotice: string | null;
  thankYouMessage: string | null;
};

/**
 * Read-only branding for the till receipt, gated by requireUser() rather
 * than requireOwner(): assistants work the counter and their sales must
 * print the same letterhead. getPharmacySettings() stays owner-only
 * because it backs the settings *forms*, which assistants may not open.
 */
export async function getReceiptBranding(): Promise<ReceiptBranding> {
  const user = await requireUser();
  const pharmacy = await prisma.pharmacy.findUniqueOrThrow({
    where: { id: user.pharmacyId },
    select: {
      name: true,
      address: true,
      phone: true,
      ice: true,
      logoUrl: true,
      receiptSettings: true,
      loyaltyRate: true,
    },
  });

  const settings = parseReceiptSettings(pharmacy.receiptSettings);
  return {
    pharmacyName: pharmacy.name,
    address: pharmacy.address,
    phone: pharmacy.phone,
    ice: pharmacy.ice,
    logoUrl: pharmacy.logoUrl,
    showLogo: settings.showLogo,
    legalNotice: settings.legalNotice,
    thankYouMessage: settings.thankYouMessage,
  };
}

export async function getPharmacySettings(): Promise<PharmacySettings> {
  const owner = await requireOwner();
  const pharmacy = await prisma.pharmacy.findUniqueOrThrow({
    where: { id: owner.pharmacyId },
  });

  return {
    id: pharmacy.id,
    name: pharmacy.name,
    address: pharmacy.address,
    phone: pharmacy.phone,
    ice: pharmacy.ice,
    orderNumber: pharmacy.orderNumber,
    logoUrl: pharmacy.logoUrl,
    receiptSettings: parseReceiptSettings(pharmacy.receiptSettings),
    loyaltyRate: Number(pharmacy.loyaltyRate),
  };
}

async function uploadLogo(pharmacyId: string, file: File): Promise<string> {
  const admin = createAdminClient();
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${pharmacyId}/logo.${extension}`;

  const { error: uploadError } = await admin.storage.from(LOGO_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type,
  });

  if (uploadError && /bucket not found/i.test(uploadError.message)) {
    await admin.storage.createBucket(LOGO_BUCKET, { public: true });
    const retry = await admin.storage.from(LOGO_BUCKET).upload(path, file, {
      upsert: true,
      contentType: file.type,
    });
    if (retry.error) throw new Error("Impossible de téléverser le logo");
  } else if (uploadError) {
    throw new Error("Impossible de téléverser le logo");
  }

  const {
    data: { publicUrl },
  } = admin.storage.from(LOGO_BUCKET).getPublicUrl(path);
  // Cache-bust so the new logo shows immediately instead of a stale
  // browser-cached image at the same URL.
  return `${publicUrl}?v=${Date.now()}`;
}

export async function updatePharmacyInfoAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner();

  const parsed = pharmacyInfoSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address"),
    phone: formData.get("phone"),
    ice: formData.get("ice"),
    orderNumber: formData.get("orderNumber"),
    loyaltyRate: formData.get("loyaltyRate"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  let logoUrl: string | undefined;
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (!logo.type.startsWith("image/")) {
      return { error: "Le logo doit être une image" };
    }
    if (logo.size > MAX_LOGO_SIZE_BYTES) {
      return { error: "Le logo ne doit pas dépasser 2 Mo" };
    }
    try {
      logoUrl = await uploadLogo(owner.pharmacyId, logo);
    } catch {
      return { error: "Impossible de téléverser le logo" };
    }
  }

  await prisma.pharmacy.update({
    where: { id: owner.pharmacyId },
    data: { ...parsed.data, ...(logoUrl ? { logoUrl } : {}) },
  });

  revalidatePath("/parametres");
  return { success: true };
}

export async function updateReceiptSettingsAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner();

  const parsed = receiptSettingsSchema.safeParse({
    showLogo: formData.get("showLogo") === "on",
    legalNotice: formData.get("legalNotice"),
    thankYouMessage: formData.get("thankYouMessage"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  await prisma.pharmacy.update({
    where: { id: owner.pharmacyId },
    data: { receiptSettings: parsed.data },
  });

  revalidatePath("/parametres");
  return { success: true };
}
