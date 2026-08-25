# Skill Card Manager Design System

## Purpose

This document is the boundary between **what the product is** and **how a skin
expresses it**. Skill Card Manager must be able to adopt a Linear, Airbnb, or
another future visual language without rewriting product structure, copy,
behavior, or business state.

There are three layers:

1. **Product contract (invariant)** — information architecture, task flow,
   semantics, accessibility, safety, and interaction outcomes.
2. **Component contract (stable API)** — semantic component roles such as page,
   panel, toolbar, control, status, choice, and action.
3. **Skin (replaceable)** — color, typography, radii, elevation, density, and
   motion values supplied through tokens.

Light/dark is a mode inside a skin. It is not a separate skin.

## Architecture

- Runtime skin selection is owned by `src/lib/designSystem.ts` and expressed on
  the root element as `data-design-skin`.
- Skin implementations live in `src/styles/skins/`. The current upstream-derived
  appearance is `skill-manager.css` and remains the default skin.
- `src/index.css` owns structural utilities and component behavior. It must not
  contain visual literals.
- `tailwind.config.js` maps semantic utilities to the Token Contract. Legacy
  palette utilities are compatibility aliases to semantic state ramps, so older
  upstream screens can be skinned before they are component-by-component
  migrated.
- `npm run design:check` derives the live contract from every `var(--token)`
  consumer, adds the required compatibility ramps, and rejects incomplete skins
  or visual literals outside a skin file.

## Token Contract

Every skin must implement the following roles in both readable light and dark
modes. Token names are the public API; their values are private to the skin.

| Domain | Required roles | Meaning |
| --- | --- | --- |
| Typography | `font-sans`, `font-mono`, `tracking-body` | Voice and reading density |
| Canvas | `bg`, `bg-secondary`, `surface`, `surface-hover`, `surface-active` | Luminance hierarchy, not decoration |
| Structure | `border`, `border-subtle`, `border-faint` | Controls, regions, internal separation |
| Content | `text-primary`, `secondary`, `tertiary`, `muted`, `faint`, `on-accent` | Reading priority |
| Brand/action | `accent`, `accent-light`, `accent-dark`, `accent-bg`, `accent-border` | Selection, focus, and primary action |
| State | `danger`, `warning`, `success`, `info`, `feature` plus backgrounds and ramps | Meaning must remain stable across skins |
| Shape | `radius-xs`, `sm`, `control`, `panel`, `dialog`, `pill` | Component family geometry |
| Elevation | `shadow-card`, `card-hover`, `dialog`, `control-knob`, `highlight-inset` | Depth without changing structure |
| Motion | `duration-instant`, `fast`, `standard`, `slow`, `ease-standard`, `ease-smooth-out` | State continuity and perceived speed |

Tokens may change expression but not meaning. For example, a Linear skin may use
tighter radii and quieter shadows, while an Airbnb skin may use warmer surfaces
and more generous radii. Neither skin may turn `danger` into decoration, change a
radio choice into a multi-select control, or move an action into another task.

## Adding a Skin

1. Copy `src/styles/skins/skill-manager.css` and change only token values and its
   `data-design-skin` selector.
2. Add the skin id to `DESIGN_SKINS` in `src/lib/designSystem.ts` and import its
   CSS once from `src/main.tsx`.
3. Translate the reference Design MD (for example Linear or Airbnb) into the
   Token Contract. Do not copy reference product IA or branded assets.
4. Run `npm run design:check`, `npm run lint`, and `npm run build` in light and
   dark mode. A skin is incomplete if any screen falls back to a raw color,
   radius, shadow, or motion literal.

No skin picker is shown while only one skin exists. The runtime contract is ready;
the control becomes useful only when a second complete skin is installed.

## Default Skin Direction

Skill Card Manager uses **Linear's dark, surface-led information hierarchy** with
**Airbnb's restrained interaction clarity**. It is a dense desktop tool, not a
marketing site: content and decisions carry the hierarchy; decoration does not.

The product keeps its existing emerald identity. Emerald is scarce and semantic:
it appears on the primary action, the selected radio control, focus, and confirmed
success. It is not a section background or an informational border.

The default skin preserves the existing Skill Manager appearance while routing
the entire product through the shared Token Contract.

## Product Interaction Contract (Skin-invariant)

## Hierarchy

1. **Page / structural container** — `bg-surface`; one subtle structural hairline
   is allowed around a master-detail region.
2. **Section** — separated by spacing or a faint divider. A section does not get
   a card merely because it contains information.
3. **Supporting information** — transparent or `bg-bg-secondary/40`; never an
   accent border, bright outline, or shadow.
4. **Interactive choice** — use the native control that matches the decision.
   Mutually exclusive choices use radio buttons; selected state is carried by the
   radio, not by tinting the whole row.
5. **Action** — only the next safe, reversible command receives the filled emerald
   primary treatment. Re-run, refresh, and override controls stay secondary.

## Color Roles

- Canvas and surfaces reuse the existing `background`, `surface`, and
  `bg-secondary` tokens.
- Text uses `primary` → `secondary` → `muted` → `faint` in that order.
- Borders use `border-faint` for internal dividers and `border-subtle` only for
  structural containers and controls.
- Emerald (`accent`) is reserved for primary action, focus, selected radio, and
  confirmed success.
- Amber/red communicate unresolved or blocked state only. They do not decorate
  neutral AI output.

## Organization Components

### Scan → Review hierarchy

- The Pending landing view is a scan result, not an inventory dashboard. It shows
  the scan state, total findings, and no more than the few top-level issue
  categories. Individual skills, evidence, and execution controls stay out of
  this level.
- Each category has one quiet `Review` action. Entering Review temporarily removes
  the library KPI cards, search, and top-level tabs so the user is not forced to
  hold two navigation hierarchies at once.
- The Review workspace reads left to right: cause (when a category has causes) →
  affected case → selected case evidence and action. These columns share one
  structural panel; they are not separate cards.
- Category identity belongs to the Review header: category icon, category name,
  count, and category-level explanation appear once. A selected event never
  repeats the category title or icon. Its header names the concrete Skill pair,
  shows the current treatment state, and summarizes the pair-specific finding.
- Case-list subtitles communicate progress or disposition (awaiting judgment,
  archive redundant item, keep both, needs evidence), not the already-known
  category name.
- The selected case must answer, in order: what was found, why it matters, what
  Skill Card Manager recommends, and exactly what the next action changes.
- CleanMyMac is the interaction reference for progressive disclosure and focused
  review, not a visual skin. Skill Card Manager keeps its dark, restrained
  developer-tool theme and does not copy purple gradients or 3D decoration.
- Independent Review blocks always keep a 16px vertical gap. Only cause, case,
  evidence, and action regions inside the same master-detail panel may touch; in
  that case a shared container and faint divider must make the grouping explicit.
  A toolbar or split button must never visually merge with the following panel.

### Batch result toolbar

- The comparison result is ordinary title + description text.
- It sits below a faint divider inside the issue header; it is not a highlighted
  card and has no accent border.
- “Apply conclusions” is the single primary action. “Compare again” is secondary.

### Agent assessment

- Agent output is supporting evidence at the same reading depth as human-readable
  analysis.
- It uses spacing and typography, not an accent card, to distinguish itself.
- Confidence is a quiet neutral value. Only stale/error text uses semantic color.
- Rules own the diagnosis facts. Once a current Agent assessment exists, its
  opinion and recommendation replace the rule-generated guidance in place; the
  interface never stacks both sets of advice. A stale Agent assessment cannot
  override the current rule guidance.
- One Agent run produces one conclusion surface. Its relation, reasoning, and
  recommendation read as a continuous block instead of separate peer panels;
  the choice and execution controls below remain a distinct action layer.
- A same-name case has exactly three user-facing layers: **Problem** (deterministic
  fact), **Judgment** (the current combined interpretation), and **Next step**
  (one executable path). “Agent conclusion” and “Manager conclusion” must never
  appear as peer opinions that the user has to reconcile.
- If the bounded SKILL.md snapshot cannot close the judgment, the next step is
  “Check complete differences,” not another identical comparison. Card Manager
  produces a complete, read-only managed-directory manifest and bounded text
  evidence; the Agent interprets that evidence without receiving filesystem
  access. If provenance still blocks archival, the safe exit is to keep both and
  record the unresolved source relationship.
- A completed deep comparison must terminate in a typed action, never another
  comparison loop. The Agent supplies the semantic judgment; Skill Card Manager
  validates it and owns execution, journaling, recovery, and Undo. The primary
  button names the concrete outcome, for example “Keep pdf, archive pdf-2.”
- When every behavior-bearing file is identical and differences are limited to
  a frontmatter-only version field, generated cache files, and one ecosystem
  packaging/provenance marker, retain the provenance-bearing superset, archive
  the redundant member, and rewire its managed Agent projection. This is a
  deterministic terminal rule; the Agent does not need to re-judge it.
- Side-by-side Skill summaries use equal-height rows with the same identity,
  description, and Agent-visibility slots. Unequal copy length must not move
  corresponding fields out of alignment.

### Keep/archive choice

- The choices form one radio group.
- Each row contains radio → Skill identity/source → consequence.
- Selection changes only the radio and the consequence label. The row does not
  gain a bright border or colored fill.
- An Agent recommendation lives only on the recommended option as a compact
  “Agent recommends keeping” label. The rejected option stays unlabelled so two
  labels cannot both read as endorsements. The recommendation is not repeated as
  a section title.
  A nearby help icon reveals the evidence reason on hover or keyboard focus.
- Recommendation and current selection remain separate facts: changing the radio
  never rewrites which option the Agent originally recommended.

### Execution impact

- Previewed effects use a neutral supporting surface with no border.
- The copy must state what is kept, what enters Skill Card Manager's recovery
  area, what happens to Agent projections, whether external sources remain, and
  that the operation is undoable.

### Format-health repair

- A detected format fact must end in one concrete path: Agent repair, identity
  dependency resolution, or source/readability recovery. A diagnosis without an
  action is not a complete task.
- Managed Agent repair never starts in the real Skill. Codex edits an isolated
  copy under an enforced workspace sandbox; Skill Card Manager validates the
  result, shows changed files, and requires an explicit Apply action.
- Applying a validated repair is journaled and undoable from Processed. Claude,
  Hermes, a copied prompt, or another external Agent is labelled as an external
  path and does not claim Manager-controlled apply or undo.
- Agent-visible name mismatches are identity problems, not metadata typos. Route
  them through same-name version resolution before rebuilding projections.

## Shape, Type, and Spacing

- 4px base grid; common gaps are 8, 12, 16, and 24px.
- Controls use 8px radius; structural panels use 12px radius.
- Body text is 12–14px at weight 400; labels are 10–12px at weight 500/600.
- Avoid nested shadows. Dark-mode depth comes from surface luminance and spacing.
- Do not use pill badges as a substitute for selection or action.

## Interaction Requirements

- Radio rows remain keyboard selectable and expose a shared group name.
- Primary and secondary controls keep visible focus states and disabled states.
- A preview is not an execution: the final action must remain explicit.
- Destructive-looking operations are archive-first and reversible; the UI must
  continue to surface Undo after execution.

## Anti-patterns

- Accent or white borders around information-only sections.
- Card-inside-card nesting for every paragraph.
- Whole-row green selection when a radio control expresses the state.
- Multiple filled CTAs competing in one local decision.
- Bright success styling before an operation has actually completed.
