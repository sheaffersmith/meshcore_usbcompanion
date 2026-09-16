# Upgrade to 1.3.0

Version 1.3.0 makes channel bot replies use the same received MeshCore region
scope shown by the companion app (for example, `us-ga`).

No `.env` change is required for standard US scopes. The bot includes all US
state and territory scopes. If your mesh uses custom scope names, add them as a
comma-separated list:

```dotenv
REGION_SCOPES=my-custom-region,another-region
```

After pulling on the Raspberry Pi:

```bash
cd ~/meshcore_usbcompanion
git pull --ff-only
npm ci
node --test
sudo systemctl restart meshcore-usbcompanion.service
sudo journalctl -u meshcore-usbcompanion.service -f
```

At startup, look for `Received-scope replies: enabled`. When the bot receives a
scoped trigger, its log will show `Received scope: ...` and `Reply scope: ...`.
If a scoped packet uses an unknown custom name, the bot intentionally skips the
reply instead of accidentally sending it unscoped.
