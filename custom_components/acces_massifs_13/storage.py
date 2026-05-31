"""Persistent storage for Accès Massifs Forestiers 13 history data."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

_LOGGER = logging.getLogger(__name__)

STORAGE_KEY = "acces_massifs_13_history"
STORAGE_VERSION = 1


class AccesMassifsStorage:
    """Manage persistent storage for daily massif access history."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialise the storage helper."""
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, STORAGE_KEY
        )
        self._data: dict[str, Any] | None = None

    async def async_load(self) -> dict[str, Any]:
        """Load stored data from disk.

        Returns an empty dict if nothing has been persisted yet.
        """
        if self._data is None:
            stored: dict[str, Any] | None = await self._store.async_load()
            self._data = stored if stored is not None else {}
        return self._data

    async def async_save_day(
        self, date_str: str, massifs_data: dict[str, Any]
    ) -> None:
        """Persist one day's massif data.

        Args:
            date_str: Date key in ``YYYYMMDD`` format.
            massifs_data: Mapping of massif‑id → level/procedure data for the
                given day.
        """
        if self._data is None:
            await self.async_load()
        assert self._data is not None  # noqa: S101 – guaranteed by async_load

        self._data[date_str] = massifs_data
        await self._store.async_save(self._data)
        _LOGGER.debug("Saved massif data for %s", date_str)

    async def async_get_history(
        self, year: int | None = None
    ) -> dict[str, Any]:
        """Return stored history, optionally filtered to a single year.

        Args:
            year: If provided only entries whose date key starts with the given
                four‑digit year are returned.

        Returns:
            A dict of ``{date_str: massifs_data}`` entries.
        """
        if self._data is None:
            await self.async_load()
        assert self._data is not None  # noqa: S101

        if year is None:
            return dict(self._data)

        year_prefix = str(year)
        return {
            k: v for k, v in self._data.items() if k.startswith(year_prefix)
        }

    async def async_get_all_history(self) -> dict[str, Any]:
        """Return the complete stored history for Lovelace cards."""
        if self._data is None:
            await self.async_load()
        assert self._data is not None  # noqa: S101
        return dict(self._data)
