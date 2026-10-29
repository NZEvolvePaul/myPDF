export type FieldKind = 'signature' | 'initials' | 'date' | 'text';

/**
 * A field placed on a page. Position and size are fractions (0..1) of the
 * page's visible width and height, measured from the top-left corner, so a
 * field stays put whatever the zoom level.
 */
export interface Field {
  id: string;
  kind: FieldKind;
  page: number; // 0-based
  x: number;
  y: number;
  w: number;
  h: number;
  /** Text for date/text fields; a PNG data URL for signature/initials. */
  value: string;
}

export interface PageSize {
  width: number; // PDF points at scale 1
  height: number;
}
