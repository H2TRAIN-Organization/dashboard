import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "pi-mqtt-agent/**",
    "kub-kubioscloud-demo/**",
    "Uploader/**",
    "src/app/kubios/**",
    "src/app/api/kubios/**",
    "src/app/study/**",
    "src/components/HRVCharts.tsx",
    "src/components/StudyCharts.tsx",
    "src/lib/kubios-service.ts",
  ]),
]);
