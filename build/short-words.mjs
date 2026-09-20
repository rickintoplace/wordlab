// Zweibuchstabige Wörter, die wirklich Wörter sind. Alles andere mit zwei
// Buchstaben ist im Aussprachelexikon eine Abkürzung ("ca" für circa, "mo",
// "ex") und stört als Ergebnis mehr, als es nützt.
export const TWO_LETTER = new Set(`
ah am an as at aw ax ay be by do eh go ha he hi ho id if in is it la lo ma me
my no of oh ok on or ow ox oy pa re so to uh um up us we ye yo
`.trim().split(/\s+/));
