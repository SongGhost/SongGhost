"use client";

import { Check, Mic2, Radio, RotateCcw, Sliders, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PERSONAS, type PersonaId } from "@/data/personas";
import type { Station } from "@/data/stations";
import { clampFmFrequency, MAX_FM_FREQUENCY, MIN_FM_FREQUENCY } from "@/lib/saved-stations";
import {
  CHATTER_PACING_OPTIONS,
  ERA_LOCK_OPTIONS,
  getChatterPacingProfile,
  MAX_VIBE_PROMPT_LENGTH,
  MEMORY_PRESET_SLOTS,
  normalizeMemoryPresets,
  normalizeVoiceProfileOverride,
  resolveEraLock,
  sanitizeVibePrompt,
  VOICE_ACCENT_ORDER,
  VOICE_DELIVERY_PACING_ORDER,
  VOICE_ENERGY_ORDER,
  VOICE_SNARK_ORDER,
  type ChatterPacing,
  type EraLock,
  type MemoryPresetList,
  type StationConfig,
  type VoiceAccent,
  type VoiceDeliveryPacing,
  type VoiceEnergy,
  type VoiceProfileOverride,
  type VoiceSnark,
} from "@/types/station";

const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors focus:border-amber-500";

const labelClass = "block font-mono text-[10px] uppercase tracking-widest text-zinc-500";

const sectionClass = "space-y-2 border-t border-zinc-800/80 pt-4 first:border-t-0 first:pt-0";

/** Sentinel for "inherit the station's authored host" in the picker. */
const INHERIT_HOST = "__inherit__";

/** Sentinel for "inherit the listener's global chatter setting". */
const INHERIT_PACING = "__inherit__";

type StationEditDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** Station being edited — the drawer renders nothing without one */
  station: Station | null;
  config: StationConfig | undefined;
  /** Listener's global pacing, shown as the inherited value */
  globalChatterPacing: ChatterPacing;
  memoryPresets: MemoryPresetList;
  onSave: (stationId: string, patch: Partial<StationConfig>) => void;
  onReset: (stationId: string) => void;
  /** Park this station on a dial button. Called on save when a slot is picked. */
  onSaveToPreset: (slot: number, station: Station) => void;
};

type DraftState = {
  name: string;
  frequency: string;
  hostPersonaId: string;
  chatterPacing: string;
  eraLock: EraLock;
  vibePrompt: string;
  voiceEnergy: string;
  voiceAccent: string;
  voiceSnark: string;
  voicePacing: string;
  presetSlot: number | null;
};

const INHERIT_VOICE = "__inherit__";

function draftFromConfig(station: Station, config: StationConfig | undefined): DraftState {
  const voice = normalizeVoiceProfileOverride(config?.voiceProfile);
  return {
    name: config?.name ?? station.name,
    frequency: String(config?.frequency ?? station.frequency),
    hostPersonaId: config?.hostPersonaId ?? INHERIT_HOST,
    chatterPacing: config?.chatterPacing ?? INHERIT_PACING,
    eraLock: resolveEraLock(config?.eraLock),
    vibePrompt: config?.vibePrompt ?? "",
    voiceEnergy: voice?.energy ?? INHERIT_VOICE,
    voiceAccent: voice?.accent ?? INHERIT_VOICE,
    voiceSnark: voice?.snark ?? INHERIT_VOICE,
    voicePacing: voice?.pacing ?? INHERIT_VOICE,
    presetSlot: null,
  };
}

function draftVoiceProfile(draft: DraftState): VoiceProfileOverride | undefined {
  return normalizeVoiceProfileOverride({
    energy: draft.voiceEnergy === INHERIT_VOICE ? undefined : (draft.voiceEnergy as VoiceEnergy),
    accent: draft.voiceAccent === INHERIT_VOICE ? undefined : (draft.voiceAccent as VoiceAccent),
    snark: draft.voiceSnark === INHERIT_VOICE ? undefined : (draft.voiceSnark as VoiceSnark),
    pacing:
      draft.voicePacing === INHERIT_VOICE
        ? undefined
        : (draft.voicePacing as VoiceDeliveryPacing),
  });
}

export default function StationEditDrawer({
  open,
  onClose,
  station,
  config,
  globalChatterPacing,
  memoryPresets,
  onSave,
  onReset,
  onSaveToPreset,
}: StationEditDrawerProps) {
  const [draft, setDraft] = useState<DraftState | null>(null);

  // Keyed on the station so opening the drawer on a different card always starts
  // from that station's own values rather than the last one's edits.
  useEffect(() => {
    if (!open || !station) {
      setDraft(null);
      return;
    }
    setDraft(draftFromConfig(station, config));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, station?.id]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const slots = useMemo(() => normalizeMemoryPresets(memoryPresets), [memoryPresets]);

  if (!open || !station || !draft) return null;

  const update = <K extends keyof DraftState>(key: K, value: DraftState[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const inheritedPacing = getChatterPacingProfile(globalChatterPacing);

  const handleSave = () => {
    const trimmedName = draft.name.trim();
    onSave(station.id, {
      // A name matching the station's own is stored as no override, so a later
      // rename of the underlying station still reaches the listener.
      name: trimmedName && trimmedName !== station.name ? trimmedName : undefined,
      frequency: clampFmFrequency(Number(draft.frequency)),
      hostPersonaId:
        draft.hostPersonaId === INHERIT_HOST ? null : (draft.hostPersonaId as PersonaId),
      chatterPacing:
        draft.chatterPacing === INHERIT_PACING ? null : (draft.chatterPacing as ChatterPacing),
      eraLock: draft.eraLock,
      vibePrompt: sanitizeVibePrompt(draft.vibePrompt),
      voiceProfile: draftVoiceProfile(draft),
    });

    if (draft.presetSlot) onSaveToPreset(draft.presetSlot, station);
    onClose();
  };

  const handleReset = () => {
    onReset(station.id);
    setDraft(draftFromConfig(station, undefined));
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close station settings"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${station.name}`}
        className="relative flex h-full w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <Sliders className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="truncate font-sans text-sm font-semibold text-zinc-100">
                Station Settings
              </h2>
              <p className="truncate font-mono text-[10px] text-zinc-500">{station.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <section className={sectionClass}>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1">
                <label htmlFor="station-edit-name" className={labelClass}>
                  Station Name
                </label>
                <input
                  id="station-edit-name"
                  type="text"
                  value={draft.name}
                  maxLength={40}
                  autoComplete="off"
                  onChange={(e) => update("name", e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="station-edit-frequency" className={labelClass}>
                  Dial
                </label>
                <input
                  id="station-edit-frequency"
                  type="number"
                  inputMode="decimal"
                  min={MIN_FM_FREQUENCY}
                  max={MAX_FM_FREQUENCY}
                  step={0.1}
                  value={draft.frequency}
                  onChange={(e) => update("frequency", e.target.value)}
                  onBlur={() =>
                    update("frequency", String(clampFmFrequency(Number(draft.frequency))))
                  }
                  className={`${inputClass} tabular-nums`}
                />
              </div>
            </div>
          </section>

          <section className={sectionClass}>
            <span className={labelClass}>Host</span>
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Host override">
              <HostOption
                label="Station Default"
                sublabel={
                  PERSONAS.find((p) => p.id === station.defaultPersonaId)?.name ?? "DJ"
                }
                selected={draft.hostPersonaId === INHERIT_HOST}
                onSelect={() => update("hostPersonaId", INHERIT_HOST)}
              />
              {PERSONAS.map((persona) => (
                <HostOption
                  key={persona.id}
                  label={persona.name}
                  sublabel={persona.defaultGenre}
                  selected={draft.hostPersonaId === persona.id}
                  onSelect={() => update("hostPersonaId", persona.id)}
                />
              ))}
            </div>
          </section>

          <section className={sectionClass}>
            <label htmlFor="station-edit-chatter" className={labelClass}>
              DJ Chatter Pacing
            </label>
            <select
              id="station-edit-chatter"
              value={draft.chatterPacing}
              onChange={(e) => update("chatterPacing", e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              <option value={INHERIT_PACING}>
                Use my default ({inheritedPacing.label})
              </option>
              {CHATTER_PACING_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="font-sans text-[10px] leading-snug text-zinc-500">
              {draft.chatterPacing === INHERIT_PACING
                ? inheritedPacing.description
                : getChatterPacingProfile(draft.chatterPacing).description}
            </p>
          </section>

          <section className={sectionClass}>
            <label htmlFor="station-edit-era" className={labelClass}>
              Era Lock
            </label>
            <select
              id="station-edit-era"
              value={draft.eraLock}
              onChange={(e) => update("eraLock", resolveEraLock(e.target.value))}
              className={`${inputClass} cursor-pointer`}
            >
              {ERA_LOCK_OPTIONS.map((era) => (
                <option key={era.id} value={era.id}>
                  {era.label}
                  {era.startYear !== null ? ` (${era.startYear}–${era.endYear})` : ""}
                </option>
              ))}
            </select>
            <p className="font-sans text-[10px] leading-snug text-zinc-500">
              {draft.eraLock === "all"
                ? "No release-year restriction — the full catalog is in play."
                : "Only tracks with a confirmed release year inside this decade are queued, and the host stays in period."}
            </p>
          </section>

          <section className={sectionClass}>
            <label htmlFor="station-edit-vibe" className={labelClass}>
              Custom Vibe Prompt
            </label>
            <textarea
              id="station-edit-vibe"
              value={draft.vibePrompt}
              maxLength={MAX_VIBE_PROMPT_LENGTH}
              rows={3}
              placeholder="Late-night highway drive, keep it moody and low-key…"
              onChange={(e) => update("vibePrompt", e.target.value)}
              className={`${inputClass} resize-none leading-relaxed`}
            />
            <p className="text-right font-mono text-[9px] tabular-nums text-zinc-600">
              {draft.vibePrompt.length} / {MAX_VIBE_PROMPT_LENGTH}
            </p>
          </section>

          <section className={sectionClass}>
            <span className={labelClass}>Custom Voice Tuning</span>
            <p className="font-sans text-[10px] leading-snug text-zinc-500">
              Colour the host&apos;s delivery without replacing who they are. Leave
              fields on Host Default to keep the persona&apos;s authored character.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <VoiceSelect
                id="station-edit-voice-energy"
                label="Energy"
                value={draft.voiceEnergy}
                options={VOICE_ENERGY_ORDER}
                onChange={(value) => update("voiceEnergy", value)}
              />
              <VoiceSelect
                id="station-edit-voice-accent"
                label="Accent"
                value={draft.voiceAccent}
                options={VOICE_ACCENT_ORDER}
                onChange={(value) => update("voiceAccent", value)}
              />
              <VoiceSelect
                id="station-edit-voice-snark"
                label="Snark"
                value={draft.voiceSnark}
                options={VOICE_SNARK_ORDER}
                onChange={(value) => update("voiceSnark", value)}
              />
              <VoiceSelect
                id="station-edit-voice-pacing"
                label="Spoken Pacing"
                value={draft.voicePacing}
                options={VOICE_DELIVERY_PACING_ORDER}
                onChange={(value) => update("voicePacing", value)}
              />
            </div>
          </section>

          <section className={sectionClass}>
            <span className={labelClass}>Save to Memory Preset</span>
            <div className="flex gap-1.5" role="radiogroup" aria-label="Memory preset slot">
              {MEMORY_PRESET_SLOTS.map((slot) => {
                const occupant = slots[slot - 1];
                const selected = draft.presetSlot === slot;
                return (
                  <button
                    key={slot}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => update("presetSlot", selected ? null : slot)}
                    title={
                      occupant
                        ? `Slot ${slot} — replaces ${occupant.stationName}`
                        : `Slot ${slot} — empty`
                    }
                    className={`flex h-9 flex-1 items-center justify-center rounded-lg border font-mono text-xs font-bold tabular-nums transition-all ${
                      selected
                        ? "border-amber-500 bg-amber-500 text-zinc-950"
                        : occupant
                          ? "border-zinc-700 bg-zinc-900 text-amber-400/80 hover:border-amber-500/50"
                          : "border-zinc-800 bg-zinc-900/60 text-zinc-600 hover:border-zinc-700"
                    }`}
                  >
                    {slot}
                  </button>
                );
              })}
            </div>
            <p className="font-sans text-[10px] leading-snug text-zinc-500">
              {draft.presetSlot
                ? slots[draft.presetSlot - 1]
                  ? `Replaces "${slots[draft.presetSlot - 1]?.stationName}" on button ${draft.presetSlot}.`
                  : `Parks this station on button ${draft.presetSlot}.`
                : "Optional — pick a button to park this station on the dial."}
            </p>
          </section>
        </div>

        <footer className="flex items-center gap-2 border-t border-zinc-800 px-5 py-4">
          <button
            type="button"
            onClick={handleSave}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-widest text-zinc-950 transition-all hover:bg-amber-400 active:scale-95"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Save Settings
          </button>
          <button
            type="button"
            onClick={handleReset}
            title="Clear every override and go back to the station's defaults"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2.5 font-mono text-[10px] uppercase tracking-widest text-zinc-400 transition-colors hover:border-red-500/40 hover:text-red-400"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Reset
          </button>
        </footer>
      </aside>
    </div>
  );
}

function VoiceSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} cursor-pointer capitalize`}
      >
        <option value={INHERIT_VOICE}>Host Default</option>
        {options.map((option) => (
          <option key={option} value={option} className="capitalize">
            {option.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </div>
  );
}

function HostOption({
  label,
  sublabel,
  selected,
  onSelect,
}: {
  label: string;
  sublabel: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-all ${
        selected
          ? "border-amber-500/60 bg-amber-500/10"
          : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
      }`}
    >
      <span className="flex items-center gap-1.5">
        <Mic2
          className={`h-3 w-3 shrink-0 ${selected ? "text-amber-400" : "text-zinc-600"}`}
          aria-hidden="true"
        />
        <span
          className={`truncate font-sans text-xs font-medium ${
            selected ? "text-amber-400" : "text-zinc-200"
          }`}
        >
          {label}
        </span>
      </span>
      <span className="truncate font-mono text-[9px] text-zinc-500">{sublabel}</span>
    </button>
  );
}

/** Dial-position badge shared by the drawer trigger and station cards. */
export function StationEditButton({
  onClick,
  label,
  className = "",
}: {
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className={`rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-amber-500/10 hover:text-amber-400 ${className}`}
    >
      <Radio className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}
