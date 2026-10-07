# Avito feed and public photos

This repository publishes `avito.xml` and JPG/PNG photos for Avito Autoload
on GitHub Pages. Avito Flow itself remains private and is not deployed here.

The feed is refreshed hourly by GitHub Actions. The private source URL is kept
in the repository secret `SOURCE_FEED_URL` and is never committed. The workflow
also runs after publisher-code changes and can be started manually in Actions.

The publisher downloads each photo, checks the file structure and size, saves
the exact original bytes in `media/`, and replaces only the image URLs in XML.
Listing IDs, titles, descriptions (including CDATA), prices and addresses are
preserved. SHA-256 filenames are for integrity and reuse, not image disguising.
Only `_site/` is deployed: no source secrets or private application files.

If a photo cannot download or validate, the workflow fails and does not deploy
an incomplete feed. Already mirrored photos are reused, and old public photo
files stay available. An empty source feed is supported for withdrawing ads.

## One-time connection

In repository Settings → Pages choose **GitHub Actions** as the source.
After a successful run, copy the deployed `avito.xml` URL into Avito Autoload.
Do not add it as a second feed alongside an older copy of the same ads: replace
the old URL. Future listing changes from Avito Flow then refresh hourly.

## Limits

Only public HTTPS images, JPG/PNG up to 25 MB each, and 1–10 photos per ad are
accepted by this publisher. At 750 MB of stored photos, publication stops with
a message to migrate to a larger object store; old files are not deleted.
GitHub's own service limits and availability still apply. Actual Avito photo
acceptance must be checked in the next Autoload report.

## Local tests

`python3 -m unittest discover -s tests -v`
