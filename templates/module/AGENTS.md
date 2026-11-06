# Regler for dette modul (til AI-kodeværktøjer og mennesker)

Dette er et modul til fysio.work, platformen for fysioterapiklinikker. Det gælder for
Claude Code, Codex, Lovable, broberg.ai, Henosia og alle andre værktøjer der skriver i repoet.

## Skal

1. **Start modulet med `createModule` fra `@fysio-work/sdk`.** Start aldrig en egen server
   (`Bun.serve`, `Deno.serve`, `http.createServer`, `@hono/node-server`, `app.listen`).
   `npm run check` afviser det.
2. **Ingen eksterne databaser.** Ingen Supabase, Firebase, MongoDB, Neon, PlanetScale,
   Turso, Upstash eller lignende — heller ikke hvis værktøjet foreslår det. Modulets data
   bor i det lager platformen opretter til modulet i EU, så en patient altid kan få sine data
   udleveret og slettet. `npm run check` afviser det.
3. **Valider alt input med `strictBody(z.object({ … }))`.** Brug `z` fra `@fysio-work/sdk`.
   Et ukendt felt giver 400 — det forsvinder aldrig i stilhed.
4. **Log kun navngivne felter** via `c.var.log.info("navn.på.hændelse", { felt: værdi })`, og
   tilføj feltnavnet til `log.fields` i `createModule`. Aldrig fritekst, navne, CPR eller
   anden persondata i logs.
5. **GDPR:** `exportPatient` skal returnere alt modulet har om patienten i klinikken, og
   `deletePatient` skal slette det. Platformen kalder dem; testen i `test/` beviser dem.
6. **Klinikken kommer fra platformen** (`c.var.clinic.id`) — aldrig fra en værdi i kaldet.
   Gem og læs altid data pr. klinik.
7. **Manifestet** (`fysio-work.manifest.json`) skal passe til hvad modulet gør: rettigheder,
   tabeller med patientdata og hvilke værter modulet må kalde ud til.

## Før du siger at noget virker

`npm run typecheck && npm test && npm run check` skal alle være grønne. Skriv en test der
gemmer en værdi og læser den tilbage — ikke kun at kaldet gav 200.

## Skærme

Skærme bygges som færdig front-end med platformens web-komponenter — aldrig HTML fra
serveren. Web-komponenterne er ikke udgivet endnu; modulet er indtil videre kun bagende.
