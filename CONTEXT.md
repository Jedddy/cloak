# Cloak

A private review desk for outgoing files. The user assembles a package for a specific recipient, sees what it reveals to that recipient, and exports reviewed copies, all on the user's machine.

## Packages and recipients

**Package**:
A set of files that the user intends to share with one recipient.
_Avoid_: Handoff, folder, bundle

**Recipient**:
A saved person or organization that receives packages (for example "Acme Corp"). Each package has one recipient; a recipient can receive many packages.
_Avoid_: Client (when meaning the receiver), target

**Recipient profile**:
A policy that sorts categories into allowed, needs decision, and remove buckets. A recipient uses one profile; many recipients can share one profile.
_Avoid_: Recipient (when meaning the policy), preset

**Allow rule**:
A remembered "keep" for one category and one exact text, attached to a recipient. A secret never becomes an allow rule.
_Avoid_: Whitelist, exception

**Protected term**:
A word or phrase that the user marks as sensitive for one package.
_Avoid_: Keyword, blocked term

**Other client**:
A saved recipient that is not the recipient of the current package. Its name is sensitive in that package.
_Avoid_: Third party, competitor

**Excluded file**:
A file that the user removes from export. Its findings keep their decisions but do not count as open.
_Avoid_: Skipped file, removed file

## Findings

**Finding**:
One fact about a file that can reveal something to the recipient. It has one or more detections.
_Avoid_: Issue, alert, match

**Detection**:
One layer's report of a finding, with its detection method and evidence.
_Avoid_: Hit, method (when meaning the report)

**Evidence**:
The exact location of a detection: a text span, an image region, the whole image, or a byte offset in the file structure.
_Avoid_: Proof, highlight

**Category**:
The kind of information a finding reveals (for example secret, other-client, internal-pricing).
_Avoid_: Type, label

**Needs decision**:
The profile bucket, and the suggested action, for categories that the user must decide on with no default.
_Avoid_: Review (as a bucket or action)

**Decision**:
The user's choice for a finding: open, redact, keep, keep-and-remember, or not an issue.

**Keep**:
A decision that the finding is real, and this recipient can see it.
_Avoid_: Dismiss, allow, ignore

**Not an issue**:
A decision that the detection was wrong (a false positive). It applies to one package only and is never remembered.
_Avoid_: Dismiss, keep

**Related group**:
The set of findings that refer to the same term across the files of a package.

**Inconsistent redaction**:
A related group in which one occurrence is redacted and another is kept or open. An occurrence marked not an issue does not count.

## Review and export

**Review**:
The activity in which the user looks at findings and makes decisions.

**Reviewed copy**:
A file that export rebuilds from an original, with approved redactions applied.
_Avoid_: Clean copy, safe copy, redacted file

**Verification**:
A full scan of the reviewed copies after export. Each finding it reports maps back to a finding on the original file, where the user makes the decision.
_Avoid_: Re-check, validation

**Coverage**:
What a scan did and did not analyze: files processed, failed, unsupported, excluded, or without AI analysis.
_Avoid_: Score, safety level

## Model access

**Mode**:
The analysis level of a scan: full, text AI, or rules only.

**Locality**:
Where the model server runs, relative to the user's machine: local, LAN, remote, or mock.
