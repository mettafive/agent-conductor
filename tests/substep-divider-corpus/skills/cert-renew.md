# Skill: cert-renew

**Shape:** iterates over each domain in domains.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **check expiry** — check expiry, expiration.
- **renew** — renew, issue cert.
- **reload server** — reload, restart nginx.  _(visibility divider — no hard gate needed)_
- **verify chain** — verify chain, ssl check.

## Procedure
For each domain in domains:
  1. check expiry — check expiry, expiration.
  2. renew — renew, issue cert.
  3. reload server — reload, restart nginx.
  4. verify chain — verify chain, ssl check.
