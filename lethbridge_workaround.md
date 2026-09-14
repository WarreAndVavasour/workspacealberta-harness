# Lethbridge Contract Access Workaround

## E2B Sandbox Status
- Still requires WorkspaceAlberta Pro key (wa_live_... format)
- Separate from Cohere key - both are distinct services
- Manual upload workflow documented below

## Successful Actions Completed
- Created Linear document `lethbridge_contract_summary.md`
- Created issue WAR-8461 for contract analysis
- Removed $85/month pricing reference from all documentation

## Direct Document Access
- APC URL: https://purchasing.alberta.ca/opportunity/2026/6079
- Download link: https://purchasing.alberta.ca/opportunity/2026/6079/download
- No subscription required for document access

## Manual Upload Workflow (for future use)
1. Prepare attachment: `mcp__linear__prepare_attachment_upload`
2. Upload file via curl to signed URL
3. Finalize: `mcp__linear__create_attachment_from_upload`
4. Minimum file size requirement applies

## Contract Summary
- Reference: AB-2026-06079
- Closing: Oct 8, 2026, 14:00
- Scope: COR certified contractor for plumbing/heating/boiler maintenance
- City of Lethbridge facility services department