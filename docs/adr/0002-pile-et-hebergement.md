# ADR-0002 — Pile et hébergement

Application familiale mono-groupe, admin unique par mot de passe. Front en React, données dans Supabase (Postgres + RLS), déployé sur un VPS via Coolify déclenché par un hook GitHub. Pas d'email : les liens privés sont distribués manuellement (WhatsApp/SMS). Le lien privé est l'identité du participant (UUID 128 bits, sécurité par RLS).