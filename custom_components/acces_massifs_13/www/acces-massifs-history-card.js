const LitElement = customElements.get('hui-masonry-view')
  ? Object.getPrototypeOf(customElements.get('hui-masonry-view'))
  : Object.getPrototypeOf(customElements.get('hui-view'));
const html = LitElement.prototype.html;
const css = LitElement.prototype.css;

const scriptUrl = new URL(import.meta.url);
const cardVersion = scriptUrl.searchParams.get('v') || '1.0.4';

const ALL_MASSIF_IDS = [
  '131','132','133','134','135','136','137','138','139',
  '1310','1311','1312','1313','1314','1315','1316','1317',
  '1318','1319','1320','1321','1322','1323','1324','1325'
];

const LEVEL_COLORS = {
  0: '#2a2a2a',
  1: '#4CAF50',
  2: '#81C784',
  3: '#F44336',
  4: '#E53935',
};

const LEVEL_LABELS = {
  0: 'Non disponible',
  1: 'Autorisé',
  2: 'Autorisé sous conditions',
  3: 'Interdit',
  4: 'Interdit renforcé',
};

const MONTH_NAMES = ['Juin', 'Juil.', 'Août', 'Sept.'];
const MONTH_OFFSETS = [0, 30, 61, 92];

class AccesMassifsHistoryCard extends LitElement {

  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      _selectedYear: { type: Number },
      _selectedMassif: { type: String },
      _animated: { type: Boolean },
    };
  }

  constructor() {
    super();
    this._selectedYear = null;
    this._selectedMassif = null;
    this._animated = false;
    this._tooltipEl = null;
  }

  static getConfigElement() {
    return document.createElement('acces-massifs-history-card-editor');
  }

  static getStubConfig() {
    return {
      entity: 'sensor.acces_massifs_13_summary',
      title: 'Historique des accès aux massifs',
      year: new Date().getFullYear(),
      animate: true,
      show_sparkline: true,
    };
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Please define an entity');
    }
    this.config = {
      title: 'Historique des accès aux massifs',
      year: new Date().getFullYear(),
      animate: true,
      show_sparkline: true,
      ...config,
    };
    this._selectedYear = this.config.year;
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
    return 8;
  }

  // --- Data helpers ---

  _getEntity() {
    if (!this.hass || !this.config) return null;
    return this.hass.states[this.config.entity] || null;
  }

  _getHistory() {
    const entity = this._getEntity();
    if (!entity || !entity.attributes || !entity.attributes.history) return {};
    return entity.attributes.history;
  }

  _getMassifs() {
    const entity = this._getEntity();
    if (!entity || !entity.attributes || !entity.attributes.massifs) return {};
    return entity.attributes.massifs;
  }

  _getAvailableYears() {
    const history = this._getHistory();
    return Object.keys(history).map(Number).sort();
  }

  _getSortedMassifs() {
    const massifs = this._getMassifs();
    const entries = ALL_MASSIF_IDS.map(id => ({
      id,
      name: (massifs[id] && massifs[id].name) ? massifs[id].name : `Massif ${id}`,
    }));
    entries.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return entries;
  }

  _generateDateKeys(year) {
    const dates = [];
    const months = [
      { month: 5, days: 30 },  // June (0-indexed)
      { month: 6, days: 31 },  // July
      { month: 7, days: 31 },  // August
      { month: 8, days: 30 },  // September
    ];
    for (const m of months) {
      for (let d = 1; d <= m.days; d++) {
        const mm = String(m.month + 1).padStart(2, '0');
        const dd = String(d).padStart(2, '0');
        dates.push(`${year}${mm}${dd}`);
      }
    }
    return dates;
  }

  _formatDateKey(key) {
    const y = key.substring(0, 4);
    const m = parseInt(key.substring(4, 6), 10);
    const d = parseInt(key.substring(6, 8), 10);
    const monthNames = ['', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    return `${d} ${monthNames[m]} ${y}`;
  }

  _getLevelForCell(yearData, dateKey, massifId) {
    if (!yearData || !yearData[dateKey] || !yearData[dateKey][massifId]) return 0;
    return yearData[dateKey][massifId][0] || 0;
  }

  _getProcedureForCell(yearData, dateKey, massifId) {
    if (!yearData || !yearData[dateKey] || !yearData[dateKey][massifId]) return 0;
    return yearData[dateKey][massifId][1] || 0;
  }

  // --- Stats for selected massif ---

  _getMassifStats(yearData, massifId, dateKeys) {
    let authorized = 0;
    let forbidden = 0;
    let total = 0;
    for (const dk of dateKeys) {
      const level = this._getLevelForCell(yearData, dk, massifId);
      if (level > 0) {
        total++;
        if (level === 1 || level === 2) authorized++;
        else forbidden++;
      }
    }
    return { authorized, forbidden, total };
  }

  // --- Sparkline data ---

  _getSparklineData(yearData, dateKeys, massifId) {
    const sortedMassifs = this._getSortedMassifs();
    return dateKeys.map(dk => {
      if (massifId) {
        const level = this._getLevelForCell(yearData, dk, massifId);
        return (level === 1 || level === 2) ? 100 : 0;
      }
      let accessible = 0;
      for (const m of sortedMassifs) {
        const level = this._getLevelForCell(yearData, dk, m.id);
        if (level === 1 || level === 2) accessible++;
      }
      return (accessible / 25) * 100;
    });
  }

  _buildSparklinePath(data, width, height) {
    if (data.length === 0) return '';
    const padding = 0;
    const w = width - padding * 2;
    const h = height - 8;
    const stepX = w / (data.length - 1 || 1);

    const points = data.map((val, i) => ({
      x: padding + i * stepX,
      y: 4 + h - (val / 100) * h,
    }));

    if (points.length === 1) {
      return `M ${points[0].x} ${points[0].y}`;
    }

    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(i + 2, points.length - 1)];

      const tension = 0.3;
      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;

      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }

  _buildAreaPath(linePath, width, height) {
    return `${linePath} L ${width} ${height} L 0 ${height} Z`;
  }

  // --- Event handlers ---

  _onYearClick(year) {
    this._selectedYear = year;
    this._selectedMassif = null;
    this._animated = false;
    this.requestUpdate();
    // Re-trigger animation
    if (this.config.animate) {
      requestAnimationFrame(() => {
        this._animated = true;
        this.requestUpdate();
      });
    }
  }

  _onRowClick(massifId) {
    if (this._selectedMassif === massifId) {
      this._selectedMassif = null;
    } else {
      this._selectedMassif = massifId;
    }
    this.requestUpdate();
  }

  _onCardClick(e) {
    // Deselect if clicking empty space
    const path = e.composedPath();
    const isRow = path.some(el => el.classList && (el.classList.contains('heatmap-row') || el.classList.contains('massif-label')));
    if (!isRow && this._selectedMassif) {
      this._selectedMassif = null;
      this.requestUpdate();
    }
  }

  _onCellMouseEnter(e, dateKey, massifName, level) {
    const tooltip = this.shadowRoot.querySelector('.tooltip');
    if (!tooltip) return;
    const card = this.shadowRoot.querySelector('.card-container');
    const cardRect = card.getBoundingClientRect();
    const cellRect = e.target.getBoundingClientRect();

    tooltip.innerHTML = `
      <div class="tooltip-date">${this._formatDateKey(dateKey)}</div>
      <div class="tooltip-massif">${massifName}</div>
      <div class="tooltip-status" style="color: ${LEVEL_COLORS[level] || LEVEL_COLORS[0]}">${LEVEL_LABELS[level] || LEVEL_LABELS[0]}</div>
    `;

    tooltip.style.display = 'block';

    // Position tooltip
    const tooltipRect = tooltip.getBoundingClientRect();
    let left = cellRect.left - cardRect.left + cellRect.width / 2 - tooltipRect.width / 2;
    let top = cellRect.top - cardRect.top - tooltipRect.height - 8;

    // Keep within bounds
    if (left < 4) left = 4;
    if (left + tooltipRect.width > cardRect.width - 4) left = cardRect.width - tooltipRect.width - 4;
    if (top < 0) top = cellRect.bottom - cardRect.top + 8;

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  _onCellMouseLeave() {
    const tooltip = this.shadowRoot.querySelector('.tooltip');
    if (tooltip) tooltip.style.display = 'none';
  }

  // --- Lifecycle ---

  firstUpdated() {
    if (this.config.animate) {
      requestAnimationFrame(() => {
        this._animated = true;
        this.requestUpdate();
      });
    }
  }

  // --- Render ---

  render() {
    const entity = this._getEntity();
    if (!this.hass) {
      return html`
        <div class="card-container">
          <div class="loading-state">
            <div class="pulse-bar"></div>
            <div class="pulse-bar short"></div>
            <div class="pulse-bar"></div>
          </div>
        </div>
      `;
    }

    if (!entity) {
      return html`
        <div class="card-container">
          <div class="error-state">
            <span class="error-icon">⚠️</span>
            <span>Entité <strong>${this.config.entity}</strong> introuvable</span>
          </div>
        </div>
      `;
    }

    const history = this._getHistory();
    const availableYears = this._getAvailableYears();
    const selectedYear = this._selectedYear || this.config.year;
    const yearData = history[String(selectedYear)] || {};
    const dateKeys = this._generateDateKeys(selectedYear);
    const sortedMassifs = this._getSortedMassifs();
    const hasData = Object.keys(yearData).length > 0;

    // Ensure selected year is in available years for pills
    const yearsToShow = [...new Set([...availableYears, selectedYear])].sort();

    return html`
      <div class="card-container" @click=${this._onCardClick}>
        <!-- Tooltip -->
        <div class="tooltip"></div>

        <!-- Header -->
        <div class="header">
          <div class="header-left">
            <span class="header-icon">🔥</span>
            <span class="header-title">${this.config.title}</span>
          </div>
          <div class="header-right">
            ${yearsToShow.map(y => html`
              <button
                class="year-pill ${y === selectedYear ? 'active' : ''}"
                @click=${(e) => { e.stopPropagation(); this._onYearClick(y); }}
              >${y}</button>
            `)}
          </div>
        </div>

        ${!hasData ? html`
          <div class="empty-state">
            <span class="empty-icon">📭</span>
            <span>Aucune donnée historique disponible pour ${selectedYear}</span>
          </div>
        ` : html`
          <!-- Month Headers + Heatmap -->
          <div class="heatmap-wrapper">
            <div class="heatmap-scroll">
              <!-- Month header row -->
              <div class="month-row">
                <div class="label-spacer"></div>
                <div class="months-container">
                  ${MONTH_NAMES.map((name, i) => html`
                    <div class="month-label" style="left: ${MONTH_OFFSETS[i] * 5}px">${name}</div>
                  `)}
                </div>
              </div>

              <!-- Heatmap rows -->
              ${sortedMassifs.map(massif => {
                const isSelected = this._selectedMassif === massif.id;
                const isDimmed = this._selectedMassif && !isSelected;
                return html`
                  <div
                    class="heatmap-row ${isSelected ? 'selected' : ''} ${isDimmed ? 'dimmed' : ''}"
                    @click=${(e) => { e.stopPropagation(); this._onRowClick(massif.id); }}
                  >
                    <div class="massif-label" title="${massif.name}">${massif.name}</div>
                    <div class="cells-container">
                      ${dateKeys.map((dk, colIdx) => {
                        const level = this._getLevelForCell(yearData, dk, massif.id);
                        const color = LEVEL_COLORS[level] || LEVEL_COLORS[0];
                        const animStyle = this.config.animate
                          ? `animation-delay: ${colIdx * 5}ms;`
                          : 'opacity: 1;';
                        const animClass = (this.config.animate && this._animated) ? 'animate' : '';
                        return html`
                          <div
                            class="cell ${animClass}"
                            style="background: ${color}; ${animStyle}"
                            @mouseenter=${(e) => this._onCellMouseEnter(e, dk, massif.name, level)}
                            @mouseleave=${this._onCellMouseLeave}
                          ></div>
                        `;
                      })}
                    </div>
                  </div>
                `;
              })}
            </div>
          </div>

          <!-- Detail bar when massif selected -->
          ${this._selectedMassif ? (() => {
            const massif = sortedMassifs.find(m => m.id === this._selectedMassif);
            const stats = this._getMassifStats(yearData, this._selectedMassif, dateKeys);
            const authPct = stats.total > 0 ? Math.round((stats.authorized / stats.total) * 100) : 0;
            const forbPct = stats.total > 0 ? Math.round((stats.forbidden / stats.total) * 100) : 0;
            return html`
              <div class="detail-bar">
                <span class="detail-name">${massif ? massif.name : ''}</span>
                <span class="detail-stats">
                  <span class="stat-auth">${stats.authorized} jours autorisé (${authPct}%)</span>
                  <span class="stat-sep">·</span>
                  <span class="stat-forb">${stats.forbidden} jours interdit (${forbPct}%)</span>
                </span>
              </div>
            `;
          })() : ''}

          <!-- Sparkline -->
          ${this.config.show_sparkline ? (() => {
            const sparkData = this._getSparklineData(yearData, dateKeys, this._selectedMassif);
            const svgWidth = dateKeys.length * 5;
            const svgHeight = 50;
            const linePath = this._buildSparklinePath(sparkData, svgWidth, svgHeight);
            const areaPath = this._buildAreaPath(linePath, svgWidth, svgHeight);
            const totalLength = svgWidth * 2;
            return html`
              <div class="sparkline-wrapper">
                <div class="sparkline-labels">
                  <span class="sparkline-label-top">100%</span>
                  <span class="sparkline-label-bottom">0%</span>
                </div>
                <div class="sparkline-scroll">
                  <svg
                    class="sparkline-svg"
                    viewBox="0 0 ${svgWidth} ${svgHeight}"
                    preserveAspectRatio="none"
                    width="${svgWidth}"
                    height="${svgHeight}"
                  >
                    <defs>
                      <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="rgba(76,175,80,0.3)" />
                        <stop offset="100%" stop-color="rgba(76,175,80,0)" />
                      </linearGradient>
                    </defs>
                    <path class="sparkline-area" d="${areaPath}" fill="url(#sparkGrad)" />
                    <path
                      class="sparkline-line ${this._animated ? 'animate' : ''}"
                      d="${linePath}"
                      stroke="#4CAF50"
                      stroke-width="1.5"
                      fill="none"
                      stroke-dasharray="${totalLength}"
                      stroke-dashoffset="${this._animated ? 0 : totalLength}"
                    />
                  </svg>
                  <!-- Month labels below sparkline -->
                  <div class="sparkline-months">
                    ${MONTH_NAMES.map((name, i) => html`
                      <div class="sparkline-month" style="left: ${MONTH_OFFSETS[i] * 5}px">${name}</div>
                    `)}
                  </div>
                </div>
              </div>
            `;
          })() : ''}

          <!-- Legend -->
          <div class="legend">
            ${Object.entries(LEVEL_COLORS).filter(([k]) => k !== '0').map(([level, color]) => html`
              <div class="legend-item">
                <span class="legend-dot" style="background: ${color}"></span>
                <span class="legend-text">${LEVEL_LABELS[level]}</span>
              </div>
            `)}
            <div class="legend-item">
              <span class="legend-dot" style="background: ${LEVEL_COLORS[0]}"></span>
              <span class="legend-text">${LEVEL_LABELS[0]}</span>
            </div>
          </div>
        `}
      </div>
    `;
  }

  static get styles() {
    return css`
      :host {
        display: block;
        font-family: var(--paper-font-common-typography_-_font-family, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif);
      }

      .card-container {
        position: relative;
        background: var(--ha-card-background, var(--card-background-color, rgba(30, 30, 30, 0.85)));
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-radius: var(--ha-card-border-radius, 16px);
        border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, rgba(255, 255, 255, 0.1));
        padding: 20px;
        overflow: hidden;
        color: var(--primary-text-color, #fff);
      }

      /* --- Tooltip --- */
      .tooltip {
        display: none;
        position: absolute;
        z-index: 100;
        background: var(--ha-card-background, var(--card-background-color, rgba(15, 15, 15, 0.95)));
        border: 1px solid var(--ha-card-border-color, rgba(255, 255, 255, 0.15));
        border-radius: 6px;
        padding: 8px 12px;
        pointer-events: none;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        font-size: 11px;
        line-height: 1.5;
        max-width: 200px;
        color: var(--primary-text-color, #fff);
      }
      .tooltip-date {
        color: var(--secondary-text-color, rgba(255, 255, 255, 0.5));
        margin-bottom: 2px;
      }
      .tooltip-massif {
        color: var(--primary-text-color, rgba(255, 255, 255, 0.9));
        font-weight: 600;
        margin-bottom: 2px;
      }
      .tooltip-status {
        font-weight: 500;
      }

      /* --- Header --- */
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--primary-background-color, rgba(255, 255, 255, 0.05));
        border: 1px solid var(--ha-card-border-color, rgba(255, 255, 255, 0.1));
        border-radius: 12px;
        padding: 16px 20px;
        margin-bottom: 16px;
        flex-wrap: wrap;
        gap: 10px;
      }
      .header-left {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .header-icon {
        font-size: 22px;
      }
      .header-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--primary-text-color, #fff);
      }
      .header-right {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .year-pill {
        padding: 4px 14px;
        border-radius: 20px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
        outline: none;
        font-family: inherit;
      }
      .year-pill.active {
        background: var(--primary-color, #e94560);
        color: var(--text-primary-color, #fff);
        border: 1px solid transparent;
        box-shadow: 0 2px 12px rgba(var(--rgb-primary-color, 233, 69, 96), 0.35);
      }
      .year-pill:not(.active) {
        background: transparent;
        border: 1px solid var(--ha-card-border-color, rgba(255, 255, 255, 0.2));
        color: var(--secondary-text-color, rgba(255, 255, 255, 0.6));
      }
      .year-pill:not(.active):hover {
        border-color: var(--ha-card-border-color, rgba(255, 255, 255, 0.5));
        color: var(--primary-text-color, rgba(255, 255, 255, 0.85));
      }

      /* --- Heatmap --- */
      .heatmap-wrapper {
        margin-bottom: 12px;
      }
      .heatmap-scroll {
        overflow-x: auto;
        position: relative;
        padding-bottom: 4px;
      }
      .heatmap-scroll::-webkit-scrollbar {
        height: 4px;
      }
      .heatmap-scroll::-webkit-scrollbar-track {
        background: var(--primary-background-color, rgba(255, 255, 255, 0.05));
        border-radius: 2px;
      }
      .heatmap-scroll::-webkit-scrollbar-thumb {
        background: var(--ha-card-border-color, rgba(255, 255, 255, 0.15));
        border-radius: 2px;
      }

      /* Month row */
      .month-row {
        display: flex;
        align-items: flex-end;
        margin-bottom: 6px;
      }
      .label-spacer {
        min-width: 120px;
        flex-shrink: 0;
      }
      .months-container {
        position: relative;
        height: 16px;
        flex: 1;
        min-width: ${122 * 5}px;
      }
      .month-label {
        position: absolute;
        font-size: 11px;
        color: var(--secondary-text-color, rgba(255, 255, 255, 0.4));
        font-weight: 500;
        letter-spacing: 0.3px;
      }

      /* Heatmap rows */
      .heatmap-row {
        display: flex;
        align-items: center;
        cursor: pointer;
        border-radius: 3px;
        transition: opacity 0.3s ease, filter 0.3s ease, background 0.3s ease;
      }
      .heatmap-row:hover {
        background: var(--primary-background-color, rgba(255, 255, 255, 0.03));
      }
      .heatmap-row.selected {
        background: var(--primary-background-color, rgba(255, 255, 255, 0.06));
      }
      .heatmap-row.dimmed {
        opacity: 0.25;
        filter: grayscale(0.5);
      }

      .massif-label {
        position: sticky;
        left: 0;
        z-index: 5;
        min-width: 120px;
        max-width: 120px;
        font-size: 11px;
        color: var(--primary-text-color, rgba(255, 255, 255, 0.8));
        background: var(--ha-card-background, var(--card-background-color, rgba(30, 30, 30, 0.95)));
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
        padding-right: 8px;
        padding-top: 1px;
        padding-bottom: 1px;
        line-height: 14px;
        height: 15px;
        display: flex;
        align-items: center;
      }

      .cells-container {
        display: flex;
        gap: 1px;
        flex-shrink: 0;
      }

      .cell {
        width: 4px;
        height: 14px;
        border-radius: 1px;
        opacity: 0;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        position: relative;
        flex-shrink: 0;
      }
      .cell:not(.animate) {
        opacity: 1;
      }
      .cell.animate {
        animation: fadeIn 0.3s ease forwards;
      }
      .cell:hover {
        transform: scale(2.5);
        z-index: 10;
        box-shadow: 0 0 8px var(--cell-glow, currentColor);
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      /* --- Detail bar --- */
      .detail-bar {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        padding: 10px 16px;
        margin-bottom: 12px;
        background: var(--primary-background-color, rgba(255, 255, 255, 0.03));
        border-radius: 8px;
        border: 1px solid var(--ha-card-border-color, rgba(255, 255, 255, 0.08));
        flex-wrap: wrap;
      }
      .detail-name {
        font-weight: 600;
        font-size: 14px;
        color: var(--primary-text-color, #fff);
      }
      .detail-stats {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
      }
      .stat-auth {
        color: var(--success-color, #4CAF50);
      }
      .stat-sep {
        color: var(--ha-card-border-color, rgba(255, 255, 255, 0.3));
      }
      .stat-forb {
        color: var(--error-color, #F44336);
      }

      /* --- Sparkline --- */
      .sparkline-wrapper {
        display: flex;
        align-items: stretch;
        margin-bottom: 14px;
        margin-top: 4px;
        gap: 6px;
      }
      .sparkline-labels {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        min-width: 30px;
        padding: 2px 0;
      }
      .sparkline-label-top,
      .sparkline-label-bottom {
        font-size: 9px;
        color: var(--secondary-text-color, rgba(255, 255, 255, 0.3));
      }
      .sparkline-scroll {
        overflow-x: auto;
        position: relative;
        flex: 1;
      }
      .sparkline-scroll::-webkit-scrollbar {
        height: 0;
      }
      .sparkline-svg {
        display: block;
      }
      .sparkline-line {
        transition: stroke-dashoffset 1.5s ease-in-out;
      }
      .sparkline-line.animate {
        stroke-dashoffset: 0 !important;
      }
      .sparkline-area {
        opacity: 0.6;
      }
      .sparkline-months {
        position: relative;
        height: 14px;
        margin-top: 2px;
      }
      .sparkline-month {
        position: absolute;
        font-size: 9px;
        color: var(--secondary-text-color, rgba(255, 255, 255, 0.3));
      }

      /* --- Legend --- */
      .legend {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
        padding-top: 4px;
      }
      .legend-item {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .legend-dot {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .legend-text {
        font-size: 11px;
        color: var(--secondary-text-color, rgba(255, 255, 255, 0.5));
        white-space: nowrap;
      }

      /* --- Loading state --- */
      .loading-state {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 40px 20px;
      }
      .pulse-bar {
        height: 12px;
        border-radius: 6px;
        background: linear-gradient(90deg,
          var(--primary-background-color, rgba(255,255,255,0.04)) 25%,
          var(--ha-card-border-color, rgba(255,255,255,0.08)) 50%,
          var(--primary-background-color, rgba(255,255,255,0.04)) 75%
        );
        background-size: 200% 100%;
        animation: pulse 1.5s ease-in-out infinite;
      }
      .pulse-bar.short {
        width: 60%;
      }
      @keyframes pulse {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      /* --- Error state --- */
      .error-state {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 40px 20px;
        font-size: 14px;
        color: var(--secondary-text-color, rgba(255, 255, 255, 0.6));
      }
      .error-icon {
        font-size: 20px;
      }

      /* --- Empty state --- */
      .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 60px 20px;
        font-size: 14px;
        color: var(--secondary-text-color, rgba(255, 255, 255, 0.4));
      }
      .empty-icon {
        font-size: 24px;
      }
    `;
  }
}

customElements.define('acces-massifs-history-card', AccesMassifsHistoryCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'acces-massifs-history-card',
  name: 'Accès Massifs - Historique',
  description: 'Historique des accès aux massifs forestiers des Bouches-du-Rhône',
});

console.info(
  `%c ACCES-MASSIFS-HISTORY-CARD %c v${cardVersion} `,
  'color: #fff; background: #e94560; font-weight: bold; padding: 2px 6px; border-radius: 4px 0 0 4px;',
  'color: #e94560; background: #1a1a2e; font-weight: bold; padding: 2px 6px; border-radius: 0 4px 4px 0;'
);

class AccesMassifsHistoryCardEditor extends LitElement {
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

    const newConfig = {
      ...this._config,
      [configValue]: newValue,
    };

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
            label="Entité"
            .value=${this._config.entity || ''}
            .configValue=${'entity'}
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
        <div class="option">
          <ha-textfield
            label="Année par défaut"
            type="number"
            .value=${this._config.year || new Date().getFullYear()}
            .configValue=${'year'}
            @input=${this._valueChanged}
            style="width: 100%;"
          ></ha-textfield>
        </div>
        <div class="option switch-option">
          <ha-switch
            .checked=${this._config.show_sparkline !== false}
            .configValue=${'show_sparkline'}
            @change=${this._valueChanged}
          ></ha-switch>
          <span class="switch-label">Afficher la sparkline de tendance</span>
        </div>
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
    `;
  }
}
customElements.define('acces-massifs-history-card-editor', AccesMassifsHistoryCardEditor);
