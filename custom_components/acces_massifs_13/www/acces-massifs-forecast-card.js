/**
 * Accès Massifs 13 — Forecast Card (Tomorrow)
 * A Home Assistant Lovelace custom card showing tomorrow's access levels
 * with an interactive Leaflet map.
 *
 * Entity: sensor.acces_massifs_13_summary
 */

const LitElement = customElements.get('hui-masonry-view')
  ? Object.getPrototypeOf(customElements.get('hui-masonry-view'))
  : Object.getPrototypeOf(customElements.get('hui-view'));
const html = LitElement.prototype.html;
const css = LitElement.prototype.css;

class AccesMassifsForecastCard extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      _animatedCount: { type: Number },
    };
  }

  constructor() {
    super();
    this._animatedCount = 0;
    this._map = null;
    this._markers = [];
    this._mapId = `map-${Math.random().toString(36).substr(2, 9)}`;
    this._leafletLoading = null;
    this._lastAccessibleCount = -1;
    this._resizeObserver = null;
    this._cardWidth = 800;
    this._geoJsonData = null;
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Please define an entity');
    }
    this.config = {
      entity: config.entity,
      title: config.title || "Prévisions d'accès — Demain",
      show_map: config.show_map !== false,
      map_height: config.map_height || 400,
      animate: config.animate !== false,
    };
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    this.requestUpdate('hass', oldHass);
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return this.config?.show_map ? 8 : 5;
  }

  // ── Helpers ──────────────────────────────────────────────

  _getTomorrowDate() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }

  _formatFrenchDate(date) {
    const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
    const months = [
      'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
      'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
    ];
    return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  }

  _getStatusColor(level) {
    switch (level) {
      case 1: return '#4CAF50';
      case 2: return '#81C784';
      case 3: return '#F44336';
      case 4: return '#E53935';
      default: return '#555';
    }
  }

  _getStatusLabel(level) {
    switch (level) {
      case 1: return 'Autorisé';
      case 2: return 'Autorisé sous conditions';
      case 3: return 'Interdit';
      case 4: return 'Interdit renforcé';
      default: return 'Non disponible';
    }
  }

  _animateCount(target) {
    if (this._lastAccessibleCount === target) return;
    this._lastAccessibleCount = target;
    const duration = 1000;
    const start = performance.now();
    const from = 0;
    const step = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      this._animatedCount = Math.round(from + (target - from) * eased);
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  // ── Leaflet ──────────────────────────────────────────────

  async _loadLeaflet() {
    if (window.L) return;
    if (this._leafletLoading) return this._leafletLoading;

    this._leafletLoading = new Promise((resolve, reject) => {
      // CSS
      const cssLink = document.createElement('link');
      cssLink.rel = 'stylesheet';
      cssLink.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(cssLink);

      // JS
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });

    return this._leafletLoading;
  }

  async _initMap() {
    if (this._map) return;
    if (!this.config.show_map) return;

    await this._loadLeaflet();

    const container = this.shadowRoot.querySelector(`#${this._mapId}`);
    if (!container || !window.L) return;

    // Load GeoJSON data if not already cached
    if (!this._geoJsonData) {
      try {
        let response = await fetch('/local/community/acces_massifs_13/massifs_13.geojson');
        if (!response.ok) {
          response = await fetch('/hacsfiles/acces_massifs_13/massifs_13.geojson');
        }
        if (response.ok) {
          this._geoJsonData = await response.json();
        }
      } catch (err) {
        console.warn('Failed to load massifs GeoJSON:', err);
      }
    }

    // Inject Leaflet CSS into shadow DOM so popups/controls render correctly
    const leafletCSS = document.createElement('link');
    leafletCSS.rel = 'stylesheet';
    leafletCSS.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    this.shadowRoot.appendChild(leafletCSS);

    this._map = L.map(container, {
      center: [43.45, 5.095],
      zoom: 9,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap, &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(this._map);

    this._updateMapMarkers();

    // Ensure tiles render correctly
    setTimeout(() => {
      if (this._map) this._map.invalidateSize();
    }, 200);
  }

  _updateMapMarkers() {
    if (!this._map || !window.L) return;

    const stateObj = this._getStateObj();
    if (!stateObj) return;
    const massifs = stateObj.attributes.massifs;
    if (!massifs) return;

    // Remove old layers
    this._markers.forEach((m) => m.remove());
    this._markers = [];

    if (this._geoJsonData) {
      // Draw actual polygons from GeoJSON
      const geoJsonLayer = L.geoJSON(this._geoJsonData, {
        style: (feature) => {
          const mId = feature.properties.ID;
          const m = massifs[mId] || {};
          const level = m.tomorrow_level;
          const color = this._getStatusColor(level);
          return {
            fillColor: color,
            color: color,
            weight: 2,
            opacity: 0.8,
            fillOpacity: 0.4,
          };
        },
        onEachFeature: (feature, layer) => {
          const mId = feature.properties.ID;
          const m = massifs[mId] || {};
          const color = this._getStatusColor(m.tomorrow_level);
          const label = this._getStatusLabel(m.tomorrow_level);

          layer.bindPopup(
            `<div style="font-family:sans-serif;font-size:13px;line-height:1.4;">` +
            `<b style="font-size:14px;">${m.name || feature.properties.NOM_MASSIF}</b><br>` +
            `<span style="color:${color};font-weight:600;">${label}</span>` +
            `</div>`,
            { className: 'forecast-popup', closeButton: true, maxWidth: 200 }
          );

          layer.on({
            mouseover: (e) => {
              const ly = e.target;
              ly.setStyle({
                fillOpacity: 0.7,
                weight: 3,
              });
            },
            mouseout: (e) => {
              const ly = e.target;
              ly.setStyle({
                fillOpacity: 0.4,
                weight: 2,
              });
            },
          });
        },
      }).addTo(this._map);

      this._markers.push(geoJsonLayer);
    } else {
      // Fallback: draw circle markers
      Object.values(massifs).forEach((m) => {
        if (!m.latitude || !m.longitude) return;
        const color = this._getStatusColor(m.tomorrow_level);

        const marker = L.circleMarker([m.latitude, m.longitude], {
          radius: 12,
          fillColor: color,
          color: color,
          weight: 2,
          opacity: 0.8,
          fillOpacity: 0.5,
        }).addTo(this._map);

        const label = this._getStatusLabel(m.tomorrow_level);
        marker.bindPopup(
          `<div style="font-family:sans-serif;font-size:13px;line-height:1.4;">` +
          `<b style="font-size:14px;">${m.name}</b><br>` +
          `<span style="color:${color};font-weight:600;">${label}</span>` +
          `</div>`,
          { className: 'forecast-popup', closeButton: true, maxWidth: 200 }
        );

        this._markers.push(marker);
      });
    }
  }

  _getStateObj() {
    if (!this.hass || !this.config) return null;
    return this.hass.states[this.config.entity] || null;
  }

  // ── Lifecycle ────────────────────────────────────────────

  firstUpdated() {
    // Set up resize observer for responsive grid
    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this._cardWidth = entry.contentRect.width;
        this.requestUpdate();
      }
    });
    this._resizeObserver.observe(this);

    if (this.config.show_map) {
      setTimeout(() => this._initMap(), 150);
    }
  }

  updated(changedProps) {
    super.updated(changedProps);

    const stateObj = this._getStateObj();
    if (!stateObj) return;
    const massifs = stateObj.attributes.massifs;
    if (!massifs) return;

    // Calculate accessible count for tomorrow
    const accessibleCount = Object.values(massifs).filter(
      (m) => m.tomorrow_level === 1 || m.tomorrow_level === 2
    ).length;

    if (this.config.animate) {
      this._animateCount(accessibleCount);
    } else {
      this._animatedCount = accessibleCount;
    }

    // Map
    if (this.config.show_map && !this._map) {
      setTimeout(() => this._initMap(), 150);
    } else if (this._map) {
      this._updateMapMarkers();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  // ── Styles ───────────────────────────────────────────────

  static get styles() {
    return css`
      :host {
        display: block;
        font-family: 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      .card-container {
        background: rgba(30, 30, 30, 0.85);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 20px;
        overflow: hidden;
        color: #fff;
      }

      /* ── Header ── */
      .header {
        background: linear-gradient(135deg, #1a1a2e, #16213e);
        border-radius: 12px;
        padding: 16px 20px;
        margin-bottom: 16px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
      }

      .header-icon {
        font-size: 32px;
        flex-shrink: 0;
      }

      .header-icon.accessible {
        animation: sway 3s ease-in-out infinite;
      }

      .header-icon.forbidden {
        animation: bounce-fire 1.5s ease-in-out infinite;
      }

      @keyframes sway {
        0%, 100% { transform: rotate(0deg); }
        25% { transform: rotate(-5deg); }
        75% { transform: rotate(5deg); }
      }

      @keyframes bounce-fire {
        0%, 100% { transform: translateY(0) scale(1); }
        50% { transform: translateY(-4px) scale(1.1); }
      }

      .header-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .header-title {
        font-size: 18px;
        font-weight: 600;
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .header-subtitle {
        font-size: 13px;
        color: rgba(255, 255, 255, 0.55);
        margin-top: 2px;
      }

      .badge {
        padding: 8px 16px;
        border-radius: 20px;
        font-weight: 700;
        font-size: 15px;
        color: #fff;
        white-space: nowrap;
        animation: pulse 3s ease-in-out infinite;
        text-shadow: 0 1px 3px rgba(0,0,0,0.3);
        flex-shrink: 0;
      }

      .badge.green  { background: linear-gradient(135deg, #4CAF50, #66BB6A); }
      .badge.orange { background: linear-gradient(135deg, #FF9800, #FFB74D); }
      .badge.red    { background: linear-gradient(135deg, #F44336, #EF5350); }

      @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
      }

      /* ── Massif Grid ── */
      .massif-grid {
        display: grid;
        gap: 10px;
      }

      .massif-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
      .massif-grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
      .massif-grid.cols-1 { grid-template-columns: 1fr; }

      /* ── Mini Card ── */
      .massif-card {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 10px;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        transition: all 0.2s ease;
        cursor: default;
      }

      .massif-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
        background: rgba(255, 255, 255, 0.08);
      }

      .massif-card.border-green  { border-left: 3px solid #4CAF50; }
      .massif-card.border-red    { border-left: 3px solid #F44336; }
      .massif-card.border-gray   { border-left: 3px solid #555; }

      .massif-card.animate-in {
        opacity: 0;
        transform: translateY(20px);
        animation: slideUp 0.4s ease forwards;
      }

      @keyframes slideUp {
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .status-dot.green {
        background: #4CAF50;
        animation: greenPulse 2s ease-in-out infinite;
      }

      .status-dot.red {
        background: #F44336;
        animation: redPulse 1.5s ease-in-out infinite;
      }

      .status-dot.gray {
        background: #555;
      }

      @keyframes greenPulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.4); opacity: 0.7; }
      }

      @keyframes redPulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.3); opacity: 0.8; }
      }

      .massif-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .massif-name {
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .massif-status {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.6);
        margin-top: 2px;
      }

      .massif-extra {
        font-size: 11px;
        margin-top: 2px;
        font-weight: 600;
      }

      .massif-extra.conditions { color: #FFB74D; }
      .massif-extra.reinforced { color: #E53935; }

      /* ── Map ── */
      .map-container {
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.1);
        margin-top: 16px;
      }

      .map-inner {
        width: 100%;
      }

      /* ── Legend ── */
      .legend {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 16px;
        margin-top: 16px;
        flex-wrap: wrap;
      }

      .legend-item {
        display: flex;
        align-items: center;
        gap: 5px;
      }

      .legend-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .legend-label {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.55);
      }

      /* ── Off-Season ── */
      .off-season {
        text-align: center;
        padding: 60px 20px;
      }

      .off-season-trees {
        font-size: 40px;
        animation: float 3s ease-in-out infinite;
        margin-bottom: 20px;
        display: inline-block;
      }

      @keyframes float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
      }

      .off-season-title {
        font-size: 28px;
        font-weight: 700;
        background: linear-gradient(135deg, #4CAF50, #81C784, #A5D6A7);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        margin-bottom: 12px;
      }

      .off-season-subtitle {
        font-size: 14px;
        color: rgba(255, 255, 255, 0.5);
        line-height: 1.6;
        max-width: 400px;
        margin: 0 auto;
      }

      /* ── Loading / Error ── */
      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 40px;
        color: rgba(255, 255, 255, 0.6);
        font-size: 14px;
      }

      .spinner {
        width: 20px;
        height: 20px;
        border: 2px solid rgba(255, 255, 255, 0.15);
        border-top-color: rgba(255, 255, 255, 0.6);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .error {
        background: rgba(244, 67, 54, 0.1);
        border: 1px solid rgba(244, 67, 54, 0.3);
        border-radius: 12px;
        padding: 20px;
        text-align: center;
        color: #EF9A9A;
        font-size: 14px;
      }

      .error-icon {
        font-size: 28px;
        margin-bottom: 8px;
      }

      .no-data {
        text-align: center;
        padding: 40px 20px;
        color: rgba(255, 255, 255, 0.45);
        font-size: 14px;
      }
    `;
  }

  // ── Render ───────────────────────────────────────────────

  render() {
    if (!this.hass || !this.config) {
      return html`
        <div class="card-container">
          <div class="loading">
            <div class="spinner"></div>
            Chargement...
          </div>
        </div>
      `;
    }

    const stateObj = this._getStateObj();
    if (!stateObj) {
      return html`
        <div class="card-container">
          <div class="error">
            <div class="error-icon">⚠️</div>
            Entité introuvable : ${this.config.entity}
          </div>
        </div>
      `;
    }

    const attrs = stateObj.attributes;
    const isSeason = attrs.is_season;
    const massifs = attrs.massifs;

    // Off-season
    if (isSeason === false) {
      return html`
        <div class="card-container">
          ${this._renderHeader(massifs)}
          <div class="off-season">
            <div class="off-season-trees">🌲🌳🌲🌳🌲</div>
            <div class="off-season-title">Hors saison</div>
            <div class="off-season-subtitle">
              La surveillance des massifs forestiers reprend du 1er juin au 30 septembre.
            </div>
          </div>
        </div>
      `;
    }

    if (!massifs || Object.keys(massifs).length === 0) {
      return html`
        <div class="card-container">
          ${this._renderHeader(massifs)}
          <div class="no-data">Données non disponibles</div>
        </div>
      `;
    }

    return html`
      <div class="card-container">
        ${this._renderHeader(massifs)}
        ${this._renderGrid(massifs)}
        ${this.config.show_map ? this._renderMap() : ''}
        ${this._renderLegend()}
      </div>
    `;
  }

  _renderHeader(massifs) {
    const tomorrow = this._getTomorrowDate();
    const dateStr = this._formatFrenchDate(tomorrow);

    let accessibleCount = 0;
    let totalCount = 0;
    if (massifs) {
      const vals = Object.values(massifs);
      totalCount = vals.length;
      accessibleCount = vals.filter(
        (m) => m.tomorrow_level === 1 || m.tomorrow_level === 2
      ).length;
    }

    const isMostlyAccessible = accessibleCount >= totalCount / 2;
    const iconClass = isMostlyAccessible ? 'accessible' : 'forbidden';
    const icon = isMostlyAccessible ? '🌲' : '🔥';

    let badgeClass = 'red';
    if (accessibleCount > 20) badgeClass = 'green';
    else if (accessibleCount >= 10) badgeClass = 'orange';

    return html`
      <div class="header">
        <div class="header-left">
          <div class="header-icon ${iconClass}">${icon}</div>
          <div class="header-text">
            <div class="header-title">${this.config.title || "Prévisions d'accès"}</div>
            <div class="header-subtitle">${dateStr}</div>
          </div>
        </div>
        <div class="badge ${badgeClass}">
          ${this._animatedCount} / ${totalCount || 25} accessibles
        </div>
      </div>
    `;
  }

  _renderGrid(massifs) {
    // Sort: accessible (1,2) first, then forbidden (3,4), then unknown (0)
    const sorted = Object.entries(massifs)
      .map(([id, m]) => ({ id, ...m }))
      .sort((a, b) => {
        const groupOrder = (level) => {
          if (level === 1 || level === 2) return 0;
          if (level === 3 || level === 4) return 1;
          return 2;
        };
        const ga = groupOrder(a.tomorrow_level);
        const gb = groupOrder(b.tomorrow_level);
        if (ga !== gb) return ga - gb;
        return (a.name || '').localeCompare(b.name || '', 'fr');
      });

    // Responsive columns
    let colsClass = 'cols-3';
    if (this._cardWidth < 400) colsClass = 'cols-1';
    else if (this._cardWidth < 700) colsClass = 'cols-2';

    return html`
      <div class="massif-grid ${colsClass}">
        ${sorted.map((m, i) => this._renderMassifCard(m, i))}
      </div>
    `;
  }

  _renderMassifCard(m, index) {
    const level = m.tomorrow_level;
    const color = this._getStatusColor(level);
    const label = this._getStatusLabel(level);

    let borderClass = 'border-gray';
    let dotClass = 'gray';
    if (level === 1 || level === 2) { borderClass = 'border-green'; dotClass = 'green'; }
    else if (level === 3 || level === 4) { borderClass = 'border-red'; dotClass = 'red'; }

    const animClass = this.config.animate ? 'animate-in' : '';
    const animDelay = this.config.animate ? `animation-delay: ${index * 30}ms;` : '';

    let extra = '';
    if (level === 2) {
      extra = html`<div class="massif-extra conditions">⚠️ Sous conditions</div>`;
    } else if (level === 4) {
      extra = html`<div class="massif-extra reinforced">⛔ Accès renforcé</div>`;
    }

    return html`
      <div class="massif-card ${borderClass} ${animClass}" style="${animDelay}">
        <div class="status-dot ${dotClass}"></div>
        <div class="massif-info">
          <div class="massif-name">${m.name}</div>
          <div class="massif-status">${label}</div>
          ${extra}
        </div>
      </div>
    `;
  }

  _renderMap() {
    const h = this.config.map_height || 400;
    return html`
      <div class="map-container">
        <div id="${this._mapId}" class="map-inner" style="height:${h}px;"></div>
      </div>
    `;
  }

  _renderLegend() {
    const items = [
      { color: '#4CAF50', label: 'Autorisé' },
      { color: '#81C784', label: 'Sous conditions' },
      { color: '#F44336', label: 'Interdit' },
      { color: '#E53935', label: 'Interdit renforcé' },
      { color: '#555', label: 'Non disponible' },
    ];

    return html`
      <div class="legend">
        ${items.map(
          (item) => html`
            <div class="legend-item">
              <div class="legend-dot" style="background:${item.color};"></div>
              <span class="legend-label">${item.label}</span>
            </div>
          `
        )}
      </div>
    `;
  }
}

customElements.define('acces-massifs-forecast-card', AccesMassifsForecastCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'acces-massifs-forecast-card',
  name: 'Accès Massifs 13 — Prévisions',
  description: "Carte de prévisions d'accès aux massifs forestiers des Bouches-du-Rhône pour demain, avec carte Leaflet interactive.",
});

console.info(
  '%c ACCES-MASSIFS-FORECAST-CARD %c v1.0.0 ',
  'color: #fff; background: #4CAF50; font-weight: bold; padding: 2px 6px; border-radius: 4px 0 0 4px;',
  'color: #4CAF50; background: #1a1a2e; font-weight: bold; padding: 2px 6px; border-radius: 0 4px 4px 0;'
);
