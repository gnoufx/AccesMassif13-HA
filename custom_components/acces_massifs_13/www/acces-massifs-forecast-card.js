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

const scriptUrl = new URL(import.meta.url);
const cardVersion = scriptUrl.searchParams.get('v') || '1.0.4';

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

  static getConfigElement() {
    return document.createElement('acces-massifs-forecast-card-editor');
  }

  static getStubConfig() {
    return {
      entity: 'sensor.acces_massifs_13_summary',
      title: 'Accès aux massifs',
      show_map: true,
      map_height: 400,
      animate: true,
      mode: 'auto',
    };
  }

  setConfig(config) {
    if (!config.entity && (!config.entities || config.entities.length === 0)) {
      throw new Error('Please define an entity or entities');
    }
    this.config = {
      entity: config.entity,
      entities: config.entities,
      title: config.title || "Accès aux massifs",
      show_map: config.show_map !== false,
      map_height: config.map_height || 400,
      animate: config.animate !== false,
      mode: config.mode || 'auto', // 'auto' | 'today' | 'tomorrow'
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

  _getDisplayMode(attrs) {
    const configMode = this.config.mode || 'auto';
    if (configMode === 'today') return 'today';
    if (configMode === 'tomorrow') return 'tomorrow';

    // auto mode
    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();

    const scanHour = attrs && attrs.scan_hour !== undefined ? attrs.scan_hour : 18;
    const scanMin = attrs && attrs.scan_minute !== undefined ? attrs.scan_minute : 30;

    if (currentHour < scanHour || (currentHour === scanHour && currentMin <= scanMin)) {
      return 'today';
    }
    return 'tomorrow';
  }

  _parseDateKey(dateStr) {
    if (!dateStr || dateStr.length !== 8) return new Date();
    const y = parseInt(dateStr.substring(0, 4), 10);
    const m = parseInt(dateStr.substring(4, 6), 10) - 1;
    const d = parseInt(dateStr.substring(6, 8), 10);
    return new Date(y, m, d);
  }

  _getDisplayInfo(attrs) {
    if (!attrs) {
      return {
        mode: 'tomorrow',
        dateLabel: "Demain",
        dateObj: this._getTomorrowDate(),
        levelKey: 'tomorrow_level',
        colorKey: 'tomorrow_color',
        labelKey: 'tomorrow_label',
        procedureKey: 'tomorrow_procedure',
      };
    }
    const mode = this._getDisplayMode(attrs);
    const dateStr = mode === 'today' ? attrs.today_date : attrs.tomorrow_date;
    const dateObj = dateStr ? this._parseDateKey(dateStr) : (mode === 'today' ? new Date() : this._getTomorrowDate());
    
    return {
      mode,
      dateLabel: mode === 'today' ? "Aujourd'hui" : "Demain",
      dateObj: dateObj,
      levelKey: mode === 'today' ? 'today_level' : 'tomorrow_level',
      colorKey: mode === 'today' ? 'today_color' : 'tomorrow_color',
      labelKey: mode === 'today' ? 'today_label' : 'tomorrow_label',
      procedureKey: mode === 'today' ? 'today_procedure' : 'tomorrow_procedure',
    };
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
        let response = await fetch(`/local/community/acces_massifs_13/massifs_13.geojson?v=${cardVersion}`);
        if (!response.ok) {
          response = await fetch(`/hacsfiles/acces_massifs_13/massifs_13.geojson?v=${cardVersion}`);
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

    const stateObj = this._getStateObj();
    const attrs = stateObj ? stateObj.attributes : {};
    const isIndividual = !this.config.entities && attrs && attrs.massif_id !== undefined;
    const center = isIndividual && attrs.latitude && attrs.longitude
      ? [attrs.latitude, attrs.longitude]
      : [43.45, 5.095];
    const zoom = isIndividual ? 11 : 9;

    this._map = L.map(container, {
      center: center,
      zoom: zoom,
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

  _getMassifs(stateObj) {
    if (!this.hass) return null;

    if (this.config.entities && this.config.entities.length > 0) {
      const massifs = {};
      for (const ent of this.config.entities) {
        const entState = this.hass.states[ent];
        if (!entState || !entState.attributes) continue;

        const attrs = entState.attributes;
        if (attrs.massifs) {
          Object.assign(massifs, attrs.massifs);
        } else if (attrs.massif_id !== undefined) {
          massifs[attrs.massif_id] = {
            name: attrs.massif_name,
            today_level: attrs.level,
            today_label: entState.state,
            today_color: attrs.color,
            today_procedure: attrs.procedure,
            tomorrow_level: attrs.tomorrow_level,
            tomorrow_label: attrs.tomorrow_label,
            tomorrow_color: attrs.tomorrow_color,
            tomorrow_procedure: attrs.tomorrow_procedure || "",
            latitude: attrs.latitude,
            longitude: attrs.longitude,
          };
        }
      }
      return Object.keys(massifs).length > 0 ? massifs : null;
    }

    if (!stateObj) return null;
    const attrs = stateObj.attributes;
    if (!attrs) return null;
    let massifs = attrs.massifs;
    const isIndividual = attrs.massif_id !== undefined;
    if (isIndividual && !massifs) {
      massifs = {
        [attrs.massif_id]: {
          name: attrs.massif_name,
          today_level: attrs.level,
          today_label: stateObj.state,
          today_color: attrs.color,
          today_procedure: attrs.procedure,
          tomorrow_level: attrs.tomorrow_level,
          tomorrow_label: attrs.tomorrow_label,
          tomorrow_color: attrs.tomorrow_color,
          tomorrow_procedure: attrs.tomorrow_procedure || "",
          latitude: attrs.latitude,
          longitude: attrs.longitude,
        }
      };
    }
    return massifs;
  }

  _updateMapMarkers() {
    if (!this._map || !window.L) return;

    const stateObj = this._getStateObj();
    if (!stateObj) return;
    const massifs = this._getMassifs(stateObj);
    if (!massifs) return;

    const info = this._getDisplayInfo(stateObj.attributes);

    // Remove old layers
    this._markers.forEach((m) => m.remove());
    this._markers = [];

    if (this._geoJsonData) {
      // Draw actual polygons from GeoJSON
      const geoJsonLayer = L.geoJSON(this._geoJsonData, {
        filter: (feature) => {
          const mId = String(feature.properties.ID);
          return massifs[mId] !== undefined;
        },
        style: (feature) => {
          const mId = feature.properties.ID;
          const m = massifs[mId] || {};
          const level = m[info.levelKey];
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
          const level = m[info.levelKey];
          const color = this._getStatusColor(level);
          const label = this._getStatusLabel(level);

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

      // Auto-fit bounds if we are displaying a subset of massifs
      const totalFeatures = this._geoJsonData.features ? this._geoJsonData.features.length : 25;
      const displayedCount = Object.keys(massifs).length;
      if (displayedCount > 0 && displayedCount < totalFeatures) {
        try {
          const bounds = geoJsonLayer.getBounds();
          if (bounds.isValid()) {
            this._map.fitBounds(bounds, { padding: [20, 20] });
          }
        } catch (e) {
          console.warn('Failed to fit map bounds:', e);
        }
      }
    } else {
      // Fallback: draw circle markers
      Object.values(massifs).forEach((m) => {
        if (!m.latitude || !m.longitude) return;
        const level = m[info.levelKey];
        const color = this._getStatusColor(level);

        const marker = L.circleMarker([m.latitude, m.longitude], {
          radius: 12,
          fillColor: color,
          color: color,
          weight: 2,
          opacity: 0.8,
          fillOpacity: 0.5,
        }).addTo(this._map);

        const label = this._getStatusLabel(level);
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
    if (this.config.entity) {
      return this.hass.states[this.config.entity] || null;
    }
    if (this.config.entities && this.config.entities.length > 0) {
      for (const ent of this.config.entities) {
        if (this.hass.states[ent]) {
          return this.hass.states[ent];
        }
      }
    }
    return null;
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
    const massifs = this._getMassifs(stateObj);
    if (!massifs) return;

    const info = this._getDisplayInfo(stateObj.attributes);

    // Calculate accessible count for the selected mode
    const accessibleCount = Object.values(massifs).filter(
      (m) => m[info.levelKey] === 1 || m[info.levelKey] === 2
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
        font-family: var(--paper-font-common-typography_-_font-family, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif);
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      .card-container {
        background: var(--ha-card-background, var(--card-background-color, rgba(30, 30, 30, 0.85)));
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-radius: var(--ha-card-border-radius, 16px);
        border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, rgba(255, 255, 255, 0.1));
        padding: 20px;
        overflow: hidden;
        color: var(--primary-text-color, #fff);
      }

      /* ── Header ── */
      .header {
        background: var(--primary-background-color, rgba(255, 255, 255, 0.05));
        border-radius: 12px;
        border: 1px solid var(--ha-card-border-color, rgba(255, 255, 255, 0.1));
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
        color: var(--primary-text-color, #fff);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .header-subtitle {
        font-size: 13px;
        color: var(--secondary-text-color, rgba(255, 255, 255, 0.55));
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

      .badge.green  { background: linear-gradient(135deg, var(--success-color, #4CAF50), #66BB6A); }
      .badge.orange { background: linear-gradient(135deg, var(--warning-color, #FF9800), #FFB74D); }
      .badge.red    { background: linear-gradient(135deg, var(--error-color, #F44336), #EF5350); }

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
        background: var(--primary-background-color, rgba(255, 255, 255, 0.05));
        border-radius: 10px;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        transition: all 0.2s ease;
        cursor: default;
        border: 1px solid var(--ha-card-border-color, rgba(255, 255, 255, 0.05));
      }

      .massif-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
        background: var(--primary-background-color, rgba(255, 255, 255, 0.08));
      }

      .massif-card.border-green  { border-left: 3px solid var(--success-color, #4CAF50); }
      .massif-card.border-red    { border-left: 3px solid var(--error-color, #F44336); }
      .massif-card.border-gray   { border-left: 3px solid var(--disabled-color, #555); }

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
        background: var(--success-color, #4CAF50);
        animation: greenPulse 2s ease-in-out infinite;
      }

      .status-dot.red {
        background: var(--error-color, #F44336);
        animation: redPulse 1.5s ease-in-out infinite;
      }

      .status-dot.gray {
        background: var(--disabled-color, #555);
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
        color: var(--primary-text-color, #fff);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .massif-status {
        font-size: 12px;
        color: var(--secondary-text-color, rgba(255, 255, 255, 0.6));
        margin-top: 2px;
      }

      .massif-extra {
        font-size: 11px;
        margin-top: 2px;
        font-weight: 600;
      }

      .massif-extra.conditions { color: var(--warning-color, #FFB74D); }
      .massif-extra.reinforced { color: var(--error-color, #E53935); }

      /* ── Map ── */
      .map-container {
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid var(--ha-card-border-color, rgba(255, 255, 255, 0.1));
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
        color: var(--secondary-text-color, rgba(255, 255, 255, 0.55));
      }

      /* ── Off-Season Banner ── */
      .off-season-banner {
        background: rgba(var(--rgb-info-color, 33, 150, 243), 0.1);
        border: 1px solid var(--info-color, rgba(33, 150, 243, 0.25));
        border-radius: 10px;
        padding: 12px 16px;
        margin-bottom: 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 13px;
        color: var(--primary-text-color, #fff);
        line-height: 1.4;
      }

      .banner-icon {
        font-size: 20px;
        flex-shrink: 0;
        animation: rotate-snowflake 6s linear infinite;
        display: inline-block;
      }

      @keyframes rotate-snowflake {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      /* ── Loading / Error ── */
      .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 40px;
        color: var(--secondary-text-color, rgba(255, 255, 255, 0.6));
        font-size: 14px;
      }

      .spinner {
        width: 20px;
        height: 20px;
        border: 2px solid var(--ha-card-border-color, rgba(255, 255, 255, 0.15));
        border-top-color: var(--primary-text-color, rgba(255, 255, 255, 0.6));
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .error {
        background: rgba(var(--rgb-error-color, 244, 67, 54), 0.1);
        border: 1px solid var(--error-color, rgba(244, 67, 54, 0.3));
        border-radius: 12px;
        padding: 20px;
        text-align: center;
        color: var(--error-color, #EF9A9A);
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
      const missingEntity = this.config.entity || (this.config.entities && this.config.entities.join(', ')) || 'Aucune entité configurée';
      return html`
        <div class="card-container">
          <div class="error">
            <div class="error-icon">⚠️</div>
            Entité introuvable : ${missingEntity}
          </div>
        </div>
      `;
    }

    const attrs = stateObj.attributes;
    const isSeason = attrs.is_season;
    const massifs = this._getMassifs(stateObj);

    if (!massifs || Object.keys(massifs).length === 0) {
      return html`
        <div class="card-container">
          ${this._renderHeader(attrs, massifs)}
          <div class="no-data">Données non disponibles</div>
        </div>
      `;
    }

    return html`
      <div class="card-container">
        ${this._renderHeader(attrs, massifs)}
        ${this._renderOffSeasonBanner(isSeason)}
        ${this._renderGrid(attrs, massifs)}
        ${this.config.show_map ? this._renderMap() : ''}
        ${this._renderLegend()}
      </div>
    `;
  }

  _renderOffSeasonBanner(isSeason) {
    if (isSeason !== false) return '';
    return html`
      <div class="off-season-banner">
        <span class="banner-icon">❄️</span>
        <div class="banner-text">
          <strong>Hors saison active (1er oct. – 31 mai)</strong> : La surveillance préfectorale est inactive et le risque d'incendie est faible. L'accès à l'ensemble des massifs est libre et ouvert.
        </div>
      </div>
    `;
  }

  _renderHeader(attrs, massifs) {
    const info = this._getDisplayInfo(attrs);
    const dateStr = this._formatFrenchDate(info.dateObj);

    let accessibleCount = 0;
    let totalCount = 0;
    if (massifs) {
      const vals = Object.values(massifs);
      totalCount = vals.length;
      accessibleCount = vals.filter(
        (m) => m[info.levelKey] === 1 || m[info.levelKey] === 2
      ).length;
    }

    const isMostlyAccessible = accessibleCount >= totalCount / 2;
    const iconClass = isMostlyAccessible ? 'accessible' : 'forbidden';
    const icon = isMostlyAccessible ? '🌲' : '🔥';

    let badgeClass = 'red';
    if (totalCount === 1) {
      badgeClass = accessibleCount === 1 ? 'green' : 'red';
    } else if (totalCount > 1) {
      const ratio = accessibleCount / totalCount;
      if (ratio >= 0.8) badgeClass = 'green';
      else if (ratio >= 0.4) badgeClass = 'orange';
    }

    const isSingleMassif = totalCount === 1;
    const displayName = isSingleMassif && Object.values(massifs)[0]?.name || attrs.massif_name;
    const defaultTitle = info.mode === 'today'
      ? (displayName ? `Accès ${displayName} — Aujourd'hui` : "Accès aux massifs — Aujourd'hui")
      : (displayName ? `Prévisions ${displayName} — Demain` : "Prévisions d'accès — Demain");
    const title = this.config.title === "Accès aux massifs" ? defaultTitle : this.config.title;

    return html`
      <div class="header">
        <div class="header-left">
          <div class="header-icon ${iconClass}">${icon}</div>
          <div class="header-text">
            <div class="header-title">${title}</div>
            <div class="header-subtitle">${dateStr}</div>
          </div>
        </div>
        <div class="badge ${badgeClass}">
          ${this._animatedCount} / ${totalCount || 25} accessibles
        </div>
      </div>
    `;
  }

  _renderGrid(attrs, massifs) {
    const info = this._getDisplayInfo(attrs);
    // Sort: accessible (1,2) first, then forbidden (3,4), then unknown (0)
    const sorted = Object.entries(massifs)
      .map(([id, m]) => ({ id, ...m }))
      .sort((a, b) => {
        const groupOrder = (level) => {
          if (level === 1 || level === 2) return 0;
          if (level === 3 || level === 4) return 1;
          return 2;
        };
        const ga = groupOrder(a[info.levelKey]);
        const gb = groupOrder(b[info.levelKey]);
        if (ga !== gb) return ga - gb;
        return (a.name || '').localeCompare(b.name || '', 'fr');
      });

    // Responsive columns
    let colsClass = 'cols-3';
    if (this._cardWidth < 400) colsClass = 'cols-1';
    else if (this._cardWidth < 700) colsClass = 'cols-2';

    return html`
      <div class="massif-grid ${colsClass}">
        ${sorted.map((m, i) => this._renderMassifCard(info, m, i))}
      </div>
    `;
  }

  _renderMassifCard(info, m, index) {
    const level = m[info.levelKey];
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
  name: 'Accès Massifs 13 — Cartographie',
  description: "Carte d'accès aux massifs forestiers des Bouches-du-Rhône avec mode d'affichage intelligent (Aujourd'hui / Demain) et carte interactive.",
});

console.info(
  `%c ACCES-MASSIFS-FORECAST-CARD %c v${cardVersion} `,
  'color: #fff; background: #4CAF50; font-weight: bold; padding: 2px 6px; border-radius: 4px 0 0 4px;',
  'color: #4CAF50; background: #1a1a2e; font-weight: bold; padding: 2px 6px; border-radius: 0 4px 4px 0;'
);

class AccesMassifsForecastCardEditor extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      _config: { type: Object },
    };
  }

  setConfig(config) {
    this._config = config;
  }

  _valueChanged(ev) {
    if (!this._config || !this.hass) return;
    const target = ev.target;
    const configValue = target.configValue;
    if (!configValue) return;

    let newValue = ev.detail ? ev.detail.value : target.value;
    if (target.tagName === 'HA-SWITCH') {
      newValue = target.checked;
    } else if (target.tagName === 'HA-TEXTFIELD' && target.type === 'number') {
      newValue = parseInt(target.value, 10) || 0;
    } else if (target.tagName === 'HA-TEXTFIELD') {
      newValue = target.value;
    }

    if (configValue === 'entities') {
      newValue = typeof newValue === 'string'
        ? newValue.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : newValue;
    }

    const newConfig = {
      ...this._config,
      [configValue]: newValue,
    };

    if (configValue === 'entities' && (!newValue || newValue.length === 0)) {
      delete newConfig.entities;
    }

    const event = new CustomEvent("config-changed", {
      detail: { config: newConfig },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  render() {
    if (!this.hass || !this._config) return html``;

    return html`
      <div class="card-config">
        <div class="option">
          <ha-textfield
            label="Entité unique (ex: sensor.acces_massifs_13_summary)"
            .value=${this._config.entity || ''}
            .configValue=${'entity'}
            @input=${this._valueChanged}
            style="width: 100%;"
          ></ha-textfield>
        </div>
        <div class="option">
          <ha-textfield
            label="Plusieurs entités (séparées par des virgules)"
            .value=${this._config.entities ? this._config.entities.join(', ') : ''}
            .configValue=${'entities'}
            @input=${this._valueChanged}
            style="width: 100%;"
          ></ha-textfield>
        </div>
        <div class="option">
          <ha-textfield
            label="Titre"
            .value=${this._config.title || ''}
            .configValue=${'title'}
            @input=${this._valueChanged}
            style="width: 100%;"
          ></ha-textfield>
        </div>
        <div class="option select-option">
          <label class="select-label">Mode d'affichage</label>
          <ha-select
            .value=${this._config.mode || 'auto'}
            .configValue=${'mode'}
            @selected=${this._valueChanged}
            @closed=${(ev) => ev.stopPropagation()}
            style="width: 100%;"
          >
            <ha-list-item value="auto">Automatique (Intelligent)</ha-list-item>
            <ha-list-item value="today">Aujourd'hui</ha-list-item>
            <ha-list-item value="tomorrow">Demain</ha-list-item>
          </ha-select>
        </div>
        <div class="option switch-option">
          <ha-switch
            .checked=${this._config.show_map !== false}
            .configValue=${'show_map'}
            @change=${this._valueChanged}
          ></ha-switch>
          <span class="switch-label">Afficher la carte Leaflet</span>
        </div>
        ${this._config.show_map !== false ? html`
          <div class="option">
            <ha-textfield
              label="Hauteur de la carte (px)"
              type="number"
              .value=${this._config.map_height || 400}
              .configValue=${'map_height'}
              @input=${this._valueChanged}
              style="width: 100%;"
            ></ha-textfield>
          </div>
        ` : ''}
        <div class="option switch-option">
          <ha-switch
            .checked=${this._config.animate !== false}
            .configValue=${'animate'}
            @change=${this._valueChanged}
          ></ha-switch>
          <span class="switch-label">Activer les animations</span>
        </div>
      </div>
    `;
  }

  static get styles() {
    return css`
      .card-config {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 8px 0;
      }
      .option {
        display: flex;
        flex-direction: column;
      }
      .switch-option {
        flex-direction: row;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        margin: 4px 0;
      }
      .switch-label {
        font-size: 14px;
        color: var(--primary-text-color);
      }
      .select-option {
        gap: 6px;
        margin-bottom: 8px;
      }
      .select-label {
        font-size: 12px;
        color: var(--secondary-text-color);
      }
    `;
  }
}
customElements.define('acces-massifs-forecast-card-editor', AccesMassifsForecastCardEditor);
