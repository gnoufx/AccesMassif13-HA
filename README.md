# 🌲🔥 Accès Massifs Forestiers 13

[![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2024.1+-blue.svg)](https://www.home-assistant.io)

Intégration Home Assistant pour récupérer automatiquement les **niveaux d'accès aux massifs forestiers des Bouches-du-Rhône** depuis le site officiel [risque-prevention-incendie.fr](https://www.risque-prevention-incendie.fr/13).

## ✨ Fonctionnalités

- 📊 **25 capteurs** — Un capteur par massif forestier avec niveau d'accès en temps réel
- 🗓️ **Prévisions J+1** — Accès aux prévisions pour le lendemain
- 📈 **Historique multi-saisons** — Stockage persistant de l'historique complet
- 🗺️ **Carte interactive** — Visualisation sur carte Leaflet avec marqueurs colorés
- 🎨 **Cartes Lovelace premium** — 2 cartes custom avec design glassmorphism et animations
- ⏰ **Mise à jour automatique** — Scan quotidien configurable (défaut : 18h30)
- 🌙 **Thème sombre** — S'adapte au thème de votre Home Assistant

## 📅 Période de fonctionnement

> ⚠️ Le site source ne fonctionne que du **1er juin au 30 septembre**. En dehors de cette période, les capteurs sont en état "Non disponible" et aucune requête n'est effectuée.

## 🚀 Installation

### Via HACS (recommandé)

1. Ouvrez HACS dans Home Assistant
2. Cliquez sur **Intégrations**
3. Cliquez sur le menu **⋮** en haut à droite → **Dépôts personnalisés**
4. Ajoutez l'URL du dépôt et sélectionnez **Intégration** comme catégorie
5. Cherchez "Accès Massifs" et installez
6. Redémarrez Home Assistant
7. Allez dans **Paramètres → Appareils & Services → Ajouter une intégration**
8. Cherchez "Accès Massifs Forestiers 13"

### Installation manuelle

1. Copiez le dossier `custom_components/acces_massifs_13/` dans votre dossier `config/custom_components/`
2. Redémarrez Home Assistant
3. Configurez via l'UI

## ⚙️ Configuration

L'intégration se configure entièrement via l'interface utilisateur de Home Assistant.

| Paramètre | Description | Défaut |
|-----------|-------------|--------|
| Heure de mise à jour | Heure de récupération quotidienne | 18 |
| Minute de mise à jour | Minute de récupération quotidienne | 30 |

## 📊 Capteurs créés

### Capteurs individuels (×25)

Chaque massif dispose de son propre capteur avec les attributs suivants :

| Attribut | Description |
|----------|-------------|
| `state` | "Autorisé", "Interdit" ou "Non disponible" |
| `level` | Niveau d'accès (0-4) |
| `color` | Couleur ("green", "red", "white") |
| `tomorrow_level` | Niveau d'accès prévu pour demain |
| `tomorrow_color` | Couleur prévue pour demain |
| `tomorrow_label` | Label prévu pour demain |
| `latitude` / `longitude` | Coordonnées GPS du massif |
| `is_season` | Indique si on est en période active |

### Capteur résumé

`sensor.acces_massifs_13_summary` — Vue globale avec le nombre de massifs interdits, l'ensemble des données et l'historique complet.

## 🎨 Cartes Lovelace

### Carte Historique

Matrice heatmap animée affichant l'historique complet des accès sur toute la saison.

```yaml
type: custom:acces-massifs-history-card
entity: sensor.acces_massifs_13_summary
title: "Historique des accès aux massifs"
year: 2025
animate: true
show_sparkline: true
```

### Carte Prévisions

Affiche les prévisions d'accès pour le lendemain avec carte interactive optionnelle.

```yaml
type: custom:acces-massifs-forecast-card
entity: sensor.acces_massifs_13_summary
title: "Prévisions d'accès — Demain"
show_map: true
map_height: 400
animate: true
```

## 🔔 Niveaux d'accès

| Niveau | Couleur | Signification |
|--------|---------|---------------|
| 0 | ⬜ Blanc | Pas de données / Hors saison |
| 1 | 🟢 Vert | Accès autorisé |
| 2 | 🟢 Vert | Accès autorisé (avec conditions) |
| 3 | 🔴 Rouge | Accès interdit |
| 4 | 🔴 Rouge | Accès interdit (renforcé) |

## 🌲 Les 25 Massifs

Alpilles · Arbois · Calanques · Cap Canaille · Castillon · Chaîne des Côtes · Chambremont · Collines de Gardanne · Concors · Cote Bleue · Etoile · Garlaban · Grand Caunet · Lançon · Les Roques · Montagnette · Montaiguet · Pont de Rhaud · Quatre Termes · Regagnas · Rougadou · Sainte-Baume · Sainte-Victoire · Sulauze · Trevaresse

## 📝 Exemple d'automatisation

```yaml
automation:
  - alias: "Alerte massif interdit"
    trigger:
      - platform: state
        entity_id: sensor.acces_massif_calanques
        to: "Interdit"
    action:
      - service: notify.mobile_app
        data:
          title: "🔴 Massif interdit"
          message: "L'accès aux Calanques est interdit demain !"
```

## 📜 Source des données

Les données proviennent du site officiel de la Préfecture des Bouches-du-Rhône :
[risque-prevention-incendie.fr/13](https://www.risque-prevention-incendie.fr/13)

## 📄 Licence

MIT License
