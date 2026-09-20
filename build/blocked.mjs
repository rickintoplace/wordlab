// Wörter, die gar nicht erst in die Datendatei kommen — unabhängig von jeder
// Option, auch nicht in den derben Modi. Die Profanitätsliste wirft derbe
// Wörter und Slurs in einen Topf; der Regler soll Derbes freischalten können,
// diese hier nie.
//
// Nicht aufgenommen sind mehrdeutige Fälle, deren Hauptbedeutung harmlos ist
// (spade, cracker, spook, nip, yank, paddy, dike, jigs …) — die stehen in
// not-vulgar.mjs und gelten als ganz normale Wörter.

/** Ethnische, homophobe und behindertenfeindliche Slurs. */
const SLURS = `

`;

const ABUSE = `

`;

export const BLOCKED = new Set((SLURS + ABUSE).trim().split(/\s+/));


// const SLURS = `
// abbo abeed africoon africoons abo abos arabush arabushs argie argies armo armos
// beaner beaners boong boonga boongas boongs chinaman chinamen chink chinks chonky
// coon coons dago dagos darkie darkies darky dink dinks dothead dyke dykes eyetie
// fag faggot faggots fags gippo gook gooks greaseball gyppo gyppos
// halfbreed heeb homo homos honkies honky hymie injun jap japs jigaboo
// kaffir kike kikes kraut krauts lardass lesbo mockie
// mong mongoloid mulatto poof poofs poofter poofters mulattos negress negro negroes negroid nig nigga niggas
// niggard niggardly nigger niggers nignog paki pakis pickaninny polack
// raghead ragheads redskin redskins retard retarded retards roundeye
// sambo shemale shylock slanteye slopehead spearchucker spic spics squaw
// tard tranny trannies transhit wetback wetbacks whitey wigger wog wogs
// wop wops yid yids yobbo zipperhead
// `;

// const ABUSE = `
// bestial bestiality childporn incest incestuous jailbait lolita molest molested
// molester molestation molesting necrophilia pedo pedophile pedophiles pedophilia
// preteen rape raped raper rapers rapes raping rapist rapists sodomize sodomized
// `;