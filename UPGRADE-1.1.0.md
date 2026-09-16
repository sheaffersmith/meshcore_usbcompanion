# MeshCore Bot 1.1.0

The bot now sends a flood advertisement whenever it connects to the USB
companion. Nearby MeshCore clients can discover the bot as a contact instead
of manually entering its public key.

`ADVERTISE_ON_START` defaults to `true`. Add this to `.env` only if you want
to set it explicitly:

```dotenv
ADVERTISE_ON_START=true
```

After updating and restarting the service, remove any manually entered bot
contact from the phone app. The USB companion should appear again from its
fresh advertisement; use that discovered contact for private messages.
