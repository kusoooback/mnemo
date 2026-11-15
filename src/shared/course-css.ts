/*
 * Style « cours » des fiches (voir renderer/lib/course.ts). Une seule feuille pour l'écran ET le PDF : tailles en « em »
 * (elles suivent la taille du texte), couleurs dérivées de --ac (accent de la partie) et des variables --text / --surface
 * / --border (thème clair ou sombre à l'écran, valeurs « papier » dans le PDF).
 */
export const COURSE_CSS = `
.course { --ac: var(--accent, #c6613f); --tint: color-mix(in srgb, var(--ac) 9%, var(--surface, #fff)); --mid: color-mix(in srgb, var(--ac) 28%, var(--surface, #fff)); --ink: var(--text, #1d1d1b); }
.course .fh { display: flex; align-items: stretch; gap: .9em; margin: 0 0 1em; padding: 0 0 .8em; border-bottom: 3px solid var(--ac); break-after: avoid; }
.course .fh .cbadge { flex: none; min-width: 4.3em; background: var(--ac); color: #fff; border-radius: .6em; display: flex; align-items: center; justify-content: center; padding: .5em .6em; font: 700 1.6em/1.05 var(--font-serif, Georgia, serif); text-align: center; letter-spacing: .02em; }
.course .fh .cbadge.long { font-size: 1.15em; }
.course .fh .meta { flex: 1; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.course .fh .part { font: 600 .72em/1.3 var(--font-sans, 'Segoe UI', sans-serif); letter-spacing: .12em; text-transform: uppercase; color: var(--ac); }
.course .fh h1 { font: 700 1.75em/1.15 var(--font-serif, Georgia, serif); letter-spacing: -.01em; margin: .15em 0 0; color: var(--ink); border: 0; padding: 0; }
.course h1.course-title { font: 700 1.75em/1.15 var(--font-serif, Georgia, serif); padding-bottom: .35em; border-bottom: 3px solid var(--ac); margin: 0 0 .7em; }

.course h2.A { display: flex; align-items: center; gap: .7em; background: var(--ac); color: #fff; font: 700 1.2em/1.25 var(--font-serif, Georgia, serif); padding: .4em .85em; margin: 1.5em 0 .6em; border: 0; border-radius: .55em; break-after: avoid; }
.course h2.A .n { font-size: 1.45em; opacity: .9; }
.course h3.B { display: flex; align-items: baseline; gap: .6em; font: 700 1.12em/1.3 var(--font-serif, Georgia, serif); color: var(--ac); border-left: .32em solid var(--ac); padding: .08em 0 .08em .65em; margin: 1.3em 0 .5em; break-after: avoid; }
.course h3.B .n { font: 700 .85em var(--font-sans, 'Segoe UI', sans-serif); opacity: .85; }
.course h4.C { display: flex; align-items: center; gap: .65em; margin: 1.3em 0 .5em; padding: 0 0 .3em; border-bottom: 1.5px solid var(--mid); font: 700 1.04em/1.3 var(--font-sans, 'Segoe UI', sans-serif); color: var(--ink); break-after: avoid; }
.course h4.C .pill { flex: none; background: var(--ac); color: #fff; border-radius: .4em; padding: .05em .6em; font-size: .88em; white-space: nowrap; }
.course h5.D { display: flex; align-items: center; gap: .55em; margin: 1.05em 0 .35em; font: 700 .98em/1.3 var(--font-sans, 'Segoe UI', sans-serif); color: var(--ink); break-after: avoid; }
.course h5.D .cchip { flex: none; width: 1.55em; height: 1.55em; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--tint); color: var(--ac); border: 1.5px solid var(--ac); font-size: .85em; }
.course h3.N { font: 700 1.05em/1.3 var(--font-serif, Georgia, serif); color: var(--ac); margin: 1.4em 0 .5em; padding: 0 0 .25em; border-bottom: 2px solid var(--ac); break-after: avoid; }
.course h3.N.small { font: 700 .78em/1.3 var(--font-sans, 'Segoe UI', sans-serif); letter-spacing: .12em; text-transform: uppercase; border-bottom: 1px solid var(--mid); }

.course strong.d { font-weight: 700; color: var(--ac); background: var(--tint); padding: 0 .22em; border-radius: .25em; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.course .arg { background: var(--tint); border-left: .32em solid var(--ac); border-radius: 0 .55em .55em 0; padding: .5em .85em .55em; margin: .6em 0; break-inside: avoid; }
.course .arg .lab { font: 700 .66em var(--font-sans, 'Segoe UI', sans-serif); letter-spacing: .16em; text-transform: uppercase; color: var(--ac); margin-bottom: .1em; }
.course .arg .tx { font: 600 1.03em/1.42 var(--font-serif, Georgia, serif); color: var(--ink); }
.course .diss { display: block; border: 1.3px dashed #c59a1a; background: color-mix(in srgb, #f5c542 14%, var(--surface, #fff)); border-radius: .55em; padding: .35em .75em; margin: .5em 0 .3em; font-size: .93em; color: var(--ink); break-inside: avoid; }
.course .diss .lab { font: 700 .75em var(--font-sans, 'Segoe UI', sans-serif); letter-spacing: .12em; text-transform: uppercase; color: #9a6f00; margin-right: .6em; }
.course .lead { background: color-mix(in srgb, var(--ink) 5%, var(--surface, #fff)); border-left: 3px solid color-mix(in srgb, var(--ink) 40%, transparent); border-radius: .55em; padding: .6em .85em; margin: .6em 0 .9em; }
.course .lead .lab { font: 700 .75em var(--font-sans, 'Segoe UI', sans-serif); letter-spacing: .12em; text-transform: uppercase; color: var(--ac); margin-right: .6em; }
.course .notebox { background: color-mix(in srgb, #f59e0b 13%, var(--surface, #fff)); border: 1px solid color-mix(in srgb, #f59e0b 45%, transparent); border-radius: .55em; padding: .45em .8em; margin: .6em 0; font-size: .93em; }
.course .cchips { display: flex; flex-wrap: wrap; gap: .3em; margin: .25em 0 .5em; }
.course .chipv { background: color-mix(in srgb, var(--ink) 6%, var(--surface, #fff)); border: 1px solid color-mix(in srgb, var(--ink) 18%, transparent); border-radius: 1em; padding: 0 .65em; font-size: .88em; color: var(--ink); }
.course .cchips.dates .chipv { background: var(--tint); border-color: var(--mid); }
.course .web { display: inline-block; background: #ffedd5; color: #9a3412; border: 1px solid #fdba74; border-radius: .8em; padding: 0 .5em; font: 700 .72em var(--font-sans, 'Segoe UI', sans-serif); text-transform: uppercase; letter-spacing: .05em; vertical-align: .08em; }
.course .cwarn { color: #dc2626; font-weight: 700; }
.course .callout { border-left-color: var(--c, var(--ac)); }

.course table { break-inside: auto; width: 100%; border-collapse: separate; border-spacing: 0; margin: .5em 0 .9em; font-size: .93em; border: 1px solid var(--mid); border-radius: .55em; overflow: hidden; }
.course thead th { background: var(--ac); color: #fff; border: 0; text-align: left; font-weight: 700; padding: .4em .7em; }
.course td { padding: .4em .7em; border: 0; border-top: 1px solid var(--mid); vertical-align: top; }
.course tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--ac) 4%, var(--surface, #fff)); }
.course table.ref td:last-child { color: color-mix(in srgb, var(--ink) 55%, transparent); font-size: .92em; white-space: nowrap; width: 1%; }
.course table.def td:first-child { white-space: normal; width: 24%; min-width: 0; color: var(--ac); font-weight: 700; }
.course table.def td:nth-child(2) { font-weight: 400; }
.course table.dates td:first-child { white-space: nowrap; width: 1%; color: var(--ac); font-weight: 700; }
.course ul { padding-left: 1.2em; }
.course li::marker { color: var(--ac); }
.course tr { break-inside: avoid; }
`
