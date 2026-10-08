import { expect, test } from "@playwright/test";

test("operator signs in, selects a workspace, and creates a safe connection setup record", async ({ page }) => {
  const createdConnection = {
    id: "connection-test-1", provider: "manual_test", display_name: "Support channel",
    status: "setup_required", credential_status: "missing", safe_settings: { inbound_enabled: true, outbound_enabled: false },
  };
  let connectionCreated = false;
  let apiAuthorization = "";

  await page.route("https://test-fayfort.supabase.co/auth/v1/token**", async route => {
    await route.fulfill({ json: {
      access_token: "test-access-token", token_type: "bearer", expires_in: 3600, refresh_token: "test-refresh-token",
      user: { id: "user-test-1", aud: "authenticated", role: "authenticated", email: "operator@example.test", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: "2026-09-29T00:00:00Z" },
    } });
  });
  await page.route("http://127.0.0.1:8000/**", async route => {
    apiAuthorization = route.request().headers()["authorization"] || "";
    const url = new URL(route.request().url());
    if (url.pathname === "/dashboard/businesses") {
      await route.fulfill({ json: { businesses: [{ business_id: "business-test-1", name: "FayFort Test Workspace", role: "owner" }] } });
    } else if (url.pathname === "/businesses/business-test-1/connections" && route.request().method() === "POST") {
      connectionCreated = true;
      await route.fulfill({ json: { connection: createdConnection } });
    } else if (url.pathname === "/businesses/business-test-1/connections") {
      await route.fulfill({ json: { connections: connectionCreated ? [createdConnection] : [] } });
    } else {
      await route.fulfill({ json: {} });
    }
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("operator@example.test");
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByLabel("Business workspace")).toContainText("FayFort Test Workspace");
  expect(apiAuthorization).toBe("Bearer test-access-token");

  await page.getByRole("button", { name: "C Connections", exact: true }).click();
  await page.getByLabel("Display name").fill("Support channel");
  await page.getByRole("button", { name: "Add setup record" }).click();
  await expect(page.getByText("Support channel", { exact: true })).toBeVisible();
  await expect(page.getByText(/setup_required/)).toBeVisible();
  expect(connectionCreated).toBe(true);
});
