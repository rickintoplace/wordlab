# wordlab

Zwei phonetische Wortspiel-Werkzeuge fürs Englische auf einer gemeinsamen
Lautdatenbank, unter [wordlab.rickinto.place](https://wordlab.rickinto.place):

- **`/`  Spoonerize** — tauscht die Anlaute zweier Wörter und behält nur
  Tausche, die wieder echte Wörter ergeben.
- **`/misheard`  Misheard** — dieselbe Lautkette, anders in Wörter geschnitten
  (*ice cream* / *I scream*). Siehe [unten](#misheard-dieselbe-lautkette-anders-geschnitten).

Der Spoonerismus-Generator ist der Nachfolger des deutschen — der Nachfolger des
deutschen [Schüttelreim-Generators](https://github.com/Reimisch/reimisch.github.io).
Statt Buchstaben werden diesmal **Laute** getauscht, und es kommen nur
existierende, gebräuchliche Wörter heraus.

Reine statische Seite: HTML, CSS, ES-Module, eine Textdatei. Kein Server, kein
Build-Schritt beim Deploy, keine laufenden Kosten.

## Wie es funktioniert

Ein Spoonerismus besteht hier aus vier Wörtern in zwei Zeilen:

```
lighting  a fire        A = a + R1      C = b + R2
fighting  a liar        B = b + R1      D = a + R2
```

`a` und `b` sind Anlaute (alle Konsonanten vor dem ersten Vokal, also auch
Cluster wie /str/), `R1` und `R2` die Reime (der ganze Rest des Worts). Der
Tausch geht genau dann auf, wenn beide Reime beide Anlaute hergeben — dann sind
alle vier Wörter echt, und die Spalten reimen sich automatisch.

Die Engine indexiert dafür beim Laden zwei Maps: `Reim → Anlaut → Wörter` und
`Anlaut → Reime`. Eine Generierung ist dann nur noch zweimal Würfeln plus ein
Nachschlagen — rund **0,1 ms**, unabhängig von der Wörterbuchgröße.

## Die schwierigen Stellen

| Problem | Lösung |
| --- | --- |
| **Eigennamen** im Aussprachelexikon (`mary`, `london`, `kevin`) | Hunspell kennt sie nur großgeschrieben. Alles, was kleingeschrieben nicht korrekt ist, fliegt raus — 31.430 Einträge. `smith`, `rose`, `bill` bleiben, weil sie auch Gattungswörter sind. |
| **Abkürzungen** (`st` → /striːt/, `mr` → /mɪstɚ/) | Wörter ohne Vokalbuchstaben werden verworfen. |
| **Seltene Wörter** | Häufigkeiten aus einem 20-Mio-Zeilen-Korpus gesprochener Sprache (OpenSubtitles). Der Regler „How common" schneidet bei Rang N ab; voreingestellt sind die 10.000 häufigsten. |
| **Natürlichkeit** | Die Auswahl ist zu häufigen Wörtern hin verzerrt (`bias`), und aus mehreren Treffern gewinnt der, dessen *seltenstes* der vier Wörter am häufigsten ist (`shortlist`). |
| **Mehrere Aussprachen** (`read`, `lead`, reduziertes `for` → /fɚ/) | Jede Aussprache ist ein eigener Indexeintrag. Nebenaussprachen sind per Voreinstellung aus, weil sie Unsinn wie „has was" erzeugen; ein Schalter lässt sie zu. |
| **Homophone** (`bear`/`bare`, `sent`/`scent`/`cent`) | Gleicher Anlaut + gleicher Reim = ein Eintrag mit mehreren Schreibweisen. Angezeigt wird die häufigste, die übrigen stehen als „also:" darunter. |
| **Entartete Treffer** (`cooking looked → looking cooked`) | Verworfen, wenn ein Wort der ersten Spalte mit einem der zweiten vier Anfangsbuchstaben teilt. |
| **Derbe Wörter** | Vierstufiger Regler, siehe unten. |

Unter jedem Wort steht die Aussprache in IPA, der getauschte Anlaut in Orange —
damit ist auch bei `read`/`led` sofort klar, was gemeint ist.

## Der Derbheitsregler

Vier Stufen (`VULGARITY` in `public/engine.js`):

| Stufe | Bedeutung |
| --- | --- |
| 0 `NONE` | derbe Wörter sind ausgeschlossen (Voreinstellung) |
| 1 `ANY` | kein Filter |
| 2 `SOME` | mindestens eins der vier Wörter ist derb |
| 3 `MOST` | in **jedem** Wortpaar steckt ein derbes Wort |

Stufe 3 heißt bewusst nicht „nur derbe Wörter": alle vier Wörter derb ergibt das
Vokabular praktisch nicht her. Es gibt genau acht solcher Vierergruppen
(`fuck sucking → suck fucking`, `dick pricks → prick dicks`, `slut smutty →
smut slutty` …), und die fallen alle durch den Stammfilter, weil sie nur
flektierte Formen derselben zwei Wörter sind. Die Wertung bevorzugt aber
möglichst viele derbe Wörter, so dass die derbstmögliche Lösung gewinnt.

In den Stufen 2 und 3 wird das Startwort direkt aus den 194 derben Wörtern
gezogen (gleichverteilt, nicht häufigkeitsgewichtet — sonst käme fast immer
`hell` heraus) und sein Anlaut festgehalten; blind zu würfeln, bis zufällig ein
derbes Wort dabei ist, wäre aussichtslos. Anschließend wird das Ergebnis
zufällig gespiegelt, damit das gezogene Wort nicht immer oben links steht —
beide Spiegelungen sind wieder gültige Spoonerismen.

Weil nur 194 Wörter markiert sind und die meisten weit hinten in der
Häufigkeitsliste stehen, lohnt es sich, für die Stufen 2 und 3 den
Häufigkeitsregler aufzuziehen: bei Rang 10.000 gibt es ~90 verschiedene
Ergebnisse für Stufe 3, bei vollem Umfang ~650.

### Kuratierung der Wortliste

Die [Profanitätsliste](https://github.com/hypernewbie/vbw) wirft alles in einen
Topf, deshalb zwei Korrekturlisten im Repo:

- **`build/blocked.mjs`** — kommt gar nicht erst in die Daten, unabhängig von
  jeder Option: Slurs sowie Begriffe rund um sexuelle Gewalt und
  Kindesmissbrauch. Das ist keine Derbheit, die man freischalten möchte.
- **`build/not-vulgar.mjs`** — steht in der Liste, ist aber kein derbes Wort:
  `words`, `demon`, `illegal`, `vodka`, `stroke`; Identitätsbegriffe wie `gay`,
  `lesbian`, `transsexual`, `interracial`, deren Einordnung als „derb" selbst
  eine Beleidigung wäre; und Wörter mit harmloser Hauptbedeutung wie `balls`,
  `knob`, `hoe`, `vixen`, `pansy`, `spade`, `cracker`, `yank`, `penetrate`.

Von 2.487 Listeneinträgen bleiben so 194 tatsächlich derbe Wörter übrig. Beide
Listen sind Ermessensfragen und zum Nachjustieren gedacht.

## Oberfläche

Zwei Regler sind aus dem cindermate-Projekt übernommen und nach Vanilla-JS
portiert (`public/sliders.js`, kein React):

- **Wortschatz** — der `CharacterDepthBooksSlider`: vom losen Zettel über
  einzelne Bände bis zum Bücherhaufen, fünf Stufen von „die 3.000 häufigsten
  Wörter" bis „alle".
- **Derbheit** — der `BadTraitsSlider`: ein Gesicht, das vom Heiligenschein zu
  den Hörnern wandert, vier Stufen.

Alle teilen sich denselben Kern: ein `<input type=range>` mit `step="0.01"`,
das beim Loslassen in 380 ms weich auf den nächsten ganzen Wert rutscht, eine in
Pixeln gesetzte Füllspur (`--fill-px`), die exakt unter dem Griff endet, und
anklickbare Wörter darunter.

Eine Falle steckt darin: `input.value` läuft während des Einrastens erst noch
zum Ziel. Wer ihn in dem Moment ausliest — etwa eine Suche, die durch `onChange`
neu angeworfen wird — bekommt den **alten** Stand. Ein Klick auf „Noisy" suchte
so weiter mit „Faint", und erst die nächste Reglerbewegung brachte es in
Ordnung. `get()` liefert deshalb den gemerkten Zielwert, nicht den Reglerstand.

Immer sichtbar sind Wortschatz, Derbheit, Startwort und Silbenzahl; Wortlängen
und die beiden Schalter liegen hinter „Show more".

### Lautfarben

Über die vier Wörter verteilen sich genau zwei Anlaute und zwei Reime — also
vier Lautbausteine. In der Lautschrift bekommt jeder davon eine eigene Farbe,
über alle vier Wörter hinweg dieselbe:

```
lazy   /leɪzi/      l  → Farbe 1      eɪzi → Farbe 3
dive   /daɪv/       d  → Farbe 2      aɪv  → Farbe 4
daisy  /deɪzi/      d  → Farbe 2      eɪzi → Farbe 3
live   /laɪv/       l  → Farbe 1      aɪv  → Farbe 4
```

Die Zuordnung fällt in `render()` an: die Engine liefert Anlaut und Reim jedes
Treffers als eigene Felder, daraus werden zwei Indizes und daraus die
CSS-Klassen `onset-0/1` und `rime-0/1`.

Die vier Farben stehen als `--c-onset-1` … `--c-rime-2` in `:root`, in OKLCH
notiert und mit **gleicher Helligkeit und ähnlicher Buntheit** — sie
unterscheiden sich nur im Farbton (Bernstein, Indigo, Petrol, Altrosa). Dadurch
wirken sie als Familie und nicht als Regenbogen, und keine Farbe drängt sich
vor. Für den dunklen Modus wird dieselbe Familie auf Helligkeit 0.8 gehoben.

Die Schreibweise bleibt einfarbig — Buchstaben lassen sich im Englischen nicht
verlässlich auf Laute abbilden (`daisy` hat fünf Buchstaben für vier Laute).

### Animationen

- Buchstaben werden einzeln in `.letter`-Spans zerlegt, jeder bekommt seinen
  Index als `--i`. Die Staffelung passiert dann komplett in CSS
  (`animation-delay: calc(var(--row) * 90ms + var(--i) * 26ms)`) — kein
  JavaScript läuft währenddessen.
- Ein Durchlauf: altes Ergebnis fällt heraus (190 ms), neues läuft
  zeilenweise von links und rechts ein (~520 ms). Die Suche selbst dauert
  0,1 ms, die Zeit gehört ganz der Animation.
- **Der Titel führt vor, worum es geht.** „Tips of the Slung" ist der
  Spoonerismus von „Slips of the Tongue"; beim Überfahren wechseln die beiden
  Anlaute sichtbar die Plätze und machen das Original daraus. Die Anlaute sind
  feste Elemente, die zwischen den Wörtern umgehängt werden — nur so können sie
  wirklich quer durch den Titel wandern. Danach misst `swapPhrase()` alle
  Bausteine erneut und animiert sie von ihrer alten Position aus zurück (FLIP).
  Die beiden Anlaute fliegen dabei über gegenläufige Bögen, damit sie sich
  kreuzen statt sich zu überlagern, und tragen ihre Farbe mit.

  Gemessen wird **vor** dem Abbruch der laufenden Flüge, also dort, wo die Teile
  gerade wirklich stehen, und die Dauer hängt am verbleibenden Weg. Schnelles Hin
  und Her kehrt dadurch mitten in der Bewegung um, statt die alte Strecke erst zu
  Ende zu spielen.

  Die Schreibung des zweiten Reims zieht mit (`ung` → `ongue`) — das ist kein
  ausgetauschter Text, sondern vier feste Zellen: `n` und `g` bleiben stehen,
  das `u` rollt zum `o` um (der alte Buchstabe fällt dabei aus dem Fluss, damit
  die Zelle sofort die neue Breite hat), und das stumme `ue` klappt in der bis
  dahin leeren vierten Zelle auf.
- **Der Button** hat keinen Glow und keinen Schimmer mehr. Hinter ihm dreht
  sich ein `conic-gradient` aus den vier Lautfarben, ein innen aufgesetzter
  Grund (`::before`, `inset: var(--ring)`) deckt alles bis auf den Rand ab.
  Übrig bleibt ein wandernder Farbring. `--angle` ist per `@property` als
  `<angle>` registriert, sonst ließe sich ein Winkel nicht animieren.
  Die Zustände: Ruhe 1,8 px Ring / 9 s Umlauf · Zeiger darüber 2,5 px und
  `scale(1.025)` · gedrückt 4 px und `scale(.962)` in 100 ms mit harter Kurve ·
  Loslassen federt über `cubic-bezier(.34, 1.4, .64, 1)` an der Ausgangsgröße
  vorbei · während der Suche 3 px und 1,4 s Umlauf.

## Misheard: dieselbe Lautkette, anders geschnitten

```
   [ the  ][    sky    ]      ← was du getippt hast
     ð  ə  s  k  aɪ           ← seine Laute
     ð  ɪ  s  ɡ  aɪ           ← die Laute, die man stattdessen hört
   [ this ][    guy    ]      ← und die Wörter dazu
```

Beide Lautzeilen stehen übereinander, und wo sie sich unterscheiden, sind beide
Felder markiert. Damit ist ablesbar, **woran** ein Verhörer hängt — hier ə→ɪ und
k→ɡ — statt nur, dass irgendetwas anders ist.

Der Spoonerismus verschiebt Laute, das Oronym verschiebt die **Wortgrenzen** —
dieselbe lautbewahrende Umformung, nur auf der anderen Achse. Die Phrase wird zu
einer durchgehenden Lautfolge, eine Strahlsuche schneidet sie auf alle anderen
Arten neu, die lauter echte Wörter ergeben. Bewertet wird nach Worthäufigkeit,
mit einem Abschlag pro Wort, damit nichts in lauter Kurzwörter zerbröselt.

### Die Bewertung

Zwei Dinge werden gegeneinander gewogen: wie **plausibel** eine Lesart sprachlich
ist (Worthäufigkeit) und wie **interessant** sie als Oronym ist. Ungedämpft
erdrückt die Häufigkeit alles — *my self* schlägt *mice elf* dann um Längen,
obwohl letzteres der eigentliche Fund ist. Deshalb:

- die Häufigkeit wird gewichtet — und zwar mit einem **Sockel**: unterhalb von
  Rang 900 bringt mehr Häufigkeit keinen Vorteil mehr. Ohne ihn bekommen
  Funktionswörter wie *my* (Rang 31) einen so großen Vorsprung, dass *my self*
  jede interessantere Lesart erschlägt; mit ihm rückt *ice bank mice elf* von
  Platz 161 auf 6,
- eine Betonung an neuer Stelle kostet. Der Index ist betonungsfrei, damit sich
  Betonungsverschiebungen überhaupt finden lassen — sonst gilt aber *thus* für
  ein unbetontes *the* als lautgleich und landet vor *this*,
- jede Wortgrenze an neuer Stelle zählt positiv, und zwar **schon während der
  Suche**, sonst wirft der Strahl die tief umgeschnittenen Pfade zu früh weg,
- unverändert übernommene Wörter zählen negativ, **und zwar nach Lautanzahl**:
  wer bei *i spank myself* das Wort *myself* stehen lässt, hat die halbe Kette
  gar nicht verhört. Das drückt Lesarten, die nur die erste Hälfte umhören, aus
  den vorderen Plätzen,
- Interjektionen kosten extra. In Untertiteln stehen *huh*, *duh* und *uh*
  häufiger als die meisten Inhaltswörter, und ohne Aufschlag verdrängt
  *her duh* das eigentliche *hurt*,
- **wirklich** lautgleiche Lesarten bekommen einen festen Bonus. „Wirklich"
  heißt: kein Laut verändert *und* keine Betonung verschoben. Der Index ist
  betonungsfrei, damit sich Betonungsverschiebungen überhaupt finden lassen —
  aber *thus* für ein unbetontes *the* ist eben nicht dasselbe Geräusch. Ohne
  diese Bedingung kassiert *thus chi* den vollen Bonus und steht vor
  *this guy*; mit ihr fällt es von Platz 1 auf 14,
- die Strafe für Lautabweichungen wächst **quadratisch**. Linear geht nicht auf:
  hart genug, um eine 2,3er-Vertauschung zu erdrücken, wäre auch hart genug, um
  die 0,6er-Verschiebung zu erdrücken, an der *the sky* / *this guy* hängt.

Sortiert wird allein nach dieser Bewertung. Neu geschnittene Lesarten zusätzlich
absolut vorzuziehen war ein Fehler: bei einwortigen Eingaben gibt es keine
Schnittstelle zu verschieben, und damit landete jede Ein-Wort-Lesart hinten —
*heard* → *hurt* war so überhaupt nicht zu finden.

Ausgegeben wird nicht stur nach Rang: die drei stärksten Treffer zuerst, danach
im **Rundlauf über die Schnittmuster** — erst die beste Lesart jeder Zerlegung,
dann die zweitbeste jeder Zerlegung. Sonst füllen Varianten derselben Zerlegung
(*ice bank my self*, *ice punk my self*, …) die ganze Liste.

Die Strahlbreite richtet sich nach der Kettenlänge. Mit fester Breite fällt bei
längeren Sätzen genau der interessante Pfad heraus, bevor er sich auszahlt —
*the stuff he knows* überlebt sonst nicht bis ans Ende des Satzes.

Getunt wurde das nicht nach Gefühl, sondern gegen eine Liste von 29 bekannten
Oronymen: `node tools/tune-oronyms.mjs` meldet, auf welchem Platz jedes Ziel
landet.
Dazu kommen Gegenbeispiele, die *nicht* vorn stehen dürfen. **25 der 29 Ziele
stehen in der Liste, 15 davon auf Platz eins**, und kein Gegenbeispiel ist unter
den ersten drei.

Drei Grenzen bleiben:

- **Lange Sätze.** *stuffy nose* → *stuff he knows* steht auf Platz 6; mit
  *the … can lead to problems* drumherum verliert sich der Treffer im Raum
  möglicher Zerlegungen. Das Werkzeug ist auf kurzen Phrasen am stärksten.
- **Eigennamen.** *euthanasia* → *youth in asia* ist unerreichbar, weil *asia*
  vom Eigennamenfilter aus dem Ausgabewortschatz fliegt — derselbe Filter, der
  *mary* und *london* fernhält.
- **Sehr seltene Wörter.** *mint spy* → *mince pie* liegt um Platz 180: das
  weggefallene /t/ kostet nach der Clusterregel nur noch 0,48, aber *mince*
  steht auf Rang 18.608, und so weit hinten reicht auch der Sockel nicht mehr.

Laufzeit: eine Millisekunde für eine kurze Phrase, 25 ms für neun Wörter bei
voller Toleranz. Der Suchraum ist klein, weil pro Startposition nur Teilstrings
bis zur Länge des längsten Wortes geprüft werden — bei 40 Lauten sind das rund
640 Nachschläge.

### Beispiele

Unter dem Eingabefeld stehen sechs anklickbare Vorlagen, bei jedem Seitenaufruf
andere, und bei leerem Feld nimmt der Knopf eine zufällig. Es sind dieselben,
gegen die die Bewertung eingestellt ist — jede liefert bei der Voreinstellung
etwas.

### Der Toleranzregler

Bei „Exact" müssen die Laute exakt übereinstimmen. Danach dürfen einzelne Laute
verrutschen, und was das kostet, steht in `public/confusion.js`. Grundlage ist
Miller & Nicely (1955): **im Rauschen überleben Stimmhaftigkeit und Nasalität,
der Artikulationsort geht als Erstes verloren.** Ein Ortswechsel bei gleicher
Artikulationsart ist deshalb billig (/p/→/t/), ein Stimmhaftigkeitswechsel teuer
(/p/→/b/). Ein paar notorische Paare sind von Hand verbilligt (θ/f, ð/v, l/ɹ),
unbetonte Vokale fallen fast kostenlos zum Schwa zusammen, und /h/ sowie
Schwa dürfen ganz verschwinden.

Vier Regeln hängen an der Umgebung, nicht am Laut allein, und jede entscheidet
über bekannte Beispiele:

- **Nach /s/ ist der Stimmhaftigkeitskontrast der Verschlusslaute praktisch
  aufgehoben** — das k in *sky* ist unbehaucht und klingt wie ein g. Ohne diese
  Regel findet das Werkzeug ausgerechnet das bekannteste Oronym nicht
  (*the sky* / *this guy*).
- **Am Wortende sind Verschlusslaute unreleased**; die Stimmhaftigkeit hängt
  dort fast nur an der Länge des Vokals davor, also an einem schwachen Merkmal.
  Ohne diese Regel bleibt *heard* / *hurt* unerreichbar, weil /d/→/t/ sonst 2,3
  kostet und damit über jeder Toleranzstufe liegt.
- **Angleichung an den Nachbarlaut**: wird ein Laut so gehört, dass er mit dem
  Laut davor oder danach zusammenfällt, entsteht ein langer Laut statt zweier
  kurzer — und den hört niemand heraus. Daran hängt *mishear it* →
  *miss see rid*: das /h/ verschwindet im /s/ davor. Ohne die Regel kostet
  /h/→/s/ volle 1,8 und der Treffer landet auf Platz 390 statt auf Platz 2.
- **Stimmhaftigkeit im Geräuschlautcluster**: neben einem anderen Obstruenten
  gleicht sich ein Laut an, und der Unterschied wird unhörbar. *example* und
  *egg sample* trennt genau das /z/ neben dem /ɡ/.
- **Clustervereinfachung**: ein Verschlusslaut zwischen zwei Konsonanten fällt
  im Englischen routinemäßig weg — *mints* und *mince* klingen gleich. Ohne die
  Regel kostet das Weglassen so viel wie ein beliebiger Lautverlust.

Und eine Entscheidung in der Lautdarstellung selbst: **Affrikaten werden überall
aufgelöst** (`tʃ` → `t` + `ʃ`). Als ein Zeichen geführt hätten *why choose*
(… tʃ u z) und *white shoes* (… t ʃ u z) verschiedene Kettenlängen und könnten
sich nie treffen — die Wortgrenze fällt ja mitten in die Affrikate. Lautlich ist
eine Affrikate genau ein Verschluss plus ein Reibelaut, also ist das nicht nur
ein Kniff, sondern die richtigere Darstellung.

Die Kostenfunktion bekommt deshalb den Vorgängerlaut aus der ganzen Kette und
die Position im Wort mitgeliefert, nicht nur die beiden Laute.

Auf der obersten Stufe sind **zwei** verrutschte Laute im selben Wort erlaubt —
darauf beruhen Fälle wie *mishear it* → *miss see rid*, wo in *see* gleich zwei
Laute anders gehört werden. Weil das kombinatorisch teuer ist, gilt es nur dort,
nur für kurze Wörter und nur mit den billigsten Alternativen.

### Das Band

Obere Zeile und Lautkette hängen nur an der Phrase; beim Überfahren der Liste
wird ausschließlich die untere Zeile angefasst, und auch dort nur das, was sich
wirklich ändert — gleich gebliebene Blöcke werden nicht neu gebaut und nicht neu
animiert.

Gewechselt wird erst, wenn der Zeiger **130 ms liegen bleibt**. Ohne diese
Verzögerung rennt für jede gestreifte Zeile eine eigene Verwandlung los, und das
Band wirkt hektisch, auch wenn die Bildrate stimmt. Gemessen beim Durchfahren
von 36 Zeilen im 22-ms-Takt: **2 tatsächliche Verwandlungen statt 36**. Ein
Klick wechselt sofort.

Die untere Zeile besteht aus **festen Blasen**, die nur ihre Maße ändern: ein
Vorrat von zehn absolut positionierten Elementen, die je Lesart neue `left`- und
`width`-Werte bekommen. Dadurch greifen die CSS-Übergänge auch mitten in der
Bewegung und laufen ineinander, statt neu zu starten — schnelles Überfahren der
Liste wird dadurch ruhig, ohne künstliche Verzögerung. Eine neue Blase beginnt
als Strich an der Trennstelle und geht auf; eine überflüssige schmilzt in ihre
Mitte ein.

Der SVG-Goo-Filter (Weichzeichnen, dann Alphakanal wieder schärfen) wird **nicht
an- und ausgeschaltet** — das wäre der sichtbare Sprung. Er läuft dauerhaft mit
schwacher Weichzeichnung, und beim Wechsel zieht `misheard.js` seine
`stdDeviation` hoch und wieder herunter. Der flache Exponent der Abklingkurve
hält sie lange oben: verschmelzen geht schnell, lösen langsam. Die Beschriftung
liegt auf einer eigenen, ungefilterten Ebene und bleibt scharf.

Wie überzeugend eine Lesart ist, steht als `--strength` an der Zeile und färbt
die Schrift — gemessen am **Bewertungsabstand zur besten Lesart**. Aus
Lautabstand und Wortseltenheit direkt zu rechnen sah willkürlich aus: der erste
Treffer konnte blasser stehen als der zehnte. Am Abstand ist die Helligkeit
zwangsläufig mit der Reihenfolge einig.

Der frühere Aufbau — Blasen je Wechsel anlegen und entfernen, per FLIP animiert
— hatte drei Probleme, die diese Fassung gar nicht erst haben kann: überlappende
Grid-Spannen legten neue Zeilen an, auslaufende Blasen stapelten sich, und
verschobene Elemente vergrößerten den Scrollbereich, was in Chromium sporadisch
eine waagerechte Bildlaufleiste aufblitzen ließ. Gemessen über 36 schnelle
Wechsel: **Überhang 0 px**, Bandhöhe unverändert, Filter im Ruhezustand aus.

### Was angezeigt wird

Nur Lesarten mit **neuer Schnittstelle** sind echte Oronyme; reine
Wortvertauschungen (*a bit* → *a but*) stehen hinten, sind mit „same cut"
gekennzeichnet und auf drei begrenzt, sonst fluten sie die Liste. Lesarten, in
denen kein einziges neues Wort vorkommt, fallen ganz weg. Rechts steht in fester
Spaltenbreite, wie viele Laute verrutscht sind — feste Breite, damit beim
Überfahren nichts springt.

Zwei Lexika: die Eingabe darf alles sein, was im Aussprachewörterbuch steht
(Namen und seltene Wörter inklusive, `data/lexicon-extra.txt`, wird erst bei
Bedarf nachgeladen) — die **Ausgabe** kommt aus dem kuratierten Wortschatz.

Dazu gehören auch Apostrophformen: ohne sie scheitert schon „i can't see". Sie
stehen allerdings **nur** im Eingabelexikon. In der Ausgabe verdoppeln sie
lautgleiche Kandidaten (*cant* / *can't*) und drängen bessere Lesarten aus der
Liste — die Messlatte fiel dadurch von 158 auf 267. Die Häufigkeitsliste kennt
selbst keine Apostrophe, deshalb zählt für sie die nackte Form (*dont*).

Wie stark seltene Wörter benachteiligt werden, ist ein **Regler**: von
„everyday words only" bis „the long tail is fair game". Gewicht und Sockel
zusammen verschieben das Gleichgewicht zwischen naheliegend und überraschend —
bei *i spank myself* steht *ice bank mice elf* je nach Stellung auf Platz 161
oder auf Platz 6.

### Hören

`speechSynthesis` spricht beide Lesarten nacheinander. Bei einem lautlichen
Werkzeug ist das kein Beiwerk: gelesen sind *ice cream* und *I scream*
verschieden, gehört sind sie gleich. Der Spoonerismus-Generator hat denselben
Knopf bekommen.

Gesprochen wird nur, was man anklickt — eine Lesart, eine Zeile. Kein Knopf,
der ungefragt beides abspielt.

**Unter Linux braucht das Systempakete.** Chrome und Firefox beziehen ihre
Stimmen von `speech-dispatcher`; fehlt es, existiert `speechSynthesis` zwar,
liefert aber keine einzige Stimme und schweigt bei jedem Aufruf. Die Seite prüft
das aktiv und sagt es, statt still nichts zu tun:

```sh
sudo pacman -S speech-dispatcher espeak-ng   # Arch/CachyOS
sudo apt install speech-dispatcher espeak-ng # Debian/Ubuntu
```

**Chrome braucht zusätzlich Geduld.** Es liefert bei `getVoices()` anfangs oft
ein leeres Feld und füllt es erst später; je nach Version feuert
`voiceschanged` spät oder gar nicht ([bekannter
Fehler](https://issues.chromium.org/issues/374263394)). Deshalb fasst
`voicesReady()` fünf Sekunden lang alle 250 ms nach, statt einmal zu fragen —
und `say()` prüft beim ersten Klick noch einmal, falls die Liste bis dahin
gekommen ist.

### Stimmen

Die Systemstimmen werden nach Güte sortiert, statt einfach die erste passende zu
nehmen: Windows-11-Stimmen mit „(Natural)" zuerst, dann die macOS-Stimmen mit
„Premium"/„Enhanced", dann Chromes eigene „Google …"-Stimmen, dann gepflegte
Systemstimmen wie *Samantha* oder *Alex*, und ganz zuletzt espeak-ng samt seiner
tausenden Klangvarianten. Auf Windows und macOS trifft das ohne Zutun die gute
Wahl; unter Linux sagt die Seite, wenn nur espeak da ist.

Neuronales TTS im Browser (Kokoro-82M als ONNX) war eingebaut und ist wieder
draußen. Gemessen ohne GPU: 21,6 s zum Laden von 86 MB und 5,1 s für 1,9 s Ton —
langsamer als Echtzeit. Mit WebGPU wäre es brauchbar, aber `navigator.gpu` zu
haben heißt nicht, dass ein Adapter da ist; auf der Entwicklungsmaschine war
keiner. Für ein Werkzeug, das man zwischendurch aufruft, ist das kein Handel.

**espeak-ng klingt hart** — das ist Formantsynthese und lässt sich von außen
nicht schönrechnen. Wer mehr als eine Stimme installiert hat, bekommt neben der
Ergebnisliste eine Auswahl, nach Grundstimme gruppiert (speech-dispatcher reicht
sonst dreistellig viele espeak-Varianten durch, die sich nur durch ein Kürzel
wie `+f3` unterscheiden). Vorgehört wird am eigenen Inhalt. Die Wahl wird
gemerkt. Deutlich besser als espeak und in den Arch-Repos:

```sh
sudo pacman -S rhvoice rhvoice-language-english rhvoice-voice-alan
```

**Installieren allein reicht unter Arch nicht.** Das `speech-dispatcher`-Paket
registriert kein RHVoice-Modul, und in `/etc/speech-dispatcher/speechd.conf`
sind sämtliche `AddModule`-Zeilen auskommentiert — der Dienst erkennt dann nur
espeak-ng automatisch. `spd-say -O` zeigt, was wirklich da ist. Abhilfe:

```sh
mkdir -p ~/.config/speech-dispatcher
cat > ~/.config/speech-dispatcher/speechd.conf <<'CONF'
AddModule "rhvoice"    "sd_rhvoice"   "rhvoice.conf"
AddModule "espeak-ng"  "sd_espeak-ng" "espeak-ng.conf"
DefaultModule rhvoice
CONF
```

Danach den laufenden Dienst beenden (`pkill -f speech-dispatcher`, dazu
`rm -f /run/user/$UID/speech-dispatcher/pid/*.pid`) und den Browser neu starten.
`spd-say -O` muss `rhvoice` auflisten. Rückgängig: `rm -r ~/.config/speech-dispatcher`.

Auf macOS und Windows sind brauchbare Stimmen ab Werk da.

## Der Seitenrahmen

Kopfleiste, Fußzeile und Thema sind auf allen Seiten dieselben und liegen in
`public/theme.js` samt `public/icons.js`:

- **Hell/Dunkel** funktioniert wie auf rickinto.place: ein Schnipsel im `<head>`
  setzt `data-theme` am `<html>`, bevor irgendetwas gezeichnet wird — sonst
  blitzt beim Laden das falsche Thema auf. Ohne gespeicherte Wahl folgt die Seite
  dem System, und ein Wechsel in einem anderen Tab zieht mit.

  Im CSS steht jede Farbe nur einmal, als `light-dark(hell, dunkel)`; welche
  Hälfte gilt, entscheidet `color-scheme`. Dadurch braucht die Wahl des Nutzers
  keine zweite Palette, sondern nur zwei Zeilen
  (`:root[data-theme="dark"] { color-scheme: dark }`).

  Der Schlüssel im `localStorage` heißt wie auf der Hauptseite, geteilt wird er
  trotzdem nicht: `localStorage` gilt je Herkunft, und eine Subdomain ist eine
  eigene. Geteilt würde er nur über ein Cookie auf `.rickinto.place` — dafür ist
  eine Themawahl aber der falsche Preis.
- **Symbole** sind [Lucide](https://lucide.dev) (ISC), aber ohne Abhängigkeit:
  `icons.js` hält nur die Pfaddaten der gebrauchten Zeichen und baut daraus SVG
  mit `stroke="currentColor"`. Keine Emoji — auch nicht als Favicon
  (`public/icon.svg` ist dasselbe Kolbensymbol wie in der Kopfleiste).
- **`/legal`** trägt Impressum und Datenschutz. Beides ist kurz, weil die Seite
  wirklich nichts erhebt: kein Cookie, keine Messung, kein Server, der die
  Eingabe je zu sehen bekommt. Erwähnenswert bleibt genau ein Punkt — manche
  Browser synthetisieren Sprache in der Cloud (Chromes Google-Stimmen), und dann
  schickt der Browser den angeklickten Satz an seinen Hersteller.

## Datenquellen

Alle frei und beim Build einmalig heruntergeladen (`build/cache/`, nicht im Repo):

- [CMU Pronouncing Dictionary](https://github.com/cmusphinx/cmudict) — 126.000 Aussprachen in ARPAbet mit Betonung, BSD-artige Lizenz
- [OpenSubtitles-Häufigkeiten](https://github.com/hermitdave/FrequencyWords) (hermitdave, 2018, MIT)
- [Hunspell en](https://github.com/wooorm/dictionaries) via `nspell` — Eigennamenfilter
- [hypernewbie/vbw](https://github.com/hypernewbie/vbw) — Profanitätsliste, hier kuratiert

Ergebnis: **43.343 Wörter / 47.951 Aussprachen**, 876 KB als Text, ~295 KB über
Brotli, dazu 1,4 KB `vulgar.txt`. Aufbau des Index im Browser: ~90 ms.

## Benutzen

```sh
npm install
npm run data     # Quellen laden und public/data/words.txt bauen (einmalig)
npm run dev      # http://localhost:5173
npm run dev -- 5174   # falls der Port schon belegt ist
```

Werkzeuge:

```sh
npm run try -- 30                  # 30 Spoonerismen auf der Konsole
npm run try -- 10 --seed lighting  # mit vorgegebenem Wort
npm run try -- 10 --vulgar 3       # Derbheitsstufe (0-3), derbe Wörter mit *
npm run check                      # Invarianten prüfen (Tausch geht auf, Wörter existieren)
npm run try:misheard -- "the sky" --tol 2      # Oronyme auf der Konsole
node tools/tune-oronyms.mjs --tol 2            # Bewertung gegen bekannte Oronyme messen
node tools/shot.mjs http://localhost:5173 shot.png --light   # Screenshot via headless Chromium
```

## Deployment

`vercel.json` setzt `outputDirectory: public` und `cleanUrls`. Kein
Build-Command nötig — `public/data/words.txt` liegt im Repo und wird mit
ausgeliefert. Nach einem `npm run data` also einfach committen und pushen.

Die Seite läuft als **eigenes** Vercel-Projekt unter
`wordlab.rickinto.place`. Dafür in Vercel unter *Settings → Domains* die
Subdomain eintragen und bei Cloudflare den Eintrag anlegen, den Vercel dort
anzeigt:

| Feld | Wert |
| --- | --- |
| Type | `CNAME` |
| Name | `wordlab` |
| Target | `cname.vercel-dns.com` (oder der projektbezogene Wert, den Vercel nennt) |
| Proxy status | **DNS only** (graue Wolke) |
| TTL | Auto |

Die graue Wolke ist wichtig: mit Cloudflares Proxy meldet Vercel „Proxy
Detected", weil dann Cloudflare das Zertifikat ausstellt und Vercel keine
eigene Ausstellung prüfen kann. Für die Hauptdomain ist das so gewollt; für
Subdomains ist der direkte Weg der einfachere.

## Aufbau

```
build/     Datenpipeline (nur lokal, nicht im Auslieferungspfad)
  sources.mjs      Downloads
  build-data.mjs   Filterung -> public/data/words.txt und vulgar.txt
  blocked.mjs      fest ausgeschlossene Wörter (Slurs, sexuelle Gewalt)
  not-vulgar.mjs   Fehltreffer der Profanitätsliste
public/    die Seite selbst
  index.html       Spoonerize
  misheard.html    Misheard
  legal.html       Impressum und Datenschutz
  icon.svg         Favicon und Wortmarke (Lucide "flask-conical")
  phonemes.js      ARPAbet <-> 1-Zeichen-Kodierung <-> IPA
  engine.js        Index und Generator (DOM-frei, auch unter Node lauffähig)
  sliders.js       Bücherstapel-, Gesichts- und Rauschregler
  confusion.js     wie leicht man zwei Laute verwechselt
  oronyms.js       Resegmentierung der Lautkette (DOM-frei)
  speak.js         Sprachausgabe
  app.js           Spoonerize-Oberfläche
  misheard.js      Misheard-Oberfläche
  theme.js         Hell/Dunkel-Umschalter, auf allen Seiten
  icons.js         die gebrauchten Lucide-Pfade
  data/words.txt   wort \t kodierte Laute \t Aussprachevariante, nach Häufigkeit sortiert
  data/vulgar.txt  die als derb markierten Wörter
  data/lexicon-extra.txt  nur für die Eingabe: Namen und seltene Wörter
tools/     Konsolenwerkzeuge (try, check, serve, shot)
```
