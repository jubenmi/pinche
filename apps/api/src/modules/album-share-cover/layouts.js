export const ALBUM_SHARE_COVER_LAYOUT_VERSION = "album-share-cover-v1";

export const ALBUM_SHARE_COVER_VARIANTS = Object.freeze({
  friend: Object.freeze({ width: 1000, height: 800 }),
  timeline: Object.freeze({ width: 1000, height: 1000 })
});

const slot = (x, y, width, height) => ({ x, y, width, height });
const row3 = (y, height) => [
  slot(0, y, 1 / 3, height),
  slot(1 / 3, y, 1 / 3, height),
  slot(2 / 3, y, 1 / 3, height)
];

const LAYOUTS = Object.freeze({
  friend: Object.freeze({
    1: [slot(0, 0, 1, 1)],
    2: [slot(0, 0, 0.62, 1), slot(0.62, 0, 0.38, 1)],
    3: [slot(0, 0, 0.62, 1), slot(0.62, 0, 0.38, 0.5), slot(0.62, 0.5, 0.38, 0.5)],
    4: [slot(0, 0, 1, 0.58), ...row3(0.58, 0.42)],
    5: [
      slot(0, 0, 0.54, 1),
      slot(0.54, 0, 0.23, 0.5),
      slot(0.77, 0, 0.23, 0.5),
      slot(0.54, 0.5, 0.23, 0.5),
      slot(0.77, 0.5, 0.23, 0.5)
    ],
    6: [
      slot(0, 0, 0.54, 1),
      slot(0.54, 0, 0.46, 0.34),
      slot(0.54, 0.34, 0.23, 0.33),
      slot(0.77, 0.34, 0.23, 0.33),
      slot(0.54, 0.67, 0.23, 0.33),
      slot(0.77, 0.67, 0.23, 0.33)
    ],
    7: [slot(0, 0, 1, 0.46), ...row3(0.46, 0.27), ...row3(0.73, 0.27)],
    8: [slot(0, 0, 2 / 3, 1 / 3), slot(2 / 3, 0, 1 / 3, 1 / 3), ...row3(1 / 3, 1 / 3), ...row3(2 / 3, 1 / 3)],
    9: [...row3(0, 1 / 3), ...row3(1 / 3, 1 / 3), ...row3(2 / 3, 1 / 3)]
  }),
  timeline: Object.freeze({
    1: [slot(0, 0, 1, 1)],
    2: [slot(0, 0, 0.58, 1), slot(0.58, 0, 0.42, 1)],
    3: [slot(0, 0, 1, 0.58), slot(0, 0.58, 0.5, 0.42), slot(0.5, 0.58, 0.5, 0.42)],
    4: [slot(0, 0, 0.5, 0.5), slot(0.5, 0, 0.5, 0.5), slot(0, 0.5, 0.5, 0.5), slot(0.5, 0.5, 0.5, 0.5)],
    5: [
      slot(0, 0, 1, 0.48),
      slot(0, 0.48, 0.5, 0.26),
      slot(0.5, 0.48, 0.5, 0.26),
      slot(0, 0.74, 0.5, 0.26),
      slot(0.5, 0.74, 0.5, 0.26)
    ],
    6: [...row3(0, 0.5), ...row3(0.5, 0.5)],
    7: [slot(0, 0, 1, 0.46), ...row3(0.46, 0.27), ...row3(0.73, 0.27)],
    8: [slot(0, 0, 2 / 3, 1 / 3), slot(2 / 3, 0, 1 / 3, 1 / 3), ...row3(1 / 3, 1 / 3), ...row3(2 / 3, 1 / 3)],
    9: [...row3(0, 1 / 3), ...row3(1 / 3, 1 / 3), ...row3(2 / 3, 1 / 3)]
  })
});

export function albumShareCoverLayout(variant, count) {
  if (!Object.hasOwn(ALBUM_SHARE_COVER_VARIANTS, variant)) {
    throw new TypeError("invalid album share cover variant");
  }
  if (!Number.isInteger(count) || count < 1 || count > 9) {
    throw new RangeError("invalid album share cover count");
  }

  return {
    variant,
    output: ALBUM_SHARE_COVER_VARIANTS[variant],
    gutter: variant === "friend" ? 0.008 : 0.01,
    slots: LAYOUTS[variant][count].map((entry, index) => ({
      ...entry,
      role: index === 0 ? "hero" : "detail"
    })),
    textMode: count <= 6 ? "gradient" : "caption-band"
  };
}
