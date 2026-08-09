"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ImagePlus, Loader2, X } from "lucide-react";
import { uploadProductPhoto } from "@/lib/server/product-photo";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function PhotoUploadField({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (file: File) => uploadProductPhoto(file),
    onSuccess: (data) => {
      setError(null);
      onChange(data.url);
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) mutation.mutate(file);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local asset
            <img src={value} alt="Photo du produit" className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-6 text-muted-foreground" strokeWidth={1.5} />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Envoi...
              </>
            ) : value ? (
              "Changer la photo"
            ) : (
              "Ajouter une photo"
            )}
          </Button>
          {value && !mutation.isPending && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
              <X className="size-4" />
              Retirer
            </Button>
          )}
        </div>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
