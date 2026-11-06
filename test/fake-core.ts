// The fake core used by the tests IS the sandbox developers run (src/sandbox.ts) — one fake,
// so what the tests prove is what a developer gets on their own machine.
export { createSandbox as createFakeCore, type Sandbox as FakeCore, type RecordedCall } from "../src/sandbox";
