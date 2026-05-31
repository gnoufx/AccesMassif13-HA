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


async def _async_register_lovelace_resources(hass: HomeAssistant) -> None:
    """Register the Lovelace card resources programmatically if using storage mode."""
    lovelace = hass.data.get("lovelace")
    if not lovelace:
        _LOGGER.debug("Lovelace not loaded, skipping resource registration")
        return

    if not hasattr(lovelace, "resources"):
        _LOGGER.debug("Lovelace is not in storage mode, skipping resource registration")
        return

    resources = lovelace.resources
    if not hasattr(resources, "async_items") or not hasattr(resources, "async_create_item"):
        return

    if not resources.loaded:
        await resources.async_load()

    urls_to_register = [
        f"/local/community/{DOMAIN}/acces-massifs-forecast-card.js",
        f"/local/community/{DOMAIN}/acces-massifs-history-card.js",
    ]

    current_urls = {
        res.get("url") if hasattr(res, "get") else getattr(res, "url", None)
        for res in resources.async_items()
    }

    for url in urls_to_register:
        if url not in current_urls:
            _LOGGER.info("Registering Lovelace resource automatically: %s", url)
            await resources.async_create_item({
                "res_type": "module",
                "url": url,
            })


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

    # Using the current integration version for query cache-busting
    version = "1.0.1"

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
                item_url = item.get("url", "")
                if r["path"] in item_url or item_url.startswith(r["path"]):
                    found_item = item
                    break

            if found_item is None:
                _LOGGER.info("Automatically registering Lovelace resource: %s", r["url"])
                await resources.async_create_item({
                    "url": r["url"],
                    "type": "module"
                })
            else:
                # If URL query string differs, update to bust browser cache automatically!
                if found_item.get("url") != r["url"]:
                    _LOGGER.info(
                        "Updating Lovelace resource for cache busting: %s -> %s",
                        found_item.get("url"),
                        r["url"]
                    )
                    await resources.async_update_item(found_item["id"], {
                        "url": r["url"],
                        "type": "module"
                    })
    except Exception as err:
        _LOGGER.error("Failed to automatically register Lovelace resources: %s", err)

