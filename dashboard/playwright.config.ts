import { defineConfig,devices } from "@playwright/test";
// Every test starts with the cookie question answered and as a known member, so the cookie banner and the visitor
// popups (src/app/consent) stay out of the way. Tests that cover them clear these cookies.
const answered = {
  cookies: ["ff_consent", "ff_member"].map((name) => ({
    name, value: name === "ff_consent" ? `m0.t${Date.now()}` : "1", domain: "127.0.0.1", path: "/",
    expires: Math.floor(Date.now() / 1000) + 86400, httpOnly: false, secure: false, sameSite: "Lax" as const,
  })),
  origins: [],
};
export default defineConfig({
  testDir:"./tests/e2e",
  use:{baseURL:"http://127.0.0.1:4173",...devices["Desktop Chrome"],storageState:answered},
  webServer:{command:"npm run dev -- --port 4173 --strictPort",url:"http://127.0.0.1:4173",reuseExistingServer:!process.env.CI,timeout:30000,env:{VITE_SUPABASE_URL:"https://test-fayfort.supabase.co",VITE_SUPABASE_ANON_KEY:"test-anon-key",VITE_FAYFORT_API_URL:"http://127.0.0.1:8001",VITE_DASHBOARD_EVENTS_ENABLED:"false"}},
});
