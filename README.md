# RFTC Ticketing — prototype

Prototype interactif de la billetterie Reach For The Culture, réalisé à partir du cahier des charges v2. Les données de démonstration sont fictives et exprimées en FCFA (XAF).

## Lancer le prototype

Ouvrir `index.html` dans un navigateur moderne. Le prototype ne nécessite ni installation, ni compte, ni serveur. Les événements, commandes et billets de démonstration sont conservés dans le stockage local du navigateur. Le bouton **Réinitialiser la démo**, en bas de page, efface ces données sur cet appareil.

## Parcours à essayer

1. **Visiteur** : choisir un événement et une catégorie, puis ajouter des billets au panier.
2. **Client** : créer une réservation, puis utiliser **Simuler paiement confirmé** ou **Simuler un refus**. Une réservation en attente bloque les places pendant 15 minutes; le refus ou l’expiration les libère. Chaque billet émis a son propre jeton QR opaque.
3. **Admin RFTC / Responsable événement** : créer, modifier, publier, dépublier, dupliquer ou clôturer des événements; consulter le tableau de bord et les rapports.
4. **Agent de contrôle** : saisir un jeton de billet, le valider une fois, puis vérifier le résultat d’un second scan. L’option hors ligne ne valide jamais le billet.
5. **Vendeur / point de vente** : simuler une vente en espèces ou par Orange Money / MTN MoMo. Les ventes confirmées émettent des billets et alimentent les rapports.
6. **Client** : retrouver les billets créés localement et imprimer la vue de billet via le navigateur.

## Limites de cette maquette

Le prototype est uniquement côté navigateur. Le sélecteur de rôle sert à parcourir les écrans et **ne constitue pas un contrôle d’accès**. Les paiements opérateur, callbacks signés, e-mails, PDF envoyés, lecture caméra, validations serveur, journaux d’audit, sauvegardes et synchronisation multiappareil ne sont pas implémentés. Les QR et ventes de démonstration ne donnent pas accès à un événement réel. N’utilisez pas de vraies données clients ou de paiement.

## Étape suivante pour la mise en production

Conformément au cahier des charges, la suite consiste à convertir cette maquette en application **Python 3.12 / Django 5** avec templates Django, HTML, Bootstrap 5 et HTMX; SQLite en développement puis PostgreSQL en production. Les comptes, groupes et permissions, quotas transactionnels, réservations temporaires, paiements Orange Money / MTN MoMo vérifiés côté serveur, jetons QR signés, contrôle anti-double-scan, reçus/PDF, notifications, rapports, HTTPS, configuration de secrets et tests de recette devront être fournis côté serveur avant toute vente réelle.
