"use client";

import Link from "next/link";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import BrandHeader from "@/components/layout/Header";
import BreakCard from "@/components/studio/BreakCard";
import ShareStationModal from "@/components/studio/ShareStationModal";
import StudioHeader from "@/components/studio/StudioHeader";
import TuneStationPanel, {
  type BlueprintSeedDraft,
} from "@/components/studio/TuneStationPanel";
import {
  defaultStudioDjConfig,
  newClientId,
  type StudioBreakKind,
  type StudioDjConfig,
  type StudioTimelineBreak,
  type StudioTimelineTrack,
} from "@/components/studio/types";
import HostSettingsModal from "@/components/player/HostSettingsModal";
import { useMusicSource } from "@/context/MusicSourceContext";
import { DEFAULT_PERSONA, getPersonaById, type PersonaId } from "@/data/personas";
import { useStudioStations } from "@/hooks/useStudioStations";
import {
  normalizeStudioDjConfig,
  type StudioDjBreakCue,
  type StudioBreakSessionTrigger,
  type StudioStationManifest,
} from "@/lib/studio/manifest";
import {
  DEFAULT_DJ_TUNING,
  type DjTuningSettings,
} from "@/types/dj";

type SaveStationResponse = {
  id?: string;
  url?: string;
  error?: string;
  success?: boolean;
  message?: string;
  manifest?: StudioStationManifest;
};

type LoadStationResponse = {
  id?: string;
  error?: string;
  manifest?: StudioStationManifest;
};

function manifestTracksToTimeline(
  tracks: StudioStationManifest["tracks"],
): StudioTimelineTrack[] {
  return (tracks ?? []).map((track) => ({
    clientId: newClientId("track"),
    title: track.title,
    artist: track.artist,
    youtubeId: track.youtubeId,
    previewUrl: track.previewUrl,
    durationSec: track.durationSec,
  }));
}

function manifestBreaksToTimeline(
  djBreaks: StudioDjBreakCue[],
  callerAudioUrls: string[],
): StudioTimelineBreak[] {
  const callerSet = new Set(callerAudioUrls);
  return djBreaks.map((cue) => {
    const trigger = cue.sessionTrigger ??
      (cue.cuePointSec === 0 && (cue.trackIndex === 0 || cue.trackIndex == null)
        ? "opener"
        : "between_tracks");
    const afterTrackIndex =
      trigger === "opener" || trigger === "station_launch"
        ? -1
        : trigger === "every_n_tracks"
          ? 0
          : 1;
    const kind: StudioBreakKind =
      cue.kind ?? (cue.isCallIn ? "call_in" : "full_break");
    const isCallIn = cue.isCallIn === true || kind === "call_in";
    const applyTelephoneEq = Boolean(
      cue.audioUrl && (isCallIn || callerSet.has(cue.audioUrl)),
    );

    return {
      clientId: newClientId("break"),
      afterTrackIndex,
      mode: isCallIn ? "call_in" : cue.audioUrl ? "mic" : "ai_host",
      kind,
      timing: cue.timing ?? "BETWEEN_TRACKS",
      label: cue.label,
      scriptText: cue.customText,
      audioUrl: cue.audioUrl,
      applyTelephoneEq,
    };
  });
}

/**
 * Ghost Studio Station Blueprint Builder — seed criteria, host rules,
 * vibe directives, and caller voicemails. Playback regenerates a statutory
 * stream from the published profile.
 */
function StudioPageInner() {
  const { userId, isSignedIn } = useAuth();
  const searchParams = useSearchParams();
  const editMixId = searchParams.get("edit")?.trim() || null;
  const { djVolume } = useMusicSource();
  const { saveStudioMix } = useStudioStations();
  const [stationTitle, setStationTitle] = useState("Late Night Drive Mix");
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [djConfig, setDjConfig] = useState<StudioDjConfig>(() =>
    defaultStudioDjConfig(DEFAULT_PERSONA.id),
  );
  const [hostTuning, setHostTuning] = useState<DjTuningSettings>(DEFAULT_DJ_TUNING);
  const [hostSettingsOpen, setHostSettingsOpen] = useState(false);
  const [tracks, setTracks] = useState<StudioTimelineTrack[]>([]);
  const [breaks, setBreaks] = useState<StudioTimelineBreak[]>([]);
  const [seedArtistsText, setSeedArtistsText] = useState("");
  const [seedDraft, setSeedDraft] = useState<BlueprintSeedDraft>({
    decades: [],
    genres: [],
    energy: 55,
    catalogDepth: 35,
  });
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSignInPrompt, setPublishSignInPrompt] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [publishedStudioId, setPublishedStudioId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(Boolean(editMixId));
  /** Preserve original createdAt when overwriting an existing mix. */
  const existingCreatedAtRef = useRef<string | null>(null);
  const hydratedEditIdRef = useRef<string | null>(null);

  // Keep djConfig.djVolume in sync with Host Settings / MusicSource.
  useEffect(() => {
    setDjConfig((prev) =>
      prev.djVolume === djVolume ? prev : { ...prev, djVolume },
    );
  }, [djVolume]);

  // Hydrate canvas when `/studio?edit=` is present.
  useEffect(() => {
    if (!editMixId) {
      setHydrating(false);
      return;
    }
    if (hydratedEditIdRef.current === editMixId) return;

    let cancelled = false;
    setHydrating(true);
    setHydrateError(null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/studio/save-station?id=${encodeURIComponent(editMixId)}`,
        );
        const data = (await res.json()) as LoadStationResponse;
        if (!res.ok || !data.manifest) {
          throw new Error(data.error ?? "Failed to load studio mix");
        }
        if (cancelled) return;

        const manifest = data.manifest;
        const nextDj = normalizeStudioDjConfig(
          manifest.djConfig,
          DEFAULT_PERSONA.id,
        );
        setEditingId(manifest.id);
        setStationTitle(manifest.name);
        setCoverImageUrl(manifest.coverImageUrl?.trim() || null);
        setDjConfig(nextDj);
        setTracks(manifestTracksToTimeline(manifest.tracks ?? []));
        setSeedArtistsText((manifest.seedArtists ?? []).join(", "));
        setSeedDraft({
          decades: (manifest.eras ?? []).filter((era): era is BlueprintSeedDraft["decades"][number] =>
            ["60s", "70s", "80s", "90s", "2000s", "2010s", "Modern"].includes(era),
          ),
          genres: manifest.seedGenres ?? [],
          energy: manifest.energyLevel ?? 55,
          catalogDepth: manifest.catalogDepth ?? 35,
        });
        setBreaks(
          manifestBreaksToTimeline(
            manifest.djBreaks ?? [],
            manifest.callerAudioUrls ?? [],
          ),
        );
        existingCreatedAtRef.current = manifest.createdAt ?? null;
        hydratedEditIdRef.current = editMixId;
      } catch (err) {
        if (!cancelled) {
          setHydrateError(
            err instanceof Error ? err.message : "Failed to load studio mix",
          );
        }
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editMixId]);

  const breaksBySlot = useMemo(() => {
    const map = new Map<number, StudioTimelineBreak>();
    for (const item of breaks) {
      map.set(item.afterTrackIndex, item);
    }
    return map;
  }, [breaks]);

  const handlePersonaChange = useCallback((personaId: PersonaId) => {
    setDjConfig((prev) => ({ ...prev, personaId }));
  }, []);

  const handleHostTuningChange = useCallback((next: DjTuningSettings) => {
    setHostTuning(next);
  }, []);

  const handleSaveBreak = useCallback((breakItem: StudioTimelineBreak) => {
    setBreaks((prev) => {
      const without = prev.filter(
        (item) => item.afterTrackIndex !== breakItem.afterTrackIndex,
      );
      return [...without, breakItem];
    });
  }, []);

  const handleRemoveBreak = useCallback((afterTrackIndex: number) => {
    setBreaks((prev) =>
      prev.filter((item) => item.afterTrackIndex !== afterTrackIndex),
    );
  }, []);

  const handlePublish = useCallback(
    async (mode: "save" | "save_as_new" = "save") => {
      const name = stationTitle.trim();
      if (!name) {
        setPublishError("Give your station a title before publishing.");
        return;
      }
      const seedArtists = seedArtistsText
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean);
      const hasSeeds =
        seedArtists.length > 0 ||
        seedDraft.genres.length > 0 ||
        seedDraft.decades.length > 0 ||
        Boolean(djConfig.customDirectives.trim());
      if (!hasSeeds && tracks.length === 0 && breaks.length === 0) {
        setPublishError("Add seed criteria, a vibe prompt, or a voicemail before publishing.");
        return;
      }

      if (!isSignedIn) {
        setPublishError(null);
        setPublishSignInPrompt(true);
        return;
      }

      setPublishing(true);
      setPublishError(null);
      setPublishSignInPrompt(false);

      try {
        const hostVoiceId = getPersonaById(djConfig.personaId)?.voice ?? undefined;
        const djBreaks: {
          cuePointSec: number;
          trackIndex?: number;
          sessionTrigger?: StudioBreakSessionTrigger;
          everyNTracks?: number;
          kind?: StudioTimelineBreak["kind"];
          timing?: StudioTimelineBreak["timing"];
          audioUrl?: string;
          customText?: string;
          voiceId?: string;
          label?: string;
        }[] = [];
        const callerAudioUrls: string[] = [];

        const opening = breaksBySlot.get(-1);
        if (opening) {
          const customText = opening.scriptText?.trim() || undefined;
          djBreaks.push({
            cuePointSec: 0,
            sessionTrigger: "opener",
            kind: opening.kind,
            timing: opening.timing,
            audioUrl: opening.audioUrl,
            customText,
            voiceId: customText ? hostVoiceId : undefined,
            label: opening.label,
          });
          if (opening.applyTelephoneEq && opening.audioUrl) {
            callerAudioUrls.push(opening.audioUrl);
          }
        }

        const cadence = breaksBySlot.get(0);
        if (cadence) {
          const customText = cadence.scriptText?.trim() || undefined;
          djBreaks.push({
            cuePointSec: 0,
            sessionTrigger: "every_n_tracks",
            everyNTracks: 4,
            kind: cadence.kind,
            timing: cadence.timing,
            audioUrl: cadence.audioUrl,
            customText,
            voiceId: customText ? hostVoiceId : undefined,
            label: cadence.label,
          });
          if (cadence.applyTelephoneEq && cadence.audioUrl) {
            callerAudioUrls.push(cadence.audioUrl);
          }
        }

        const payloadDjConfig: StudioDjConfig = {
          ...djConfig,
          djVolume,
        };

        const overwriteId =
          mode === "save" && editingId ? editingId : undefined;

        const res = await fetch("/api/studio/save-station", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(overwriteId ? { id: overwriteId } : {}),
            ...(overwriteId && existingCreatedAtRef.current
              ? { createdAt: existingCreatedAtRef.current }
              : {}),
            name,
            description: `Hosted by ${payloadDjConfig.personaId}`,
            coverImageUrl: coverImageUrl || undefined,
            authorUserId: userId || undefined,
            userId: userId || undefined,
            seedArtists,
            seedGenres: seedDraft.genres,
            eras: seedDraft.decades,
            energyLevel: seedDraft.energy,
            catalogDepth: seedDraft.catalogDepth,
            vibePrompt: payloadDjConfig.customDirectives,
            tracks: tracks.map((track) => ({
              title: track.title,
              artist: track.artist,
              youtubeId: track.youtubeId,
              previewUrl: track.previewUrl,
              durationSec: track.durationSec,
            })),
            djBreaks,
            callerAudioUrls,
            djConfig: payloadDjConfig,
          }),
        });

        const data = (await res.json()) as SaveStationResponse;
        if (!res.ok || !data.id) {
          throw new Error(data.error ?? "Failed to publish station");
        }

        if (data.manifest) {
          saveStudioMix(data.manifest);
          existingCreatedAtRef.current = data.manifest.createdAt ?? null;
        }

        if (mode === "save_as_new" || !editingId) {
          setEditingId(data.id);
        }

        setPublishedStudioId(data.id);
        setShareOpen(true);
      } catch (err) {
        setPublishError(
          err instanceof Error ? err.message : "Failed to publish station",
        );
      } finally {
        setPublishing(false);
      }
    },
    [
      breaksBySlot,
      coverImageUrl,
      djConfig,
      djVolume,
      editingId,
      saveStudioMix,
      seedArtistsText,
      seedDraft,
      stationTitle,
      tracks,
      userId,
      isSignedIn,
    ],
  );

  const isEditing = Boolean(editingId);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100">
      <div className="border-b border-zinc-800/80 px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <BrandHeader
            actions={
              <Link
                href="/"
                className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-accent"
              >
                ← On Air
              </Link>
            }
          />
        </div>
      </div>

      <StudioHeader
        title={stationTitle}
        onTitleChange={setStationTitle}
        personaId={djConfig.personaId}
        onPersonaChange={handlePersonaChange}
        onOpenHostSettings={() => setHostSettingsOpen(true)}
        customDirectives={djConfig.customDirectives}
        onCustomDirectivesChange={(value) =>
          setDjConfig((prev) => ({ ...prev, customDirectives: value }))
        }
        coverImageUrl={coverImageUrl}
        onCoverImageChange={setCoverImageUrl}
        onPublish={() => void handlePublish("save")}
        publishLabel={isEditing ? "Save Changes" : "Publish Station"}
        onSaveAsNew={
          isEditing ? () => void handlePublish("save_as_new") : undefined
        }
        publishing={publishing || hydrating}
        publishDisabled={!stationTitle.trim() || hydrating}
      />

      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {hydrateError && (
          <p
            className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-sans text-sm text-red-300"
            role="alert"
          >
            {hydrateError}
          </p>
        )}
        {hydrating && !hydrateError && (
          <p className="mb-4 font-mono text-xs uppercase tracking-widest text-zinc-500">
            Loading mix…
          </p>
        )}
        {publishSignInPrompt && (
          <div
            className="mb-4 flex flex-col gap-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            role="status"
          >
            <p className="font-sans text-sm text-amber-200">Sign in to publish</p>
            <SignInButton mode="modal">
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-accent px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-950 transition hover:bg-accent-hover"
              >
                Sign in
              </button>
            </SignInButton>
          </div>
        )}
        {publishError && (
          <p
            className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-sans text-sm text-red-300"
            role="alert"
          >
            {publishError}
          </p>
        )}

        <label className="mb-4 block space-y-1.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            Seed artists
          </span>
          <input
            type="text"
            value={seedArtistsText}
            onChange={(e) => setSeedArtistsText(e.target.value)}
            placeholder="Fleetwood Mac, The Cure, New Order"
            className="w-full rounded-lg border border-white/[0.08] bg-[#121215] px-3 py-2 font-sans text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
        </label>

        <TuneStationPanel
          key={editingId ?? "new"}
          seedsOnly
          initialDraft={seedDraft}
          onDraftChange={setSeedDraft}
          disabled={hydrating || publishing}
        />

        <section className="mt-8 space-y-3" aria-labelledby="voicemail-heading">
          <h2
            id="voicemail-heading"
            className="font-mono text-[11px] font-bold uppercase tracking-widest text-accent"
          >
            Liners &amp; voicemails
          </h2>
          <p className="font-sans text-xs text-zinc-500">
            Attach an opener break or a repeating voicemail. These fire on session
            events — not a fixed track list.
          </p>
          <BreakCard
            afterTrackIndex={-1}
            personaId={djConfig.personaId}
            djVolume={djConfig.djVolume}
            savedBreak={breaksBySlot.get(-1) ?? null}
            onSave={handleSaveBreak}
            onRemove={() => handleRemoveBreak(-1)}
          />
          <BreakCard
            afterTrackIndex={0}
            personaId={djConfig.personaId}
            djVolume={djConfig.djVolume}
            savedBreak={breaksBySlot.get(0) ?? null}
            onSave={handleSaveBreak}
            onRemove={() => handleRemoveBreak(0)}
          />
        </section>
      </main>

      <HostSettingsModal
        open={hostSettingsOpen}
        onClose={() => setHostSettingsOpen(false)}
        value={hostTuning}
        onChange={handleHostTuningChange}
        personaId={djConfig.personaId}
        onPersonaChange={handlePersonaChange}
      />

      <ShareStationModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        studioId={publishedStudioId}
        stationName={stationTitle}
      />
    </div>
  );
}

export default function StudioPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#09090b] font-mono text-xs uppercase tracking-widest text-zinc-500">
          Loading studio…
        </div>
      }
    >
      <StudioPageInner />
    </Suspense>
  );
}
