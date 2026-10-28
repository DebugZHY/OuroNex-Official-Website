---
title: Reading drawings as an engineer reads them
date: 30 September 2026
tag: Practice
excerpt: What it takes to represent drawing intent — not just geometry — so an assistant can follow the reasoning an engineer applies to a set.
---

A drawing is not a picture of a structure. It is a claim about one: a set of decisions recorded in a form other engineers can check. That distinction is easy to lose when drawings are treated as geometry to be parsed.

The geometry is the easy part. Lines, layers and coordinates can be read mechanically. Intent is harder. A section shows what the designer thought mattered. A schedule fixes a value that a note elsewhere assumes. A dimension is a decision about tolerance as much as distance. Little of that is recoverable from outlines alone.

## Where the reasoning lives

We think of a drawing set as an argument. Plans state a layout, sections justify it, schedules quantify it, and notes set the rules for reading the rest. An assistant that is designed to support review has to follow that argument, not only the shapes. In scoped engagements, this is the work we aim to do: represent intent well enough that a reviewer can check a reading against the drawing rather than re-derive it.

> A reader who can quote the clause but not the reasoning has not read the drawing.

That representation has to stay checkable. If an assistant infers that a note applies to a detail, the inference should be written down where a reviewer can see it: what was read, what was assumed, what remains open. An explicit assumption is useful. A silent one is a hazard. This is the rule we apply to calculations as well — sources, assumptions and working travel with the result. Reviewed work should show its reading, not ask for trust in it.

So the hard part is not optical. It is deciding what a drawing means, recording why, and leaving the professional judgement where it belongs. AI can assist with reading and cross-checking. The decision about what the structure is, and whether the drawing says so clearly enough, stays with the engineer who signs. Our work on drawing intent is under research; we describe it as a direction, not a finished capability. That boundary is not a limitation we are trying to remove; it is part of why the work can be reviewed at all.