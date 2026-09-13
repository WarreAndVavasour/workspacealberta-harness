# Procurement citation reference

Use the official [CanadaBuys](https://canadabuys.canada.ca/en/tender-opportunities) or [Alberta Purchasing Connection](https://purchasing.alberta.ca/) notice and the buyer's linked solicitation documents. These are discovery entrypoints; cite the individual notice and document for each brief. An aggregator or search snippet is a lead until verified against the primary record.

Record the exact solicitation ID, URL, retrieval timestamp with timezone, published/updated date if present, and document/amendment identifier. For decisive requirements, cite the document section or page and a short supporting excerpt when useful. Never imply you read attachments that were inaccessible. A portal login wall means that evidence is unavailable to this run.

Preserve the closing datetime exactly as stated, including timezone. Add an America/Edmonton conversion only when the source timezone is explicit or documented by that portal. Never silently assume a timezone, invent a closing time for a date-only notice, or convert a fixed abbreviation as if it were a daylight-saving region. An ambiguous closing time prevents `tender-live` verification and requires `needs-human` plus `blocked-data`.

For native Cohere citations retain the original response text, returned start/end spans, document IDs and provenance. Validate referenced IDs against the supplied source manifest and validate spans against the exact response text before displaying links. Do not invent missing spans, silently repair malformed citations, or turn retrieved snippets into proof of unread attachments. A source ID alone is not a page citation: only include page/section/frame timestamps when the acquisition path recorded them.

Missing or rejected native citations must be visible as uncited/unverified evidence. For decisive requirements, retrieve the primary source or add `needs-human`/`blocked-data` as appropriate; do not manufacture references. Keep generated summaries and vision observations distinct from primary evidence. Preserve provenance through PDF extraction, image interpretation and any supported video frame sampling; a frame citation covers only that frame, not an entire video.

An amendment supersedes a field only when the official document explicitly supports that change. Preserve unresolved contradictions and cite both sources. Check current status, amendments, mandatory events, and the submission route before drafting the next action; a saved prior brief is not current evidence.
