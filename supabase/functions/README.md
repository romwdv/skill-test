# Edge Functions admin (ticket #2)

Auth de la console admin par mot de passe unique. Configuration par secrets
Supabase (variables `Deno.env`) — jamais commités :

| Secret | Usage |
| --- | --- |
| `ADMIN_PASSWORD` | le mot de passe unique, demandé au login |
| `ADMIN_JWT_SECRET` | secret HMAC-SHA256 qui signe/valide les sessions |
| `ALLOWED_ORIGIN` | origine du front déployé (restreint le CORS ; vide en dev) |
| `SUPABASE_URL` | auto-injecté par Supabase, base des vues admin |
| `SUPABASE_SERVICE_ROLE_KEY` | auto-injecté par Supabase, lecture des vues admin |

## Endpoints

- `admin-login` : `POST { password }` → `{ token }` (JWT `sub=admin, role=admin`,
  validité 12 h) ; `401` si mot de passe invalide, `403` si origine étrangère.
- `admin-game-state` : `GET` avec `Authorization: Bearer <token>` → aperçu de la
  partie (`state` : total/tiré/reste ; `players` : qui a tiré, qui reste ;
  `attributions` : qui offre à qui).
- `admin-participants` : gestion des participants (ticket #3). `GET` →
  `{ participants }` (id, nom, lien privé, état tiré/non) pour copier chaque
  lien. `POST { action: "add", name }` → `201 { participant }` ;
  `POST { action: "delete", id }` → suppression (attributions/couples en
  cascade) ; `POST { action: "regenerate", id }` → l'ancien lien cesse de
  fonctionner, `200 { participant }` avec le nouveau lien.

## Tests

Le module JWT et les deux handlers sont testés avec `deno` (sans dépendance) :

```bash
cd supabase/functions
deno task test    # --allow-env : les tests manipulent les secrets
```