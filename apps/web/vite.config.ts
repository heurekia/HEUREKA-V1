import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Isole les grosses dépendances dans des chunks vendor séparés : ils sont
        // cachés indépendamment (une mise à jour applicative n'invalide plus
        // leaflet/pdf/tiptap) et, combinés au lazy-loading des routes, ne sont
        // téléchargés que par les pages qui les utilisent.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/leaflet")) return "vendor-leaflet";
          if (id.includes("pdfjs-dist") || id.includes("/react-pdf")) return "vendor-pdf";
          if (id.includes("@tiptap") || id.includes("prosemirror")) return "vendor-tiptap";
          if (id.includes("recharts") || id.includes("/d3-") || id.includes("victory-vendor")) return "vendor-charts";
          if (id.includes("react-router") || id.includes("/@remix-run/")) return "vendor-router";
          if (id.includes("/react-dom") || id.includes("/react/") || id.includes("/scheduler/")) return "vendor-react";
          return "vendor";
        },
      },
    },
  },
});
