# Tencent Cloud Content Moderation Design

## Goal

Prevent newly submitted user images, videos, and selected user-authored text from becoming visible before Tencent Cloud machine moderation or an administrator explicitly approves them. Existing content remains available without a historical rescan.

## Scope

This phase covers:

- Session album images.
- Session album videos, including video frames and audio tracks.
- User nicknames and nickname changes.
- Session review text.
- Pseudo-chat messages and pinned messages.
- User-submitted or edited store and script names and descriptions.
- Public explanatory text entered while creating or managing a session.
- A minimal administrator review queue for machine results that require review.

This phase does not cover:

- Historical rescanning of existing COS objects.
- Automated user strikes, suspensions, or bans.
- A productized appeal workflow.
- System-generated text, phone numbers, or administrator review notes.
- General document, live-stream, or private-message moderation beyond the listed entry points.

## Selected Approach

Use a hybrid moderation architecture:

1. The API explicitly submits each eligible image or video to Tencent Cloud Data Processing/Cloud Infinite (CI) and each eligible text mutation to Tencent Cloud Text Moderation System (TMS).
2. Application database state is the authority for visibility and access.
3. COS automatic moderation and automatic freezing are enabled for the relevant upload prefixes as a second line of defense.
4. Moderation service failures fail closed: new content stays hidden and is retried; it is never automatically approved.

COS automatic moderation alone is insufficient because an object could become visible before the asynchronous result arrives. Explicit submission alone is insufficient as the only protection because an application defect could omit submission. The hybrid design makes the application gate deterministic and retains a cloud-side safety net.

## Data Model

### Unified moderation jobs

Add a `content_moderation_jobs` table with these responsibilities:

- Identify the subject using `subject_type` and `subject_id`.
- Identify the immutable submitted version using an object ETag for media or a SHA-256 digest for text.
- Record the provider (`tencent_ci` or `tencent_tms`), provider job ID, opaque `data_id`, and configured policy identifier.
- Track `status`: `pending`, `processing`, `approved`, `review`, `rejected`, or `error`.
- Store the highest-priority suggestion, label, sublabel, score, a bounded response summary, attempt count, next retry time, and last error code.
- Record submission, completion, and update timestamps.
- Enforce uniqueness for a subject version so retries and duplicate callbacks cannot create conflicting decisions.

Raw provider payloads must not be retained without a size bound. Logs must exclude credentials, user tokens, signed URLs, and full private text.

### Media moderation state

Add `moderation_status` to `session_album_photos` with these values:

- `approved_legacy`: content that existed before the production cutover and is not rescanned.
- `pending`: uploaded or processed and awaiting submission or a provider result.
- `approved`: machine-approved or administrator-approved.
- `review`: hidden pending human review.
- `rejected`: denied and scheduled for object cleanup.
- `error`: provider submission or processing failed and is awaiting retry or operator action.

The existing `status` continues to represent the media lifecycle, such as active versus deleting. The existing `processing_status` continues to represent image/video processing. Moderation is a separate concern and must not overload either field.

The migration backfills all existing media to `approved_legacy`. New rows must explicitly start at `pending`; they must not inherit the legacy default.

### Text proposals

Text that can replace an existing visible value, such as a nickname, is stored as a versioned proposal while moderation is pending or requires review. The current approved value stays visible until the proposal is approved. Approval atomically applies the proposal only if its expected base version still matches; otherwise the proposal becomes stale and requires resubmission.

New entities that contain reviewable text, such as a review or private catalog submission, remain non-public until approved. A single mutation's eligible short fields are normalized and combined into one labeled TMS request to reduce calls. The highest-risk field determines the mutation result.

## Media Flow

### Images

1. The existing COS direct-upload intent and file validation flow remains responsible for authorization, type, size, dimensions, ETag stability, and image processing.
2. Finalization creates the media row with `status = active`, `processing_status = ready`, and `moderation_status = pending`.
3. The API creates a moderation job keyed by media ID and ETag, then submits the COS object key to CI image moderation using the configured policy.
4. Until approval, the uploader may see a status placeholder but receives no preview, download, or directly signed COS URL.
5. Other users, public shares, counts, tags, downloads, previews, and direct-media endpoints behave as if the media does not exist.
6. `Pass` changes the media and job to `approved` in one transaction.
7. `Review` changes them to `review` and adds the item to the administrator queue.
8. `Block` changes them to `rejected` and creates an idempotent object-cleanup job.

### Videos

1. Upload and transcoding/inspection remain responsible for technical validity.
2. Once the source object is stable, the media row enters `moderation_status = pending` and CI video moderation is submitted for configured frame and audio checks.
3. Video processing readiness does not imply moderation approval. Playback URLs, covers, previews, downloads, and public counts remain gated.
4. Provider results use the same `Pass`, `Review`, and `Block` transitions as images.
5. A rejected video schedules cleanup for every owned source, display, and cover object through the existing cleanup architecture.

## Text Flow

TMS moderation occurs at API service boundaries, never in the client. The covered mutation gathers normalized labeled fields, creates a moderation job/proposal, and calls TMS.

- `Pass`: persist or apply the submitted text and mark the job approved.
- `Block`: reject the request with a stable application error code and store only the bounded audit record required for operations.
- `Review`: retain a hidden proposal and return a stable pending-review result. Existing approved text remains unchanged.
- Provider timeout, permission error, quota error, or malformed result: retain the hidden proposal as `error`, enqueue a retry, and return a service-unavailable or pending response appropriate to the mutation. The text is not published.

The client receives neutral Chinese messages such as “内容正在审核” or “内容未通过安全审核”. Provider labels, confidence scores, and sensitive matched terms are not exposed to ordinary users.

## Visibility and Access Rules

Database moderation state is the sole publishing authority.

- Ordinary album lists, public shares, aggregate counts, tag queries, and download selections include only `approved` and `approved_legacy` media.
- The uploader's private management view may include non-approved rows but only as metadata-only status placeholders.
- Preview, thumbnail, video stream, download, and direct signed-URL endpoints independently re-check moderation state. A list-query filter alone is not considered sufficient.
- Administrators access review media through a dedicated authorized endpoint with short-lived URLs and audit logging.
- A COS freeze callback or 403 must not be interpreted as approval or automatically change application state.

## Provider Integration and Configuration

Create a focused moderation module with separate responsibilities:

- Configuration validation and production fail-closed policy.
- Tencent Cloud request signing/client adapters.
- CI image and video submission.
- TMS synchronous text moderation.
- Provider-result normalization into `pass`, `review`, and `block`.
- Job persistence, retry claiming, and state transitions.
- Callback authentication and idempotent processing.

Secrets remain in API environment variables. Required production configuration includes Tencent Cloud credentials or workload identity, region, image/video/text policy identifiers, callback URL, and a high-entropy callback token when provider-native request verification is unavailable. Development and tests use injected fake clients; production must refuse to enable new publishing paths if required moderation configuration is missing.

CAM permissions follow least privilege: submit and inspect the required moderation jobs, read only the relevant COS object prefixes, and freeze/delete only through the existing controlled storage path where possible.

## Callback Security and Idempotency

The callback endpoint does not require a user login but must authenticate the provider event. It must:

1. Validate provider-supported signatures or the configured high-entropy callback token.
2. Parse with a strict body-size limit and reject unknown event shapes.
3. Match provider job ID, opaque data ID, subject ID, object key, and immutable ETag/digest.
4. Lock the moderation job and subject row before transition.
5. Ignore exact duplicate terminal callbacks.
6. Reject or record stale callbacks for superseded subject versions.
7. Prevent a lower-authority or older result from replacing an administrator decision.
8. Return success for authenticated duplicates so Tencent Cloud does not retry indefinitely.

## Retry and Failure Recovery

A recurring moderation worker claims jobs using a lease, mirroring the existing media cleanup job pattern. It retries transient network, timeout, rate-limit, and provider 5xx failures with bounded exponential backoff and jitter. Authentication, permission, policy, quota, and billing failures generate an immediate operational alert and remain hidden.

Retries are idempotent by subject version and provider request identifier. Jobs exceeding the retry budget stay in `error`, remain invisible, and appear in the administrator queue for resubmission or rejection. There is no timeout-based automatic approval.

## Administrator Review

Add a minimal “内容审核” page to the existing administrator web application.

The queue supports filters for subject type, moderation status, provider label, and submission time. Each row shows safe preview data, uploader, related session/entity, machine suggestion, label, score, attempts, and timestamps.

Administrators can:

- Approve a `review` or `error` item.
- Reject a `review` or `error` item with a required reason.
- Retry an `error` item without changing visibility.

Every action records the administrator ID, action, reason, previous state, resulting state, and timestamp. An administrator decision is terminal for that immutable version and wins over later duplicate provider callbacks.

Rejected users receive a neutral reason and customer-service guidance. Appeals and automated account penalties are outside this phase.

## COS Automatic Moderation

Configure CI automatic moderation and automatic freezing for the exact album image and video upload prefixes. Use policies covering pornography, political/illegal content, terrorism/violence, advertising/QR codes where operationally desired, image OCR text, video frames, and video audio.

This is a cloud-console/deployment requirement as well as an application change. Daily audit limits must not silently leave content unreviewed; monitoring must alert before limits are exhausted. COS remains private-read, and automatic freezing is a fallback rather than the application publishing decision.

## Testing

### Unit tests

- Provider response normalization for pass, review, block, unknown, and malformed responses.
- Legal and illegal moderation state transitions.
- Text field normalization and deterministic digest generation.
- Callback authentication, immutable-version matching, duplicates, and stale events.
- Retry classification, leases, backoff, and terminal operational errors.

### Service and integration tests

- New image finalization produces `pending`, not an immediately visible active image.
- New video processing readiness does not bypass moderation.
- Pending, review, rejected, and error media are absent from member lists, shares, counts, previews, streams, downloads, and signed-URL endpoints.
- Uploader management responses contain metadata-only placeholders and no media URL before approval.
- Pass publishes exactly one immutable version.
- Block schedules cleanup exactly once.
- Review enters the administrator queue; administrator approval publishes and rejection removes the content.
- Nickname review leaves the old nickname visible until approval.
- Text block does not mutate the underlying entity.
- Provider failure leaves content hidden and creates a retryable job.

Use injected fake Tencent Cloud clients for deterministic automated tests. Before production rollout, run controlled real-provider smoke tests with Tencent Cloud's permitted test samples and non-sensitive normal samples.

### Regression verification

Run targeted API moderation tests, album image/video tests, administrator runtime tests, mini-program media tests, migration checks, and the repository-wide `npm run check`. Verification must explicitly exercise direct media URLs and public share access, not only list endpoints.

## Rollout

1. Deploy schema additions, moderation modules, query gates, administrator queue, metrics, and feature flags while treating backfilled media as `approved_legacy`.
2. Configure CI/TMS services, policies, CAM permissions, callback routing, COS automatic moderation/freezing, billing alerts, and audit quotas.
3. Validate real-provider submission and callback behavior in a non-production environment.
4. Enable production text moderation first, then image moderation, then video moderation. Observe each stage before advancing.
5. Keep existing content available throughout. Every item created after its content-type cutover timestamp must have a valid moderation job or remain hidden.

Rollback disables new user submissions for the affected content type; it does not relax visibility gates or auto-approve pending content.

## Monitoring and Operations

Track and alert on:

- Pending, review, and error queue depth and age.
- Submission and callback latency percentiles.
- Pass, review, and block rates by content type and policy.
- Callback authentication failures and stale-event counts.
- Retry attempts and exhausted retry budgets.
- Tencent Cloud authentication, CAM permission, quota, billing, and policy errors.
- COS automatic freeze events that do not have a corresponding application job.
- Any attempted access to non-approved media.

Operational logs use moderation job IDs and subject IDs, not full private text or reusable signed URLs.

## Acceptance Criteria

- Every covered item created after its production cutover is moderated before publication.
- Only `approved` and `approved_legacy` media can be read by non-administrators; non-approved direct-media access is denied independently of list filtering.
- A provider outage, timeout, configuration error, quota exhaustion, or billing failure never publishes new content.
- `Review` items stay hidden until an audited administrator decision.
- Existing pre-cutover media remains available and is not submitted for historical review.
- Duplicate and stale callbacks cannot reverse a terminal provider or administrator decision.
- The full automated verification suite passes, and controlled staging smoke tests demonstrate pass, review, block, timeout, and duplicate-callback flows.
