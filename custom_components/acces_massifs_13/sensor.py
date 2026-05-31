"""Sensor platform for Accès Massifs Forestiers 13."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, MASSIFS
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
    """Set up sensors from a config entry."""
    coordinator: AccesMassifsCoordinator = hass.data[DOMAIN][entry.entry_id]

    entities: list[SensorEntity] = []

    # One sensor per massif
    for massif_id, massif_info in MASSIFS.items():
        entities.append(
            AccesMassifSensor(
                coordinator=coordinator,
                massif_id=massif_id,
                massif_name=str(massif_info["name"]),
                entry_id=entry.entry_id,
            )
        )

    # Summary sensor
    entities.append(
        AccesMassifsSummarySensor(
            coordinator=coordinator,
            entry_id=entry.entry_id,
        )
    )

    async_add_entities(entities)


class AccesMassifSensor(CoordinatorEntity[AccesMassifsCoordinator], SensorEntity):
    """Sensor representing access status for a single massif."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: AccesMassifsCoordinator,
        massif_id: str,
        massif_name: str,
        entry_id: str,
    ) -> None:
        """Initialise the massif sensor."""
        super().__init__(coordinator)
        self._massif_id = massif_id
        self._massif_name = massif_name
        self._attr_unique_id = f"acces_massifs_13_{massif_id}"
        self._attr_translation_key = f"massif_{massif_id}"
        self._entry_id = entry_id

    # ── Properties ─────────────────────────────────────────────────────────

    @property
    def name(self) -> str:
        """Return the display name."""
        return f"Accès Massif {self._massif_name}"

    @property
    def device_info(self) -> DeviceInfo:
        """Group all massif sensors under a single device."""
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry_id)},
            name=DEVICE_NAME,
            manufacturer=DEVICE_MANUFACTURER,
            model=DEVICE_MODEL,
            entry_type=DeviceEntryType.SERVICE,
        )

    @property
    def _massif_data(self) -> dict[str, Any]:
        """Shortcut to the current massif data from the coordinator."""
        if self.coordinator.data is None:
            return {}
        return self.coordinator.data.get("massifs", {}).get(self._massif_id, {})

    @property
    def native_value(self) -> str | None:
        """Return today's access label."""
        data = self._massif_data
        if not data:
            return "Non disponible"
        return data.get("today_label", "Non disponible")

    @property
    def icon(self) -> str:
        """Return an icon reflecting the access status."""
        data = self._massif_data
        color = data.get("today_color", "unknown")
        if color == "green":
            return "mdi:pine-tree"
        if color == "red":
            return "mdi:pine-tree-fire"
        return "mdi:help-circle-outline"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose detailed attributes for dashboards & automations."""
        data = self._massif_data
        coord_data = self.coordinator.data or {}
        return {
            "massif_id": self._massif_id,
            "massif_name": self._massif_name,
            "level": data.get("today_level"),
            "color": data.get("today_color"),
            "procedure": data.get("today_procedure"),
            "tomorrow_level": data.get("tomorrow_level"),
            "tomorrow_color": data.get("tomorrow_color"),
            "tomorrow_label": data.get("tomorrow_label"),
            "latitude": data.get("latitude"),
            "longitude": data.get("longitude"),
            "is_season": coord_data.get("is_season"),
        }


class AccesMassifsSummarySensor(
    CoordinatorEntity[AccesMassifsCoordinator], SensorEntity
):
    """Summary sensor aggregating all massif statuses."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: AccesMassifsCoordinator,
        entry_id: str,
    ) -> None:
        """Initialise the summary sensor."""
        super().__init__(coordinator)
        self._attr_unique_id = "acces_massifs_13_summary"
        self._entry_id = entry_id

    # ── Properties ─────────────────────────────────────────────────────────

    @property
    def name(self) -> str:
        """Return the display name."""
        return "Accès Massifs 13 - Résumé"

    @property
    def device_info(self) -> DeviceInfo:
        """Group under the same device as individual sensors."""
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry_id)},
            name=DEVICE_NAME,
            manufacturer=DEVICE_MANUFACTURER,
            model=DEVICE_MODEL,
            entry_type=DeviceEntryType.SERVICE,
        )

    @property
    def icon(self) -> str:
        """Return a summary icon."""
        return "mdi:forest"

    @property
    def _massifs_data(self) -> dict[str, Any]:
        if self.coordinator.data is None:
            return {}
        return self.coordinator.data.get("massifs", {})

    @property
    def native_value(self) -> int:
        """Return the count of massifs with access forbidden today."""
        return sum(
            1
            for m in self._massifs_data.values()
            if m.get("today_color") == "red"
        )

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Provide aggregated data for dashboards."""
        massifs = self._massifs_data
        coord_data = self.coordinator.data or {}

        total = len(massifs)
        forbidden = sum(
            1 for m in massifs.values() if m.get("today_color") == "red"
        )
        accessible = sum(
            1 for m in massifs.values() if m.get("today_color") == "green"
        )
        unknown = total - forbidden - accessible

        # Full per‑massif data for Lovelace cards (map, heatmap, etc.)
        massifs_summary: dict[str, dict[str, Any]] = {}
        for m_id, m_data in massifs.items():
            massifs_summary[m_id] = {
                "name": m_data.get("name"),
                "today_level": m_data.get("today_level"),
                "today_label": m_data.get("today_label"),
                "today_color": m_data.get("today_color"),
                "today_procedure": m_data.get("today_procedure"),
                "tomorrow_level": m_data.get("tomorrow_level"),
                "tomorrow_label": m_data.get("tomorrow_label"),
                "tomorrow_color": m_data.get("tomorrow_color"),
                "tomorrow_procedure": m_data.get("tomorrow_procedure"),
                "latitude": m_data.get("latitude"),
                "longitude": m_data.get("longitude"),
            }

        return {
            "total_massifs": total,
            "accessible_count": accessible,
            "forbidden_count": forbidden,
            "unknown_count": unknown,
            "is_season": coord_data.get("is_season"),
            "today_date": coord_data.get("today_date"),
            "tomorrow_date": coord_data.get("tomorrow_date"),
            "massifs": massifs_summary,
            "history": coord_data.get("history", {}),
        }
