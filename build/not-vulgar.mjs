// Steht in der Profanitätsliste, ist aber in der Hauptbedeutung ein ganz
// normales Wort. Diese Wörter werden NICHT als vulgär markiert: sie bleiben im
// "clean"-Modus erlaubt und tauchen im "derb"-Modus nicht als Füllmaterial auf.
//
// Drei Gruppen stehen hier:
//   1. Sensibles Thema ≠ vulgär — Drogen, Waffen, Krankheiten, Gewalt.
//   2. Identitätsbegriffe (gay, lesbian, transsexual, interracial). Die als
//      "derbes Wort" zu führen wäre selbst eine Beleidigung.
//   3. Wörter, deren geläufige Bedeutung harmlos ist: balls, knob, hoe, vixen,
//      pansy, dong, snatch, cocky, penetrate …
export const NOT_VULGAR = new Set(`
abuse aroused babes backdoor bagging banger bimbo bimbos blackout blacks bodily
bombers bombing bong bookie boozer boozy bum chug chute clamps cocaine commie
cox crabs cracker demon dike dingle dipstick enlargement erect escort fanny
feces fecal flamer flange flipping fungus gob gringo gyp gypped harem heroin
herpes hijacker hijacking hillbillies hillbilly homey hooch hummer illegal
illegals inbred jerk jerked jigs jihad jugs junkie kicking kumquat lech leper
loin lynch marijuana mick moron muff naked necked nimrod nip nips ninny nymph
orally ovum paddy pawn pegging penthouse peyote piker pistol playboy premature
prig quickie redneck rednecks reefer sac scat skeet slopes smack smoker snuff
sooty spade spades spastic spook stoned stoner stringer stroke stroking swastika
syphilis taboo tawdry teat terror terrorist toots torture tramp triplex trots
vodka wad wench whit whites willy words yank

bawdy banging balls boned bung cocky damnation diddle dong domination erection
eunuch flasher fondle gangsta gay gays grope guineas hoe hoes humped hustler
interracial knob knobs lesbian licking lovemaking masochist nasty pansies pansy
penetrate penetration perversion pussycat puss queer queers sadism sadist
scantily sexual sexuality sexually slag snatch spunky steamy tinkle transsexual
transvestite trashy vixen virgin voyeur whacker
`.trim().split(/\s+/));
