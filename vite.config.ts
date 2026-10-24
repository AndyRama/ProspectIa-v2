import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "client",
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    proxy: { "/api": `http://127.0.0.1:${process.env.API_PORT || 3001}` },
  },
  build: { outDir: "../dist", emptyOutDir: true },
});
