import * as esbuild from "esbuild"

const commonOptions = {
    entryPoints: [
        "./src/index.ts",
    ],
    outdir: "dist",
    bundle: true,
    platform: "node",
    target: "node20",
    define: {
        "process.env.NODE_ENV": JSON.stringify(
            process.env.NODE_ENV || "development",
        ),
    },
    tsconfig: "./tsconfig.json",
    packages: "external",
    sourcemap: true,
}

await Promise.all([
    esbuild.build({
		...commonOptions,

		outExtension: {
			".js": ".cjs",
		},
        format: "cjs",
	}),
    esbuild.build({
		...commonOptions,

		outExtension: {
			".js": ".mjs",
		},
        format: "esm",
	})
])
