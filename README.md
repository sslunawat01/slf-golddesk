# SLF GoldDesk
Gold loan management system for S Lunawat Finance (NBFC, Nashik).

- `engine/` — pure interest engine (retroactive slabs, cycle anchoring, penal grace,
  universal ₹10 round-up, min-15 lifetime floor) + 47 golden tests
- `db/`     — PostgreSQL schema v1 (80 tables; business rules enforced as constraints)
              and seed canon
- `backup.sh` — nightly database backup to S3 (2:30 AM IST)

Built with Claude as architect/developer. Rules are data; facts are append-only;
derived values are never stored.
