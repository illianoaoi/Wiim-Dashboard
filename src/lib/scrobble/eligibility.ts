/**
 * Last.fm's scrobble-submission rule, kept as a pure function (no imports) so
 * it can be exercised on its own — it's the trickiest decision the scrobbler
 * makes, and getting it wrong means either missing plays or submitting ones
 * Last.fm silently drops.
 *
 * The rule: a track must be **longer than 30 seconds**, and must have been
 * played for at least **half its length or 4 minutes**, whichever comes first.
 *
 * Two device realities sit on top of it:
 *  - `duration === 0` means the device reports no length at all (Bluetooth,
 *    some radio streams). There's nothing to take half of, so fall back to
 *    wall-clock listening time.
 *  - a known duration of 30 s or less is never eligible; submitting it just
 *    earns a silent drop.
 */

/** Half-way cap: Last.fm never requires more than 4 minutes. */
export const SCROBBLE_MAX_HALF_SEC = 240;

/** Wall-clock listening time that stands in for "half" when length is unknown. */
export const SCROBBLE_UNKNOWN_LENGTH_SEC = 90;

export function isScrobbleEligible(o: {
  /** Track length in seconds; 0 when the device doesn't report one. */
  duration: number;
  /** Current playback position in seconds. */
  position: number;
  /** Seconds of continuous play of this track (wall clock). */
  playedSec: number;
}): boolean {
  if (o.duration > 30) {
    return o.position >= Math.min(o.duration / 2, SCROBBLE_MAX_HALF_SEC);
  }
  if (o.duration > 0) return false; // Last.fm refuses tracks of 30 s or less
  return o.playedSec >= SCROBBLE_UNKNOWN_LENGTH_SEC;
}
