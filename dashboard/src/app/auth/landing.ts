import type { Session } from "@supabase/supabase-js";
import { apiRequest } from "../../lib/api";

export type Landing = "/" | "/member/home";

/** Platform admin claim (server-managed app_metadata). */
export function isPlatformAdmin(session: Pick<Session, "user"> | null | undefined): boolean {
  const meta = (session?.user?.app_metadata || {}) as { platform_admin?: unknown; roles?: unknown };
  return meta.platform_admin === true || (Array.isArray(meta.roles) && meta.roles.includes("platform_admin"));
}

/**
 * Where an account lands after signing in (docs/AUTH_PAGES_PLAN.md, one sign-in for everyone): the FayFort team
 * (platform admins, active workers) and business owners go to the Control Center, where two-step verification runs;
 * everyone else with a member profile goes to the member chat. Admins who are also members land in the Control Center.
 */
export async function landingFor(session: Session): Promise<Landing> {
  if (isPlatformAdmin(session)) return "/";
  const token = session.access_token;
  const [worker, businesses, member] = await Promise.all([
    apiRequest<{ worker?: { status?: string } }>("/workers/me", token).catch(() => null),
    apiRequest<{ businesses?: unknown[] }>("/dashboard/businesses", token).catch(() => null),
    apiRequest<{ profile?: unknown }>("/members/me", token).catch(() => null),
  ]);
  if (worker?.worker?.status === "active") return "/";
  if (Array.isArray(businesses?.businesses) && businesses.businesses.length > 0) return "/";
  if (member?.profile) return "/member/home";
  return "/";
}
