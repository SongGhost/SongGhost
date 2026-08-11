"use client";

import {
  ChevronDown,
  Copy,
  Disc3,
  Loader2,
  Radio,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { PersonaId } from "@/data/personas";
import { useTier } from "@/context/TierContext";
import {
  getAvailablePersonas,
  getPersonaPickerValue,
  toStationPersonaId,
} from "@/lib/dj/personaConfig";

export type StudioHeaderProps = {
  title: string;
  onTitleChange: (title: string) => void;
  personaId: PersonaId;
  onPersonaChange: (personaId: PersonaId) => void;
  onOpenHostSettings: () => void;
  customDirectives: string;
  onCustomDirectivesChange: (value: string) => void;
  coverImageUrl?: string | null;
  onCoverImageChange: (url: string | null) => void;
  onPublish: () => void;
  /** Primary CTA label — e.g. "Publish Station" or "Save Changes". */
  publishLabel?: string;
  /** When set, shows a dropdown with "Save as New Copy". */
  onSaveAsNew?: () => void;
  publishing?: boolean;
  publishDisabled?: boolean;
};

/**
 * Station metadata chrome for Ghost Studio — title, host persona, cover, publish.
 */
export default function StudioHeader({
  title,
  onTitleChange,
  personaId,
  onPersonaChange,
  onOpenHostSettings,
  customDirectives,
  onCustomDirectivesChange,
  coverImageUrl,
  onCoverImageChange,
  onPublish,
  publishLabel = "Publish Station",
  onSaveAsNew,
  publishing = false,
  publishDisabled = false,
}: StudioHeaderProps) {
  const { isPro } = useTier();
  const personaOptions = useMemo(() => getAvailablePersonas(isPro), [isPro]);
  const pickerValue = getPersonaPickerValue(personaId, isPro);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);

  useEffect(() => {
    if (!saveMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!saveMenuRef.current?.contains(e.target as Node)) {
        setSaveMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [saveMenuOpen]);

  const uploadCover = useCallback(
    async (file: File) => {
      setUploading(true);
      setUploadError(null);
      try {
        const formData = new FormData();
        formData.append("image", file);
        const res = await fetch("/api/studio/upload-cover", {
          method: "POST",
          body: formData,
        });
        const data = (await res.json()) as {
          coverImageUrl?: string;
          error?: string;
        };
        if (!res.ok || !data.coverImageUrl) {
          throw new Error(data.error ?? "Failed to upload cover image");
        }
        onCoverImageChange(data.coverImageUrl);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Failed to upload cover image",
        );
      } finally {
        setUploading(false);
      }
    },
    [onCoverImageChange],
  );

  const handleFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      void uploadCover(file);
    },
    [uploadCover],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      handleFile(e.dataTransfer.files?.[0]);
    },
    [handleFile],
  );

  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-accent/90">
          <Radio className="h-3.5 w-3.5" aria-hidden="true" />
          SongHost Studio · Timeline Editor
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="w-full shrink-0 space-y-2 sm:w-40">
            <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              Cover Art
            </span>
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`relative flex aspect-square w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed transition-colors ${
                dragOver
                  ? "border-accent/70 bg-accent/10"
                  : "border-zinc-700 bg-zinc-900/80 hover:border-accent/50"
              }`}
              aria-label="Upload cover image"
            >
              {coverImageUrl ? (
                <Image
                  src={coverImageUrl}
                  alt="Station cover"
                  fill
                  sizes="160px"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <>
                  <Disc3 className="h-8 w-8 text-zinc-600" aria-hidden="true" />
                  <span className="mt-2 px-2 text-center font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                    {uploading ? "Uploading…" : "Drop or browse"}
                  </span>
                </>
              )}
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/70">
                  <Loader2 className="h-5 w-5 animate-spin text-accent" />
                </div>
              )}
              {coverImageUrl && !uploading && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCoverImageChange(null);
                  }}
                  className="absolute right-1.5 top-1.5 rounded-md bg-zinc-950/80 p-1 text-zinc-300 transition-colors hover:text-red-400"
                  aria-label="Remove cover image"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <p className="font-sans text-[11px] leading-snug text-accent/90">
              Notice: Upload original or royalty-free artwork only. Do not use
              copyrighted images.
            </p>
            {uploadError && (
              <p className="font-sans text-[11px] text-red-400" role="alert">
                {uploadError}
              </p>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="min-w-0 flex-1 space-y-1.5">
                <label
                  htmlFor="studio-station-title"
                  className="font-mono text-[10px] uppercase tracking-widest text-zinc-500"
                >
                  Station Title
                </label>
                <input
                  id="studio-station-title"
                  type="text"
                  value={title}
                  onChange={(e) => onTitleChange(e.target.value)}
                  placeholder="Late Night Drive Mix"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2.5 font-sans text-base font-semibold text-zinc-100 outline-none transition-colors placeholder:font-normal placeholder:text-zinc-600 focus:border-accent/70"
                />
              </div>

              <div className="w-full space-y-1.5 sm:max-w-xs lg:w-64">
                <label
                  htmlFor="studio-host-persona"
                  className="font-mono text-[10px] uppercase tracking-widest text-zinc-500"
                >
                  Host Persona
                </label>
                <div className="flex gap-2">
                  <select
                    id="studio-host-persona"
                    value={
                      personaOptions.some((p) => p.id === pickerValue)
                        ? pickerValue
                        : (personaOptions[0]?.id ?? personaId)
                    }
                    onChange={(e) =>
                      onPersonaChange(toStationPersonaId(e.target.value, isPro))
                    }
                    className="w-full cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2.5 font-mono text-xs text-zinc-100 outline-none transition-colors focus:border-accent/70"
                  >
                    {personaOptions.map((persona) => (
                      <option key={persona.id} value={persona.id}>
                        {persona.displayName}
                        {persona.description ? ` · ${persona.description}` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={onOpenHostSettings}
                    className="inline-flex shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 text-zinc-300 transition-colors hover:border-accent/50 hover:text-accent"
                    aria-label="Open host settings"
                    title="Host Settings"
                  >
                    <Settings2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div ref={saveMenuRef} className="relative flex lg:min-w-[10.5rem]">
                <button
                  type="button"
                  onClick={onPublish}
                  disabled={publishing || publishDisabled}
                  className={`inline-flex flex-1 items-center justify-center gap-2 bg-accent px-5 py-2.5 font-mono text-xs font-bold uppercase tracking-widest text-zinc-950 transition-all hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
                    onSaveAsNew ? "rounded-l-lg" : "rounded-lg"
                  }`}
                >
                  {publishing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      {publishLabel}
                    </>
                  )}
                </button>
                {onSaveAsNew && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSaveMenuOpen((open) => !open)}
                      disabled={publishing || publishDisabled}
                      className="inline-flex items-center justify-center rounded-r-lg border-l border-accent/40 bg-accent px-2.5 text-zinc-950 transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="More save options"
                      aria-expanded={saveMenuOpen}
                      aria-haspopup="menu"
                    >
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    {saveMenuOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 top-full z-30 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setSaveMenuOpen(false);
                            onSaveAsNew();
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left font-mono text-[11px] uppercase tracking-wider text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-accent"
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          Save as New Copy
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="studio-custom-directives"
                className="font-mono text-[10px] uppercase tracking-widest text-zinc-500"
              >
                Custom Host Directives
              </label>
              <textarea
                id="studio-custom-directives"
                value={customDirectives}
                onChange={(e) => onCustomDirectivesChange(e.target.value)}
                rows={2}
                placeholder="Optional tone notes for this mix (saved in djConfig)…"
                className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2 font-sans text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-accent/70"
              />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
