/**
 * Persian locale support for weak-pattern detection.
 *
 * The pinned SecLists corpus is pure ASCII — 10,898 entries, zero non-ASCII
 * characters of any kind. For an Iranian clinic that leaves the most obvious
 * weak password entirely undetected, because the Iranian keyboard emits Persian
 * digits on the number row by default: `۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵` satisfied every rule
 * in the policy before this file existed.
 *
 * Two additions, both pattern-detection only:
 *
 *   1. a digit-system fold, so one rule covers ASCII, Persian and Arabic-Indic
 *      numerals;
 *   2. the base-layer letter rows of the standard Iranian layout.
 *
 * ============================================================================
 * PROVENANCE — Persian keyboard layout
 * ============================================================================
 *   upstream:    https://gitlab.freedesktop.org/xkeyboard-config/xkeyboard-config
 *   source path: symbols/ir          (xkb_symbols "pes", the default group)
 *   tag:         xkeyboard-config-2.48
 *   commit SHA:  cf8d1151bb4c9ef5b895828d0e6dd7860c0833e0
 *   licence:     MIT/X11. The file carries an explicit note that its author
 *                permitted this layout to be licensed under MIT/X11.
 *   retrieved:   2026-08-04
 *
 *   The source file states in its own header that it implements ISIRI 9147
 *   (1st Edition), "Layout of Persian Letters and Symbols on Computer
 *   Keyboards", the Iranian national standard published 2007-04-08 by the
 *   Institute of Standards and Industrial Research of Iran.
 *
 * DETERMINISTIC DECODING
 *   Fetch the file at the pinned commit:
 *     curl -sSL -o ir https://gitlab.freedesktop.org/xkeyboard-config/xkeyboard-config/-/raw/cf8d1151bb4c9ef5b895828d0e6dd7860c0833e0/symbols/ir
 *
 *   Take the FIRST entry of each `key <XXnn> { [ ... ] }` line — level 1, the
 *   character produced with no modifier — for the three alphabetic rows AD, AC
 *   and AB, in ascending key order. Resolve each X11 keysym to its Unicode code
 *   point via `keysymdef.h` (`Arabic_dad` = U+0636, `Farsi_yeh` = U+06CC, and so
 *   on). Those code points are listed below with their keysym beside them, so
 *   the decoding can be checked line by line rather than taken on trust.
 *
 *   Punctuation keys are excluded: AB09 is `period` and AB10 is `slash`, which
 *   are not part of a letter walk.
 *
 * SCOPE AND ITS LIMITS
 *   This covers the Iranian STANDARD Persian layout only. It does not claim to
 *   cover legacy layouts, mobile keyboards, vendor variants, or a custom
 *   remapping. A walk typed on any of those is not detected here, and that is a
 *   known and accepted limit of this pass rather than an oversight.
 *
 * YEH AND KAF ARE NOT FOLDED
 *   Level 1 of AC03 is Farsi_yeh (U+06CC) and of AC10 is Arabic_keheh (U+06A9)
 *   — the Persian forms. Arabic yeh (U+064A) and Arabic kaf (U+0643) sit on the
 *   shift level and are deliberately absent below. Nothing here folds the two
 *   pairs together; they remain distinct characters and distinct passwords.
 */

/** AD row, left to right. `key <AD01>` .. `key <AD12>`. */
const AD_ROW_CODE_POINTS = [
  0x0636, // AD01  Arabic_dad     ض
  0x0635, // AD02  Arabic_sad     ص
  0x062b, // AD03  Arabic_theh    ث
  0x0642, // AD04  Arabic_qaf     ق
  0x0641, // AD05  Arabic_feh     ف
  0x063a, // AD06  Arabic_ghain   غ
  0x0639, // AD07  Arabic_ain     ع
  0x0647, // AD08  Arabic_heh     ه
  0x062e, // AD09  Arabic_khah    خ
  0x062d, // AD10  Arabic_hah     ح
  0x062c, // AD11  Arabic_jeem    ج
  0x0686, // AD12  Arabic_tcheh   چ
] as const;

/** AC row (home row), left to right. `key <AC01>` .. `key <AC11>`. */
const AC_ROW_CODE_POINTS = [
  0x0634, // AC01  Arabic_sheen   ش
  0x0633, // AC02  Arabic_seen    س
  0x06cc, // AC03  Farsi_yeh      ی   <- Persian yeh, not Arabic yeh
  0x0628, // AC04  Arabic_beh     ب
  0x0644, // AC05  Arabic_lam     ل
  0x0627, // AC06  Arabic_alef    ا
  0x062a, // AC07  Arabic_teh     ت
  0x0646, // AC08  Arabic_noon    ن
  0x0645, // AC09  Arabic_meem    م
  0x06a9, // AC10  Arabic_keheh   ک   <- Persian keheh, not Arabic kaf
  0x06af, // AC11  Arabic_gaf     گ
] as const;

/** AB row, letters only. `key <AB01>` .. `key <AB08>`; AB09/AB10 are punctuation. */
const AB_ROW_CODE_POINTS = [
  0x0638, // AB01  Arabic_zah     ظ
  0x0637, // AB02  Arabic_tah     ط
  0x0632, // AB03  Arabic_zain    ز
  0x0631, // AB04  Arabic_ra      ر
  0x0630, // AB05  Arabic_thal    ذ
  0x062f, // AB06  Arabic_dal     د
  0x067e, // AB07  Arabic_peh     پ
  0x0648, // AB08  Arabic_waw     و
] as const;

function toRow(codePoints: readonly number[]): string {
  return String.fromCodePoint(...codePoints);
}

/**
 * The three physical letter rows, each on its own.
 *
 * They are deliberately NOT concatenated. Joining the end of one row to the
 * start of the next would invent adjacency that does not exist on the keyboard,
 * and a slice spanning that seam is not a walk anyone could type. Cross-row
 * walks would need real key-adjacency modelling and a separate review.
 */
export const PERSIAN_LAYOUT_ROWS: readonly string[] = [
  toRow(AD_ROW_CODE_POINTS),
  toRow(AC_ROW_CODE_POINTS),
  toRow(AB_ROW_CODE_POINTS),
];

/**
 * The Persian number row is absent by design.
 *
 * After the digit fold below, `۱۲۳۴۵۶۷۸۹۰` becomes `1234567890`, which the
 * existing ASCII digit sequence already covers. One rule, three numeral
 * systems, no duplicated data.
 */

// --- Digit-system folding ---------------------------------------------------

const PERSIAN_DIGIT_ZERO = 0x06f0; // U+06F0 .. U+06F9  ۰۱۲۳۴۵۶۷۸۹
const ARABIC_INDIC_DIGIT_ZERO = 0x0660; // U+0660 .. U+0669  ٠١٢٣٤٥٦٧٨٩
const ASCII_DIGIT_ZERO = 0x0030;

/**
 * Maps Persian and Arabic-Indic digits onto ASCII digits.
 *
 * STRICTLY FOR WEAK-PATTERN DETECTION. This must never touch hashing, stored
 * values, verification, NFC normalisation, or general string comparison: two
 * passwords differing only in numeral system remain different passwords and
 * produce different hashes. The fold exists so that one sequence and one
 * repetition rule can recognise `۱۲۳۴۵۶۷۸۹۰`, `١٢٣٤٥٦٧٨٩٠` and `1234567890` as
 * the same weak shape, including when they are mixed inside one password.
 *
 * This is categorically unlike folding yeh or kaf. `۱`, `١` and `1` are three
 * encodings of the numeral one; Persian yeh and Arabic yeh are different
 * letters, and those are never folded anywhere in this codebase.
 */
export function foldDigitSystems(value: string): string {
  let folded = '';

  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint === undefined) continue;

    if (codePoint >= PERSIAN_DIGIT_ZERO && codePoint <= PERSIAN_DIGIT_ZERO + 9) {
      folded += String.fromCodePoint(ASCII_DIGIT_ZERO + (codePoint - PERSIAN_DIGIT_ZERO));
    } else if (codePoint >= ARABIC_INDIC_DIGIT_ZERO && codePoint <= ARABIC_INDIC_DIGIT_ZERO + 9) {
      folded += String.fromCodePoint(ASCII_DIGIT_ZERO + (codePoint - ARABIC_INDIC_DIGIT_ZERO));
    } else {
      folded += character;
    }
  }

  return folded;
}
