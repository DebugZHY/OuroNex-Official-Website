---
title: What we learned adapting LLMs to drawing review
date: 14 October 2026
tag: Field
excerpt: Working notes from adapting language models to drawing checks: where they help a reviewer, and where the sheet still has the final say.
---

Drawing review is a reading task before it is a checking task. Sheets carry callouts, cross-references, notes and revision clouds, and a reviewer moves between them constantly. We have been testing where language models help with that reading work — in scoped engagements, on drawing sets the reviewing engineer already owns.

The pattern we see is fairly stable. Reading a callout and locating the detail it points to is the kind of task a language model can assist with. The same applies to cross-references between a general note and the sheets it governs, and to flagging where a revision cloud and a description no longer agree. These are text and relationship tasks, and a suggestion can carry the reference it came from.

## Text is not geometry

Geometric intent is a different problem. A model can observe that a detail looks crowded or that a note is repeated, but it cannot be trusted to decide whether a connection is buildable or whether a dimension chain closes. Those judgements depend on structural reasoning, construction knowledge and the responsibilities that come with a design. We treat any geometric output as a prompt for the reviewer, never as a finding.

> The drawing set remains authoritative. A model output is a reading aid; the reviewer stays the decision point.

That is why the workflow is designed to keep the sheet in front of the reviewer and to make each suggestion traceable to the text or reference behind it. Where a suggestion cannot cite its source, it is not surfaced as a finding. Geometric reasoning also remains under research, and we do not present it as a solved part of drawing review.

What we are learning is modest and useful: keep the scope small, keep the sources visible, and keep the engineer in charge. Language models help at the edges of drawing review — the reading, the retrieval, the cross-check. The decision itself remains a professional one, and responsibility for it stays with the engineer.