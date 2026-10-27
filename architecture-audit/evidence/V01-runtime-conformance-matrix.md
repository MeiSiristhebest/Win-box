# V01 Runtime Conformance Matrix

Recorded: 2026-10-28. This matrix separates shared adapter contracts from real runtime evidence. A mock-port pass is not reported as an actual runtime pass.

## Shared spider contract

| Layer | Evidence | Result | What it proves |
|---|---|---:|---|
| JS/JVM/Python spider adapters | tests/spiderRuntimeConformance.spec.ts | 12 passed | The same app-facing scenarios are normalized across JsSpider, JarSpider, and PySpider: pre-cancel, preparation cancellation/failure, legal empty result, unsupported operation, execution failure, timeout, late reply, destroyed instance, and cache rebuild cancellation. Runtime ports are test doubles here. |
| Python pool adapter | tests/pythonSpiderRuntimeAdapter.spec.ts | 7 passed | Pool result classification and one-shot fallback policy. Pool and process boundaries are injected doubles. |

## Real executable evidence

| Runtime | Evidence | Result | Limits |
|---|---|---:|---|
| JS Worker | tests/jsWorkerPoolContract.spec.ts | 6 passed | Builds and runs the actual worker entry in a real worker thread. Covers legal undefined/empty values, unsupported operation, source exception, timeout, loading retry, cancellation, and late reply handling. |
| JVM spider runner | tests/jvmLoader.spec.ts | 9 passed | Compiles fixtures with the configured JDK and launches the bundled JRE. Exercises actual one-shot and resident JVM calls, private class loading/TCCL, legacy argument compatibility, legal empty result, unsupported inherited method, a method exception in both modes, recovery of the resident process after failure, and shell-shim class-loader binding. Does not exercise ARM emulation. |
| JVM filesystem adapters | tests/jvmAtomicFile.spec.ts | 1 passed | Compiles and executes the packaged AtomicFile/PosixFile sources on the bundled JVM. |
| Python runner | tests/pythonRunnerContract.spec.ts | 2 passed | Executes the actual runner.py as child processes in one-shot and resident modes. Verifies unsupported inherited capability, valid empty output, init/body failures, stderr-only spider logs, and that a resident process accepts a valid call after earlier failures. Host Python is used; this is not the bundled embedded Python distribution. |

## Native bridge status

| Evidence | Result | What was actually exercised |
|---|---:|---|
| tests/nativeBridge.spec.ts | 13 passed | Launch arguments, classpath composition, detection, and fallback using mocked process spawning and synthetic/fake assets. This is not a real ARM .so execution. |
| tests/jvmNativePatch.spec.ts | 1 skipped | NOT RUN: JAVA_HOME and the bundled JRE are present, but NATIVE_RUNTIME_DIR is unset and the unidbg runtime jars are absent. |
| tests/jvmAssets.spec.ts | 2 skipped | NOT RUN for the same missing native-runtime assets. |

The native bridge is a constrained compatibility layer for selected ARM JNI operations. These results do not establish that arbitrary native libraries or return types are supported. A real native execution verdict requires a provisioned NATIVE_RUNTIME_DIR and representative lawful fixture assets.

## Commands and checks

- node node_modules/vitest/vitest.mjs run tests/pythonRunnerContract.spec.ts tests/spiderRuntimeConformance.spec.ts tests/jsWorkerPoolContract.spec.ts tests/pythonSpiderRuntimeAdapter.spec.ts: 4 files, 27 tests passed.
- node node_modules/vitest/vitest.mjs run tests/jvmLoader.spec.ts tests/jvmAtomicFile.spec.ts tests/jvmNativePatch.spec.ts tests/jvmAssets.spec.ts: 2 files / 10 tests passed; 2 files / 3 tests skipped because native runtime assets were unavailable.
- node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json: passed.
