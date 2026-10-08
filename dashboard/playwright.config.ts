import { defineConfig,devices } from "@playwright/test";
export default defineConfig({
  testDir:"./tests/e2e",
  use:{baseURL:"http://127.0.0.1:4173",...devices["Desktop Chrome"]},
  webServer:{command:"npm run dev -- --port 4173 --strictPort",url:"http://127.0.0.1:4173",reuseExistingServer:!process.env.CI,timeout:30000,env:{VITE_SUPABASE_URL:"https://test-fayfort.supabase.co",VITE_SUPABASE_ANON_KEY:"test-anon-key",VITE_FAYFORT_API_URL:"http://127.0.0.1:8000",VITE_DASHBOARD_EVENTS_ENABLED:"false"}},
});
