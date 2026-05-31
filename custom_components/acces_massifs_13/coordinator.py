"""Data update coordinator for Accès Massifs Forestiers 13."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.update_coordinator import (
    DataUpdateCoordinator,
    UpdateFailed,
)

from .const import (
    DATA_URL_TEMPLATE,
    DOMAIN,
    LEVEL_COLORS,
    LEVEL_LABELS,
    MASSIFS,
    SEASON_END_DAY,
    SEASON_END_MONTH,
    SEASON_START_DAY,
    SEASON_START_MONTH,
)
from .storage import AccesMassifsStorage

_LOGGER = logging.getLogger(__name__)

UPDATE_INTERVAL_IN_SEASON = timedelta(hours=1)
UPDATE_INTERVAL_OFF_SEASON = timedelta(hours=6)


class AccesMassifsCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Fetch massif access data and keep it up‑to‑date."""

    def __init__(
        self,
        hass: HomeAssistant,
        storage: AccesMassifsStorage,
        scan_hour: int,
        scan_minute: int,
    ) -> None:
        """Initialise the coordinator.

        Args:
            hass: The Home Assistant instance.
            storage: Persistent storage helper.
            scan_hour: Preferred hour for the daily scan (informational –
                the actual polling uses *update_interval*).
            scan_minute: Preferred minute for the daily scan.
        """
        self.storage = storage
        self.scan_hour = scan_hour
        self.scan_minute = scan_minute

        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=self._compute_interval(),
        )

        # Track the daily scan time
        self._unsub_track_time = async_track_time_change(
            hass,
            self._handle_daily_scan_time,
            hour=self.scan_hour,
            minute=self.scan_minute,
            second=0,
        )

    # ── Helpers ────────────────────────────────────────────────────────────

    async def _handle_daily_scan_time(self, _datetime_now: datetime) -> None:
        """Triggered at the daily scan time to fetch fresh data."""
        _LOGGER.info(
            "Scheduled daily scan time reached (%02d:%02d) - triggering data refresh",
            self.scan_hour,
            self.scan_minute,
        )
        await self.async_request_refresh()

    async def async_unload(self) -> None:
        """Unload the coordinator and cancel any scheduled tasks."""
        if self._unsub_track_time:
            self._unsub_track_time()
            self._unsub_track_time = None

    @staticmethod
    def _is_in_season(now: datetime | None = None) -> bool:
        """Return *True* when the current date falls within the active season."""
        if now is None:
            now = datetime.now()
        season_start = now.replace(
            month=SEASON_START_MONTH, day=SEASON_START_DAY,
            hour=0, minute=0, second=0, microsecond=0,
        )
        season_end = now.replace(
            month=SEASON_END_MONTH, day=SEASON_END_DAY,
            hour=23, minute=59, second=59, microsecond=999999,
        )
        return season_start <= now <= season_end

    def _compute_interval(self) -> timedelta:
        """Choose a polling interval depending on the season."""
        return (
            UPDATE_INTERVAL_IN_SEASON
            if self._is_in_season()
            else UPDATE_INTERVAL_OFF_SEASON
        )

    async def _fetch_json(
        self, date_str: str
    ) -> dict[str, Any] | None:
        """Fetch a single day's JSON file from the remote server.

        Returns *None* when the server responds with 404 (data not yet
        published) or any other non‑200 status.
        """
        session = async_get_clientsession(self.hass)
        url = DATA_URL_TEMPLATE.format(date=date_str)

        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status == 404:
                    _LOGGER.debug(
                        "Data not (yet) available for %s (HTTP 404)", date_str
                    )
                    return None
                if resp.status != 200:
                    _LOGGER.warning(
                        "Unexpected HTTP %s when fetching %s", resp.status, url
                    )
                    return None
                return await resp.json(content_type=None)
        except aiohttp.ClientError as err:
            _LOGGER.warning("Network error fetching %s: %s", url, err)
            return None
        except ValueError as err:
            _LOGGER.warning("JSON decode error for %s: %s", url, err)
            return None

    @staticmethod
    def _parse_massif_data(
        raw: dict[str, Any] | None, massif_id: str
    ) -> tuple[int, int]:
        """Extract *(level, procedure)* for a massif from a raw JSON payload.

        Returns ``(0, 0)`` when data is missing.
        """
        if raw is None:
            return (0, 0)
        massifs_raw = raw.get("massifs", {})
        entry = massifs_raw.get(massif_id)
        if entry is None or not isinstance(entry, list) or len(entry) < 2:
            return (0, 0)
        try:
            return (int(entry[0]), int(entry[1]))
        except (TypeError, ValueError):
            return (0, 0)

    # ── Core update logic ──────────────────────────────────────────────────

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch fresh data from the remote API."""
        now = datetime.now()
        in_season = self._is_in_season(now)

        # Adjust polling cadence dynamically
        self.update_interval = self._compute_interval()

        today_str = now.strftime("%Y%m%d")
        tomorrow_str = (now + timedelta(days=1)).strftime("%Y%m%d")

        _LOGGER.debug("Fetching data for today=%s, tomorrow=%s", today_str, tomorrow_str)

        try:
            raw_today = await self._fetch_json(today_str)
            raw_tomorrow = await self._fetch_json(tomorrow_str)
        except Exception as err:
            raise UpdateFailed(f"Error fetching massif data: {err}") from err

        massifs_out = {}
        today_storage: dict[str, Any] = {}

        for m_id, m_info in MASSIFS.items():
            # Today's level and procedure
            if raw_today is not None:
                today_level, today_proc = self._parse_massif_data(raw_today, m_id)
            else:
                today_level, today_proc = (1 if not in_season else 0), 0

            # Tomorrow's level and procedure
            if raw_tomorrow is not None:
                tmrw_level, tmrw_proc = self._parse_massif_data(raw_tomorrow, m_id)
            else:
                tmrw_level, tmrw_proc = (1 if not in_season else 0), 0

            massifs_out[m_id] = {
                "name": m_info["name"],
                "today_level": today_level,
                "today_color": LEVEL_COLORS.get(today_level, "unknown"),
                "today_label": LEVEL_LABELS.get(today_level, "Non disponible"),
                "today_procedure": today_proc,
                "tomorrow_level": tmrw_level,
                "tomorrow_color": LEVEL_COLORS.get(tmrw_level, "unknown"),
                "tomorrow_label": LEVEL_LABELS.get(tmrw_level, "Non disponible"),
                "tomorrow_procedure": tmrw_proc,
                "latitude": m_info["latitude"],
                "longitude": m_info["longitude"],
            }

            # Prepare data for persistent storage (today only)
            today_storage[m_id] = {
                "level": today_level,
                "procedure": today_proc,
            }

        # Persist today's snapshot if available
        if raw_today is not None:
            await self.storage.async_save_day(today_str, today_storage)

        history = await self.storage.async_get_all_history()

        return {
            "is_season": in_season,
            "today_date": today_str,
            "tomorrow_date": tomorrow_str,
            "massifs": massifs_out,
            "history": history,
        }
