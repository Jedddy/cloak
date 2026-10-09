# Recipients are saved records that own allow rules

The first overview put allow rules ("remember for this recipient") on the recipient profile, and a package had no named recipient. That leaks decisions: a name kept for contractor A became "allowed by profile" for contractor B, and the app could not know which client name belonged to the recipient. We decided that a recipient is a saved record (name + profile) that owns its allow rules, and each package has one recipient. The profile stays a shared policy of category buckets only.

## Consequences

- The names of all other saved recipients are checked by rule as `other-client` in each package. This gives `other-client` findings with no model, which supports rules-only mode.
- A secret never becomes an allow rule, so a kept test key is never auto-kept in a later package.
- Workspace needs a `recipients.json` next to `profiles.json`, and the API needs `/api/recipients`.
