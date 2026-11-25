import React, { useEffect, useState } from "react";
import { api, saveUser } from "../api.js";

const CONTACT = "guutforms@outlook.com";

/**
 * Pricing, in the format agreed with the team: Freemium, Teams, Servers. One sign-up for everyone: an
 * individual upgrades to Teams from here without a new account. Prices are placeholders.
 */
export default function PricingPage({ onChoose, user, onUser }) {
  const [plans, setPlans] = useState(null);
  const [upgrading, setUpgrading] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { api.plans().then(setPlans).catch(() => setPlans(false)); }, []);

  if (plans === null) return <p className="muted">Loading plans...</p>;
  if (plans === false) return <p className="error">Couldn't load the plans. Refresh to try again.</p>;
  const free = plans.individual;
  const teams = plans.business.find((p) => !p.contact) || plans.business[0];
  const servers = plans.business.find((p) => p.contact);
  const companyType = user?.company?.type;
  const myPlan = companyType === "business" ? user.company.plan || "starter" : companyType === "individual" ? "individual" : null;
  const canUpgrade = companyType === "individual" && user?.role !== "superadmin";

  async function upgrade(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { user: u } = await api.upgrade({ companyName: teamName, plan: teams.id });
      saveUser(u); onUser?.(u);
      setUpgrading(false);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const current = <span className="access-badge">Current plan</span>;
  return (
    <div className="pricing-page v2">
      <section className="pricing-hero">
        <span className="hero-eyebrow"><span className="dot" /> Pricing</span>
        <h1>Start free. Add your team when you are ready.</h1>
        <p className="pricing-sub">One sign-up for everyone. Upgrade from inside the app, with no new account.</p>
        {!user && <button className="primary big-btn" onClick={() => onChoose("individual")}>Start free</button>}
      </section>

      <section className="plan-grid" aria-label="Plans">
        <div className="plan-card">
          <span className="plan-name">{free.name}</span>
          <span className="plan-price">{free.priceLabel}</span>
          <span className="plan-for">{free.tagline}</span>
          <ul className="plan-ticks">{free.features.map((x) => <li key={x}>{x}</li>)}</ul>
          <div className="plan-foot">{myPlan === "individual" ? current : !user ? <button className="secondary" onClick={() => onChoose("individual")}>Start free</button> : null}</div>
        </div>

        {teams && (
          <div className="plan-card dark">
            <span className="plan-name">{teams.name}</span>
            <div className="plan-per">
              <span className="plan-price">{teams.priceLabel.replace(/\s*\/\s*month$/, "")} {/month$/.test(teams.priceLabel) && <small>/ month</small>}</span>
              {teams.seatsLabel && <span>{teams.seatsLabel}</span>}
            </div>
            <ul className="plan-ticks">{teams.features.map((x) => <li key={x}>{x}</li>)}</ul>
            <div className="plan-foot column">
              {myPlan === teams.id ? current
                : canUpgrade ? (upgrading ? (
                  <form className="upgrade-form" onSubmit={upgrade}>
                    <label>Team or company name
                      <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Acme Inc." maxLength={80} required autoFocus />
                    </label>
                    <span className="upgrade-hint">Your forms, responses and shares stay as they are. You become the team admin and get an invite link.</span>
                    {error && <p className="error">{error}</p>}
                    <div className="row-gap">
                      <button className="amber" type="submit" disabled={busy}>{busy ? "Upgrading..." : "Upgrade"}</button>
                      <button type="button" className="ghost-light" onClick={() => { setUpgrading(false); setError(null); }}>Cancel</button>
                    </div>
                  </form>
                ) : <button className="amber" onClick={() => setUpgrading(true)}>Upgrade to {teams.name}</button>)
                : !user ? <button className="amber" onClick={() => onChoose("business", teams.id)}>Choose {teams.name}</button>
                : companyType === "business" && user.role === "admin" ? <button className="amber" onClick={() => onChoose("business", teams.id)}>Change in Admin, Billing</button>
                : null}
              {teams.upgradeNote && <p className="plan-upg">{teams.upgradeNote}</p>}
            </div>
          </div>
        )}

        {servers && (
          <div className="plan-card">
            <span className="plan-name">{servers.name}</span>
            <span className="plan-price">{servers.priceLabel}</span>
            <span className="plan-for">{servers.tagline}</span>
            <ul className="plan-ticks">{servers.features.map((x) => <li key={x}>{x}</li>)}</ul>
            <div className="plan-foot">{myPlan === servers.id ? current : <a className="btn-outline" href={`mailto:${CONTACT}?subject=${encodeURIComponent("GUUT Forms Servers plan")}`}>Contact us</a>}</div>
          </div>
        )}
      </section>

      {plans.aiNote && <p className="pricing-note">{plans.aiNote}</p>}
      {plans.pricingIsPlaceholder && <p className="pricing-draft">Draft for review. Prices are placeholders to discuss.</p>}
    </div>
  );
}
