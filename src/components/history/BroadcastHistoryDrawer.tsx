"use client";

import { History, ListMusic, Mic, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import type { StationTrack } from "@/data/stations";
import { useDjState } from "@/hooks/useDjState";
import type { DjBroadcastSegment } from "@/lib/dj/broadcast-state";

type DrawerTab = "history" | "transcripts" | "upNext";

const TABS: ReadonlyArray<{ id: DrawerTab; label: string; icon: typeof History }> = [
  { id: "history", label: "History", icon: History },
  { id: "transcripts", label: "Transcripts", icon: Mic },
  { id: "upNext", label: "Up Next", icon: ListMusic },
];

const SEGMENT_LABELS: Record<string, string> = {
  song_intro: "Intro",
  recap: "Recap",
  up_next: "Up Next",
  artist_trivia: "Trivia",
  local_events: "Local",
  stinger: "Station ID",
};

type BroadcastHistoryDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** Live queue from the player, so Up Next shows what will actually air. */
  queue: StationTrack[];
  currentIndex: number;
  accentColor?: string;
};

/** Short elapsed label. Falls back to a clock time once a session runs long. */
function formatElapsed(timestamp: number): string {
  const deltaMs = Date.now() - timestamp;
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return "";

  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TabEmptyState({ children }: { children: string }) {
  return <p className="px-1 py-10 text-center font-sans text-xs text-zinc-500">{children}</p>;
}

function TranscriptRow({ segment, live }: { segment: DjBroadcastSegment; live?: boolean }) {
  const label = SEGMENT_LABELS[segment.kind] ?? segment.kind;

  return (
    <li
      className={`rounded-xl border p-3 ${
        live ? "border-amber-500/40 bg-amber-500/5" : "border-zinc-800 bg-zinc-900/40"
      }`}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider ${
            live
              ? "bg-amber-500/20 text-amber-400"
              : "border border-zinc-700/70 bg-zinc-900 text-zinc-400"
          }`}
        >
          {live ? "On Air" : label}
        </span>
        {!live && segment.interrupted && (
          <span
            className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-zinc-600"
            title="Cut short by a skip or station change"
          >
            Cut
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[9px] tabular-nums text-zinc-600">
          {formatElapsed(segment.startedAt)}
        </span>
      </div>
      <p className="font-sans text-xs leading-relaxed text-zinc-300">{segment.script}</p>
      {segment.songTitle && (
        <p className="mt-1.5 truncate font-mono text-[10px] text-zinc-600">
          over {segment.songTitle}
          {segment.artistName ? ` · ${segment.artistName}` : ""}
        </p>
      )}
    </li>
  );
}

/**
 * Sliding log of the broadcast: songs already played, scripts the host has read,
 * and what is still queued.
 *
 * All three tabs are read-only views of state owned elsewhere — play history in
 * the preference store, transcripts in the DJ broadcast log, and the queue from
 * the player. Nothing here can reorder or remove a track; that lives in the
 * playlist modal.
 */
export default function BroadcastHistoryDrawer({
  open,
  onClose,
  queue,
  currentIndex,
  accentColor = "#f59e0b",
}: BroadcastHistoryDrawerProps) {
  const [tab, setTab] = useState<DrawerTab>("history");
  const { playHistory } = useUserPreferences();
  const { activeSegment, transcripts } = useDjState();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const onAirYoutubeId = queue[currentIndex]?.youtubeId?.trim() ?? "";
  const upNext = queue.slice(currentIndex + 1);
  const counts: Record<DrawerTab, number> = {
    history: playHistory.length,
    transcripts: transcripts.length + (activeSegment ? 1 : 0),
    upNext: upNext.length,
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close broadcast log"
      />

      <aside
        className="relative flex h-full w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl"
        style={{ "--station-accent": accentColor } as React.CSSProperties}
        aria-label="Broadcast log"
      >
        <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <History className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <h2 className="font-sans text-sm font-semibold text-zinc-100">Broadcast Log</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg p-1.5 text-zinc-500 transition-colors hover:text-amber-400"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div role="tablist" aria-label="Broadcast log sections" className="flex border-b border-zinc-800">
          {TABS.map(({ id, label, icon: Icon }) => {
            const selected = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(id)}
                className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                  selected
                    ? "border-amber-500 text-amber-400"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                {label}
                {counts[id] > 0 && (
                  <span className="tabular-nums text-zinc-600">{counts[id]}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {tab === "history" &&
            (playHistory.length === 0 ? (
              <TabEmptyState>Nothing has played yet this session.</TabEmptyState>
            ) : (
              <ol className="space-y-1">
                {playHistory.map((entry) => {
                  const onAir = Boolean(onAirYoutubeId) && entry.youtubeId === onAirYoutubeId;
                  return (
                    <li
                      key={`${entry.id}-${entry.playedAt}`}
                      className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 ${
                        onAir
                          ? "border-amber-500/30 bg-amber-500/10"
                          : "border-transparent hover:bg-zinc-900/60"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: onAir ? accentColor : "#3f3f46" }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-sans text-xs text-zinc-200">{entry.title}</p>
                        <p className="truncate font-mono text-[10px] text-zinc-500">
                          {entry.artist}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-[9px] tabular-nums text-zinc-600">
                        {onAir ? "On Air" : formatElapsed(Date.parse(entry.playedAt))}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ))}

          {tab === "transcripts" &&
            (!activeSegment && transcripts.length === 0 ? (
              <TabEmptyState>
                The host has not spoken yet — breaks are logged here as they air.
              </TabEmptyState>
            ) : (
              <ol className="space-y-2">
                {activeSegment && (
                  <TranscriptRow key={activeSegment.id} segment={activeSegment} live />
                )}
                {transcripts.map((segment) => (
                  <TranscriptRow key={segment.id} segment={segment} />
                ))}
              </ol>
            ))}

          {tab === "upNext" &&
            (upNext.length === 0 ? (
              <TabEmptyState>The queue is refilling — check back in a moment.</TabEmptyState>
            ) : (
              <ol className="space-y-1">
                {upNext.map((track, index) => (
                  <li
                    key={`${track.youtubeId || track.previewUrl || track.title}-${index}`}
                    className="flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 hover:bg-zinc-900/60"
                  >
                    <span className="w-5 shrink-0 text-center font-mono text-[10px] tabular-nums text-zinc-600">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-sans text-xs text-zinc-200">{track.title}</p>
                      <p className="truncate font-mono text-[10px] text-zinc-500">{track.artist}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ))}
        </div>
      </aside>
    </div>
  );
}
