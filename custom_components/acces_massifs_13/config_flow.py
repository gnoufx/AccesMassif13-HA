"""Config flow for Accès Massifs Forestiers 13."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback

from .const import (
    CONF_SCAN_HOUR,
    CONF_SCAN_MINUTE,
    DEFAULT_SCAN_HOUR,
    DEFAULT_SCAN_MINUTE,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)


class AccesMassifsConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Accès Massifs Forestiers 13."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle the initial step."""
        # Only one instance allowed
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(
                title="Accès Massifs Forestiers 13",
                data=user_input,
            )

        schema = vol.Schema(
            {
                vol.Required(
                    CONF_SCAN_HOUR, default=DEFAULT_SCAN_HOUR
                ): vol.All(vol.Coerce(int), vol.Range(min=0, max=23)),
                vol.Required(
                    CONF_SCAN_MINUTE, default=DEFAULT_SCAN_MINUTE
                ): vol.All(vol.Coerce(int), vol.Range(min=0, max=59)),
            }
        )

        return self.async_show_form(step_id="user", data_schema=schema)

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: ConfigEntry,
    ) -> AccesMassifsOptionsFlow:
        """Return the options flow handler."""
        return AccesMassifsOptionsFlow(config_entry)


class AccesMassifsOptionsFlow(OptionsFlow):
    """Handle options for Accès Massifs Forestiers 13."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        """Initialise the options flow."""
        self._config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current = self._config_entry.options or self._config_entry.data

        schema = vol.Schema(
            {
                vol.Required(
                    CONF_SCAN_HOUR,
                    default=current.get(CONF_SCAN_HOUR, DEFAULT_SCAN_HOUR),
                ): vol.All(vol.Coerce(int), vol.Range(min=0, max=23)),
                vol.Required(
                    CONF_SCAN_MINUTE,
                    default=current.get(CONF_SCAN_MINUTE, DEFAULT_SCAN_MINUTE),
                ): vol.All(vol.Coerce(int), vol.Range(min=0, max=59)),
            }
        )

        return self.async_show_form(step_id="init", data_schema=schema)
