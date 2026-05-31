"""The Accès Massifs Forestiers 13 integration."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall

from .const import (
    CONF_SCAN_HOUR,
    CONF_SCAN_MINUTE,
    DEFAULT_SCAN_HOUR,
    DEFAULT_SCAN_MINUTE,
    DOMAIN,
)
from .coordinator import AccesMassifsCoordinator
from .storage import AccesMassifsStorage

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR]

SERVICE_FORCE_UPDATE = "force_update"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Accès Massifs Forestiers 13 from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    # ── Storage ────────────────────────────────────────────────────────────
    storage = AccesMassifsStorage(hass)
    await storage.async_load()

    # ── Coordinator ────────────────────────────────────────────────────────
    scan_hour: int = entry.options.get(
        CONF_SCAN_HOUR, entry.data.get(CONF_SCAN_HOUR, DEFAULT_SCAN_HOUR)
    )
    scan_minute: int = entry.options.get(
        CONF_SCAN_MINUTE, entry.data.get(CONF_SCAN_MINUTE, DEFAULT_SCAN_MINUTE)
    )

    coordinator = AccesMassifsCoordinator(
        hass,
        storage=storage,
        scan_hour=scan_hour,
        scan_minute=scan_minute,
    )

    # First data fetch
    await coordinator.async_config_entry_first_refresh()

    hass.data[DOMAIN][entry.entry_id] = coordinator

    # ── Forward platforms ──────────────────────────────────────────────────
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # ── Register force_update service ──────────────────────────────────────
    async def handle_force_update(call: ServiceCall) -> None:  # noqa: ARG001
        """Force an immediate data refresh."""
        _LOGGER.info("force_update service called – refreshing data")
        await coordinator.async_request_refresh()

    if not hass.services.has_service(DOMAIN, SERVICE_FORCE_UPDATE):
        hass.services.async_register(
            DOMAIN, SERVICE_FORCE_UPDATE, handle_force_update
        )

    # ── Register www directory for Lovelace card assets ────────────────────
    await _async_register_www(hass)

    # ── Listen for options updates ─────────────────────────────────────────
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    return True


async def _async_register_www(hass: HomeAssistant) -> None:
    """Serve the integration's ``www/`` folder as a static path.

    This makes Lovelace card JS files loadable via:
        ``/local/community/acces_massifs_13/<file>``
    or via the ``/hacsfiles/`` alias used by HACS.
    """
    www_path = Path(__file__).parent / "www"
    if www_path.is_dir():
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    url_path=f"/local/community/{DOMAIN}",
                    path=str(www_path),
                    cache_headers=True,
                )
            ]
        )
        _LOGGER.debug("Registered static path for %s", www_path)


async def _async_options_updated(
    hass: HomeAssistant, entry: ConfigEntry
) -> None:
    """Reload the integration when options change."""
    _LOGGER.debug("Options updated – reloading integration")
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(
        entry, PLATFORMS
    )
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        # Clean up domain data dict if empty
        if not hass.data[DOMAIN]:
            hass.data.pop(DOMAIN, None)
            # Remove service when no entries remain
            if hass.services.has_service(DOMAIN, SERVICE_FORCE_UPDATE):
                hass.services.async_remove(DOMAIN, SERVICE_FORCE_UPDATE)

    return unload_ok
