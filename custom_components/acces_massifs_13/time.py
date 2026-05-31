"""Time platform for Accès Massifs Forestiers 13."""

from __future__ import annotations

from datetime import time
import logging

from homeassistant.components.time import TimeEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    CONF_SCAN_HOUR,
    CONF_SCAN_MINUTE,
    DEFAULT_SCAN_HOUR,
    DEFAULT_SCAN_MINUTE,
    DOMAIN,
)
from .coordinator import AccesMassifsCoordinator

_LOGGER = logging.getLogger(__name__)

DEVICE_NAME = "Accès Massifs Forestiers 13"
DEVICE_MANUFACTURER = "Préfecture des Bouches-du-Rhône"
DEVICE_MODEL = "Risque Incendie Forêt"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the time entities from a config entry."""
    coordinator: AccesMassifsCoordinator = hass.data[DOMAIN][entry.entry_id]

    async_add_entities(
        [
            AccesMassifsScanTimeEntity(
                coordinator=coordinator,
                entry=entry,
            )
        ]
    )


class AccesMassifsScanTimeEntity(TimeEntity):
    """Representation of the scan time entity."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: AccesMassifsCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialise the scan time entity."""
        self.coordinator = coordinator
        self.entry = entry
        self._attr_unique_id = f"{entry.entry_id}_scan_time"
        self._attr_translation_key = "scan_time"

    @property
    def name(self) -> str:
        """Return the name of the entity."""
        return "Heure de récupération"

    @property
    def device_info(self) -> DeviceInfo:
        """Group under the same device as individual sensors."""
        return DeviceInfo(
            identifiers={(DOMAIN, self.entry.entry_id)},
            name=DEVICE_NAME,
            manufacturer=DEVICE_MANUFACTURER,
            model=DEVICE_MODEL,
            entry_type=DeviceEntryType.SERVICE,
        )

    @property
    def native_value(self) -> time:
        """Return the time value."""
        return time(
            hour=self.coordinator.scan_hour,
            minute=self.coordinator.scan_minute,
        )

    async def async_set_value(self, value: time) -> None:
        """Set the time value."""
        _LOGGER.info("Setting retrieval time to %s", value)
        
        # Update config entry options
        new_options = {
            **self.entry.options,
            CONF_SCAN_HOUR: value.hour,
            CONF_SCAN_MINUTE: value.minute,
        }
        
        self.hass.config_entries.async_update_entry(
            self.entry,
            options=new_options,
        )
