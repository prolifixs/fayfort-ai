export function SetupScreen() {
  return (
    <div className="auth-page">
      <section className="auth-card">
        <b className="brand-mark">F</b>
        <label>FAYFORT CONTROL CENTER</label>
        <h1>Dashboard setup needed</h1>
        <p>
          Add the public Supabase project URL and anon key, plus the FayFort API address, to{" "}
          <code>dashboard/.env.local</code>, then restart the dashboard.
        </p>
        <p className="quiet-note">The service-role key does not belong in the dashboard.</p>
      </section>
    </div>
  );
}
