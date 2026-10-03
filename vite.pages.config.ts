import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Keep Pages independent of the optional Sites server and feedback database.
// configure-pages supplies an empty base path for user sites/custom domains.
const configuredBase = process.env.PAGES_BASE_PATH ?? "/paksaz/";
const base = `/${configuredBase.replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");

export default defineConfig({
  base,
  plugins: [react()],
  define: {
    "process.env.NEXT_PUBLIC_GITHUB_REPO": JSON.stringify(process.env.PAGES_GITHUB_REPO ?? "AliReza-K-Moradi/paksaz"),
    "process.env.NEXT_PUBLIC_STATIC_HOST": JSON.stringify("github-pages"),
  },
  build: {
    outDir: "dist-pages",
    emptyOutDir: true,
  },
});
