# Dit første modul på 30 minutter

Fra ingenting til et modul der kører mod sandkassen på din egen maskine — uden at spørge
nogen. Du skal bruge Node 20 eller nyere.

> **Early access.** Sandkassen er en falsk platform på din maskine. Den rigtige platform er
> ikke åben for udrulning endnu. Alt i denne vejledning køres af SDK'ets egne tests, så den
> ikke kan gå i stykker i stilhed.

## 1. Opret modulet (1 minut)

```sh
npx @fysio-work/sdk init mit-modul
cd mit-modul
npm install
```

Mappenavnet bliver modulets id (små bogstaver, tal og bindestreg). Vil du have et andet,
så skriv `--id <id>`; et visningsnavn får du med `--name "Mine noter"`.

Du får:

| Fil | Hvad |
|---|---|
| `fysio-work.manifest.json` | Modulets id, navn, rettigheder, hvilke tabeller der rummer patientdata, og om modulet er gratis (`"pricing": "free"`; uden feltet er det betalt) |
| `src/module.ts` | Dit modul — et lille note-eksempel du kan bygge videre på |
| `src/dev.ts` | Starter modulet mod sandkassen |
| `test/module.test.ts` | Tests der kører modulet mod sandkassen |
| `.github/workflows/ci.yml` | Samme port som platformen: typecheck, test, check |
| `AGENTS.md`, `CLAUDE.md` | Reglerne til AI-kodeværktøjer (Claude Code, Codex, Lovable, Henosia m.fl.) |

## 2. Tjek at modulet følger platformens regler (1 minut)

```sh
npm run check
```

`check` afviser et modul der starter sin egen server i stedet for `createModule`, og et
manifest der ikke er gyldigt. Hvert fund
har et regel-id, en fil og en linje. `npx fysio-work check --json` giver fundene til CI.

## 3. Kør modulet mod sandkassen (2 minutter)

```sh
npm run dev
```

Sandkassen udskriver færdige `curl`-kald med en billet og en klinik, fx:

```text
# Et kald med billet og klinik
curl -i -H 'authorization: Bearer tk_…' -H 'x-fysio-organization-id: sandkasse-klinik' -H 'x-fysio-organization-ticket: ot_…' 'http://localhost:8080/'
```

Kopiér dem ind i en anden terminal. Med billet svarer modulet 200, uden billet 401. Når dit
modul kalder platformen (fx revisionsloggen), skriver sandkassen det i terminalen.

## 4. Byg din første rute (resten af tiden)

Åbn `src/module.ts` og tilføj en rute på `mod.app`:

```ts
mod.app.post("/noter", strictBody(z.object({ patientId: z.string(), tekst: z.string().max(500) })), async (c) => {
  // c.var.organization.id — organisationen, sat af platformen. Gem altid pr. organisation.
  // c.var.body      — det validerede input. Et ukendt felt er allerede afvist med 400.
  c.var.log.info("note.oprettet", {});
  return c.json({ ok: true }, 201);
});
```

Gem filen — `npm run dev` genstarter selv.

## 5. Bevis at det virker

```sh
npm test
```

Skriv en test der gemmer en værdi og læser den tilbage — ikke kun at kaldet gav 200. Se
`test/module.test.ts` for eksempler, også på GDPR-eksport og -sletning.

## Hvad sandkassen ikke er

- Billetterne er sandkassens egne. Den rigtige platform bruger BID-billetter.
- Data ligger kun i hukommelsen. På platformen får modulet sit eget lager i EU.
- Hvilken billet modulet viser platformen, er ikke afgjort endnu; sandkassen bruger en
  tjeneste-billet for `svc:<modul-id>`.
