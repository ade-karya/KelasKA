/**
 * What a failed media task means, and whether asking again could change it.
 *
 * A media task fails for three different reasons, and the difference has to be
 * visible in one place rather than re-derived at every affordance.
 *
 * A transient failure — a timed-out provider, a dropped connection — is worth a
 * Retry, and says nothing to the user beyond that.
 *
 * A refusal of the content or the configuration is not retryable at all: the
 * provider declined the content, or generation is switched off. Nothing the
 * user does changes either, so the element says why instead of offering a
 * button that would spend a provider call to fail identically.
 *
 * A full asset store is a third thing, and it took a review round to separate
 * it from the second. It is neither the content's fault nor the
 * configuration's: it is an environmental condition an operator clears in one
 * environment variable. So it says why — a Retry with no explanation would look
 * like an ordinary failure — and it still offers the Retry, because after the
 * ceiling is raised that Retry is the only way back, and it costs nothing: the
 * bytes were kept, so it re-attempts the upload rather than the generation. It
 * is never retried automatically, by a reload or otherwise, so nothing about
 * this re-bills anyone.
 *
 * Every code here is written to the local media table, so it survives a reload
 * as a `failed` task instead of being paid for again.
 */

/** The store is full. Raised by the asset layer, not by a generation route. */
export const ASSET_QUOTA_EXCEEDED = 'ASSET_QUOTA_EXCEEDED';

/**
 * Hugging Face ZeroGPU daily free quota exhausted (or the Space is busy).
 *
 * Free tier (2026): ~5 GPU-min/day AND ~3 ZeroGPU runs/day, reset 24h after
 * the first GPU usage. One Wan video costs 2 runs (FLUX source still
 * + animation), so the free tier fits roughly 1 video/day. Failed queue joins
 * also count against the run limit, so callers must fail fast instead of
 * retrying every element in the deck.
 *
 * Matched against provider/route error text (not a stable errorCode): the
 * Gradio queue answers pressure with `data: null`, and the adapters reword
 * that as "busy or out of GPU quota — wait a moment and retry".
 *
 * NOTE: the name avoids vendor substrings on purpose — the generate routes
 * that use it are covered by the provider-neutrality guard, which flags any
 * vendor token (e.g. `huggingface`) in those files. A regex literal would be
 * invisible to that scanner, but a shared helper keeps the two call sites in
 * sync, so the neutral-safe name is the compromise.
 */
export function isZeroGpuQuotaMessage(message: string): boolean {
  return /zerogpu|gpu.{0,20}quota|quota.{0,20}exhausted|exceeded.{0,20}runs|out of.{0,20}quota|space.{0,20}busy|busy.{0,20}(space|quota)|queue.{0,20}full|wait a moment and retry/i.test(
    message,
  );
}

/**
 * The store refused these bytes for good (too large, an unsupported type) and
 * nothing can produce them again: media the user inserted or imported, which
 * has no generation request to retry. Written by the one-way import of
 * pre-server browser data; the element shows as failed, without a Retry.
 */
export const ASSET_REFUSED = 'ASSET_REFUSED';

/**
 * Codes no retry can change.
 *
 * `CONTENT_SENSITIVE` is the provider's refusal of this content and
 * `GENERATION_DISABLED` is the deployment's refusal of this kind of media;
 * asking again produces the same answer and another provider call.
 * `ASSET_QUOTA_EXCEEDED` is deliberately NOT here — see the module comment.
 *
 * Anything else, including an absent code, stays retryable: an unknown failure
 * is treated as transient, because the cost of one extra attempt is much
 * smaller than the cost of a slide that can never be recovered.
 */
export const PERMANENT_MEDIA_FAILURE_CODES: ReadonlySet<string> = new Set([
  'CONTENT_SENSITIVE',
  'GENERATION_DISABLED',
  ASSET_REFUSED,
]);

/** Whether a failed task may be tried again, by a person asking for it. */
export function isRetryableMediaFailure(task: { readonly errorCode?: string }): boolean {
  return task.errorCode === undefined || !PERMANENT_MEDIA_FAILURE_CODES.has(task.errorCode);
}

/**
 * Whether this failure means the asset store had no room for THIS write.
 *
 * The ceiling is deployment-wide but the check is per write -- the store asks
 * whether the bytes in hand fit in the headroom that is left -- so a refusal is
 * evidence about one blob, and only weak evidence about the next one.
 *
 * A path whose refusals are free acts on that -- narration adoption attempts
 * every clip smaller than the smallest one already refused in the same run,
 * because one clip that does not fit says nothing about a shorter one behind
 * it, while saying everything about one at least as long.
 */
export function isStorageFullFailure(errorCode: string | undefined): boolean {
  return errorCode === ASSET_QUOTA_EXCEEDED;
}

/**
 * The message to show above the Retry affordance, for a failure that has one.
 *
 * `GENERATION_DISABLED` is absent on purpose: a disabled generation setting has
 * its own state in the renderer, painted before any failure is considered.
 */
export function mediaFailureNoticeKey(errorCode: string | undefined): string | undefined {
  if (errorCode === 'CONTENT_SENSITIVE') return 'settings.mediaContentSensitive';
  if (errorCode === ASSET_QUOTA_EXCEEDED) return 'settings.mediaStorageFull';
  return undefined;
}
