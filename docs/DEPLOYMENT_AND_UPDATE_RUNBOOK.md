# Deployment and Update Runbooks

The production process is split into these runbooks:

- `docs/FIRST_TIME_INSTALLATION_RUNBOOK.md` covers installing the POS on a fresh Windows desktop or restaurant POS desktop.
- `docs/UPDATE_0_6_0_TO_0_7_0.md` covers the one-time upgrade from unlicensed 0.6.0 to licensed 0.7.0, including database encryption. Use it only for a PC that is still on 0.6.0.
- `docs/PRODUCTION_UPDATE_RUNBOOK.md` covers preparing, publishing, running, and rolling back every application update from 0.7.0 onward.

Use the first-time installation runbook for new restaurants or rebuilt machines.
Use the 0.6.0 to 0.7.0 runbook only for that upgrade.
Use the production update runbook after the app is already on 0.7.0 or newer and a later release needs to be deployed.
