import type { IconProps } from './icons/props.ts'

// workspaceAlberta monogram: the fallback mark rendered whenever a surface's
// brand slot is unfilled. Artwork matches ui-brand-official's OfficialBrandMark
// so a filled and an unfilled slot look identical.
//
// The export keeps its upstream name. It is an internal identifier no end user
// sees, and holding it steady keeps `git merge` on upstream releases confined
// to this file instead of every import site.

/** Native viewBox of {@link FISH_LOGO_PATH} (width and height in user units). */
export const FISH_LOGO_VIEWBOX = { width: 64, height: 64 }

/** The workspaceAlberta monogram stroke centerline, exported for consumers that compose their own svg around the same geometry. */
export const FISH_LOGO_PATH = 'M12 17l9 30 11-21 11 21 9-30'

/**
 * Render the fallback brand mark.
 * @param props.size - width and height in px (default 24; the mark is square).
 * @param props.className - extra class for layout placement.
 * @returns the mark svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="14" fill="#16324f" />
      <path d={FISH_LOGO_PATH} fill="none" stroke="#f2c14e" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
