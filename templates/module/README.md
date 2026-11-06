# Mit modul

Et modul til **fysio.work**, bygget med `@fysio-work/sdk`.

```sh
npm install
npm run dev        # kører modulet mod sandkassen og skriver færdige kald ud
npm test
npm run check      # platformens egne regler — skal være grøn før modulet kan udrulles
```

- `fysio-work.manifest.json` — modulets id, navn og rettigheder. `check` validerer den.
- `src/module.ts` — dit modul. Tilføj dine ruter på `mod.app`.
- `src/dev.ts` — starter modulet mod sandkassen (en falsk platform på din maskine).
- `AGENTS.md` — regler til AI-kodeværktøjer (Claude Code, Codex, Lovable, Henosia m.fl.).

> **Early access.** Sandkassen er en falsk platform. Den rigtige platform er ikke åben for udrulning endnu.
