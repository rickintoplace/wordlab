// Zielwörter für Beinahe-Wörter (worker.js nearMiss): derb, albern, alltäglich – das, was in einer
// ernsten Doku am meisten auffällt. Keine Beleidigungen gegen Gruppen von Menschen.
export const FUNNY = {
  de: `Pimmel Penis Schwanz Schniedel Dödel Hoden Eier Sack Nippel Busen Titten Möpse Brüste Hupen Arsch Hintern Po Popo Furz furzen pupsen Pups
Kacke kacken Scheiße Mist Pisse pissen pinkeln Pipi Klo Klopapier Toilette Durchfall Kotze kotzen Rotz Popel Schweiß stinken stinkt Gestank
Sex sexy geil nackt Nackte Puff Porno Kondom Orgasmus Vorspiel Latte Ständer Höschen Unterhose Windel Windeln BH Dildo Vibrator Fummeln
Penner Idiot Trottel Depp Arschloch Wichser wichsen Lappen Lauch Hackfresse Pfeife Bier Schnaps Wodka saufen besoffen Rausch kiffen Joint Gras
Döner Pizza Pommes Wurst Bratwurst Currywurst Würstchen Gurke Banane Möhre Kartoffel Käse Nutella Burger Schnitzel Mama Mutti Oma Opa Papa
Baby schwanger Tinder Date Liebe verliebt küssen Kuss knutschen heiraten Hochzeit Ehefrau Freundin Schatz Bett Dusche Badewanne nackig
fett dick Bauch Wampe Speck Pickel Glatze Achsel Füße Fußpilz Socken Steuer Finanzamt Rente Nachbar Polizei Knast Lehrer Hausaufgaben Mathe
Netflix Handy Internet Influencer Selfie Katze Hund Schwein Ziege Esel Affe Kuh Huhn Lama Einhorn Hamster Pudel Hose Sofa Fernseher Chef Büro`,
  en: `butt ass arse bum poop poo fart farts shit crap piss pee wee toilet diarrhea vomit puke snot booger sweat stink stinks smelly
sex sexy horny naked nude nipple nipples boobs tits balls nuts dick penis willy wiener sausage pants underpants panties bra diaper condom porn
orgasm butthole idiot moron dumb stupid loser beer vodka drunk wasted weed pizza burger fries banana cucumber potato cheese taco mom mommy
grandma dad daddy baby pregnant Tinder date kiss love marry wife girlfriend boyfriend bed shower fat belly pimple bald armpit feet socks
taxes police jail teacher homework Netflix phone wifi cat dog pig goat donkey monkey cow chicken llama unicorn hamster lick suck spank moan
wet sticky juicy sofa boss office`,
};
export const funnyWords = lang => (FUNNY[lang] ?? FUNNY.en).split(/\s+/).filter(Boolean);
