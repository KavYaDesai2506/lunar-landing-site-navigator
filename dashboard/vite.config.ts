import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" keeps every asset and data path relative, so the build can be
// dropped into any static host or sub-path (GitHub Pages, Vercel, Netlify...).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173 },
});
