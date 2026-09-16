# MeshCore Bot 1.2.2

This release enables host-managed contacts on the USB companion at startup.
That mode is required for the bot to receive new-contact adverts and implement
**Overwrite Oldest** when the firmware contact list is already full.

The default is:

```dotenv
MANAGE_CONTACTS=true
```

With contact management enabled, the bot:

1. Receives new adverts from the USB companion.
2. Updates existing contacts.
3. Adds new contacts when space exists.
4. Replaces only the oldest non-favorite at the configured capacity.
5. Never selects `CONTACT_FAVORITES` for automatic removal.
