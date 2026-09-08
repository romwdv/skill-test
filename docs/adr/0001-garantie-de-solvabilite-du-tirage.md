# ADR-0001 — Garantie de solvabilité du tirage

Les couples étant des paires disjointes, un choix avide (choisir à chaque tirage une cible qui garde le sous-problème solvable) garantit qu'un tirage valide est toujours trouvable : pas de backtracking. Si une impasse surgit malgré tout (retrait d'un participant en cours de partie), l'admin force un tirage malgré le couple, signalé dans l'UI admin.