# Agent Note: Pairing hashes must not sit next to scanner vendor tokens

Status: implemented

English | [中文](2026-09-13-pairing-hash-scanner-collision.zh.md)

## Problem

Bilingual pairing sidecars record each side as a 40-hex git blob hash next to the Markdown basename. Secret scanners that treat a 40-character token near a vendor name as that vendor's API key fire on those records. A pairing sidecar whose basename contained `cohere` produced two GitGuardian "Cohere API Key" incidents on the hashes of the English and Chinese Agent Notes; the values were `git hash-object` outputs, not credentials.

## Decision

Pairing English basenames must not contain a token from `PAIRING_BASENAME_SCANNER_COLLISIONS` in [`scripts/translation-pairing-record.ts`](../../../../scripts/translation-pairing-record.ts). `verify-translation-pairing` rejects those slugs on check and `--write`. The list starts with `cohere` and grows only when a current detector matches the sidecar format. [`.gitguardian.yaml`](../../../../.gitguardian.yaml) ignores `**/*.i18n.yaml` because those files are hash records by the [pairing contract](../../../../docs/i18n/README.md#the-pairing-contract). Prose may still name the vendor.

## Alternatives considered

**Prefix every recorded hash (`git-blob:<sha>`).** Rejected: it would rewrite every sidecar, the merge driver, and the recovery refs to silence a scanner, instead of keeping hashes as `git hash-object` prints them.

**Rewrite the introducing commit to drop the colliding slug from history.** Rejected for this false positive: the values are public blob hashes, not credentials. Mark the GitGuardian incidents as false positive; do not rotate a key that was never committed.

**Disable the Cohere detector repository-wide.** Rejected: a real `COHERE_API_KEY` value in source, config, or fixtures must still alert.

**Rename only the colliding pair and leave the format ungated.** Rejected: the next vendor-named pair would retrigger the same detector class.

## Consequences

Authors name vendor-specific notes without putting the collision token in the slug. Real API keys in source, overlays, and fixtures still alert. Historical scanner incidents on pairing hashes stay in the vendor dashboard until marked false positive; a follow-up commit does not erase the scanned commit.

## Testing

`scripts/translation-pairing.spec.ts` pins a `cohere` basename as a collision and a `coherent` substring plus an ordinary procurement slug as clear. `verify-translation-pairing` is the executed check for a colliding in-scope pair.
