import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // The repository .env (API_HOST/API_PORT) is the single source of truth for where the API listens.
  // VITE_FAYFORT_API_URL in dashboard/.env.local is only an explicit override, e.g. for a hosted API.
  // npm scripts run from dashboard/, so "." is the dashboard and ".." is the repository root.
  // loadEnv also includes matching variables already set in the shell environment.
  const dashboardEnv = loadEnv(mode, ".", ["VITE_", "V_"]);
  const rootEnv = loadEnv(mode, "..", "API_");
  const apiUrl =
    dashboardEnv.VITE_FAYFORT_API_URL ||
    `http://${rootEnv.API_HOST || "127.0.0.1"}:${rootEnv.API_PORT || "8001"}`;
  // Hosting providers can flag VITE_*_KEY names as possible secret leaks. The Supabase anon key is
  // public by design (row-level security protects the data), so V_SUPABASE_ANON_KEY is accepted too.
  const supabaseAnonKey = dashboardEnv.VITE_SUPABASE_ANON_KEY || dashboardEnv.V_SUPABASE_ANON_KEY || "";
  const define: Record<string, string> = { "import.meta.env.VITE_FAYFORT_API_URL": JSON.stringify(apiUrl) };
  if (supabaseAnonKey) define["import.meta.env.VITE_SUPABASE_ANON_KEY"] = JSON.stringify(supabaseAnonKey);
  return {
    plugins: [react()],
    define,
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("/@supabase/")) return "vendor-supabase";
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "vendor-react";
            return "vendor";
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    },
  };
});
