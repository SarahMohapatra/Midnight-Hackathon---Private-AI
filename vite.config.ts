import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite root is the "app/" directory. The canonical privacy pipeline lives in
// ../prover and the generated Midnight client in ../contracts/generated, so
// we allow Vite's dev server to read files one level above the root.
export default defineConfig({
  root: "app",
  plugins: [react()],
  server: {
    port: 5173,
    fs: {
      allow: [".."],
    },
  },
});
