# MeshCore Bot 1.2.1

This release adds protected favorite contacts to **Overwrite Oldest** contact
management. Favorite contacts are never selected for automatic removal.

`smiths16` is protected by default. Add more exact contact names or full public
keys as a comma-separated list in `.env`:

```dotenv
CONTACT_FAVORITES=smiths16,Pinehurst-Repeater-Test
```

Names are matched case-insensitively. Full public keys can be used when names
might change or are not unique.
