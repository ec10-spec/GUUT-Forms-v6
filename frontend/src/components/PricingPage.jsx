import React, { useEffect, useState } from "react";
import { api } from "../api.js";

/** Plan cards. Used on the public Pricing page; prices are placeholders until billing is switched on. */
export default function PricingPage({ onChoose }) {
  const [plans, setPlans] = useState(null);
  useEffect(() => { api.plans().then(setPlans).catch(() => {}); }, []);
  if (!plans) return <p className="muted">Loading plans...</p>;
  return (
    <div className="pricing-page">
      <h1>Pricing</h1>
      <p className="pricing-lede">Start free. Move to a business plan when your team needs shared workspaces, approvals and its own database.</p>
      <div className="pricing-grid">
        <div className="price-card featured">
          <h3>{plans.individual.name}</h3>
          <div className="price">{plans.individual.priceLabel}</div>
          <p className="price-tag-line">{plans.individual.tagline}</p>
          <ul>{plans.individual.features.map((x) => <li key={x}>{x}</li>)}</ul>
          <button className="primary" onClick={() => onChoose("individual")}>Start free</button>
        </div>
        {plans.business.map((p) => (
          <div key={p.id} className="price-card">
            <h3>{p.name}</h3>
            <div className="price">{p.priceLabel}</div>
            <p className="price-tag-line">Business</p>
            <ul>{p.features.map((x) => <li key={x}>{x}</li>)}</ul>
            <button className="secondary" onClick={() => onChoose("business", p.id)}>Choose {p.name}</button>
          </div>
        ))}
      </div>
      {plans.pricingIsPlaceholder && <p className="price-note center">Business prices are provisional and may change before billing starts.</p>}
    </div>
  );
}
