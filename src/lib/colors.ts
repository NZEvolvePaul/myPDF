// Distinct, readable colours for up to eight signers (repeats after that).
const COLORS = ['#1f6feb', '#c2410c', '#15803d', '#a21caf', '#b45309', '#0e7490', '#be123c', '#4d7c0f'];
export const signerColor = (i: number) => COLORS[i % COLORS.length];
