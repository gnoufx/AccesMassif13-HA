"""The Accès Massifs Forestiers 13 integration."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.loader import async_get_integration

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

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.TIME]

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

    # ── Automatically register Lovelace resources for UI Editor support ───
    await _async_register_lovelace_resources(hass)

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
        await _async_register_lovelace_resources(hass)


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
        coordinator = hass.data[DOMAIN].get(entry.entry_id)
        if coordinator and hasattr(coordinator, "async_unload"):
            await coordinator.async_unload()

        hass.data[DOMAIN].pop(entry.entry_id, None)
        # Clean up domain data dict if empty
        if not hass.data[DOMAIN]:
            hass.data.pop(DOMAIN, None)
            # Remove service when no entries remain
            if hass.services.has_service(DOMAIN, SERVICE_FORCE_UPDATE):
                hass.services.async_remove(DOMAIN, SERVICE_FORCE_UPDATE)

    return unload_ok


async def _async_register_lovelace_resources(hass: HomeAssistant) -> None:
    """Register the Lovelace card resources automatically.

    This ensures that when a user sets up the integration, both Lovelace
    JS cards are registered in Home Assistant's resource registry
    with an updated cache-busting version query parameter automatically.
    """
    lovelace_data = hass.data.get("lovelace")
    if not lovelace_data or getattr(lovelace_data, "mode", "storage") != "storage":
        _LOGGER.debug("Lovelace is not in storage mode, skipping automatic resource registration")
        return

    resources = lovelace_data.resources
    if not resources:
        _LOGGER.debug("Lovelace resources repository not found, skipping registration")
        return

    if not resources.loaded:
        await resources.async_load()

    # Load version dynamically from integration manifest
    version = "1.0.7"
    try:
        integration = await async_get_integration(hass, DOMAIN)
        version = integration.version
    except Exception as err:
        _LOGGER.warning("Could not read version from integration manifest: %s", err)

    card_resources = [
        {
            "url": f"/local/community/{DOMAIN}/acces-massifs-forecast-card.js?v={version}",
            "path": f"/local/community/{DOMAIN}/acces-massifs-forecast-card.js",
        },
        {
            "url": f"/local/community/{DOMAIN}/acces-massifs-history-card.js?v={version}",
            "path": f"/local/community/{DOMAIN}/acces-massifs-history-card.js",
        },
    ]

    try:
        # Get existing items to avoid duplicates
        existing_items = resources.async_items()
        
        for r in card_resources:
            found_item = None
            for item in existing_items:
                item_url = item.get("url", "") if hasattr(item, "get") else getattr(item, "url", "")
                if r["path"] in item_url or item_url.startswith(r["path"]):
                    found_item = item
                    break

            if found_item is None:
                _LOGGER.info("Automatically registering Lovelace resource: %s", r["url"])
                await resources.async_create_item({
                    "url": r["url"],
                    "res_type": "module"
                })
            else:
                found_url = found_item.get("url", "") if hasattr(found_item, "get") else getattr(found_item, "url", "")
                # If URL query string differs, update to bust browser cache automatically!
                if found_url != r["url"]:
                    _LOGGER.info(
                        "Updating Lovelace resource for cache busting: %s -> %s",
                        found_url,
                        r["url"]
                    )
                    found_item_id = found_item.get("id") if hasattr(found_item, "get") else getattr(found_item, "id", None)
                    if found_item_id:
                        await resources.async_update_item(found_item_id, {
                            "url": r["url"],
                            "res_type": "module"
                        })
    except Exception as err:
        _LOGGER.error("Failed to automatically register Lovelace resources: %s", err)


