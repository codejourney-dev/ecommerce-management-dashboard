
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/integration/**/*.test.ts"],

        environment: "node",
        setupFiles: ["./tests/integration/setup.ts"],
        testTimeout: 30_000,
        hookTimeout: 30_000,

        // Run integration test files sequentially.
        fileParallelism: false,
    },
});
