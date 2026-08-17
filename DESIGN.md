# Skill Card Manager Design System

## Direction

Skill Card Manager uses **Linear's dark, surface-led information hierarchy** with
**Airbnb's restrained interaction clarity**. It is a dense desktop tool, not a
marketing site: content and decisions carry the hierarchy; decoration does not.

The product keeps its existing emerald identity. Emerald is scarce and semantic:
it appears on the primary action, the selected radio control, focus, and confirmed
success. It is not a section background or an informational border.

This first pass applies only to Skill Card Manager additions. Existing upstream
Skill Manager screens retain their current structure until they are deliberately
themed later.

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
