# AI Collaboration & Engineering Cadence
**Status:** Canonical Process Reference

**North Star:** Put your phone in your pocket, listen to music, and learn more about what you hear.

When working on complex audio orchestration, state management, or UI synchronization in SongHost, always execute tasks using this strict 5-Step Iterative Cycle. During Phase 5A field testing, the Pocket Mode Doctrine below outranks feature work.

---

## Pocket Mode Doctrine

Phase 5A (Field Testing & Baseline Lock) is the active milestone. These rules govern every investigation and every line of code until the listening baseline is locked.

### Phone in pocket is the product
**Phone in pocket / screen-off listening** is the primary product experience, not a secondary mobile polish item. A session that dies, skips, or talks over the song when the phone is in a pocket is a ship-blocker. Validate against lock-screen, background, and PWA suspend — not just a lit desktop tab.

### Cockpit UI philosophy
The UI exists to **launch, tune, and configure host settings** before slipping the phone away. It is a radio cockpit, not the listening surface. Do not add glance-required chrome, interstitial screens, or workflows that assume the listener is watching. If a change only helps someone staring at the phone, it is out of scope for 5A.

### Human-grade transition discipline
Speech must duck or pause cleanly over music intros/outros and **never talk over vocals**. Timing regressions — late ducks, early talk-up, clipped outros, talking into a vocal — are defects, not taste. Fix the mix before adding new break kinds.

**Live companion path (16 Aug 2026 audit):** Spotify transitions use **duration-based Mode A/B** orchestration — Mode A (clip ≤ 15s) duck–talk–swell; Mode B (clip > 15s) station-bed then hard-launch. Format-aware Pause–Talk–Resume is **Phase 6 polish**. Do not implement it during 5A.

### Single transport priority
Validate and prove **Spotify Web Playback SDK** integration before expanding to Apple MusicKit. Lock session keep-alive, track-end handoff, and reconnect after background first. Do not split engineering attention across transports, and do not start new provider work during 5A.

### Surgical testing & fix rule
Perform **read-only investigations first**; zero feature creep during testing phases. Identify the exact file, line, and root cause before touching code. Then make the smallest change that restores the baseline. No new features, no opportunistic refactors, no Phase 6+ surface, no "while we're in here" cleanups. If the change is not required to lock Spotify reliability, DJ timing, or screen-off resilience, it does not ship in this window.

---

### Step 1: Read-Only Investigation & Audit
* Prompt the AI / Cursor to perform a **READ-ONLY investigation** first.
* **Rule:** DO NOT modify any code in Step 1. During Phase 5A this is mandatory — diagnose Spotify reliability, DJ timing, or screen-off failures before any edit.
* Identify exact files, line numbers, and root causes.
* Output a diagnostic report for developer review.

### Step 2: Human & AI Alignment Review
* Review the diagnostic report together.
* Agree on the root cause and proposed fix strategy before touching the codebase.

### Step 3: Surgical Refactor & Code Execution
* Open a **New Chat** in Cursor for a clean context window.
* **Directive-Only Prompting:** Provide high-level architectural requirements, target files/lines, and behavioral guidelines rather than feeding pre-written hardcoded code snippets. Allow Cursor/Grok to inspect the live codebase directly and generate native code to avoid "AI telephone" syntax or type mismatches.
* Execute the refactor precision-first. During Phase 5A, the change set must be the minimum required to restore the Pocket Mode baseline — no feature creep.
* Ensure `tsc --noEmit` passes with **0 errors**.

### Step 4: Canonical Documentation Sync
* Immediately update `docs/AUDIO_ORCHESTRATION_SPEC_2.md` and `docs/ARCHITECTURE.md` alongside every code change.
* Never allow code logic and project documentation to diverge.

### Step 5: Git Lock-In & Video Verification
* Run the provided `git` command to commit and push changes.
* Conduct a live manual test run (record screen + DevTools console if new bugs emerge).

---
*Reference this cadence anytime a chat session loses context or attempts to write code without prior investigation.*

---

## Standardized Audit & Fix Templates

### Template 1: Step 1 Read-Only Audit Prompt

# Step 1 Read-Only Audit: [INSERT SHORT ISSUE TITLE]

Perform a strict **Step 1 Read-Only Audit** to diagnose [INSERT BRIEFLY WHAT IS FAILING OR BEHAVING UNEXPECTEDLY].

---

### SOP Rules
- **STRICTLY READ-ONLY**: DO NOT modify, edit, or create any code files.
- Trace exact file paths, line numbers, state flags, and transition handlers.
- Verify state priorities (e.g., Cloud State as single source of truth over Local Storage).

---

### Audit Targets

#### Target 1: [INSERT COMPONENT / STATE SYMPTOM 1]
- **Files**: `[path/to/file1.ts]`, `[path/to/file2.ts]`
- **Trace**:
  1. Inspect [Specific function or state flow].
  2. Why does [Unexpected Behavior A] happen during [Event / Condition]?
  3. Identify which state flag or handler incorrectly triggers or holds this logic.

#### Target 2: [INSERT COMPONENT / STATE SYMPTOM 2]
- **Files**: `[path/to/file.ts]`
- **Trace**:
  1. Inspect why state remains locked or out of sync during [Transition / Event].
  2. Trace external API or player SDK interactions causing halts or empty results.
  3. Locate where state locks should be cleared or overridden by primary session state.

---

### Required Diagnostic Output
1. **Exact File Paths & Line Numbers** handling state transitions, locks, and data synchronization.
2. **Root Cause Analysis** detailing why the desync, failure, or unwanted behavior occurs.
3. **Proposed Step 2 Surgical Plan** outlining the exact logic updates required before any code is touched.

---

### Template 2: Step 2 Surgical Fix Execution Prompt

# Step 2 Surgical Fix Execution: [INSERT SHORT ISSUE TITLE]

Execute a strict **Step 2 Surgical Fix** based on the confirmed root-cause diagnosis from our Step 1 Read-Only Audit.

---

### SOP Rules
- **SURGICAL EXECUTION**: Modify ONLY the exact files, functions, and line ranges specified in the execution plan below.
- **NO UNRELATED REFACTORS**: Do not touch adjacent code, clean up unrelated styling, or modify unapproved hooks.
- **STATE PRIORITY CONTRACT**: Maintain strict adherence to Cloud State as the source of truth—local storage must act strictly as an offline cache.

---

### Confirmed Root Cause Context
- **Root Cause**: [PASTE / SUMMARIZE STEP 1 DIAGNOSIS]
- **Affected Files**: [LIST APPROVED FILES TO EDIT]

---

### Execution Plan

#### Task 1: [INSERT COMPONENT / FIX AREA 1]
- **File**: `[path/to/file.ts]`
- **Target Location**: `[Function Name / Line Range]`
- **Modification**: [Describe exact logic update, guard clause to add, or state lock release].

#### Task 2: [INSERT COMPONENT / FIX AREA 2]
- **File**: `[path/to/file.ts]`
- **Target Location**: `[Function Name / Line Range]`
- **Modification**: [Describe exact logic update, query sanitization, or state reset].

---

### Verification & Output Requirements
1. **Apply Minimal Diff Modifications**: Implement code changes directly.
2. **State Safeguard Verification**: Confirm that all new or updated handlers explicitly clear pending timers, speech buffers, or race-condition flags on state switches.
3. **Validation Steps**: List exact manual or unit test steps to verify the fix works as expected without regressions.
