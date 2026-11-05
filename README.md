# @fysio-work/sdk

The kit every module on **fysio.work** — the platform for physiotherapy clinics — is built with. Our own modules, our partners' and yours.

> **Early access · under construction.** These releases are a welcome and a status marker. The module API (`createModule`) is **not published yet**.

## Use

```ts
import { welcome, sdkStatus } from "@fysio-work/sdk";

console.log(welcome());
console.log(sdkStatus.stage); // "early-access"
```

## What it does NOT do (yet)

- No `createModule`, no module runtime, no core client. Nothing here talks to the platform.
- Do not build on this release. Read `sdkStatus.moduleApi` — it is `false` until the module API ships.

## Learn more

- Overview: https://fysio.work/developer/sdk
- Early access: https://fysio.work/developer

## License

MIT · broberg.ai, a division of WebHouse ApS
