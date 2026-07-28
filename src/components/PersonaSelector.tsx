"use client";

import { UserCircle } from "lucide-react";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { PERSONAS, type PersonaId } from "@/data/personas";

export default function PersonaSelector() {
  const { activePersonaId, setActivePersonaId } = useUserPreferences();

  const activePersona = PERSONAS.find((p) => p.id === activePersonaId);

  return (
    <div className="flex items-center gap-2">
      <UserCircle className="h-4 w-4 shrink-0 text-amber-400" />
      <label htmlFor="persona-select" className="sr-only">
        DJ Host
      </label>
      <select
        id="persona-select"
        value={activePersonaId}
        onChange={(e) => setActivePersonaId(e.target.value as PersonaId)}
        className="tune-input flex-1 rounded-lg px-3 py-2 text-sm cursor-pointer"
      >
        {PERSONAS.map((persona) => (
          <option key={persona.id} value={persona.id}>
            {persona.name} · {persona.defaultGenre}
          </option>
        ))}
      </select>
      {activePersona && (
        <span className="hidden sm:inline text-xs text-amber-200/50 shrink-0">
          {activePersona.voice}
        </span>
      )}
    </div>
  );
}
