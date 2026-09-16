# MeshCore Bot 1.2.0

The USB bot now mirrors the MeshCore app's **Overwrite Oldest** behavior.

When a new advert arrives:

1. Existing contacts are updated normally.
2. New contacts are added while space remains.
3. At the 350-contact limit, only the contact with the oldest advert time is
   removed before the new contact is added.
4. Every add, update, skip, and replacement is recorded in
   `logs/contact-management.log`.

The defaults are:

```dotenv
OVERWRITE_OLDEST_CONTACTS=true
CONTACT_CAPACITY=350
```

Set `OVERWRITE_OLDEST_CONTACTS=false` to stop automatic replacement when the
list is full.
