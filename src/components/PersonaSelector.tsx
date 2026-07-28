"use client";

import { UserCircle } from "lucide-react";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { PERSONAS, type PersonaId } from "@/data/personas";

export default function PersonaSelector({ compact }: { compact?: boolean }) {
  const { activePersonaId, setActivePersonaId } = useUserPreferences();

  return (
    <div className="flex items-center gap-2 min-w-0">
      <UserCircle className="h-4 w-4 shrink-0 text-amber-400" />
      <label htmlFor="persona-select" className="sr-only">
        DJ Host
      </label>
      <select
        id="persona-select"
        value={activePersonaId}
        onChange={(e) => setActivePersonaId(e.target.value as PersonaId)}
        className={`tune-input w-full min-w-0 rounded-lg px-2 py-1.5 cursor-pointer ${compact ? "text-xs" : "text-sm px-3 py-2"}`}
      >
        {PERSONAS.map((persona) => (
          <option key={persona.id} value={persona.id}>
            {persona.name} · {persona.defaultGenre}
          </option>
        ))}
      </select>
    </div>
  );
}
