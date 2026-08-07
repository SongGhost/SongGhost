"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import BrandHeader from "@/components/layout/Header";
import BreakCard from "@/components/studio/BreakCard";
import ShareStationModal from "@/components/studio/ShareStationModal";
import StudioHeader from "@/components/studio/StudioHeader";
import TrackSequenceBuilder from "@/components/studio/TrackSequenceBuilder";
import {
  type StudioTimelineBreak,
  type StudioTimelineTrack,
} from "@/components/studio/types";
import { DEFAULT_PERSONA, type PersonaId } from "@/data/personas";

type SaveStationResponse = {
  id?: string;
  url?: string;
  error?: string;
  manifest?: { id?: string };
};

/**
 * Ghost Studio Timeline Editor — build a custom station sequence with
 * inline DJ breaks / call-ins, then publish a shareable manifest.
 */
export default function StudioPage() {
  const [title, setTitle] = useState("Late Night Drive Mix");
  const [personaId, setPersonaId] = useState<PersonaId>(DEFAULT_PERSONA.id);
  const [tracks, setTracks] = useState<StudioTimelineTrack[]>([]);
  const [breaks, setBreaks] = useState<StudioTimelineBreak[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [publishedStudioId, setPublishedStudioId] = useState<string | null>(null);

  const breaksBySlot = useMemo(() => {
    const map = new Map<number, StudioTimelineBreak>();
    for (const item of breaks) {
      map.set(item.afterTrackIndex, item);
    }
    return map;
  }, [breaks]);

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

  const handlePublish = useCallback(async () => {
    const name = title.trim();
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
      const djBreaks: {
        cuePointSec: number;
        trackIndex?: number;
        kind?: StudioTimelineBreak["kind"];
        audioUrl?: string;
        label?: string;
      }[] = [];
      const callerAudioUrls: string[] = [];

      const opening = breaksBySlot.get(-1);
      if (opening) {
        djBreaks.push({
          cuePointSec: 0,
          trackIndex: 0,
          kind: opening.kind,
          audioUrl: opening.audioUrl,
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
          djBreaks.push({
            cuePointSec: cueCursor + duration,
            trackIndex: i,
            kind: breakAfter.kind,
            audioUrl: breakAfter.audioUrl,
            label: breakAfter.label,
          });
          if (breakAfter.applyTelephoneEq && breakAfter.audioUrl) {
            callerAudioUrls.push(breakAfter.audioUrl);
          }
        }
        cueCursor += duration;
      }

      const res = await fetch("/api/studio/save-station", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: `Hosted by ${personaId}`,
          tracks: tracks.map((track) => ({
            title: track.title,
            artist: track.artist,
            youtubeId: track.youtubeId,
            previewUrl: track.previewUrl,
            durationSec: track.durationSec,
          })),
          djBreaks,
          callerAudioUrls,
        }),
      });

      const data = (await res.json()) as SaveStationResponse;
      if (!res.ok || !data.id) {
        throw new Error(data.error ?? "Failed to publish station");
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
  }, [breaksBySlot, personaId, title, tracks]);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100">
      <div className="border-b border-zinc-800/80 px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <BrandHeader
            actions={
              <Link
                href="/"
                className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-amber-400"
              >
                ← On Air
              </Link>
            }
          />
        </div>
      </div>

      <StudioHeader
        title={title}
        onTitleChange={setTitle}
        personaId={personaId}
        onPersonaChange={setPersonaId}
        onPublish={() => void handlePublish()}
        publishing={publishing}
        publishDisabled={tracks.length === 0 || !title.trim()}
      />

      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
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
              personaId={personaId}
              savedBreak={breaksBySlot.get(afterTrackIndex) ?? null}
              onSave={handleSaveBreak}
              onRemove={() => handleRemoveBreak(afterTrackIndex)}
            />
          )}
        />
      </main>

      <ShareStationModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        studioId={publishedStudioId}
        stationName={title}
      />
    </div>
  );
}
