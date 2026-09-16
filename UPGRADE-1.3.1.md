# Upgrade to 1.3.1

Version 1.3.1 mirrors the received channel message's routing scope:

- A scoped trigger receives a reply in that same scope.
- An unscoped trigger receives an explicitly unscoped reply.
- A scoped trigger whose region name cannot be resolved is still skipped to
  prevent an accidental reply in the wrong scope.

The bot restores the USB companion's configured default scope after each reply.
No `.env` change is required for this upgrade.

After pulling on the Raspberry Pi:

```bash
cd ~/meshcore_usbcompanion
git pull --ff-only
npm ci
npm test
sudo systemctl restart meshcore-usbcompanion.service
sudo journalctl -u meshcore-usbcompanion.service -f
```

For an unscoped trigger, the service should log:

```text
Received scope: unscoped
Reply scope: unscoped
Response sent.
```
