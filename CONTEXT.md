# Secret Santa

Application web familiale pour organiser un tirage au sort de Secret Santa : chaque participant se connecte avec un lien privé, tire au sort un destinataire, et lui offrira un cadeau. Un seul groupe, administré par une seule personne.

## Language

**Participant**:
Une personne inscrite au jeu, identifiée par son lien privé.
_Avoid_: Utilisateur, joueur, membre

**Groupe**:
Le cercle familial unique. L'application ne gère qu'un seul groupe.
_Avoid_: Cercle, équipe, pool

**Lien privé**:
Capacité d'accès d'un participant à l'application. Il vaut identité : celui qui possède le lien est le participant. Régénérable par l'admin ; un lien régénéré invalide l'ancien. Le lien reste valable après le tirage.
_Avoid_: Mot de passe, compte, session, token

**Tirage**:
L'action, pour un participant pas encore tiré, de tirer au sort un destinataire parmi la réserve. S'effectue en direct, une fois par participant.
_Avoid_: Tirage au sort, loterie

**Réserve**:
L'ensemble des participants pas encore désignés comme destinataires. Un participant qui tire retire son destinataire de la réserve.
_Avoid_: Pool, file d'attente

**Attribution**:
Le résultat d'un tirage : « X offre à Y ». Visible uniquement par l'admin et par le titulaire de l'attribution. Pas de révélation finale.
_Avoid_: Affectation, pairing, appariement

**Couple**:
Deux participants qui préfèrent ne pas se tirer mutuellement. Restriction symétrique posée par paire. En dernier recours, si un tirage est bloqué, l'admin peut forcer un tirage malgré le couple.
_Avoid_: Interdiction, règle, blocage, contrainte

**Admin**:
L'unique administrateur, identifié par un mot de passe unique configuré au déploiement. Peut tout voir et tout défaire.
_Avoid_: Modérateur, gestionnaire