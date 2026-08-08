"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import BrandHeader from "@/components/layout/Header";
import BreakCard from "@/components/studio/BreakCard";
import ShareStationModal from "@/components/studio/ShareStationModal";
import StudioHeader from "@/components/studio/StudioHeader";
import TrackSequenceBuilder from "@/components/studio/TrackSequenceBuilder";
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
  return tracks.map((track) => ({
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
    const isOpening =
      cue.cuePointSec === 0 &&
      (cue.trackIndex === 0 || cue.trackIndex == null);
    const afterTrackIndex = isOpening
      ? -1
      : typeof cue.trackIndex === "number"
        ? cue.trackIndex
        : -1;
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
 * Ghost Studio Timeline Editor — build a custom station sequence with
 * inline DJ breaks / call-ins, then publish a shareable manifest.
 */
function StudioPageInner() {
  const { userId } = useAuth();
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
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
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
        setHostTuning((prev) => ({
          ...prev,
          mood: nextDj.energy,
          personality: nextDj.sarcasm,
        }));
        setTracks(manifestTracksToTimeline(manifest.tracks));
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
    setDjConfig((prev) => ({
      ...prev,
      energy: next.mood,
      sarcasm: next.personality,
    }));
  }, []);

  const handleAddTrack = useCallback((track: StudioTimelineTrack) => {
    setTracks((prev) => [...prev, track]);
  }, []);

  const handleMoveUp = useCallback((index: number) => {
    if (index <= 0) return;
    setTracks((prev) => {
      const next = [...prev];
      const tmp = next[index - 1]!;
      next[index - 1] = next[index]!;
      next[index] = tmp;
      return next;
    });
    setBreaks((prev) =>
      prev.map((item) => {
        if (item.afterTrackIndex === index - 1) {
          return { ...item, afterTrackIndex: index };
        }
        if (item.afterTrackIndex === index) {
          return { ...item, afterTrackIndex: index - 1 };
        }
        return item;
      }),
    );
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setTracks((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      const tmp = next[index]!;
      next[index] = next[index + 1]!;
      next[index + 1] = tmp;
      return next;
    });
    setBreaks((prev) =>
      prev.map((item) => {
        if (item.afterTrackIndex === index) {
          return { ...item, afterTrackIndex: index + 1 };
        }
        if (item.afterTrackIndex === index + 1) {
          return { ...item, afterTrackIndex: index };
        }
        return item;
      }),
    );
  }, []);

  const handleRemoveTrack = useCallback((index: number) => {
    setTracks((prev) => prev.filter((_, i) => i !== index));
    setBreaks((prev) =>
      prev
        .filter((item) => item.afterTrackIndex !== index)
        .map((item) =>
          item.afterTrackIndex > index
            ? { ...item, afterTrackIndex: item.afterTrackIndex - 1 }
            : item,
        ),
    );
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
      if (tracks.length === 0) {
        setPublishError("Add at least one track before publishing.");
        return;
      }

      setPublishing(true);
      setPublishError(null);

      try {
        let cueCursor = 0;
        const hostVoiceId =
          getPersonaById(djConfig.personaId)?.elevenLabsVoiceId ?? undefined;
        const djBreaks: {
          cuePointSec: number;
          trackIndex?: number;
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
            trackIndex: 0,
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

        for (let i = 0; i < tracks.length; i++) {
          const track = tracks[i]!;
          const duration = track.durationSec ?? 180;
          const breakAfter = breaksBySlot.get(i);
          if (breakAfter) {
            const customText = breakAfter.scriptText?.trim() || undefined;
            djBreaks.push({
              cuePointSec: cueCursor + duration,
              trackIndex: i,
              kind: breakAfter.kind,
              timing: breakAfter.timing,
              audioUrl: breakAfter.audioUrl,
              customText,
              voiceId: customText ? hostVoiceId : undefined,
              label: breakAfter.label,
            });
            if (breakAfter.applyTelephoneEq && breakAfter.audioUrl) {
              callerAudioUrls.push(breakAfter.audioUrl);
            }
          }
          cueCursor += duration;
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
      stationTitle,
      tracks,
      userId,
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
        publishDisabled={tracks.length === 0 || !stationTitle.trim() || hydrating}
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
        {publishError && (
          <p
            className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-sans text-sm text-red-300"
            role="alert"
          >
            {publishError}
          </p>
        )}

        <TrackSequenceBuilder
          tracks={tracks}
          onAddTrack={handleAddTrack}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onRemove={handleRemoveTrack}
          renderBreakSlot={(afterTrackIndex) => (
            <BreakCard
              key={`break-slot-${afterTrackIndex}`}
              afterTrackIndex={afterTrackIndex}
              personaId={djConfig.personaId}
              djVolume={djConfig.djVolume}
              savedBreak={breaksBySlot.get(afterTrackIndex) ?? null}
              onSave={handleSaveBreak}
              onRemove={() => handleRemoveBreak(afterTrackIndex)}
            />
          )}
        />
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
