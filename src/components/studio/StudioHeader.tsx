"use client";

import { Loader2, Radio, Settings2, Upload } from "lucide-react";
import { PERSONAS, type PersonaId } from "@/data/personas";

export type StudioHeaderProps = {
  title: string;
  onTitleChange: (title: string) => void;
  personaId: PersonaId;
  onPersonaChange: (personaId: PersonaId) => void;
  onOpenHostSettings: () => void;
  customDirectives: string;
  onCustomDirectivesChange: (value: string) => void;
  onPublish: () => void;
  publishing?: boolean;
  publishDisabled?: boolean;
};

/**
 * Station metadata chrome for Ghost Studio — title, host persona, publish.
 */
export default function StudioHeader({
  title,
  onTitleChange,
  personaId,
  onPersonaChange,
  onOpenHostSettings,
  customDirectives,
  onCustomDirectivesChange,
  onPublish,
  publishing = false,
  publishDisabled = false,
}: StudioHeaderProps) {
  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-500/90">
          <Radio className="h-3.5 w-3.5" aria-hidden="true" />
          SongHost Studio · Timeline Editor
        </div>

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
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2.5 font-sans text-base font-semibold text-zinc-100 outline-none transition-colors placeholder:font-normal placeholder:text-zinc-600 focus:border-amber-600/70"
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
                value={personaId}
                onChange={(e) => onPersonaChange(e.target.value as PersonaId)}
                className="w-full cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2.5 font-mono text-xs text-zinc-100 outline-none transition-colors focus:border-amber-600/70"
              >
                {PERSONAS.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.name} · {persona.defaultGenre}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onOpenHostSettings}
                className="inline-flex shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 text-zinc-300 transition-colors hover:border-amber-600/50 hover:text-amber-400"
                aria-label="Open host settings"
                title="Host Settings"
              >
                <Settings2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onPublish}
            disabled={publishing || publishDisabled}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 font-mono text-xs font-bold uppercase tracking-widest text-zinc-950 transition-all hover:bg-amber-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 lg:min-w-[10.5rem]"
          >
            {publishing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Publishing…
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                Publish Station
              </>
            )}
          </button>
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
            className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2 font-sans text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-amber-600/70"
          />
        </div>
      </div>
    </header>
  );
}
