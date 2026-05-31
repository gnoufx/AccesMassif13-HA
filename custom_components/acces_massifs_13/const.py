"""Constants for the Accès Massifs Forestiers 13 integration."""

from __future__ import annotations

DOMAIN = "acces_massifs_13"

# ── Season window ──────────────────────────────────────────────────────────────
SEASON_START_MONTH = 6
SEASON_START_DAY = 1
SEASON_END_MONTH = 9
SEASON_END_DAY = 30

# ── Default scan schedule ──────────────────────────────────────────────────────
DEFAULT_SCAN_HOUR = 18
DEFAULT_SCAN_MINUTE = 30

# ── Data source ────────────────────────────────────────────────────────────────
DATA_URL_TEMPLATE = (
    "https://www.risque-prevention-incendie.fr/static/13/import_data/{date}.json"
)

# ── Config‑flow keys ──────────────────────────────────────────────────────────
CONF_SCAN_HOUR = "scan_hour"
CONF_SCAN_MINUTE = "scan_minute"

# ── Level → label / color mappings ─────────────────────────────────────────────
LEVEL_LABELS: dict[int, str] = {
    0: "Non disponible",
    1: "Autorisé",
    2: "Autorisé",
    3: "Interdit",
    4: "Interdit",
}

LEVEL_COLORS: dict[int, str] = {
    0: "unknown",
    1: "green",
    2: "green",
    3: "red",
    4: "red",
}

# ── Massif registry ───────────────────────────────────────────────────────────
# Each entry: id → (name, latitude, longitude)
MASSIFS: dict[str, dict[str, str | float]] = {
    "131": {"name": "Alpilles", "latitude": 43.74, "longitude": 4.80},
    "132": {"name": "Arbois", "latitude": 43.46, "longitude": 5.32},
    "133": {"name": "Calanques", "latitude": 43.22, "longitude": 5.45},
    "134": {"name": "Cap Canaille", "latitude": 43.19, "longitude": 5.54},
    "135": {"name": "Castillon", "latitude": 43.39, "longitude": 5.07},
    "136": {"name": "Chaîne des Côtes", "latitude": 43.72, "longitude": 5.28},
    "137": {"name": "Chambremont", "latitude": 43.53, "longitude": 5.58},
    "138": {"name": "Collines de Gardanne", "latitude": 43.43, "longitude": 5.47},
    "139": {"name": "Concors", "latitude": 43.58, "longitude": 5.56},
    "1310": {"name": "Cote Bleue", "latitude": 43.35, "longitude": 5.15},
    "1311": {"name": "Etoile", "latitude": 43.38, "longitude": 5.42},
    "1312": {"name": "Garlaban", "latitude": 43.33, "longitude": 5.55},
    "1313": {"name": "Grand Caunet", "latitude": 43.25, "longitude": 5.54},
    "1314": {"name": "Lançon", "latitude": 43.58, "longitude": 5.12},
    "1315": {"name": "Les Roques", "latitude": 43.64, "longitude": 5.11},
    "1316": {"name": "Montagnette", "latitude": 43.86, "longitude": 4.72},
    "1317": {"name": "Montaiguet", "latitude": 43.48, "longitude": 5.42},
    "1318": {"name": "Pont de Rhaud", "latitude": 43.56, "longitude": 5.03},
    "1319": {"name": "Quatre Termes", "latitude": 43.52, "longitude": 5.25},
    "1320": {"name": "Regagnas", "latitude": 43.44, "longitude": 5.63},
    "1321": {"name": "Rougadou", "latitude": 43.88, "longitude": 4.86},
    "1322": {"name": "Sainte-Baume", "latitude": 43.33, "longitude": 5.78},
    "1323": {"name": "Sainte-Victoire", "latitude": 43.55, "longitude": 5.60},
    "1324": {"name": "Sulauze", "latitude": 43.52, "longitude": 5.05},
    "1325": {"name": "Trevaresse", "latitude": 43.66, "longitude": 5.34},
}
